'use strict';

// Tindam — fitness food subscription server.
// Zero-dependency Node.js HTTP server: serves the website from /public and a
// JSON REST API backed by the local food database in /data.

const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const { targetsFromStats, targetsDirect, ACTIVITY_LEVELS } = require('./lib/nutrition');
const { generatePlan } = require('./lib/planner');
const store = require('./lib/store');

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
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
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

  'POST /api/subscribe': async (req) => {
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
      targets: { kcal: Number(b.targets.kcal) || 0, protein: Number(b.targets.protein) || 0 },
      days: b.days.map((d) => ({ date: d.date, mealIds: d.mealIds, skipped: false })),
      pricing: { gross, discountPct: discount * 100, total }
    });
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
    res.writeHead(200, { 'Content-Type': MIME[path.extname(full)] || 'application/octet-stream' });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  const parsed = url.parse(req.url, true);
  const key = `${req.method} ${parsed.pathname}`;

  if (routes[key]) {
    try {
      const data = await routes[key](req, parsed.query);
      sendJson(res, 200, data);
    } catch (err) {
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
