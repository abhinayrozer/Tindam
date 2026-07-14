'use strict';

// Tindam — fitness food subscription server.
// Zero-dependency Node.js HTTP server: serves the website from /public and a
// JSON REST API backed by the local food database in /data.

const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const zlib = require('zlib');

const { targetsFromStats, targetsDirect, ACTIVITY_LEVELS } = require('./lib/nutrition');
const { generatePlan } = require('./lib/planner');
const store = require('./lib/store');
const auth = require('./lib/auth');

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || null;

// Firebase web config is public by design (it identifies the project; security
// comes from server-side ID-token verification + Firebase console rules).
// Override with FIREBASE_CONFIG='{"apiKey":...}' or disable with FIREBASE_CONFIG=off.
const FIREBASE_CONFIG = (() => {
  const env = process.env.FIREBASE_CONFIG;
  if (env === 'off' || env === '0') return null;
  if (env) { try { return JSON.parse(env); } catch { console.error('Bad FIREBASE_CONFIG JSON — ignoring'); } }
  return {
    apiKey: 'AIzaSyB_F3wKmC7_rjhRR_rV1m-oxLOjKyMNF_I',
    authDomain: 'gen-lang-client-0415222577.firebaseapp.com',
    projectId: 'gen-lang-client-0415222577',
    storageBucket: 'gen-lang-client-0415222577.firebasestorage.app',
    messagingSenderId: '882590367120',
    appId: '1:882590367120:web:6253b34dd0a948a6a6c715'
  };
})();
const ORDER_STATUSES = ['accepted', 'preparing', 'scheduled', 'delivered', 'rejected', 'not_delivered'];

// Seed the admin account on first boot (change the password after login,
// or set ADMIN_USERNAME / ADMIN_PASSWORD in the environment).
(function seedAdmin() {
  if (store.findUser((u) => u.role === 'admin')) return;
  const username = (process.env.ADMIN_USERNAME || 'admin').toLowerCase();
  const password = process.env.ADMIN_PASSWORD || 'Admin@123';
  store.createUser({
    name: 'Administrator', username, email: null, phone: null,
    role: 'admin', passwordHash: auth.hashPassword(password), via: 'seed'
  });
  store.audit('admin.seeded', `admin account "${username}" created`);
  console.log(`Seeded admin account → username: ${username}  password: ${password} (change it!)`);
})();

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const CUTOFF_HOUR = 20; // meal changes for tomorrow close at 8 PM today

const FOOD_FILES = ['foods.json', 'foods-extra.json', 'foods-extra2.json', 'foods-ifct.json', 'foods-dishes.json'];
const FOODS = FOOD_FILES.flatMap(
  (f) => JSON.parse(fs.readFileSync(path.join(__dirname, 'data', f), 'utf8')).foods
);
const MEALS = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'meals.json'), 'utf8')).meals;

{
  const ids = new Set(FOODS.map((f) => f.id));
  if (ids.size !== FOODS.length) throw new Error('Duplicate food ids across database files');
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};

function sendJson(res, code, data) {
  const body = JSON.stringify(data);
  const headers = { 'Content-Type': 'application/json; charset=utf-8' };
  const accept = (res.req && res.req.headers['accept-encoding']) || '';
  // Big payloads (the 1,340-food database) shrink ~6x over the wire.
  if (body.length > 4096 && /\bgzip\b/.test(accept)) {
    return zlib.gzip(Buffer.from(body), (err, gz) => {
      if (err) { res.writeHead(code, headers); return res.end(body); }
      headers['Content-Encoding'] = 'gzip';
      res.writeHead(code, headers);
      res.end(gz);
    });
  }
  res.writeHead(code, headers);
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (c) => {
      raw += c;
      if (raw.length > 1e6) { reject(new Error('Payload too large')); req.destroy(); }
    });
    req.on('end', () => {
      try { resolve(raw ? JSON.parse(raw) : {}); }
      catch { reject(new Error('Invalid JSON body')); }
    });
    req.on('error', reject);
  });
}

// ---------- Auth plumbing ----------

function parseCookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function sessionUser(req) {
  const token = parseCookies(req).tindam_session;
  if (!token) return { user: null, token: null };
  const sess = store.findSession(token);
  if (!sess) return { user: null, token: null };
  const user = store.findUser((u) => u.id === sess.userId);
  return { user, token };
}

function safeUser(u) {
  if (!u) return null;
  return {
    id: u.id, name: u.name, username: u.username, email: u.email, phone: u.phone,
    role: u.role, via: u.via, status: u.status || 'active', createdAt: u.createdAt
  };
}

function sessionCookie(token) {
  return `tindam_session=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${auth.SESSION_TTL_MS / 1000}`;
}
const CLEAR_COOKIE = 'tindam_session=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0';

function requireRole(ctx, ...roles) {
  if (!ctx.user) throw Object.assign(new Error('Login required'), { code: 401 });
  if (!roles.includes(ctx.user.role)) throw Object.assign(new Error('Not allowed for your role'), { code: 403 });
}

function loginAs(user, ctx) {
  const token = auth.newToken();
  store.createSession(user.id, token, auth.SESSION_TTL_MS);
  ctx.setCookie(sessionCookie(token));
  return { ok: true, user: safeUser(user) };
}

// Shared find-or-create for Google-verified profiles (GIS or Firebase).
function googleProfileLogin(g, via, ctx) {
  let user = store.findUser((u) => u.googleSub === g.sub || u.email === g.email.toLowerCase());
  if (!user) {
    let username = g.email.split('@')[0].toLowerCase().replace(/[^a-z0-9._-]/g, '').slice(0, 24) || 'user';
    while (store.findUser((u) => u.username === username)) username += Math.floor(Math.random() * 10);
    user = store.createUser({
      name: g.name, username, email: g.email.toLowerCase(), phone: null,
      role: 'user', status: 'pending', passwordHash: null, googleSub: g.sub, via
    });
    store.audit('user.signup', `${username} via ${via} (pending approval)`, username);
  } else if (!user.googleSub) {
    store.updateUser(user.id, (u) => { u.googleSub = g.sub; });
  }
  if (user.status === 'suspended') {
    throw Object.assign(new Error('This account is suspended — contact support'), { code: 403 });
  }
  store.audit('auth.login', `${user.username} via ${via}`, user.username);
  return loginAs(user, ctx);
}

// A date (YYYY-MM-DD) is editable while "now" is before 8 PM on the previous day.
function isEditable(dateStr, now = new Date()) {
  const cutoff = new Date(dateStr + 'T00:00:00');
  cutoff.setDate(cutoff.getDate() - 1);
  cutoff.setHours(CUTOFF_HOUR, 0, 0, 0);
  return now < cutoff;
}

function mealById(id) {
  return MEALS.find((m) => m.id === id) || store.findCustomMeal(id) || null;
}

function validMealIds(ids) {
  return Array.isArray(ids) && ids.length > 0 && ids.every((id) => mealById(id));
}

// Custom meals are priced by a transparent rule: ₹40 kitchen base + ₹6 per 100 kcal.
function priceCustomMeal(kcal) {
  return Math.max(49, Math.round((40 + (kcal / 100) * 6) / 5) * 5);
}

const routes = {
  'GET /api/health': async () => ({ ok: true, foods: FOODS.length, meals: MEALS.length }),

  // ---------- Auth ----------

  'GET /api/auth/config': async () => ({ googleClientId: GOOGLE_CLIENT_ID, firebase: FIREBASE_CONFIG }),

  'GET /api/auth/me': async (req, q, ctx) => ({ user: safeUser(ctx.user) }),

  'POST /api/auth/signup': async (req, q, ctx) => {
    const b = await readBody(req);
    const username = String(b.username || '').toLowerCase().trim();
    if (!auth.validUsername(username)) throw new Error('Username: 3–30 letters, numbers, dot, dash or underscore');
    if (!auth.validEmail(b.email)) throw new Error('Enter a valid email address');
    if (!auth.validPassword(b.password)) throw new Error('Password must be at least 8 characters');
    if (!b.name || String(b.name).trim().length < 2) throw new Error('Enter your name');
    if (b.phone && !/^\d{10}$/.test(String(b.phone))) throw new Error('Phone must be 10 digits');
    const email = String(b.email).toLowerCase().trim();
    if (store.findUser((u) => u.username === username)) throw new Error('That username is taken');
    if (store.findUser((u) => u.email === email)) throw new Error('An account with this email already exists — sign in instead');
    // Self-service signups start "pending" — an admin approves them before
    // they can place orders (they can still sign in and browse).
    const user = store.createUser({
      name: String(b.name).trim().slice(0, 80), username, email,
      phone: b.phone ? String(b.phone) : null, role: 'user', status: 'pending',
      passwordHash: auth.hashPassword(b.password), via: 'password'
    });
    store.audit('user.signup', `${username} <${email}> (pending approval)`, username);
    return loginAs(user, ctx);
  },

  'POST /api/auth/login': async (req, q, ctx) => {
    const b = await readBody(req);
    const id = String(b.id || '').toLowerCase().trim();
    const user = store.findUser((u) => u.username === id || u.email === id);
    if (!user || !user.passwordHash || !auth.verifyPassword(b.password, user.passwordHash)) {
      store.audit('auth.login_failed', id);
      throw Object.assign(new Error('Wrong username/email or password'), { code: 401 });
    }
    if (user.status === 'suspended') {
      store.audit('auth.login_blocked', `${user.username} (suspended)`);
      throw Object.assign(new Error('This account is suspended — contact support'), { code: 403 });
    }
    store.audit('auth.login', user.username, user.username);
    return loginAs(user, ctx);
  },

  'POST /api/auth/logout': async (req, q, ctx) => {
    if (ctx.token) store.deleteSession(ctx.token);
    ctx.setCookie(CLEAR_COOKIE);
    return { ok: true };
  },

  // Password reset. Without an email provider the reset link is returned in
  // the response (dev mode); plug an email service into this handler for prod.
  'POST /api/auth/forgot': async (req) => {
    const b = await readBody(req);
    const id = String(b.id || '').toLowerCase().trim();
    const user = store.findUser((u) => (u.username === id || u.email === id) && u.role === 'user');
    if (user) {
      const token = auth.newToken(24);
      store.createReset(user.id, token, auth.RESET_TTL_MS);
      store.audit('auth.reset_requested', user.username, user.username);
      // TODO(prod): email this link instead of returning it.
      return { ok: true, message: 'Reset link generated (valid 30 min).', devResetLink: `/#/reset?token=${token}` };
    }
    return { ok: true, message: 'If that account exists, a reset link has been generated.' };
  },

  'POST /api/auth/reset': async (req) => {
    const b = await readBody(req);
    if (!auth.validPassword(b.password)) throw new Error('Password must be at least 8 characters');
    const reset = store.consumeReset(String(b.token || ''));
    if (!reset) throw new Error('Reset link is invalid or expired — request a new one');
    const user = store.updateUser(reset.userId, (u) => { u.passwordHash = auth.hashPassword(b.password); });
    if (!user) throw new Error('Account no longer exists');
    store.audit('auth.password_reset', user.username, user.username);
    return { ok: true, message: 'Password updated — sign in with your new password.' };
  },

  'POST /api/auth/google': async (req, q, ctx) => {
    if (!GOOGLE_CLIENT_ID) throw Object.assign(new Error('Google sign-in is not configured (set GOOGLE_CLIENT_ID)'), { code: 503 });
    const b = await readBody(req);
    const g = await auth.verifyGoogleIdToken(b.credential, GOOGLE_CLIENT_ID);
    return googleProfileLogin(g, 'google', ctx);
  },

  // Firebase Authentication (Google provider) — the client signs in with the
  // Firebase popup and posts the Firebase ID token; we verify it against
  // Google's securetoken certs before creating the session.
  'POST /api/auth/firebase': async (req, q, ctx) => {
    if (!FIREBASE_CONFIG || !FIREBASE_CONFIG.projectId) {
      throw Object.assign(new Error('Firebase sign-in is not configured'), { code: 503 });
    }
    const b = await readBody(req);
    const g = await auth.verifyFirebaseIdToken(b.idToken, FIREBASE_CONFIG.projectId);
    return googleProfileLogin(g, 'firebase', ctx);
  },

  // ---------- Admin ----------

  'GET /api/admin/overview': async (req, q, ctx) => {
    requireRole(ctx, 'admin');
    const db = store._loadAll();
    return {
      users: db.users.filter((u) => u.role === 'user').length,
      pendingUsers: db.users.filter((u) => (u.status || 'active') === 'pending').length,
      staff: db.users.filter((u) => u.role === 'staff').length,
      subscriptions: db.subscriptions.length,
      activeSubscriptions: db.subscriptions.filter((s) => s.status === 'active').length,
      customMeals: db.customMeals.length,
      audit: store.listAudit(15)
    };
  },

  'GET /api/admin/users': async (req, q, ctx) => {
    requireRole(ctx, 'admin');
    return { users: store.listUsers().map(safeUser) };
  },

  'POST /api/admin/users/remove': async (req, q, ctx) => {
    requireRole(ctx, 'admin');
    const b = await readBody(req);
    const target = store.findUser((u) => u.id === b.userId);
    if (!target) throw Object.assign(new Error('User not found'), { code: 404 });
    if (target.id === ctx.user.id) throw new Error('You cannot remove your own account');
    if (target.role === 'admin') throw new Error('Admin accounts cannot be removed here');
    store.removeUser(target.id);
    store.audit('admin.user_removed', `${target.role} ${target.username}`, ctx.user.username);
    return { ok: true };
  },

  // Approve a pending account, or suspend / reactivate any non-admin account.
  'POST /api/admin/users/status': async (req, q, ctx) => {
    requireRole(ctx, 'admin');
    const b = await readBody(req);
    if (!['active', 'suspended'].includes(b.status)) throw new Error('Status must be active or suspended');
    const target = store.findUser((u) => u.id === b.userId);
    if (!target) throw Object.assign(new Error('User not found'), { code: 404 });
    if (target.id === ctx.user.id) throw new Error('You cannot change your own account status');
    if (target.role === 'admin' && b.status === 'suspended') throw new Error('Admins cannot be suspended — demote them first');
    const wasPending = (target.status || 'active') === 'pending';
    store.updateUser(target.id, (u) => { u.status = b.status; });
    store.audit(
      wasPending && b.status === 'active' ? 'admin.user_approved' : 'admin.user_status',
      `${target.username} → ${b.status}`, ctx.user.username
    );
    return { ok: true, user: safeUser(store.findUser((u) => u.id === target.id)) };
  },

  // Assign a role: user, staff or admin.
  'POST /api/admin/users/role': async (req, q, ctx) => {
    requireRole(ctx, 'admin');
    const b = await readBody(req);
    if (!['user', 'staff', 'admin'].includes(b.role)) throw new Error('Role must be user, staff or admin');
    const target = store.findUser((u) => u.id === b.userId);
    if (!target) throw Object.assign(new Error('User not found'), { code: 404 });
    if (target.id === ctx.user.id) throw new Error('You cannot change your own role');
    store.updateUser(target.id, (u) => {
      u.role = b.role;
      if (b.role !== 'user') u.status = 'active'; // staff/admin are trusted accounts
    });
    store.audit('admin.role_assigned', `${target.username} → ${b.role}`, ctx.user.username);
    return { ok: true, user: safeUser(store.findUser((u) => u.id === target.id)) };
  },

  'POST /api/admin/staff': async (req, q, ctx) => {
    requireRole(ctx, 'admin');
    const b = await readBody(req);
    const username = String(b.username || '').toLowerCase().trim();
    if (!auth.validUsername(username)) throw new Error('Username: 3–30 letters, numbers, dot, dash or underscore');
    if (!auth.validPassword(b.password)) throw new Error('Password must be at least 8 characters');
    if (!b.name || String(b.name).trim().length < 2) throw new Error('Enter the staff member\'s name');
    if (store.findUser((u) => u.username === username)) throw new Error('That username is taken');
    const staff = store.createUser({
      name: String(b.name).trim().slice(0, 80), username, email: null, phone: null,
      role: 'staff', passwordHash: auth.hashPassword(b.password), via: 'admin'
    });
    store.audit('admin.staff_created', username, ctx.user.username);
    return { ok: true, staff: safeUser(staff) };
  },

  'GET /api/admin/subscriptions': async (req, q, ctx) => {
    requireRole(ctx, 'admin');
    const subs = store._loadAll().subscriptions;
    return {
      subscriptions: subs.map((s) => ({
        id: s.id, name: s.name, phone: s.phone, status: s.status, weeks: s.weeks,
        slot: s.slot, diet: s.diet, total: s.pricing.total, createdAt: s.createdAt,
        start: s.days[0] && s.days[0].date, end: s.days[s.days.length - 1] && s.days[s.days.length - 1].date
      })).reverse()
    };
  },

  'POST /api/admin/subscriptions/status': async (req, q, ctx) => {
    requireRole(ctx, 'admin');
    const b = await readBody(req);
    if (!['active', 'paused', 'cancelled'].includes(b.status)) throw new Error('Invalid status');
    const sub = store.update(b.id, (s) => { s.status = b.status; });
    if (!sub) throw Object.assign(new Error('Subscription not found'), { code: 404 });
    store.audit('admin.subscription_status', `${b.id} → ${b.status}`, ctx.user.username);
    return { ok: true, subscription: sub };
  },

  'GET /api/admin/audit': async (req, q, ctx) => {
    requireRole(ctx, 'admin');
    return { audit: store.listAudit(200) };
  },

  // ---------- Staff (kitchen & delivery) ----------

  'GET /api/staff/orders': async (req, q, ctx) => {
    requireRole(ctx, 'staff', 'admin');
    const date = q.date && /^\d{4}-\d{2}-\d{2}$/.test(q.date)
      ? q.date : new Date().toISOString().slice(0, 10);
    const orders = [];
    for (const s of store._loadAll().subscriptions) {
      if (s.status !== 'active') continue;
      const day = s.days.find((d) => d.date === date);
      if (!day || day.skipped) continue;
      orders.push({
        subId: s.id, date, customer: s.name, phone: s.phone, address: s.address,
        slot: s.slot, diet: s.diet, status: day.status || 'accepted',
        meals: day.mealIds.map((id) => { const m = mealById(id); return m ? m.name : id; })
      });
    }
    orders.sort((a, b) => a.slot.localeCompare(b.slot));
    return { date, statuses: ORDER_STATUSES, orders };
  },

  'POST /api/staff/orders/status': async (req, q, ctx) => {
    requireRole(ctx, 'staff', 'admin');
    const b = await readBody(req);
    if (!ORDER_STATUSES.includes(b.status)) throw new Error(`Status must be one of: ${ORDER_STATUSES.join(', ')}`);
    const sub = store.update(b.subId, (s) => {
      const day = s.days.find((d) => d.date === b.date);
      if (!day) throw Object.assign(new Error('No delivery on that date'), { code: 404 });
      day.status = b.status;
    });
    if (!sub) throw Object.assign(new Error('Subscription not found'), { code: 404 });
    store.audit('staff.order_status', `${b.subId} ${b.date} → ${b.status}`, ctx.user.username);
    return { ok: true };
  },

  'GET /api/activity-levels': async () => ACTIVITY_LEVELS,

  'GET /api/foods': async (req, q) => {
    let list = FOODS;
    if (q.category) list = list.filter((f) => f.category === q.category);
    if (q.diet) list = list.filter((f) => f.diet === q.diet);
    if (q.q) {
      const needle = q.q.toLowerCase();
      list = list.filter(
        (f) => f.name.toLowerCase().includes(needle) ||
          f.category.toLowerCase().includes(needle) ||
          (f.tags || []).some((t) => t.includes(needle))
      );
    }
    return { count: list.length, categories: [...new Set(FOODS.map((f) => f.category))], foods: list };
  },

  'GET /api/meals': async (req, q) => {
    let list = MEALS;
    if (q.slot) list = list.filter((m) => m.slots.includes(q.slot));
    if (q.diet === 'veg') list = list.filter((m) => m.diet === 'veg');
    if (q.diet === 'egg') list = list.filter((m) => m.diet !== 'nonveg');
    return { count: list.length, meals: list };
  },

  'POST /api/targets': async (req) => {
    const body = await readBody(req);
    return body.mode === 'direct' ? targetsDirect(body) : targetsFromStats(body);
  },

  'POST /api/plan': async (req) => {
    const body = await readBody(req);
    return generatePlan(MEALS, body);
  },

  // Create a custom meal from raw ingredients. Body:
  // { name, phone?, slots?, items: [{ foodId, grams }] } — grams also means ml for liquids.
  'POST /api/custom-meals': async (req) => {
    const b = await readBody(req);
    if (!b.name || String(b.name).trim().length < 3) throw new Error('Give your meal a name (3+ characters)');
    if (!Array.isArray(b.items) || b.items.length === 0) throw new Error('Add at least one ingredient');
    if (b.items.length > 15) throw new Error('Maximum 15 ingredients per meal');

    let kcal = 0, protein = 0, carbs = 0, fat = 0, fiber = 0;
    let diet = 'veg';
    const items = b.items.map((it) => {
      const food = FOODS.find((f) => f.id === it.foodId);
      if (!food) throw new Error(`Unknown ingredient: ${it.foodId}`);
      const grams = Number(it.grams);
      if (!grams || grams < 5 || grams > 1000) throw new Error(`${food.name}: quantity must be 5–1000 g/ml`);
      const k = grams / 100;
      kcal += food.kcal * k; protein += food.protein * k; carbs += food.carbs * k;
      fat += food.fat * k; fiber += (food.fiber || 0) * k;
      if (food.diet === 'nonveg') diet = 'nonveg';
      else if (food.diet === 'egg' && diet === 'veg') diet = 'egg';
      return { foodId: food.id, name: food.name, grams, unit: food.unit };
    });
    if (kcal < 50) throw new Error('This meal is under 50 kcal — add more food');
    if (kcal > 2500) throw new Error('This meal is over 2500 kcal — split it into two meals');

    const slots = Array.isArray(b.slots) && b.slots.length
      ? b.slots.filter((s) => ['breakfast', 'lunch', 'snack', 'dinner'].includes(s))
      : ['breakfast', 'lunch', 'snack', 'dinner'];

    const meal = store.createCustomMeal({
      name: String(b.name).trim().slice(0, 60),
      desc: items.map((i) => `${i.grams}${i.unit === '100ml' ? ' ml' : ' g'} ${i.name}`).join(', '),
      phone: b.phone ? String(b.phone) : null,
      slots,
      diet,
      items,
      kcal: Math.round(kcal),
      protein: Math.round(protein * 10) / 10,
      carbs: Math.round(carbs * 10) / 10,
      fat: Math.round(fat * 10) / 10,
      fiber: Math.round(fiber * 10) / 10,
      price: priceCustomMeal(kcal),
      tags: ['shake', 'bowl'].includes(b.kind) ? ['custom', b.kind] : ['custom']
    });
    return { ok: true, meal };
  },

  'GET /api/custom-meals': async (req, q) => {
    if (q.ids) {
      const ids = q.ids.split(',');
      return { meals: ids.map((id) => store.findCustomMeal(id)).filter(Boolean) };
    }
    if (q.phone) return { meals: store.findCustomMealsByPhone(q.phone) };
    throw new Error('Provide ?ids= or ?phone=');
  },

  'POST /api/subscribe': async (req, q, ctx) => {
    if (ctx && ctx.user && (ctx.user.status || 'active') !== 'active') {
      throw Object.assign(new Error(
        ctx.user.status === 'pending'
          ? 'Your account is awaiting admin approval — you can order once it is approved'
          : 'This account is suspended — contact support'
      ), { code: 403 });
    }
    const b = await readBody(req);
    const required = ['name', 'phone', 'address', 'weeks', 'targets', 'diet', 'days'];
    for (const k of required) {
      if (b[k] === undefined || b[k] === null || b[k] === '') throw new Error(`Missing field: ${k}`);
    }
    if (!/^\d{10}$/.test(String(b.phone))) throw new Error('Phone must be a 10-digit number');
    const weeks = Number(b.weeks);
    if (![1, 2, 4].includes(weeks)) throw new Error('Plan must be 1, 2 or 4 weeks');
    if (!Array.isArray(b.days) || b.days.length === 0) throw new Error('No delivery days selected');
    for (const d of b.days) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d.date || '')) throw new Error('Each day needs a date (YYYY-MM-DD)');
      if (!validMealIds(d.mealIds)) throw new Error(`Invalid meal selection for ${d.date}`);
    }

    const pricePerDay = b.days.map((d) =>
      d.mealIds.reduce((s, id) => s + mealById(id).price, 0)
    );
    const gross = pricePerDay.reduce((a, x) => a + x, 0);
    const discount = weeks === 4 ? 0.1 : weeks === 2 ? 0.05 : 0;
    const total = Math.round(gross * (1 - discount));

    const sub = store.createSubscription({
      name: String(b.name).slice(0, 80),
      phone: String(b.phone),
      address: String(b.address).slice(0, 300),
      slot: b.slot === 'evening' ? 'evening' : 'morning',
      weeks,
      diet: b.diet,
      userId: ctx && ctx.user ? ctx.user.id : null,
      targets: { kcal: Number(b.targets.kcal) || 0, protein: Number(b.targets.protein) || 0 },
      days: b.days.map((d) => ({ date: d.date, mealIds: d.mealIds, skipped: false, status: 'accepted' })),
      pricing: { gross, discountPct: discount * 100, total }
    });
    store.audit('subscription.created', `${sub.id} ${sub.phone} ₹${total}`, ctx && ctx.user ? ctx.user.username : sub.phone);
    return { ok: true, subscription: sub };
  },

  'GET /api/subscription': async (req, q) => {
    let subs;
    if (q.id) {
      const sub = store.findById(q.id);
      if (!sub) throw Object.assign(new Error('Subscription not found'), { code: 404 });
      subs = [sub];
    } else if (q.phone) {
      subs = store.findByPhone(q.phone);
    } else {
      throw new Error('Provide ?phone= or ?id=');
    }
    // Resolve meal names (including custom meals) so the client needn't join.
    const mealNames = {};
    for (const s of subs) for (const d of s.days) for (const id of d.mealIds) {
      if (!mealNames[id]) {
        const m = mealById(id);
        mealNames[id] = m ? m.name : id;
      }
    }
    return { subscriptions: subs, mealNames };
  },

  'POST /api/subscription/skip': async (req) => {
    const b = await readBody(req);
    if (!isEditable(b.date)) throw new Error('Cutoff passed — changes for a date close at 8 PM the previous day');
    const sub = store.update(b.id, (s) => {
      const day = s.days.find((d) => d.date === b.date);
      if (!day) throw Object.assign(new Error('No delivery on that date'), { code: 404 });
      day.skipped = !!b.skip;
    });
    if (!sub) throw Object.assign(new Error('Subscription not found'), { code: 404 });
    return { ok: true, subscription: sub };
  },

  'POST /api/subscription/change-meals': async (req) => {
    const b = await readBody(req);
    if (!isEditable(b.date)) throw new Error('Cutoff passed — changes for a date close at 8 PM the previous day');
    if (!validMealIds(b.mealIds)) throw new Error('Invalid meal selection');
    const sub = store.update(b.id, (s) => {
      const day = s.days.find((d) => d.date === b.date);
      if (!day) throw Object.assign(new Error('No delivery on that date'), { code: 404 });
      day.mealIds = b.mealIds;
    });
    if (!sub) throw Object.assign(new Error('Subscription not found'), { code: 404 });
    return { ok: true, subscription: sub };
  },

  // Personal dashboard: order history + daily nutrients consumed in [from, to].
  // A day counts as consumed if it was delivered (date <= today) and not skipped.
  'GET /api/dashboard': async (req, q) => {
    if (!q.phone) throw new Error('Provide ?phone=');
    const today = new Date().toISOString().slice(0, 10);
    const to = q.to && /^\d{4}-\d{2}-\d{2}$/.test(q.to) ? q.to : today;
    const from = q.from && /^\d{4}-\d{2}-\d{2}$/.test(q.from)
      ? q.from
      : new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10);

    const subs = store.findAllByPhone(q.phone);
    const dailyMap = {};
    const mealCounts = {};
    for (const sub of subs) {
      for (const d of sub.days) {
        if (d.date < from || d.date > to || d.date > today || d.skipped) continue;
        const day = dailyMap[d.date] || (dailyMap[d.date] = { date: d.date, kcal: 0, protein: 0, carbs: 0, fat: 0, fiber: 0, price: 0 });
        for (const id of d.mealIds) {
          const m = mealById(id);
          if (!m) continue;
          day.kcal += m.kcal; day.protein += m.protein; day.carbs += m.carbs;
          day.fat += m.fat; day.fiber += m.fiber || 0; day.price += m.price;
          const key = m.name;
          mealCounts[key] = (mealCounts[key] || 0) + 1;
        }
      }
    }
    const daily = Object.values(dailyMap).sort((a, b) => a.date < b.date ? -1 : 1)
      .map((d) => ({
        date: d.date,
        kcal: Math.round(d.kcal), protein: Math.round(d.protein),
        carbs: Math.round(d.carbs), fat: Math.round(d.fat),
        fiber: Math.round(d.fiber), price: d.price
      }));
    const n = daily.length || 1;
    const sum = daily.reduce((t, d) => ({
      kcal: t.kcal + d.kcal, protein: t.protein + d.protein, carbs: t.carbs + d.carbs,
      fat: t.fat + d.fat, fiber: t.fiber + d.fiber, price: t.price + d.price
    }), { kcal: 0, protein: 0, carbs: 0, fat: 0, fiber: 0, price: 0 });

    const topMeals = Object.entries(mealCounts)
      .sort((a, b) => b[1] - a[1]).slice(0, 8)
      .map(([name, count]) => ({ name, count }));

    const latest = subs[subs.length - 1];
    return {
      from, to,
      orders: subs.map((s) => ({
        id: s.id, createdAt: s.createdAt, status: s.status, weeks: s.weeks,
        slot: s.slot, diet: s.diet, total: s.pricing.total,
        start: s.days[0] && s.days[0].date, end: s.days[s.days.length - 1] && s.days[s.days.length - 1].date
      })).reverse(),
      daysTracked: daily.length,
      daily,
      totals: sum,
      averages: {
        kcal: Math.round(sum.kcal / n), protein: Math.round(sum.protein / n),
        carbs: Math.round(sum.carbs / n), fat: Math.round(sum.fat / n), fiber: Math.round(sum.fiber / n)
      },
      topMeals,
      targets: latest ? latest.targets : null
    };
  },

  'POST /api/subscription/status': async (req) => {
    const b = await readBody(req);
    if (!['active', 'paused', 'cancelled'].includes(b.status)) throw new Error('Invalid status');
    const sub = store.update(b.id, (s) => { s.status = b.status; });
    if (!sub) throw Object.assign(new Error('Subscription not found'), { code: 404 });
    return { ok: true, subscription: sub };
  }
};

function serveStatic(req, res, pathname) {
  let file = pathname === '/' ? '/index.html' : pathname;
  file = path.normalize(file).replace(/^(\.\.[/\\])+/, '');
  const full = path.join(PUBLIC_DIR, file);
  if (!full.startsWith(PUBLIC_DIR)) {
    res.writeHead(403); return res.end('Forbidden');
  }
  fs.readFile(full, (err, data) => {
    if (err) {
      // SPA fallback: unknown paths render the app shell.
      if (!path.extname(full)) {
        return fs.readFile(path.join(PUBLIC_DIR, 'index.html'), (e2, html) => {
          if (e2) { res.writeHead(404); return res.end('Not found'); }
          res.writeHead(200, { 'Content-Type': MIME['.html'] });
          res.end(html);
        });
      }
      res.writeHead(404); return res.end('Not found');
    }
    const ext = path.extname(full);
    const headers = { 'Content-Type': MIME[ext] || 'application/octet-stream' };
    // Icons never change once shipped; app shell assets revalidate quickly.
    if (ext === '.svg') headers['Cache-Control'] = 'public, max-age=604800';
    else if (ext === '.css' || ext === '.js' || ext === '.json') headers['Cache-Control'] = 'public, max-age=300';
    const compressible = ['.html', '.css', '.js', '.svg', '.json'].includes(ext);
    if (compressible && data.length > 1024 && /\bgzip\b/.test(req.headers['accept-encoding'] || '')) {
      return zlib.gzip(data, (zerr, gz) => {
        if (zerr) { res.writeHead(200, headers); return res.end(data); }
        headers['Content-Encoding'] = 'gzip';
        res.writeHead(200, headers);
        res.end(gz);
      });
    }
    res.writeHead(200, headers);
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  const parsed = url.parse(req.url, true);
  const key = `${req.method} ${parsed.pathname}`;

  if (routes[key]) {
    const cookies = [];
    const ctx = { ...sessionUser(req), setCookie: (c) => cookies.push(c) };
    try {
      const data = await routes[key](req, parsed.query, ctx);
      if (cookies.length) res.setHeader('Set-Cookie', cookies);
      sendJson(res, 200, data);
    } catch (err) {
      if (cookies.length) res.setHeader('Set-Cookie', cookies);
      sendJson(res, err.code || 400, { error: err.message });
    }
    return;
  }
  if (parsed.pathname.startsWith('/api/')) return sendJson(res, 404, { error: 'Unknown API route' });
  if (req.method !== 'GET') { res.writeHead(405); return res.end('Method not allowed'); }
  serveStatic(req, res, parsed.pathname);
});

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`Tindam running → http://localhost:${PORT}  (${FOODS.length} foods, ${MEALS.length} meals)`);
  });
}

module.exports = { server, isEditable };
