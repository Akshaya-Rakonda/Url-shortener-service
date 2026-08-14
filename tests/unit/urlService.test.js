'use strict';

const store = require('../../src/utils/store');
const urlService = require('../../src/core/urlService');

beforeEach(() => store.clear());

describe('urlService.shorten()', () => {
  it('should shorten a valid URL', async () => {
    const record = await urlService.shorten({
      originalUrl: 'https://www.google.com',
      userId: 'user_123',
    });

    expect(record.shortCode).toBeDefined();
    expect(record.originalUrl).toBe('https://www.google.com');
    expect(record.userId).toBe('user_123');
    expect(record.clicks).toBe(0);
    expect(record.isActive).toBe(true);
  });

  it('should use custom alias when provided', async () => {
    const record = await urlService.shorten({
      originalUrl: 'https://www.google.com',
      customAlias: 'my-google',
      userId: 'user_123',
    });

    expect(record.shortCode).toBe('my-google');
    expect(record.customAlias).toBe('my-google');
  });

  it('should return same record for duplicate URL and user', async () => {
    const first = await urlService.shorten({
      originalUrl: 'https://www.google.com',
      userId: 'user_123',
    });

    const second = await urlService.shorten({
      originalUrl: 'https://www.google.com',
      userId: 'user_123',
    });

    expect(first.shortCode).toBe(second.shortCode);
    expect(first.id).toBe(second.id);
  });

  it('should return same record for same idempotency key', async () => {
    const first = await urlService.shorten({
      originalUrl: 'https://www.google.com',
      userId: 'user_123',
      idempotencyKey: 'my-unique-key',
    });

    const second = await urlService.shorten({
      originalUrl: 'https://www.google.com',
      userId: 'user_123',
      idempotencyKey: 'my-unique-key',
    });

    expect(first.id).toBe(second.id);
  });

  it('should throw INVALID_URL for empty URL', async () => {
    await expect(urlService.shorten({
      originalUrl: '',
      userId: 'user_123',
    })).rejects.toMatchObject({ code: 'INVALID_URL' });
  });

  it('should throw INVALID_URL for non-http URL', async () => {
    await expect(urlService.shorten({
      originalUrl: 'ftp://invalid.com',
      userId: 'user_123',
    })).rejects.toMatchObject({ code: 'INVALID_URL' });
  });

  it('should throw ALIAS_CONFLICT for duplicate alias', async () => {
    await urlService.shorten({
      originalUrl: 'https://www.google.com',
      customAlias: 'taken-alias',
      userId: 'user_123',
    });

    await expect(urlService.shorten({
      originalUrl: 'https://www.github.com',
      customAlias: 'taken-alias',
      userId: 'user_456',
    })).rejects.toMatchObject({ code: 'ALIAS_CONFLICT' });
  });

  it('should throw INVALID_ALIAS for alias with special characters', async () => {
    await expect(urlService.shorten({
      originalUrl: 'https://www.google.com',
      customAlias: 'invalid alias!',
      userId: 'user_123',
    })).rejects.toMatchObject({ code: 'INVALID_ALIAS' });
  });
});

describe('urlService.resolve()', () => {
  it('should resolve a short code to original URL', async () => {
    const record = await urlService.shorten({
      originalUrl: 'https://www.google.com',
      userId: 'user_123',
    });

    const resolved = await urlService.resolve(record.shortCode, {});
    expect(resolved).toBe('https://www.google.com');
  });

  it('should throw NOT_FOUND for non-existent short code', async () => {
    await expect(
      urlService.resolve('nonexistent', {})
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('should throw DEACTIVATED for inactive URL', async () => {
    const record = await urlService.shorten({
      originalUrl: 'https://www.google.com',
      userId: 'user_123',
    });

    await urlService.deactivate(record.shortCode, 'user_123');

    await expect(
      urlService.resolve(record.shortCode, {})
    ).rejects.toMatchObject({ code: 'DEACTIVATED' });
  });
});

describe('urlService.get()', () => {
  it('should get a URL record by short code', async () => {
    const created = await urlService.shorten({
      originalUrl: 'https://www.google.com',
      userId: 'user_123',
    });

    const fetched = await urlService.get(created.shortCode);
    expect(fetched.shortCode).toBe(created.shortCode);
  });

  it('should throw NOT_FOUND for non-existent short code', async () => {
    await expect(
      urlService.get('nonexistent')
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('urlService.list()', () => {
  it('should list URLs for a user', async () => {
    await urlService.shorten({ originalUrl: 'https://www.google.com', userId: 'user_123' });
    await urlService.shorten({ originalUrl: 'https://www.github.com', userId: 'user_123' });
    await urlService.shorten({ originalUrl: 'https://www.amazon.com', userId: 'user_456' });

    const result = await urlService.list({ userId: 'user_123' });
    expect(result.items.length).toBe(2);
    expect(result.pagination.total).toBe(2);
  });

  it('should paginate results correctly', async () => {
    for (let i = 0; i < 5; i++) {
      await urlService.shorten({
        originalUrl: `https://www.site${i}.com`,
        userId: 'user_123',
      });
    }

    const page1 = await urlService.list({ userId: 'user_123', page: 1, limit: 2 });
    const page2 = await urlService.list({ userId: 'user_123', page: 2, limit: 2 });

    expect(page1.items.length).toBe(2);
    expect(page2.items.length).toBe(2);
    expect(page1.pagination.totalPages).toBe(3);
  });
});

describe('urlService.deactivate()', () => {
  it('should deactivate a URL', async () => {
    const record = await urlService.shorten({
      originalUrl: 'https://www.google.com',
      userId: 'user_123',
    });

    const updated = await urlService.deactivate(record.shortCode, 'user_123');
    expect(updated.isActive).toBe(false);
  });

  it('should throw FORBIDDEN when non-owner tries to deactivate', async () => {
    const record = await urlService.shorten({
      originalUrl: 'https://www.google.com',
      userId: 'user_123',
    });

    await expect(
      urlService.deactivate(record.shortCode, 'user_456')
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});