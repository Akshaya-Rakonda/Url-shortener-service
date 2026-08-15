# URL Shortener Service

A production-grade URL shortener built with Node.js and Express. It includes an agentic orchestration engine that automates multi-step engineering workflows using a dependency graph — supporting parallel execution, retries, rollbacks, human approval gates, and audit logging.

Built as part of a software engineering assessment to demonstrate end-to-end SDLC automation with controlled autonomy.

---

## Getting Started

Clone the repo and install dependencies:

```bash
git clone https://github.com/Akshaya-Rakonda/Url-shortener-service.git
cd Url-shortener-service
npm install
```

Create your environment file:

```bash
cp .env.example .env
```

Start the server:

```bash
npm start
```

Verify it is running:

```bash
curl http://localhost:3000/health
```

---

## What This Does

At its core this is a URL shortener — you give it a long URL, it gives you a short one. When someone visits the short link they get redirected to the original.

On top of that it has an orchestration engine that can run multi-stage pipelines. Each pipeline is a graph of tasks with dependencies. Tasks can run in parallel, retry on failure, roll back if something goes wrong, and pause for human approval when needed.

Three pipelines are included:

- **Greenfield** — takes a new URL request through security scanning, compliance checking, shortening, validation, and documentation generation
- **Brownfield** — handles bulk updates to existing URLs with snapshotting and rollback support
- **Ambiguous** — takes a vague requirement like "make our links more reliable" and breaks it down into concrete tasks with risk assessment

---

## Project Structure

src/
api/
urls.js # URL CRUD endpoints
analytics.js # Click analytics endpoints
orchestration.js # Pipeline trigger and control endpoints
core/
urlService.js # All URL business logic lives here
middleware/
auth.js # API key check
errorHandler.js # Centralized error responses
rateLimiter.js # Rate limiting per window
requestId.js # Unique ID on every request
orchestration/
dependencyGraph.js # DAG implementation with cycle detection
engine.js # Executes pipelines, handles retry/rollback/approval
pipelines.js # Greenfield, brownfield, ambiguous pipeline definitions
utils/
store.js # In-memory store (acts as the database)
config/
index.js # Reads environment variables
server.js # Express app setup and startup

tests/
unit/
store.test.js
urlService.test.js
orchestrationEngine.test.js
integration/
api.test.js


---

## API Reference

Every endpoint under `/api/v1/` requires an `x-api-key` header. The redirect endpoint and `/health` do not.

### Health Check

GET /health


### URL Endpoints

**Create a short URL**

POST /api/v1/urls
x-api-key: your-key

{
"url": "https://www.example.com/some/long/path",
"customAlias": "my-link",
"ttlDays": 30
}


To prevent duplicates on retry, pass an `idempotency-key` header. The same key will always return the same result.

**Redirect**

GET /:shortCode


Returns 301 redirect to the original URL. Click data is recorded in the background so redirect speed is not affected.

**List your URLs**

GET /api/v1/urls?page=1&limit=20
x-api-key: your-key


**Get a single URL**

GET /api/v1/urls/:shortCode
x-api-key: your-key


**Deactivate a URL**

DELETE /api/v1/urls/:shortCode
x-api-key: your-key


### Analytics Endpoints

**Get click analytics for a URL**

GET /api/v1/analytics/:shortCode
x-api-key: your-key


Returns total clicks broken down by device, browser, and referrer.

**Get top URLs by click count**

GET /api/v1/analytics/top/urls?limit=10
x-api-key: your-key


### Orchestration Endpoints

**Run the greenfield pipeline**

POST /api/v1/orchestrate/greenfield
x-api-key: your-key

{
"url": "https://www.example.com",
"customAlias": "my-link",
"ttlDays": 90
}


The response includes the created short URL, a full audit log of every stage that ran, and metrics like success rate and end-to-end latency.

**Run the brownfield pipeline**

POST /api/v1/orchestrate/brownfield
x-api-key: your-key

{
"updates": [
{ "shortCode": "abc1234", "updates": { "isActive": false } }
]
}


**Run the ambiguous pipeline**

POST /api/v1/orchestrate/ambiguous
x-api-key: your-key

{
"description": "make our links more reliable and secure"
}


Returns a structured improvement plan with detected intents, decomposed tasks, identified risks, and tradeoffs.

**Human approval controls**

POST /api/v1/orchestrate/:executionId/approve/:stageId
POST /api/v1/orchestrate/:executionId/reject/:stageId


**Safe stop a running pipeline**

POST /api/v1/orchestrate/:executionId/stop

{ "reason": "operator requested" }


**Re-plan when something changes**

POST /api/v1/orchestrate/:executionId/replan

{ "changedStageIds": ["parse_requirements"] }


---

## How the Orchestration Engine Works

The engine takes a set of stages, each with an optional list of dependencies, and figures out the correct execution order using a topological sort. Stages with no dependencies between them run in parallel.

Each stage has a policy that controls how many times it retries on failure, how long to wait between retries, and what rollback stage to invoke if it ultimately fails. The engine keeps a shared context object that flows through every stage, so each stage can read outputs from previous ones.

Every state change is written to an audit log. When the pipeline finishes you get back the final context, the full audit log, and a metrics summary.

### Greenfield Pipeline Stages
parse_requirements
security_scan + compliance_check (run in parallel)
human_approval
shorten_url
validate_output + generate_docs (run in parallel)

### Brownfield Pipeline Stages
impact_analysis
backup_snapshot
apply_updates -- rollback_updates (triggered on failure)
verify_updates

### Ambiguous Pipeline Stages
interpret_requirement
risk_assessment
health_check_assessment + analytics_assessment (run in parallel)
generate_plan

---

## Running Tests

```bash
# All tests with coverage report
npm test

# Unit tests only
npm run test:unit

# Integration tests only
npm run test:integration
```

The unit tests cover the store, URL service, and orchestration engine in isolation. The integration tests spin up the full Express app and hit every endpoint with supertest.

### Test Coverage

| Suite | What it covers |
|-------|----------------|
| store.test.js | URL CRUD, idempotency, analytics |
| urlService.test.js | Shorten, resolve, list, deactivate, validation |
| orchestrationEngine.test.js | DAG, retry, rollback, safe stop, re-planning |
| api.test.js | All HTTP endpoints end to end |

---

## Configuration

Set these in your `.env` file:

| Variable | Default | Description |
|----------|---------|-------------|
| PORT | 3000 | Port the server listens on |
| BASE_URL | http://localhost:3000 | Used when building short URLs |
| NODE_ENV | development | Environment name |
| DEFAULT_TTL_DAYS | 365 | How long URLs live by default |
| SHORT_CODE_LENGTH | 7 | Length of auto-generated short codes |

---

## Known Limitations

**In-memory store** — All data lives in process memory and is lost when the server restarts. For production this would be replaced with PostgreSQL for persistence and Redis for caching.

**Simplified authentication** — Right now any non-empty API key is accepted. A real implementation would validate keys against a database and support user accounts.

**No geo detection** — The analytics record device and browser but not location. That would need a GeoIP service like MaxMind.

**Single process** — The orchestration engine state lives in memory so running multiple instances would not work without a shared state store like Redis.

---

## Engineering Summary

### What was built

A URL shortener with a DAG-based agentic orchestration engine. The orchestration layer can run multi-step workflows with parallel stages, retries, rollbacks, human approval gates, safe stop, dynamic re-planning, and a full audit trail. Three pipeline scenarios demonstrate greenfield, brownfield, and ambiguous requirement handling.

### Key decisions

The in-memory store was a deliberate choice to keep the prototype runnable without any infrastructure setup. The store interface is designed to be swappable — replacing it with a real database adapter would not require changes anywhere else in the codebase.

Analytics writes happen in a setImmediate callback so they never block the redirect response. This means redirect latency stays low even under high analytics write load.

Idempotency is handled at two levels — an explicit idempotency-key header for client-controlled deduplication, and implicit duplicate detection when the same URL is submitted by the same user without a custom alias.


### Reliability Metrics

Every pipeline run returns a metrics object that includes:

- **successRate** — ratio of completed stages to total stages attempted
- **retryCount** — total number of stage retries across the pipeline
- **rollbackCount** — number of rollback stages that were triggered
- **e2eLatencyMs** — total wall clock time from pipeline start to finish
- **MTTR (Mean Time To Recovery)** — approximated by e2eLatencyMs on failed runs that trigger a rollback stage. Lower rollback latency means faster recovery.

### Risks and tradeoffs

| Risk | Mitigation |
|------|------------|
| Data loss on restart | Acceptable for prototype — use PostgreSQL in production |
| No real authentication | API key is a placeholder — use JWT in production |
| Static security block list | Use Google Safe Browsing API in production |
| Single point of failure | Use clustering and load balancing in production |

### Assumptions

- Authentication is simplified for the prototype
- All data is ephemeral and resets on server restart
- Single Node.js process is sufficient for demonstration
- In-memory store interface matches what a real database adapter would expose