'use strict';

const store = require('../../src/utils/store');

beforeEach(() => store.clear());

describe('InMemoryStore - URL operations', () => {
  const sampleRecord = {
    id: 'test-id',
    shortCode: 'abc1234',
    originalUrl: 'https://google.com',
    userId: 'user_123',
    clicks: 0,
    isActive: true,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 86400000).toISOString(),
  };

  it('should save and retrieve a URL record', () => {
    store.set('abc1234', sampleRecord);
    const result = store.get('abc1234');
    expect(result).toEqual(sampleRecord);
  });

  it('should return null for non-existent short code', () => {
    const result = store.get('nonexistent');
    expect(result).toBeNull();
  });

  it('should delete a URL record', () => {
    store.set('abc1234', sampleRecord);
    store.delete('abc1234');
    expect(store.get('abc1234')).toBeNull();
  });

  it('should return all records', () => {
    store.set('abc1234', sampleRecord);
    store.set('xyz5678', { ...sampleRecord, shortCode: 'xyz5678' });
    expect(store.getAll().length).toBe(2);
  });

  it('should count records correctly', () => {
    store.set('abc1234', sampleRecord);
    expect(store.count()).toBe(1);
  });

  it('should clear all records', () => {
    store.set('abc1234', sampleRecord);
    store.clear();
    expect(store.count()).toBe(0);
  });
});

describe('InMemoryStore - Idempotency operations', () => {
  const record = {
    id: 'test-id',
    shortCode: 'abc1234',
    originalUrl: 'https://google.com',
  };

  it('should save and retrieve idempotency record', () => {
    store.setIdempotencyRecord('my-key', record);
    const result = store.getIdempotencyRecord('my-key');
    expect(result).toEqual(record);
  });

  it('should return null for non-existent idempotency key', () => {
    const result = store.getIdempotencyRecord('nonexistent');
    expect(result).toBeNull();
  });

  it('should check if idempotency key exists', () => {
    store.setIdempotencyRecord('my-key', record);
    expect(store.hasIdempotencyKey('my-key')).toBe(true);
    expect(store.hasIdempotencyKey('other-key')).toBe(false);
  });

  it('should clear idempotency records on clear()', () => {
    store.setIdempotencyRecord('my-key', record);
    store.clear();
    expect(store.getIdempotencyRecord('my-key')).toBeNull();
  });
});

describe('InMemoryStore - Analytics operations', () => {
  it('should save and retrieve click events', () => {
    store.addClickEvent({ shortCode: 'abc1234', timestamp: new Date().toISOString() });
    store.addClickEvent({ shortCode: 'abc1234', timestamp: new Date().toISOString() });
    store.addClickEvent({ shortCode: 'xyz5678', timestamp: new Date().toISOString() });

    const events = store.getClickEvents('abc1234');
    expect(events.length).toBe(2);
  });

  it('should return top URLs sorted by clicks', () => {
    store.set('abc1234', { shortCode: 'abc1234', clicks: 10, originalUrl: 'https://a.com' });
    store.set('xyz5678', { shortCode: 'xyz5678', clicks: 50, originalUrl: 'https://b.com' });
    store.set('def9012', { shortCode: 'def9012', clicks: 5, originalUrl: 'https://c.com' });

    const top = store.getTopUrls(2);
    expect(top[0].shortCode).toBe('xyz5678');
    expect(top[1].shortCode).toBe('abc1234');
  });
});