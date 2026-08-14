'use strict';

const express = require('express');
const config = require('./config');

const app = express();

app.use(express.json());

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'url-shortener',
    environment: config.env,
    timestamp: new Date().toISOString(),
  });
});

app.listen(config.port, () => {
  console.log(`Server running at ${config.baseUrl}`);
});

module.exports = app;