'use strict';

// Lightweight test runner — no dependencies. Run: npm test

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const http = require('http');

const { targetsFromStats, targetsDirect } = require('../lib/nutrition');
const { generatePlan, dietAllows } = require('../lib/planner');
const { server, isEditable } = require('../server');

const MEALS = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'meals.json'), 'utf8')).meals;
const FOODS = ['foods.json', 'foods-extra.json', 'foods-extra2.json', 'foods-ifct.json', 'foods-dishes.json'].flatMap(
  (f) => JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', f), 'utf8')).foods
);

let passed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed++; console.log('  ✓ ' + name); }
  catch (e) { failures.push({ name, e }); console.log('  ✗ ' + name + ' — ' + e.message); }
}

console.log('\nData integrity');
test('foods database has 1000+ entries', () => assert.ok(FOODS.length >= 1000, `got ${FOODS.length}`));
test('foods database has 1000+ UNIQUE base foods (variants collapsed)', () => {
  // "Mango, ripe, kesar" and "Mango / Aam" both collapse to base "mango" —
  // varieties of the same food must not inflate the unique count.
  const norm = (n) => n.toLowerCase().replace(/\(.*?\)/g, '').split('/')[0].split(',')[0].trim().replace(/\s+/g, ' ');
  const bases = new Set(FOODS.map((f) => norm(f.name)));
  assert.ok(bases.size >= 1000, `got ${bases.size} unique base foods`);
});
test('food ids are unique', () => {
  assert.strictEqual(new Set(FOODS.map((f) => f.id)).size, FOODS.length);
});
test('every food has complete nutrition fields', () => {
  for (const f of FOODS) {
    for (const k of ['kcal', 'protein', 'carbs', 'fat', 'fiber']) {
      assert.strictEqual(typeof f[k], 'number', `${f.id}.${k}`);
    }
    assert.ok(['100g', '100ml'].includes(f.unit), f.id);
    assert.ok(['veg', 'egg', 'nonveg'].includes(f.diet), f.id);
  }
});
test('food macro energy roughly matches stated kcal', () => {
  // Metabolizable energy: 4/4/9 kcal per g plus ~2 kcal/g for dietary fiber
  // (the convention IFCT 2017 uses). Tiny-kcal foods are skipped: rounding noise dominates.
  for (const f of FOODS) {
    if (f.kcal < 40) continue;
    const computed = f.protein * 4 + f.carbs * 4 + f.fat * 9 + (f.fiber || 0) * 2;
    const ratio = computed / f.kcal;
    assert.ok(ratio > 0.7 && ratio < 1.45, `${f.id}: stated ${f.kcal}, macros ${Math.round(computed)}`);
  }
});
test('meal ids are unique and slots valid', () => {
  assert.strictEqual(new Set(MEALS.map((m) => m.id)).size, MEALS.length);
  for (const m of MEALS) {
    assert.ok(m.slots.every((s) => ['breakfast', 'lunch', 'snack', 'dinner'].includes(s)), m.id);
    assert.ok(m.price > 0 && m.kcal > 0 && m.protein >= 0, m.id);
  }
});
test('every slot has veg options (veg users can fill a full day)', () => {
  for (const slot of ['breakfast', 'lunch', 'snack', 'dinner']) {
    assert.ok(MEALS.some((m) => m.slots.includes(slot) && m.diet === 'veg'), slot);
  }
});

console.log('\nNutrition engine');
test('BMR/TDEE for a known case (male 26y 172cm 74kg moderate)', () => {
  const t = targetsFromStats({ gender: 'male', age: 26, heightCm: 172, weightKg: 74, activity: 'moderate', goal: 'maintain' });
  assert.strictEqual(t.bmr, 1690);
  assert.strictEqual(t.tdee, 2620);
  assert.strictEqual(t.kcal, 2620);
});
test('weight loss subtracts deficit and raises protein per kg', () => {
  const t = targetsFromStats({ gender: 'female', age: 30, heightCm: 160, weightKg: 70, activity: 'light', goal: 'lose', rateKgPerWeek: 0.5 });
  assert.ok(t.kcal < t.tdee);
  assert.strictEqual(t.protein, Math.round(2.0 * 70));
});
test('calorie floor is enforced for aggressive cuts', () => {
  const t = targetsFromStats({ gender: 'female', age: 25, heightCm: 150, weightKg: 45, activity: 'sedentary', goal: 'lose', rateKgPerWeek: 1 });
  assert.ok(t.kcal >= 1200, `got ${t.kcal}`);
});
test('direct mode defaults protein to 25% of energy', () => {
  const t = targetsDirect({ kcal: 2000 });
  assert.strictEqual(t.protein, 125);
});
test('direct mode rejects nonsense calories', () => {
  assert.throws(() => targetsDirect({ kcal: 200 }));
  assert.throws(() => targetsDirect({ kcal: 9000 }));
});
test('stats mode rejects unrealistic inputs', () => {
  assert.throws(() => targetsFromStats({ gender: 'male', age: 5, heightCm: 172, weightKg: 74 }));
  assert.throws(() => targetsFromStats({ gender: 'male', age: 26, heightCm: 172 }));
});

console.log('\nMeal planner');
test('7-day nonveg plan lands within 12% of calorie target', () => {
  const plan = generatePlan(MEALS, { kcal: 2500, protein: 140, diet: 'nonveg', days: 7, seed: 1 });
  assert.strictEqual(plan.days.length, 7);
  for (const d of plan.days) {
    const dev = Math.abs(d.totals.kcal - 2500) / 2500;
    assert.ok(dev <= 0.12, `day ${d.day}: ${d.totals.kcal} kcal (${Math.round(dev * 100)}% off)`);
  }
});
test('veg plan contains only veg meals', () => {
  const plan = generatePlan(MEALS, { kcal: 2000, protein: 100, diet: 'veg', days: 7, seed: 2 });
  for (const d of plan.days) for (const m of d.meals) assert.strictEqual(m.diet, 'veg', m.id);
});
test('egg plan never contains nonveg meals', () => {
  const plan = generatePlan(MEALS, { kcal: 2200, protein: 120, diet: 'egg', days: 7, seed: 3 });
  for (const d of plan.days) for (const m of d.meals) assert.notStrictEqual(m.diet, 'nonveg', m.id);
});
test('bulk target (3200 kcal) lands within 12% of calories', () => {
  const plan = generatePlan(MEALS, { kcal: 3200, protein: 140, diet: 'nonveg', days: 7, seed: 11 });
  for (const d of plan.days) {
    const dev = Math.abs(d.totals.kcal - 3200) / 3200;
    assert.ok(dev <= 0.12, `day ${d.day}: ${d.totals.kcal} kcal (${Math.round(dev * 100)}% off)`);
  }
});
test('veg bulk target (3000 kcal) lands within 15% of calories', () => {
  const plan = generatePlan(MEALS, { kcal: 3000, protein: 130, diet: 'veg', days: 7, seed: 12 });
  for (const d of plan.days) {
    const dev = Math.abs(d.totals.kcal - 3000) / 3000;
    assert.ok(dev <= 0.15, `day ${d.day}: ${d.totals.kcal} kcal (${Math.round(dev * 100)}% off)`);
  }
});
test('high-protein bulk target gets protein within 20%', () => {
  const plan = generatePlan(MEALS, { kcal: 3000, protein: 160, diet: 'nonveg', days: 7, seed: 4 });
  for (const d of plan.days) {
    assert.ok(d.totals.protein >= 160 * 0.8, `day ${d.day}: ${d.totals.protein} g`);
  }
});
test('each day covers all four slots', () => {
  const plan = generatePlan(MEALS, { kcal: 2200, protein: 110, diet: 'veg', days: 3, seed: 5 });
  for (const d of plan.days) {
    const slots = d.meals.map((m) => m.slot);
    for (const s of ['breakfast', 'lunch', 'snack', 'dinner']) assert.ok(slots.includes(s), s);
  }
});
test('same seed gives a reproducible plan', () => {
  const a = generatePlan(MEALS, { kcal: 2400, protein: 130, diet: 'nonveg', days: 7, seed: 7 });
  const b = generatePlan(MEALS, { kcal: 2400, protein: 130, diet: 'nonveg', days: 7, seed: 7 });
  assert.deepStrictEqual(a, b);
});
test('planner rejects out-of-range targets', () => {
  assert.throws(() => generatePlan(MEALS, { kcal: 500, protein: 100 }));
  assert.throws(() => generatePlan(MEALS, { kcal: 2000, protein: 5 }));
});
test('dietAllows hierarchy: veg ⊂ egg ⊂ nonveg', () => {
  assert.ok(dietAllows('veg', 'veg') && !dietAllows('veg', 'egg') && !dietAllows('veg', 'nonveg'));
  assert.ok(dietAllows('egg', 'veg') && dietAllows('egg', 'egg') && !dietAllows('egg', 'nonveg'));
  assert.ok(dietAllows('nonveg', 'nonveg'));
});

console.log('\nCutoff rules');
test('a date is editable before 8 PM the previous day, locked after', () => {
  assert.ok(isEditable('2026-07-10', new Date('2026-07-09T19:59:00')));
  assert.ok(!isEditable('2026-07-10', new Date('2026-07-09T20:00:00')));
  assert.ok(!isEditable('2026-07-10', new Date('2026-07-10T08:00:00')));
});

console.log('\nHTTP API');
function req(method, urlPath, body, jar) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const headers = data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {};
    if (jar && jar.cookie) headers.Cookie = jar.cookie;
    const r = http.request({
      host: '127.0.0.1', port: server.address().port, path: urlPath, method, headers
    }, (res) => {
      let raw = '';
      res.on('data', (c) => raw += c);
      res.on('end', () => {
        if (jar && res.headers['set-cookie']) {
          const c = res.headers['set-cookie'][0].split(';')[0];
          jar.cookie = /Max-Age=0/.test(res.headers['set-cookie'][0]) ? null : c;
        }
        resolve({ status: res.statusCode, body: JSON.parse(raw || '{}') });
      });
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

async function apiTests() {
  await new Promise((res) => server.listen(0, res));
  const results = [];
  async function atest(name, fn) {
    try { await fn(); passed++; console.log('  ✓ ' + name); }
    catch (e) { failures.push({ name, e }); console.log('  ✗ ' + name + ' — ' + e.message); }
    results.push(name);
  }

  await atest('GET /api/health reports data sizes', async () => {
    const r = await req('GET', '/api/health');
    assert.strictEqual(r.status, 200);
    assert.ok(r.body.foods >= 1000 && r.body.meals >= 35);
  });
  await atest('GET /api/foods?q=paneer filters by name', async () => {
    const r = await req('GET', '/api/foods?q=paneer');
    assert.ok(r.body.count >= 2);
    assert.ok(r.body.foods.every((f) => f.name.toLowerCase().includes('paneer') || f.tags.some((t) => t.includes('paneer'))));
  });
  await atest('GET /api/meals?diet=veg&slot=dinner returns only veg dinners', async () => {
    const r = await req('GET', '/api/meals?diet=veg&slot=dinner');
    assert.ok(r.body.count > 0);
    assert.ok(r.body.meals.every((m) => m.diet === 'veg' && m.slots.includes('dinner')));
  });
  await atest('POST /api/targets (stats) returns full macro set', async () => {
    const r = await req('POST', '/api/targets', { gender: 'male', age: 28, heightCm: 175, weightKg: 80, activity: 'moderate', goal: 'gain' });
    assert.strictEqual(r.status, 200);
    for (const k of ['bmr', 'tdee', 'kcal', 'protein', 'carbs', 'fat', 'fiber']) assert.ok(r.body[k] > 0, k);
  });
  await atest('POST /api/plan generates a plan over HTTP', async () => {
    const r = await req('POST', '/api/plan', { kcal: 2500, protein: 130, diet: 'egg', days: 7, seed: 9 });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.days.length, 7);
  });
  await atest('POST /api/subscribe → lookup → skip → pause round-trip', async () => {
    const future = new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10);
    const sub = await req('POST', '/api/subscribe', {
      name: 'Test User', phone: '9876543210', address: '12 MG Road, Bengaluru 560001',
      slot: 'morning', weeks: 1, diet: 'veg', targets: { kcal: 2000, protein: 100 },
      days: [{ date: future, mealIds: ['m-masala-oats', 'm-veg-thali', 'm-fruit-bowl', 'm-khichdi-curd'] }]
    });
    assert.strictEqual(sub.status, 200, JSON.stringify(sub.body));
    const id = sub.body.subscription.id;
    assert.ok(id.startsWith('TDM-'));
    assert.ok(sub.body.subscription.pricing.total > 0);

    const found = await req('GET', '/api/subscription?phone=9876543210');
    assert.ok(found.body.subscriptions.some((s) => s.id === id));

    const skip = await req('POST', '/api/subscription/skip', { id, date: future, skip: true });
    assert.strictEqual(skip.status, 200);
    assert.ok(skip.body.subscription.days.find((d) => d.date === future).skipped);

    const pause = await req('POST', '/api/subscription/status', { id, status: 'paused' });
    assert.strictEqual(pause.body.subscription.status, 'paused');
    // cleanup so reruns don't accumulate
    await req('POST', '/api/subscription/status', { id, status: 'cancelled' });
  });
  await atest('POST /api/custom-meals builds a meal from ingredients', async () => {
    const r = await req('POST', '/api/custom-meals', {
      name: 'My Bulk Bowl',
      slots: ['lunch', 'dinner'],
      items: [
        { foodId: 'chicken-breast-boiled', grams: 200 },
        { foodId: 'rice-white-cooked', grams: 300 },
        { foodId: 'broccoli', grams: 100 }
      ]
    });
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    const m = r.body.meal;
    assert.ok(m.id.startsWith('cm-'));
    // 200g chicken (330) + 300g rice (390) + 100g broccoli (34) = 754 kcal
    assert.ok(Math.abs(m.kcal - 754) <= 2, `kcal ${m.kcal}`);
    assert.ok(Math.abs(m.protein - 73) <= 2, `protein ${m.protein}`);
    assert.strictEqual(m.diet, 'nonveg');
    assert.ok(m.price >= 49);

    // custom meal is usable in a subscription
    const future = new Date(Date.now() + 4 * 86400000).toISOString().slice(0, 10);
    const sub = await req('POST', '/api/subscribe', {
      name: 'Custom User', phone: '9123456780', address: '7 FC Road, Pune 411004',
      slot: 'evening', weeks: 1, diet: 'nonveg', targets: { kcal: 2500, protein: 150 },
      days: [{ date: future, mealIds: [m.id, 'm-fruit-bowl'] }]
    });
    assert.strictEqual(sub.status, 200, JSON.stringify(sub.body));
    assert.strictEqual(sub.body.subscription.pricing.gross, m.price + 89);

    // lookup resolves the custom meal's name
    const found = await req('GET', `/api/subscription?id=${sub.body.subscription.id}`);
    assert.strictEqual(found.body.mealNames[m.id], 'My Bulk Bowl');
    await req('POST', '/api/subscription/status', { id: sub.body.subscription.id, status: 'cancelled' });
  });
  await atest('POST /api/custom-meals validates ingredients and quantities', async () => {
    const bad1 = await req('POST', '/api/custom-meals', {
      name: 'Bad', items: [{ foodId: 'no-such-food', grams: 100 }]
    });
    assert.strictEqual(bad1.status, 400);
    const bad2 = await req('POST', '/api/custom-meals', {
      name: 'Tiny', items: [{ foodId: 'cucumber', grams: 2 }]
    });
    assert.strictEqual(bad2.status, 400);
    const bad3 = await req('POST', '/api/custom-meals', {
      name: 'Water only', items: [{ foodId: 'green-tea', grams: 100 }]
    });
    assert.strictEqual(bad3.status, 400); // under 50 kcal
  });
  await atest('POST /api/subscribe rejects bad phone and unknown meals', async () => {
    const future = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
    const bad1 = await req('POST', '/api/subscribe', {
      name: 'X', phone: '12345', address: 'Y', slot: 'morning', weeks: 1, diet: 'veg',
      targets: { kcal: 2000, protein: 100 }, days: [{ date: future, mealIds: ['m-veg-thali'] }]
    });
    assert.strictEqual(bad1.status, 400);
    const bad2 = await req('POST', '/api/subscribe', {
      name: 'X', phone: '9876543210', address: 'Y', slot: 'morning', weeks: 1, diet: 'veg',
      targets: { kcal: 2000, protein: 100 }, days: [{ date: future, mealIds: ['not-a-meal'] }]
    });
    assert.strictEqual(bad2.status, 400);
  });
  await atest('shake kind gets the shake tag and works like a meal', async () => {
    const r = await req('POST', '/api/custom-meals', {
      name: 'Test Power Shake', kind: 'shake', slots: ['breakfast', 'snack'],
      items: [
        { foodId: 'milk-toned', grams: 250 },
        { foodId: 'banana', grams: 100 },
        { foodId: 'whey-protein', grams: 30 }
      ]
    });
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    assert.ok(r.body.meal.tags.includes('shake'));
    // 250ml toned milk (145) + 100g banana (89) + 30g whey (120) = 354 kcal
    assert.ok(Math.abs(r.body.meal.kcal - 354) <= 3, `kcal ${r.body.meal.kcal}`);
    assert.ok(Math.abs(r.body.meal.protein - 31.4) <= 1.5, `protein ${r.body.meal.protein}`);
  });
  await atest('fruit bowl kind gets the bowl tag with computed nutrition', async () => {
    const r = await req('POST', '/api/custom-meals', {
      name: 'Rainbow Bowl', kind: 'bowl', slots: ['snack'],
      items: [
        { foodId: 'papaya', grams: 150 },
        { foodId: 'banana', grams: 100 },
        { foodId: 'pomegranate', grams: 100 },
        { foodId: 'almonds', grams: 10 }
      ]
    });
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    assert.ok(r.body.meal.tags.includes('bowl'));
    // 150g papaya (64.5) + 100g banana (89) + 100g anaar (83) + 10g almonds (57.9) = 294 kcal
    assert.ok(Math.abs(r.body.meal.kcal - 294) <= 3, `kcal ${r.body.meal.kcal}`);
    assert.ok(r.body.meal.fiber >= 8, `fiber ${r.body.meal.fiber}`);
  });
  await atest('GET /api/dashboard aggregates delivered days in range', async () => {
    const phone = '9111222333';
    const day = (offset) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
    const sub = await req('POST', '/api/subscribe', {
      name: 'Dash User', phone, address: '5 Test Marg, Delhi 110001',
      slot: 'morning', weeks: 1, diet: 'veg', targets: { kcal: 2000, protein: 100 },
      days: [
        { date: day(-3), mealIds: ['m-masala-oats', 'm-veg-thali'] },   // delivered
        { date: day(-2), mealIds: ['m-masala-oats'] },                  // delivered
        { date: day(-1), mealIds: ['m-veg-thali'] },                    // will be skipped
        { date: day(2), mealIds: ['m-veg-thali'] }                      // future — not counted
      ]
    });
    assert.strictEqual(sub.status, 200, JSON.stringify(sub.body));
    const id = sub.body.subscription.id;
    // note: day(-1) skip bypasses cutoff via direct store write in real ops;
    // here we test the aggregation contract with what the API allows: only
    // delivered, non-skipped days inside [from,to] count.
    const d = await req('GET', `/api/dashboard?phone=${phone}&from=${day(-6)}&to=${day(0)}`);
    assert.strictEqual(d.status, 200);
    assert.strictEqual(d.body.daysTracked, 3);
    const first = d.body.daily.find((x) => x.date === day(-3));
    // masala oats 340 + veg thali 600 = 940 kcal, 13 + 24 = 37 g protein
    assert.strictEqual(first.kcal, 940);
    assert.strictEqual(first.protein, 37);
    assert.ok(d.body.topMeals[0].name === 'Masala Oats Porridge Bowl' || d.body.topMeals[0].name === 'Balanced Veg Thali');
    assert.strictEqual(d.body.targets.kcal, 2000);
    assert.ok(d.body.orders.some((o) => o.id === id));
    // future-only range → nothing tracked
    const empty = await req('GET', `/api/dashboard?phone=${phone}&from=${day(1)}&to=${day(3)}`);
    assert.strictEqual(empty.body.daysTracked, 0);
    await req('POST', '/api/subscription/status', { id, status: 'cancelled' });
  });
  await atest('skip past cutoff is rejected', async () => {
    const r = await req('POST', '/api/subscription/skip', { id: 'TDM-NOPE', date: '2020-01-01', skip: true });
    assert.strictEqual(r.status, 400);
    assert.ok(/cutoff/i.test(r.body.error));
  });
  await atest('signup → session cookie → me → logout round-trip', async () => {
    const jar = {};
    const su = await req('POST', '/api/auth/signup', {
      name: 'Test Person', username: 'testperson', email: 'test@person.in',
      phone: '9876501234', password: 'S3curePass!'
    }, jar);
    assert.strictEqual(su.status, 200, JSON.stringify(su.body));
    assert.strictEqual(su.body.user.role, 'user');
    assert.strictEqual(su.body.user.status, 'pending'); // awaits admin approval
    assert.ok(jar.cookie, 'session cookie set');
    const me = await req('GET', '/api/auth/me', null, jar);
    assert.strictEqual(me.body.user.username, 'testperson');
    await req('POST', '/api/auth/logout', {}, jar);
    const me2 = await req('GET', '/api/auth/me', null, jar);
    assert.strictEqual(me2.body.user, null);
  });
  await atest('login rejects wrong password and unknown user', async () => {
    const bad = await req('POST', '/api/auth/login', { id: 'testperson', password: 'wrongwrong' });
    assert.strictEqual(bad.status, 401);
    const none = await req('POST', '/api/auth/login', { id: 'ghost', password: 'whatever123' });
    assert.strictEqual(none.status, 401);
    const dup = await req('POST', '/api/auth/signup', {
      name: 'Dup', username: 'testperson', email: 'x@y.dev', password: 'S3curePass!'
    });
    assert.strictEqual(dup.status, 400);
  });
  await atest('forgot → reset link → new password works, old fails', async () => {
    const fg = await req('POST', '/api/auth/forgot', { id: 'testperson' });
    assert.ok(fg.body.devResetLink, 'dev reset link returned');
    const token = fg.body.devResetLink.split('token=')[1];
    const rs = await req('POST', '/api/auth/reset', { token, password: 'NewPass123!' });
    assert.strictEqual(rs.status, 200);
    const old = await req('POST', '/api/auth/login', { id: 'testperson', password: 'S3curePass!' });
    assert.strictEqual(old.status, 401);
    const jar = {};
    const fresh = await req('POST', '/api/auth/login', { id: 'testperson', password: 'NewPass123!' }, jar);
    assert.strictEqual(fresh.status, 200);
    const reuse = await req('POST', '/api/auth/reset', { token, password: 'Another123!' });
    assert.strictEqual(reuse.status, 400); // token single-use
  });
  await atest('admin: seeded login, create staff, list & remove users, audit', async () => {
    const anon = await req('GET', '/api/admin/users');
    assert.strictEqual(anon.status, 401);
    const userJar = {};
    await req('POST', '/api/auth/login', { id: 'testperson', password: 'NewPass123!' }, userJar);
    const forbidden = await req('GET', '/api/admin/users', null, userJar);
    assert.strictEqual(forbidden.status, 403);

    const adminJar = {};
    const al = await req('POST', '/api/auth/login', { id: 'admin', password: 'Admin@123' }, adminJar);
    assert.strictEqual(al.status, 200, JSON.stringify(al.body));
    assert.strictEqual(al.body.user.role, 'admin');

    const st = await req('POST', '/api/admin/staff', { name: 'Kitchen One', username: 'kitchen1', password: 'Kitchen@123' }, adminJar);
    assert.strictEqual(st.status, 200, JSON.stringify(st.body));
    assert.strictEqual(st.body.staff.role, 'staff');

    const users = await req('GET', '/api/admin/users', null, adminJar);
    assert.ok(users.body.users.some((u) => u.username === 'kitchen1'));
    const victim = users.body.users.find((u) => u.username === 'testperson');

    // Approval flow: pending signup can't subscribe while logged in; approved can.
    assert.strictEqual(victim.status, 'pending');
    const day = (o) => new Date(Date.now() + o * 86400000).toISOString().slice(0, 10);
    const subBody = {
      name: 'Test Person', phone: '9876501234', address: '1 Approval St, Pune 411001',
      slot: 'morning', weeks: 1, diet: 'veg', targets: { kcal: 2000, protein: 100 },
      days: [{ date: day(2), mealIds: ['m-masala-oats'] }]
    };
    const blocked = await req('POST', '/api/subscribe', subBody, userJar);
    assert.strictEqual(blocked.status, 403, JSON.stringify(blocked.body));
    const ap = await req('POST', '/api/admin/users/status', { userId: victim.id, status: 'active' }, adminJar);
    assert.strictEqual(ap.status, 200, JSON.stringify(ap.body));
    assert.strictEqual(ap.body.user.status, 'active');
    const allowed = await req('POST', '/api/subscribe', subBody, userJar);
    assert.strictEqual(allowed.status, 200, JSON.stringify(allowed.body));

    // Role assignment: promote to staff, verify staff access, demote back.
    const pr = await req('POST', '/api/admin/users/role', { userId: victim.id, role: 'staff' }, adminJar);
    assert.strictEqual(pr.status, 200, JSON.stringify(pr.body));
    assert.strictEqual(pr.body.user.role, 'staff');
    const boardAsStaff = await req('GET', '/api/staff/orders', null, userJar);
    assert.strictEqual(boardAsStaff.status, 200);
    await req('POST', '/api/admin/users/role', { userId: victim.id, role: 'user' }, adminJar);

    // Suspension blocks login.
    await req('POST', '/api/admin/users/status', { userId: victim.id, status: 'suspended' }, adminJar);
    const sLogin = await req('POST', '/api/auth/login', { id: 'testperson', password: 'NewPass123!' });
    assert.strictEqual(sLogin.status, 403);
    await req('POST', '/api/admin/users/status', { userId: victim.id, status: 'active' }, adminJar);

    const rm = await req('POST', '/api/admin/users/remove', { userId: victim.id }, adminJar);
    assert.strictEqual(rm.status, 200);
    const after = await req('GET', '/api/admin/users', null, adminJar);
    assert.ok(!after.body.users.some((u) => u.username === 'testperson'));

    const audit = await req('GET', '/api/admin/audit', null, adminJar);
    assert.ok(audit.body.audit.some((a) => a.event === 'admin.staff_created'));
    assert.ok(audit.body.audit.some((a) => a.event === 'admin.user_removed'));
  });
  await atest('staff: sees orders for a date and updates delivery status', async () => {
    const day = (offset) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
    const sub = await req('POST', '/api/subscribe', {
      name: 'Order Cust', phone: '9555666777', address: '9 Kitchen Rd, Chennai 600001',
      slot: 'morning', weeks: 1, diet: 'veg', targets: { kcal: 2000, protein: 100 },
      days: [{ date: day(1), mealIds: ['m-masala-oats', 'm-veg-thali'] }]
    });
    const subId = sub.body.subscription.id;
    assert.strictEqual(sub.body.subscription.days[0].status, 'accepted');

    const staffJar = {};
    const sl = await req('POST', '/api/auth/login', { id: 'kitchen1', password: 'Kitchen@123' }, staffJar);
    assert.strictEqual(sl.status, 200);

    const board = await req('GET', `/api/staff/orders?date=${day(1)}`, null, staffJar);
    assert.strictEqual(board.status, 200);
    const order = board.body.orders.find((o) => o.subId === subId);
    assert.ok(order, 'order visible on staff board');
    assert.ok(order.meals.includes('Balanced Veg Thali'));

    const up = await req('POST', '/api/staff/orders/status', { subId, date: day(1), status: 'preparing' }, staffJar);
    assert.strictEqual(up.status, 200);
    const board2 = await req('GET', `/api/staff/orders?date=${day(1)}`, null, staffJar);
    assert.strictEqual(board2.body.orders.find((o) => o.subId === subId).status, 'preparing');

    const badStatus = await req('POST', '/api/staff/orders/status', { subId, date: day(1), status: 'eaten' }, staffJar);
    assert.strictEqual(badStatus.status, 400);
    const anon = await req('GET', '/api/staff/orders');
    assert.strictEqual(anon.status, 401);
    await req('POST', '/api/subscription/status', { id: subId, status: 'cancelled' });
  });
  await atest('static site is served at /', async () => {
    const r = await new Promise((resolve, reject) => {
      http.get({ host: '127.0.0.1', port: server.address().port, path: '/' }, (res) => {
        let raw = '';
        res.on('data', (c) => raw += c);
        res.on('end', () => resolve({ status: res.statusCode, body: raw }));
      }).on('error', reject);
    });
    assert.strictEqual(r.status, 200);
    assert.ok(r.body.includes('Tindam'));
  });

  server.close();
}

apiTests().then(() => {
  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length) {
    for (const f of failures) console.error(`FAIL: ${f.name}\n  ${f.e.stack}`);
    process.exit(1);
  }
});
