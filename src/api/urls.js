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


router.get('/', async (req, res) => {
  try {
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 20;

    const result = await urlService.list({
      userId: 'anonymous',
      page,
      limit,
    });

    res.json({
      success: true,
      data: result.items.map(r => ({
        id: r.id,
        shortCode: r.shortCode,
        shortUrl: `${config.baseUrl}/${r.shortCode}`,
        originalUrl: r.originalUrl,
        clicks: r.clicks,
        isActive: r.isActive,
        createdAt: r.createdAt,
        expiresAt: r.expiresAt,
      })),
      pagination: result.pagination,
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


router.get('/:shortCode', async (req, res) => {
  try {
    const record = await urlService.get(req.params.shortCode);

    res.json({
      success: true,
      data: {
        id: record.id,
        shortCode: record.shortCode,
        shortUrl: `${config.baseUrl}/${record.shortCode}`,
        originalUrl: record.originalUrl,
        clicks: record.clicks,
        isActive: record.isActive,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
        expiresAt: record.expiresAt,
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


router.delete('/:shortCode', async (req, res) => {
  try {
    const updated = await urlService.deactivate(
      req.params.shortCode,
      'anonymous'
    );

    res.json({
      success: true,
      data: {
        shortCode: updated.shortCode,
        isActive: updated.isActive,
        message: 'URL deactivated successfully',
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

router.get('/redirect/:shortCode', async (req, res) => {
  try {
    const { shortCode } = req.params;
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


module.exports = router;