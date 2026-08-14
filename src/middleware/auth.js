'use strict';


function requireApiKey(req, res, next) {
  const apiKey = req.headers['x-api-key'];

  if (!apiKey) {
    return res.status(401).json({
      success: false,
      error: {
        code: 'MISSING_API_KEY',
        message: 'Missing required header: x-api-key',
        requestId: req.id,
      },
    });
  }

  
  req.user = {
    id: `user_${apiKey.substring(0, 8)}`,
    apiKey,
  };

  next();
}

module.exports = { requireApiKey };