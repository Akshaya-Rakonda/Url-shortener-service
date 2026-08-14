'use strict';

const express = require('express');
const {
  buildGreenfieldPipeline,
  buildBrownfieldPipeline,
  buildAmbiguousPipeline,
} = require('../orchestration/pipelines');
const { requireApiKey } = require('../middleware/auth');

const router = express.Router();

// Keep track of running pipelines
const activePipelines = new Map();

// POST /api/v1/orchestrate/greenfield
router.post('/greenfield', requireApiKey, async (req, res, next) => {
  try {
    const { url, customAlias, ttlDays } = req.body;

    if (!url) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'url is required' },
      });
    }

    const engine = buildGreenfieldPipeline({
      originalUrl: url,
      customAlias,
      ttlDays,
      userId: req.user.id,
    });

    
    activePipelines.set(engine.executionId, engine);

    const result = await engine.run({ userId: req.user.id });

    activePipelines.delete(engine.executionId);

    res.status(201).json({
      success: true,
      data: {
        executionId: result.executionId,
        shortCode: result.context.shortCode,
        shortUrl: result.context.shortUrl,
        originalUrl: result.context.normalizedUrl,
        validationPassed: result.context.validationPassed,
        docEntry: result.context.docEntry,
        metrics: result.metrics,
        auditLog: result.auditLog,
      },
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/orchestrate/brownfield
router.post('/brownfield', requireApiKey, async (req, res, next) => {
  try {
    const { updates } = req.body;

    if (!Array.isArray(updates) || updates.length === 0) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'updates must be a non-empty array' },
      });
    }

    const engine = buildBrownfieldPipeline(updates);
    activePipelines.set(engine.executionId, engine);

    const result = await engine.run({ userId: req.user.id });
    activePipelines.delete(engine.executionId);

    res.json({
      success: true,
      data: {
        executionId: result.executionId,
        updateResults: result.context.updateResults,
        verificationResults: result.context.verificationResults,
        metrics: result.metrics,
        auditLog: result.auditLog,
      },
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/orchestrate/ambiguous
router.post('/ambiguous', requireApiKey, async (req, res, next) => {
  try {
    const { description } = req.body;

    if (!description) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'description is required' },
      });
    }

    const engine = buildAmbiguousPipeline({ description });
    activePipelines.set(engine.executionId, engine);

    const result = await engine.run({ userId: req.user.id });
    activePipelines.delete(engine.executionId);

    res.json({
      success: true,
      data: {
        executionId: result.executionId,
        improvementPlan: result.context.improvementPlan,
        clarifications: result.context.clarifications,
        risks: result.context.risks,
        metrics: result.metrics,
        auditLog: result.auditLog,
      },
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/orchestrate/:executionId/approve/:stageId
router.post('/:executionId/approve/:stageId', requireApiKey, (req, res) => {
  const engine = activePipelines.get(req.params.executionId);
  if (!engine) {
    return res.status(404).json({
      success: false,
      error: { code: 'NOT_FOUND', message: 'Pipeline not found or already completed' },
    });
  }
  try {
    engine.approve(req.params.stageId, { approver: req.user.id });
    res.json({ success: true, data: { approved: true, stageId: req.params.stageId } });
  } catch (err) {
    res.status(400).json({ success: false, error: { code: 'APPROVAL_ERROR', message: err.message } });
  }
});

// POST /api/v1/orchestrate/:executionId/stop
router.post('/:executionId/stop', requireApiKey, (req, res) => {
  const engine = activePipelines.get(req.params.executionId);
  if (!engine) {
    return res.status(404).json({
      success: false,
      error: { code: 'NOT_FOUND', message: 'Pipeline not found or already completed' },
    });
  }
  engine.safeStop(req.body.reason || 'Operator requested stop');
  res.json({ success: true, data: { safeStopRequested: true } });
});

module.exports = router;