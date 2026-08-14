'use strict';

const express = require('express');
const urlService = require('../core/urlService');
const config = require('../config');

const router = express.Router();

// POST /api/v1/urls - Shorten a URL
router.post('/', async (req, res) => {
  try {
    const { url, customAlias, ttlDays } = req.body;

    const record = await urlService.shorten({
      originalUrl: url,
      customAlias,
      ttlDays,
      userId: 'anonymous', 
    });

    res.status(201).json({
      success: true,
      data: {
        id: record.id,
        shortCode: record.shortCode,
        shortUrl: `${config.baseUrl}/${record.shortCode}`,
        originalUrl: record.originalUrl,
        expiresAt: record.expiresAt,
        createdAt: record.createdAt,
      },
    });
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

module.exports = router;