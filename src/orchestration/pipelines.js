'use strict';

const { OrchestrationEngine } = require('./engine');
const urlService = require('../core/urlService');
const config = require('../config');

// ── Pipeline 1: Greenfield ───────────────────────────────────────────────────
// Scenario: Brand new URL shortening request comes in
// Shows: requirement parsing → security → compliance → shorten → validate → docs

function buildGreenfieldPipeline(request, options = {}) {
  const engine = new OrchestrationEngine({
    name: 'greenfield-url-shorten',
    requireHumanApproval: options.requireHumanApproval || false,
  });

  engine.addStage({
    id: 'parse_requirements',
    name: 'Parse Requirements',
    type: 'task',
    parallel: false,
    policy: { maxRetries: 1, retryDelayMs: 500, timeoutMs: 5000 },
    handler: async (ctx) => {
      const { originalUrl, customAlias, ttlDays, userId } = request;

      if (!originalUrl) {
        throw Object.assign(
          new Error('originalUrl is required'),
          { code: 'VALIDATION_ERROR' }
        );
      }

      return {
        normalizedUrl: originalUrl.trim(),
        customAlias: customAlias?.trim() || null,
        ttlDays: ttlDays || config.url.defaultTtlDays,
        userId: userId || 'anonymous',
        parsedAt: new Date().toISOString(),
      };
    },
  });

  // Stage 2a: Security scan (runs in parallel with compliance check)
  engine.addStage({
    id: 'security_scan',
    name: 'Security Scan',
    type: 'gate',
    parallel: true,
    deps: ['parse_requirements'],
    policy: { maxRetries: 2, retryDelayMs: 500, timeoutMs: 10000 },
    handler: async (ctx) => {
      const blockedDomains = ['malware.example.com', 'phishing.example.com'];
      const urlObj = new URL(ctx.normalizedUrl);

      if (blockedDomains.some(d => urlObj.hostname.includes(d))) {
        throw Object.assign(
          new Error(`Domain '${urlObj.hostname}' is blocked by security policy`),
          { code: 'SECURITY_VIOLATION' }
        );
      }

      return {
        securityScanPassed: true,
        scannedDomain: urlObj.hostname,
      };
    },
  });

  // Stage 2b: Compliance check (runs in parallel with security scan)
  engine.addStage({
    id: 'compliance_check',
    name: 'Compliance Check',
    type: 'gate',
    parallel: true,
    deps: ['parse_requirements'],
    policy: { maxRetries: 1, retryDelayMs: 500, timeoutMs: 5000 },
    handler: async (ctx) => {
      // Anonymous users get shorter TTL
      const effectiveTtlDays = ctx.userId === 'anonymous'
        ? Math.min(ctx.ttlDays, 30)
        : ctx.ttlDays;

      return {
        compliancePassed: true,
        effectiveTtlDays,
        complianceNote: ctx.userId === 'anonymous'
          ? 'TTL capped to 30 days for anonymous users'
          : null,
      };
    },
  });


  engine.addStage({
    id: 'human_approval',
    name: 'Change Control Approval',
    type: 'approval',
    parallel: false,
    deps: ['security_scan', 'compliance_check'],
    requiresApproval: options.requireApproval || false,
    policy: { maxRetries: 0, retryDelayMs: 0, timeoutMs: 300000 },
    handler: async () => ({ approvalGranted: true }),
  });

  // Stage 4: Shorten the URL
  engine.addStage({
    id: 'shorten_url',
    name: 'Shorten URL',
    type: 'task',
    parallel: false,
    deps: ['human_approval'],
    policy: {
      maxRetries: 3,
      retryDelayMs: 500,
      timeoutMs: 10000,
      rollbackStageId: 'rollback_url',
    },
    handler: async (ctx) => {
      const record = await urlService.shorten({
        originalUrl: ctx.normalizedUrl,
        customAlias: ctx.customAlias,
        ttlDays: ctx.effectiveTtlDays || ctx.ttlDays,
        userId: ctx.userId,
      });

      return {
        shortCode: record.shortCode,
        shortUrl: `${config.baseUrl}/${record.shortCode}`,
        record,
      };
    },
  });

  // Stage 5a: Validate the created URL (parallel with generate_docs)
  engine.addStage({
    id: 'validate_output',
    name: 'Validate Output',
    type: 'task',
    parallel: true,
    deps: ['shorten_url'],
    policy: { maxRetries: 2, retryDelayMs: 500, timeoutMs: 5000 },
    handler: async (ctx) => {
      const resolved = await urlService.resolve(ctx.shortCode, {});

      if (resolved !== ctx.normalizedUrl) {
        throw Object.assign(
          new Error('Validation failed: resolved URL does not match original'),
          { code: 'VALIDATION_ERROR' }
        );
      }

      return { validationPassed: true };
    },
  });

  // Stage 5b: Generate documentation entry (parallel with validate_output)
  engine.addStage({
    id: 'generate_docs',
    name: 'Generate Documentation',
    type: 'task',
    parallel: true,
    deps: ['shorten_url'],
    policy: { maxRetries: 1, retryDelayMs: 500, timeoutMs: 5000 },
    handler: async (ctx) => ({
      docEntry: {
        endpoint: `GET /${ctx.shortCode}`,
        description: `Redirects to ${ctx.normalizedUrl}`,
        owner: ctx.userId,
        createdAt: ctx.record?.createdAt,
        expiresAt: ctx.record?.expiresAt,
      },
    }),
  });

  
  engine.addStage({
    id: 'rollback_url',
    name: 'Rollback URL Creation',
    type: 'rollback',
    deps: [],
    policy: { maxRetries: 1, retryDelayMs: 500, timeoutMs: 5000 },
    handler: async (ctx) => {
      if (ctx.shortCode) {
        try {
          await urlService.deactivate(ctx.shortCode, 'admin');
        } catch (_) { /* best effort */ }
      }
      return { rolledBack: true };
    },
  });

  return engine;
}

// ── Pipeline 2: Brownfield ───────────────────────────────────────────────────
// Scenario: Update existing URLs in bulk
// Shows: impact analysis → snapshot → update → verify → rollback on failure

function buildBrownfieldPipeline(updateRequests, options = {}) {
  const engine = new OrchestrationEngine({
    name: 'brownfield-bulk-update',
    requireHumanApproval: options.requireHumanApproval || false,
  });

  // Stage 1: Analyze impact
  engine.addStage({
    id: 'impact_analysis',
    name: 'Impact Analysis',
    type: 'task',
    parallel: false,
    policy: { maxRetries: 1, retryDelayMs: 500, timeoutMs: 10000 },
    handler: async () => {
      const impactedIds = updateRequests.map(r => r.shortCode);
      const riskLevel = impactedIds.length > 50 ? 'HIGH'
        : impactedIds.length > 10 ? 'MEDIUM' : 'LOW';

      return { impactedIds, riskLevel };
    },
  });

  // Stage 2: Take a snapshot before making changes
  engine.addStage({
    id: 'backup_snapshot',
    name: 'Backup Snapshot',
    type: 'task',
    deps: ['impact_analysis'],
    parallel: false,
    policy: { maxRetries: 2, retryDelayMs: 500, timeoutMs: 10000 },
    handler: async () => {
      const snapshots = {};
      for (const req of updateRequests) {
        try {
          snapshots[req.shortCode] = await urlService.get(req.shortCode);
        } catch (_) { /* record may not exist */ }
      }
      return { snapshots, snapshotTakenAt: new Date().toISOString() };
    },
  });

  // Stage 3: Apply the updates
  engine.addStage({
    id: 'apply_updates',
    name: 'Apply Updates',
    type: 'task',
    deps: ['backup_snapshot'],
    parallel: false,
    policy: {
      maxRetries: 1,
      retryDelayMs: 1000,
      timeoutMs: 30000,
      rollbackStageId: 'rollback_updates',
    },
    handler: async (ctx) => {
      const results = { succeeded: [], failed: [] };

      for (const req of updateRequests) {
        try {
          const record = await urlService.get(req.shortCode);
          if (req.updates.isActive !== undefined) {
            if (!req.updates.isActive) {
              await urlService.deactivate(req.shortCode, 'admin');
            }
          }
          results.succeeded.push({ shortCode: req.shortCode });
        } catch (err) {
          results.failed.push({ shortCode: req.shortCode, error: err.message });
        }
      }

      // Fail if more than 50% failed
      if (results.failed.length > updateRequests.length * 0.5) {
        throw Object.assign(
          new Error(`Too many failures: ${results.failed.length}/${updateRequests.length}`),
          { code: 'BULK_UPDATE_FAILURE' }
        );
      }

      return { updateResults: results };
    },
  });

  // Stage 4: Verify the updates
  engine.addStage({
    id: 'verify_updates',
    name: 'Verify Updates',
    type: 'task',
    deps: ['apply_updates'],
    parallel: false,
    policy: { maxRetries: 2, retryDelayMs: 500, timeoutMs: 10000 },
    handler: async (ctx) => {
      const verificationResults = [];

      for (const { shortCode } of ctx.updateResults.succeeded) {
        try {
          const current = await urlService.get(shortCode);
          verificationResults.push({ shortCode, verified: true, isActive: current.isActive });
        } catch (err) {
          verificationResults.push({ shortCode, verified: false, error: err.message });
        }
      }

      return { verificationResults };
    },
  });

  
  engine.addStage({
    id: 'rollback_updates',
    name: 'Rollback Updates',
    type: 'rollback',
    deps: [],
    policy: { maxRetries: 2, retryDelayMs: 500, timeoutMs: 15000 },
    handler: async (ctx) => {
      if (!ctx.snapshots) {
        return { rolledBack: false, reason: 'No snapshots available' };
      }

      const restored = [];
      for (const [shortCode, snapshot] of Object.entries(ctx.snapshots)) {
        try {
          if (snapshot.isActive) {
            // Re-activate if it was active before
            const store = require('../utils/store');
            store.set(shortCode, snapshot);
            restored.push(shortCode);
          }
        } catch (_) { /* best effort */ }
      }

      return { rolledBack: true, restored };
    },
  });

  return engine;
}

// ── Pipeline 3: Ambiguous ────────────────────────────────────────────────────
// Scenario: Vague request like "make our links more reliable"
// Shows: intent detection → risk assessment → parallel analysis → plan

function buildAmbiguousPipeline(ambiguousRequest, options = {}) {
  const engine = new OrchestrationEngine({
    name: 'ambiguous-requirement-pipeline',
    requireHumanApproval: options.requireHumanApproval || false,
  });

  // Stage 1: Interpret what the user actually wants
  engine.addStage({
    id: 'interpret_requirement',
    name: 'Interpret Requirement',
    type: 'task',
    parallel: false,
    policy: { maxRetries: 1, retryDelayMs: 500, timeoutMs: 10000 },
    handler: async () => {
      const text = ambiguousRequest.description?.toLowerCase() || '';

      // Map vague words to concrete tasks
      const intentMap = {
        'reliable': ['add_health_check', 'add_retry_logic', 'add_circuit_breaker'],
        'faster': ['add_caching', 'optimize_redirects'],
        'secure': ['add_rate_limiting', 'add_input_validation', 'add_security_headers'],
        'analytics': ['add_click_tracking', 'add_geo_detection', 'add_dashboard'],
      };

      const detectedIntents = [];
      const decomposedTasks = [];

      for (const [intent, tasks] of Object.entries(intentMap)) {
        if (text.includes(intent)) {
          detectedIntents.push(intent);
          decomposedTasks.push(...tasks);
        }
      }

      // Default fallback
      if (decomposedTasks.length === 0) {
        decomposedTasks.push('add_health_check', 'add_retry_logic');
      }

      const clarifications = [];
      if (text.includes('reliable') && !text.includes('99')) {
        clarifications.push('Target SLA not specified — defaulting to 99.9% uptime');
      }

      return {
        originalRequest: ambiguousRequest.description,
        detectedIntents,
        decomposedTasks: [...new Set(decomposedTasks)],
        clarifications,
        ambiguityScore: clarifications.length > 2 ? 'HIGH' : 'LOW',
      };
    },
  });

  // Stage 2: Assess risks
  engine.addStage({
    id: 'risk_assessment',
    name: 'Risk Assessment',
    type: 'gate',
    deps: ['interpret_requirement'],
    parallel: false,
    policy: { maxRetries: 1, retryDelayMs: 500, timeoutMs: 5000 },
    handler: async (ctx) => {
      const risks = [];
      const tradeoffs = [];

      if (ctx.decomposedTasks.includes('add_caching')) {
        risks.push('Cache invalidation complexity — stale URLs possible');
        tradeoffs.push('Latency vs consistency');
      }
      if (ctx.decomposedTasks.includes('add_circuit_breaker')) {
        risks.push('False positives may block valid requests');
        tradeoffs.push('Resilience vs availability');
      }

      return { risks, tradeoffs, riskLevel: risks.length > 2 ? 'HIGH' : 'MEDIUM' };
    },
  });

  // Stage 3a: Health check assessment (parallel)
  engine.addStage({
    id: 'health_check_assessment',
    name: 'Health Check Assessment',
    type: 'task',
    deps: ['risk_assessment'],
    parallel: true,
    policy: { maxRetries: 1, retryDelayMs: 500, timeoutMs: 5000 },
    handler: async (ctx) => {
      if (!ctx.decomposedTasks.includes('add_health_check')) {
        return { healthCheckSkipped: true };
      }
      return {
        healthCheckExists: true,
        healthCheckRecommendation: 'Enhance /health with dependency checks',
      };
    },
  });

  // Stage 3b: Analytics assessment (parallel)
  engine.addStage({
    id: 'analytics_assessment',
    name: 'Analytics Assessment',
    type: 'task',
    deps: ['risk_assessment'],
    parallel: true,
    policy: { maxRetries: 1, retryDelayMs: 500, timeoutMs: 5000 },
    handler: async (ctx) => {
      if (!ctx.decomposedTasks.includes('add_click_tracking')) {
        return { analyticsSkipped: true };
      }
      return {
        analyticsGaps: ['No geo detection', 'No referrer tracking'],
        analyticsRecommendation: 'Add geo detection and referrer tracking',
      };
    },
  });

  // Stage 4: Generate improvement plan
  engine.addStage({
    id: 'generate_plan',
    name: 'Generate Improvement Plan',
    type: 'task',
    deps: ['health_check_assessment', 'analytics_assessment'],
    parallel: false,
    policy: { maxRetries: 1, retryDelayMs: 500, timeoutMs: 5000 },
    handler: async (ctx) => ({
      improvementPlan: {
        summary: `Improvement plan for: "${ctx.originalRequest}"`,
        detectedIntents: ctx.detectedIntents,
        clarifications: ctx.clarifications,
        risks: ctx.risks,
        tradeoffs: ctx.tradeoffs,
        tasks: ctx.decomposedTasks.map(t => ({
          id: t,
          priority: t.includes('security') ? 'HIGH' : 'MEDIUM',
          status: 'planned',
        })),
        recommendations: [
          ctx.healthCheckRecommendation || 'Health checks already sufficient',
          ctx.analyticsRecommendation || 'Analytics already sufficient',
        ],
        generatedAt: new Date().toISOString(),
      },
    }),
  });

  return engine;
}

module.exports = {
  buildGreenfieldPipeline,
  buildBrownfieldPipeline,
  buildAmbiguousPipeline,
};