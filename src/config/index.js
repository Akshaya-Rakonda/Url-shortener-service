'use strict';

require('dotenv').config();

const config = {
  port: parseInt(process.env.PORT, 10) || 3000,
  baseUrl: process.env.BASE_URL || 'http://localhost:3000',
  env: process.env.NODE_ENV || 'development',
  url: {
    shortCodeLength: 7,
    defaultTtlDays: 365,
    maxCustomAliasLength: 50,
    minCustomAliasLength: 3,
  },
};

module.exports = config;