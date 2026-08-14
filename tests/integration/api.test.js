'use strict';

const request = require('supertest');
const app = require('../../src/server');
const store = require('../../src/utils/store');

beforeEach(() => store.clear());

afterAll(() => {
  // Close server after all tests
  if (app.close) { app.close(); }
});

const API_KEY = 'testkey123';
const AUTH = { 'x-api-key': API_KEY };

describe('GET /health', () => {
  it('should return 200 with ok status', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.service).toBe('url-shortener');
  });
});

describe('POST /api/v1/urls', () => {
  it('should create a short URL', async () => {
    const res = await request(app)
      .post('/api/v1/urls')
      .set(AUTH)
      .send({ url: 'https://www.google.com' });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.shortCode).toBeDefined();
    expect(res.body.data.shortUrl).toBeDefined();
    expect(res.body.data.originalUrl).toBe('https://www.google.com');
  });

  it('should return 401 without API key', async () => {
    const res = await request(app)
      .post('/api/v1/urls')
      .send({ url: 'https://www.google.com' });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('MISSING_API_KEY');
  });

  it('should return 400 for invalid URL', async () => {
    const res = await request(app)
      .post('/api/v1/urls')
      .set(AUTH)
      .send({ url: 'not-a-url' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_URL');
  });

  it('should return 400 for missing URL', async () => {
    const res = await request(app)
      .post('/api/v1/urls')
      .set(AUTH)
      .send({});

    expect(res.status).toBe(400);
  });

  it('should return same record for same idempotency key', async () => {
    const first = await request(app)
      .post('/api/v1/urls')
      .set(AUTH)
      .set('idempotency-key', 'unique-key-123')
      .send({ url: 'https://www.google.com' });

    const second = await request(app)
      .post('/api/v1/urls')
      .set(AUTH)
      .set('idempotency-key', 'unique-key-123')
      .send({ url: 'https://www.google.com' });

    expect(first.body.data.shortCode).toBe(second.body.data.shortCode);
    expect(first.body.data.id).toBe(second.body.data.id);
  });

  it('should return 409 for duplicate custom alias', async () => {
    await request(app)
      .post('/api/v1/urls')
      .set(AUTH)
      .send({ url: 'https://www.google.com', customAlias: 'my-link' });

    const res = await request(app)
      .post('/api/v1/urls')
      .set(AUTH)
      .send({ url: 'https://www.github.com', customAlias: 'my-link' });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('ALIAS_CONFLICT');
  });
});

describe('GET /api/v1/urls', () => {
  it('should list URLs for authenticated user', async () => {
    await request(app)
      .post('/api/v1/urls')
      .set(AUTH)
      .send({ url: 'https://www.google.com' });

    await request(app)
      .post('/api/v1/urls')
      .set(AUTH)
      .send({ url: 'https://www.github.com' });

    const res = await request(app)
      .get('/api/v1/urls')
      .set(AUTH);

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(2);
    expect(res.body.pagination).toBeDefined();
  });

  it('should return 401 without API key', async () => {
    const res = await request(app).get('/api/v1/urls');
    expect(res.status).toBe(401);
  });
});

describe('GET /api/v1/urls/:shortCode', () => {
  it('should get a single URL by short code', async () => {
    const created = await request(app)
      .post('/api/v1/urls')
      .set(AUTH)
      .send({ url: 'https://www.google.com' });

    const { shortCode } = created.body.data;

    const res = await request(app)
      .get(`/api/v1/urls/${shortCode}`)
      .set(AUTH);

    expect(res.status).toBe(200);
    expect(res.body.data.shortCode).toBe(shortCode);
  });

  it('should return 404 for non-existent short code', async () => {
    const res = await request(app)
      .get('/api/v1/urls/nonexistent')
      .set(AUTH);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});

describe('DELETE /api/v1/urls/:shortCode', () => {
  it('should deactivate a URL', async () => {
    const created = await request(app)
      .post('/api/v1/urls')
      .set(AUTH)
      .send({ url: 'https://www.google.com' });

    const { shortCode } = created.body.data;

    const res = await request(app)
      .delete(`/api/v1/urls/${shortCode}`)
      .set(AUTH);

    expect(res.status).toBe(200);
    expect(res.body.data.isActive).toBe(false);
  });
});

describe('GET /:shortCode (redirect)', () => {
  it('should redirect to original URL', async () => {
    const created = await request(app)
      .post('/api/v1/urls')
      .set(AUTH)
      .send({ url: 'https://www.google.com' });

    const { shortCode } = created.body.data;

    const res = await request(app)
      .get(`/${shortCode}`)
      .redirects(0);

    expect(res.status).toBe(301);
    expect(res.headers.location).toBe('https://www.google.com');
  });

  it('should return 404 for non-existent short code', async () => {
    const res = await request(app).get('/nonexistent123');
    expect(res.status).toBe(404);
  });

  it('should return 410 for deactivated URL', async () => {
    const created = await request(app)
      .post('/api/v1/urls')
      .set(AUTH)
      .send({ url: 'https://www.google.com' });

    const { shortCode } = created.body.data;

    await request(app)
      .delete(`/api/v1/urls/${shortCode}`)
      .set(AUTH);

    const res = await request(app)
      .get(`/${shortCode}`)
      .redirects(0);

    expect(res.status).toBe(410);
  });
});

describe('POST /api/v1/orchestrate/greenfield', () => {
  it('should run greenfield pipeline and return short URL', async () => {
    const res = await request(app)
      .post('/api/v1/orchestrate/greenfield')
      .set(AUTH)
      .send({ url: 'https://www.google.com' });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.shortCode).toBeDefined();
    expect(res.body.data.metrics.successRate).toBe(1);
    expect(res.body.data.auditLog.length).toBeGreaterThan(0);
  });

  it('should return 400 when url is missing', async () => {
    const res = await request(app)
      .post('/api/v1/orchestrate/greenfield')
      .set(AUTH)
      .send({});

    expect(res.status).toBe(400);
  });
});

describe('POST /api/v1/orchestrate/ambiguous', () => {
  it('should return improvement plan', async () => {
    const res = await request(app)
      .post('/api/v1/orchestrate/ambiguous')
      .set(AUTH)
      .send({ description: 'make our links more reliable' });

    expect(res.status).toBe(200);
    expect(res.body.data.improvementPlan).toBeDefined();
    expect(res.body.data.improvementPlan.tasks.length).toBeGreaterThan(0);
  });

  it('should return 400 when description is missing', async () => {
    const res = await request(app)
      .post('/api/v1/orchestrate/ambiguous')
      .set(AUTH)
      .send({});

    expect(res.status).toBe(400);
  });
});

describe('GET /api/v1/analytics/:shortCode', () => {
  it('should return analytics for a URL', async () => {
    const created = await request(app)
      .post('/api/v1/urls')
      .set(AUTH)
      .send({ url: 'https://www.google.com' });

    const { shortCode } = created.body.data;

    const res = await request(app)
      .get(`/api/v1/analytics/${shortCode}`)
      .set(AUTH);

    expect(res.status).toBe(200);
    expect(res.body.data.shortCode).toBe(shortCode);
    expect(res.body.data.totalClicks).toBeDefined();
  });
});