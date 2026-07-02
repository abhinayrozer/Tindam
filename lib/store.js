'use strict';

// Simple JSON-file persistence for subscriptions (local database).
// Data lives in data/store/subscriptions.json (gitignored, created on demand).

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const STORE_DIR = path.join(__dirname, '..', 'data', 'store');
const FILE = path.join(STORE_DIR, 'subscriptions.json');

function load() {
  try {
    const db = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    db.subscriptions = db.subscriptions || [];
    db.customMeals = db.customMeals || [];
    return db;
  } catch {
    return { subscriptions: [], customMeals: [] };
  }
}

function save(db) {
  fs.mkdirSync(STORE_DIR, { recursive: true });
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, FILE);
}

function newId() {
  return 'TDM-' + crypto.randomBytes(4).toString('hex').toUpperCase();
}

function createSubscription(data) {
  const db = load();
  const sub = {
    id: newId(),
    createdAt: new Date().toISOString(),
    status: 'active', // active | paused | cancelled
    ...data
  };
  db.subscriptions.push(sub);
  save(db);
  return sub;
}

function findByPhone(phone) {
  const db = load();
  return db.subscriptions.filter((s) => s.phone === phone && s.status !== 'cancelled');
}

function findById(id) {
  const db = load();
  return db.subscriptions.find((s) => s.id === id) || null;
}

function update(id, mutator) {
  const db = load();
  const sub = db.subscriptions.find((s) => s.id === id);
  if (!sub) return null;
  mutator(sub);
  save(db);
  return sub;
}

function createCustomMeal(data) {
  const db = load();
  const meal = {
    id: 'cm-' + crypto.randomBytes(4).toString('hex'),
    createdAt: new Date().toISOString(),
    ...data
  };
  db.customMeals.push(meal);
  save(db);
  return meal;
}

function findCustomMeal(id) {
  const db = load();
  return db.customMeals.find((m) => m.id === id) || null;
}

function findCustomMealsByPhone(phone) {
  const db = load();
  return db.customMeals.filter((m) => m.phone === phone);
}

module.exports = {
  createSubscription, findByPhone, findById, update,
  createCustomMeal, findCustomMeal, findCustomMealsByPhone
};
