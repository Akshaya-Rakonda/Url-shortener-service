'use strict';

const { nanoid } = require('nanoid');
const { v4: uuidv4 } = require('uuid');
const store = require('../utils/store');
const config = require('../config');


const RESERVED_CODES = new Set([
  'api', 'admin', 'login', 'health', 'analytics', 'dashboard', 'docs',
]);


const URL_REGEX = /^https?:\/\/(www\.)?[-a-zA-Z0-9@:%._+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()@:%_+.~#?&/=]*)$/;

class UrlService {

  // Shorten a URL
  async shorten({ originalUrl, customAlias, ttlDays, userId }) {

    // 1. Validate the URL
    this._validateUrl(originalUrl);

    // 2. Check if same URL already exists for this user (idempotency)
    const existing = store.getAll().find(
      r => r.originalUrl === originalUrl && r.userId === userId
    );
    if (existing && !customAlias) {
      return existing;
    }

    
    let shortCode;
    if (customAlias) {
      this._validateAlias(customAlias);
      if (store.has(customAlias)) {
        throw Object.assign(
          new Error(`Alias '${customAlias}' is already taken`),
          { code: 'ALIAS_CONFLICT', statusCode: 409 }
        );
      }
      shortCode = customAlias;
    } else {
      shortCode = this._generateUniqueCode();
    }

    
    const now = new Date();
    const ttl = ttlDays || config.url.defaultTtlDays;
    const expiresAt = new Date(now.getTime() + ttl * 24 * 60 * 60 * 1000);

    const record = {
      id: uuidv4(),
      shortCode,
      originalUrl,
      customAlias: customAlias || null,
      userId: userId || 'anonymous',
      clicks: 0,
      isActive: true,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
    };

   
    store.set(shortCode, record);
    return record;
  }

  // Resolve a short code to its original URL
  async resolve(shortCode) {

    
    const record = store.get(shortCode);

    if (!record) {
      throw Object.assign(
        new Error(`Short code '${shortCode}' not found`),
        { code: 'NOT_FOUND', statusCode: 404 }
      );
    }

    
    if (!record.isActive) {
      throw Object.assign(
        new Error(`This link has been deactivated`),
        { code: 'DEACTIVATED', statusCode: 410 }
      );
    }

    
    if (new Date(record.expiresAt) < new Date()) {
      throw Object.assign(
        new Error(`This link has expired`),
        { code: 'EXPIRED', statusCode: 410 }
      );
    }

    
    setImmediate(() => {
      const current = store.get(shortCode);
      if (current) {
        store.set(shortCode, {
          ...current,
          clicks: current.clicks + 1,
          lastAccessedAt: new Date().toISOString(),
        });
      }
    });

    return record.originalUrl;
  }


  async get(shortCode) {
    const record = store.get(shortCode);
    if (!record) {
      throw Object.assign(
        new Error(`Short code '${shortCode}' not found`),
        { code: 'NOT_FOUND', statusCode: 404 }
      );
    }
    return record;
  }

  
  async list({ userId, page = 1, limit = 20 } = {}) {
    const all = store.getAll();

    
    const filtered = userId
      ? all.filter(r => r.userId === userId)
      : all;

    
    const total = filtered.length;
    const start = (page - 1) * limit;
    const items = filtered.slice(start, start + limit);

    return {
      items,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  
  async deactivate(shortCode, userId) {
    const record = await this.get(shortCode);

    
    if (record.userId !== userId && userId !== 'anonymous') {
      throw Object.assign(
        new Error('You do not have permission to deactivate this URL'),
        { code: 'FORBIDDEN', statusCode: 403 }
      );
    }

    const updated = {
      ...record,
      isActive: false,
      updatedAt: new Date().toISOString(),
    };

    store.set(shortCode, updated);
    return updated;
  }

  //generate a unique short code
  _generateUniqueCode(attempts = 0) {
    if (attempts > 10) {
      throw new Error('Could not generate a unique short code');
    }
    const code = nanoid(config.url.shortCodeLength);
    if (RESERVED_CODES.has(code) || store.has(code)) {
      return this._generateUniqueCode(attempts + 1);
    }
    return code;
  }

  // validate URL format
  _validateUrl(url) {
    if (!url || typeof url !== 'string') {
      throw Object.assign(
        new Error('URL is required'),
        { code: 'INVALID_URL', statusCode: 400 }
      );
    }
    if (url.length > 2048) {
      throw Object.assign(
        new Error('URL is too long. Maximum 2048 characters'),
        { code: 'INVALID_URL', statusCode: 400 }
      );
    }
    if (!URL_REGEX.test(url)) {
      throw Object.assign(
        new Error('Invalid URL. Must start with http:// or https://'),
        { code: 'INVALID_URL', statusCode: 400 }
      );
    }
  }

  //  validate custom alias
  _validateAlias(alias) {
    const { minCustomAliasLength, maxCustomAliasLength } = config.url;
    if (alias.length < minCustomAliasLength || alias.length > maxCustomAliasLength) {
      throw Object.assign(
        new Error(`Alias must be between ${minCustomAliasLength} and ${maxCustomAliasLength} characters`),
        { code: 'INVALID_ALIAS', statusCode: 400 }
      );
    }
    if (!/^[a-zA-Z0-9_-]+$/.test(alias)) {
      throw Object.assign(
        new Error('Alias can only contain letters, numbers, hyphens and underscores'),
        { code: 'INVALID_ALIAS', statusCode: 400 }
      );
    }
    if (RESERVED_CODES.has(alias.toLowerCase())) {
      throw Object.assign(
        new Error(`'${alias}' is a reserved word`),
        { code: 'RESERVED_ALIAS', statusCode: 409 }
      );
    }
  }
}

module.exports = new UrlService();