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

// Routes
app.use('/api/v1/urls', urlRouter);

app.listen(config.port, () => {
  console.log(`Server running at ${config.baseUrl}`);
});

module.exports = app;