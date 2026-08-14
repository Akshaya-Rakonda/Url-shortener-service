'use strict';

class InMemoryStore {
  constructor() {
    this._urls = new Map();
    this._analytics = [];
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
    this._analytics = [];
  }

  

  
  addClickEvent(event) {
    this._analytics.push(event);
  }

  
  getClickEvents(shortCode) {
    return this._analytics.filter(e => e.shortCode === shortCode);
  }

  
  getTopUrls(limit = 10) {
    return [...this._urls.values()]
      .sort((a, b) => (b.clicks || 0) - (a.clicks || 0))
      .slice(0, limit);
  }
}

const store = new InMemoryStore();
module.exports = store;