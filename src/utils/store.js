'use strict';

class InMemoryStore {
  constructor() {
    this._urls = new Map();
  }

  set(shortCode, record) {
    this._urls.set(shortCode, record);
    return record;
  }

  get(shortCode) {
    return this._urls.get(shortCode) || null;
  }

  delete(shortCode) {
    const existed = this._urls.has(shortCode);
    this._urls.delete(shortCode);
    return existed;
  }

  getAll() {
    return [...this._urls.values()];
  }

  has(shortCode) {
    return this._urls.has(shortCode);
  }

  count() {
    return this._urls.size;
  }

  clear() {
    this._urls.clear();
  }
}
const store = new InMemoryStore();
module.exports = store;