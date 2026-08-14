'use strict';

const express = require('express');
const urlService = require('../core/urlService');
const { requireApiKey } = require('../middleware/auth');
const config = require('../config');

const router = express.Router();

// POST /api/v1/urls - Shorten a URL
router.post('/', requireApiKey, async (req, res, next) => {
  try {
    const { url, customAlias, ttlDays } = req.body;

    const record = await urlService.shorten({
      originalUrl: url,
      customAlias,
      ttlDays,
      userId: req.user.id,
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
    next(err);
  }
});

// GET /api/v1/urls - List all URLs
router.get('/', requireApiKey, async (req, res, next) => {
  try {
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 20;

    const result = await urlService.list({
      userId: req.user.id,
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
    next(err);
  }
});

// GET /api/v1/urls/:shortCode - Get a single URL
router.get('/:shortCode', requireApiKey, async (req, res, next) => {
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
    next(err);
  }
});

// DELETE /api/v1/urls/:shortCode - Deactivate a URL
router.delete('/:shortCode', requireApiKey, async (req, res, next) => {
  try {
    const updated = await urlService.deactivate(
      req.params.shortCode,
      req.user.id
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
    next(err);
  }
});

module.exports = router;
