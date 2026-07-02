'use strict';

// Simple JSON-file persistence for subscriptions (local database).
// Data lives in data/store/subscriptions.json (gitignored, created on demand).

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const STORE_DIR = path.join(__dirname, '..', 'data', 'store');
const FILE = path.join(STORE_DIR, 'subscriptions.json');

const EMPTY = { subscriptions: [], customMeals: [], users: [], sessions: [], resets: [], audit: [] };

function load() {
  try {
    const db = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    for (const k of Object.keys(EMPTY)) db[k] = db[k] || [];
    return db;
  } catch {
    return JSON.parse(JSON.stringify(EMPTY));
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

// Full history for dashboards — cancelled subscriptions included.
function findAllByPhone(phone) {
  const db = load();
  return db.subscriptions.filter((s) => s.phone === phone);
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

// ---------- Users, sessions, resets, audit ----------

function createUser(data) {
  const db = load();
  const user = { id: 'u-' + crypto.randomBytes(5).toString('hex'), createdAt: new Date().toISOString(), ...data };
  db.users.push(user);
  save(db);
  return user;
}

function findUser(fn) {
  return load().users.find(fn) || null;
}

function listUsers() {
  return load().users;
}

function updateUser(id, mutator) {
  const db = load();
  const u = db.users.find((x) => x.id === id);
  if (!u) return null;
  mutator(u);
  save(db);
  return u;
}

function removeUser(id) {
  const db = load();
  const before = db.users.length;
  db.users = db.users.filter((u) => u.id !== id);
  db.sessions = db.sessions.filter((s) => s.userId !== id);
  save(db);
  return db.users.length < before;
}

function createSession(userId, token, ttlMs) {
  const db = load();
  db.sessions = db.sessions.filter((s) => s.expires > Date.now()); // prune stale
  db.sessions.push({ token, userId, expires: Date.now() + ttlMs });
  save(db);
}

function findSession(token) {
  const s = load().sessions.find((x) => x.token === token);
  return s && s.expires > Date.now() ? s : null;
}

function deleteSession(token) {
  const db = load();
  db.sessions = db.sessions.filter((s) => s.token !== token);
  save(db);
}

function createReset(userId, token, ttlMs) {
  const db = load();
  db.resets = db.resets.filter((r) => r.expires > Date.now() && r.userId !== userId);
  db.resets.push({ token, userId, expires: Date.now() + ttlMs });
  save(db);
}

function consumeReset(token) {
  const db = load();
  const r = db.resets.find((x) => x.token === token && x.expires > Date.now());
  if (!r) return null;
  db.resets = db.resets.filter((x) => x.token !== token);
  save(db);
  return r;
}

function audit(event, detail, actor) {
  const db = load();
  db.audit.push({ ts: new Date().toISOString(), event, detail: String(detail || '').slice(0, 200), actor: actor || 'system' });
  if (db.audit.length > 2000) db.audit = db.audit.slice(-1500);
  save(db);
}

function listAudit(limit = 100) {
  return load().audit.slice(-limit).reverse();
}

module.exports = {
  createSubscription, findByPhone, findAllByPhone, findById, update,
  createCustomMeal, findCustomMeal, findCustomMealsByPhone,
  createUser, findUser, listUsers, updateUser, removeUser,
  createSession, findSession, deleteSession,
  createReset, consumeReset, audit, listAudit,
  _loadAll: load
};
