'use strict';

const express = require('express');
const config = require('./config');
const urlRouter = require('./api/urls');

const app = express();

app.use(express.json());

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'url-shortener',
    environment: config.env,
    timestamp: new Date().toISOString(),
  });
});


app.get('/:shortCode', async (req, res) => {
  try {
    const { shortCode } = req.params;

    
    if (shortCode === 'health' || shortCode === 'api') {
      return res.status(404).json({ error: 'Not found' });
    }

    const urlService = require('./core/urlService');
    const originalUrl = await urlService.resolve(shortCode);
    res.redirect(301, originalUrl);
  } catch (err) {
    res.status(err.statusCode || 500).json({
      success: false,
      error: {
        code: err.code || 'INTERNAL_ERROR',
        message: err.message,
      },
    });
  }
});

// Routes
app.use('/api/v1/urls', urlRouter);

app.listen(config.port, () => {
  console.log(`Server running at ${config.baseUrl}`);
});

module.exports = app;