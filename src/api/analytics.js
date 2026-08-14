'use strict';

const express = require('express');
const store = require('../utils/store');

const router = express.Router();

// GET /api/v1/analytics/:shortCode - Get analytics for a URL
router.get('/:shortCode', async (req, res) => {
  try {
    const { shortCode } = req.params;

    // Check URL exists
    const record = store.get(shortCode);
    if (!record) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Short code not found' },
      });
    }

    // Get click events
    const events = store.getClickEvents(shortCode);

    // Aggregate by device
    const devices = {};
    const browsers = {};
    const referrers = {};

    for (const event of events) {
      // Count devices
      devices[event.device] = (devices[event.device] || 0) + 1;

      // Count browsers
      browsers[event.browser] = (browsers[event.browser] || 0) + 1;

      // Count referrers
      const ref = event.referrer || 'direct';
      referrers[ref] = (referrers[ref] || 0) + 1;
    }

    res.json({
      success: true,
      data: {
        shortCode,
        totalClicks: record.clicks,
        devices,
        browsers,
        referrers,
        recentClicks: events.slice(-10).reverse(), // last 10 clicks
      },
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: err.message },
    });
  }
});

// GET /api/v1/analytics/top/urls - Get top URLs by clicks
router.get('/top/urls', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit, 10) || 10;
    const topUrls = store.getTopUrls(limit);

    res.json({
      success: true,
      data: topUrls.map(r => ({
        shortCode: r.shortCode,
        originalUrl: r.originalUrl,
        clicks: r.clicks,
      })),
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: err.message },
    });
  }
});

module.exports = router;