'use strict';

const express = require('express');
const config = require('./config');
const requestId = require('./middleware/requestId');
const { errorHandler, notFound } = require('./middleware/errorHandler');
const { apiRateLimiter, redirectRateLimiter } = require('./middleware/rateLimiter');
const urlRouter = require('./api/urls');
const analyticsRouter = require('./api/analytics');
const orchestrationRouter = require('./api/orchestration');

const app = express();


app.use(express.json());
app.use(requestId);


app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'url-shortener',
    environment: config.env,
    timestamp: new Date().toISOString(),
  });
});


app.get('/:shortCode', redirectRateLimiter, async (req, res, next) => {
  try {
    const { shortCode } = req.params;

    if (shortCode === 'health' || shortCode === 'api') {
      return res.status(404).json({ error: 'Not found' });
    }

    const urlService = require('./core/urlService');
    const context = {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
      referrer: req.headers['referer'] || null,
    };

    const originalUrl = await urlService.resolve(shortCode, context);
    res.redirect(301, originalUrl);
  } catch (err) {
    next(err);
  }
});


const api = express.Router();
api.use(apiRateLimiter);
api.use('/urls', urlRouter);
api.use('/analytics', analyticsRouter);
app.use('/api/v1', api);
api.use('/orchestrate', orchestrationRouter);


app.use(notFound);
app.use(errorHandler);

app.listen(config.port, () => {
  console.log(`Server running at ${config.baseUrl}`);
});

module.exports = app;