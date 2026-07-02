'use strict';

// Seed a demo user with ~5 weeks of past deliveries so the dashboard has
// history to chart. Run: node scripts/seed-demo.js  (demo phone: 9000000001)

const fs = require('fs');
const path = require('path');
const store = require('../lib/store');

const MEALS = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'meals.json'), 'utf8')).meals;
const PHONE = '9000000001';

if (store.findAllByPhone(PHONE).length > 0) {
  console.log(`Demo user ${PHONE} already seeded — nothing to do.`);
  process.exit(0);
}

// A sensible rotating menu: 4 meals/day at ~2,400 kcal for a muscle-maintain user.
const rotation = [
  ['m-masala-oats', 'm-grilled-chicken-brown-rice', 'm-fruit-bowl', 'm-khichdi-curd'],
  ['m-egg-bhurji-phulka', 'm-chicken-rice-bowl', 'm-masala-chaas', 'm-soup-paneer-salad'],
  ['m-moong-chilla', 'm-rajma-chawal', 'm-whey-shake', 'm-tandoori-chicken'],
  ['m-yogurt-parfait', 'm-chicken-curry-phulka', 'm-sprouts-chaat', 'm-fish-curry-rice'],
  ['m-idli-sambar', 'm-veg-thali', 'm-dry-fruit-bowl', 'm-grilled-chicken-veggies'],
  ['m-banana-oat-shake', 'm-grilled-fish-quinoa', 'm-boiled-eggs', 'm-paneer-bhurji-phulka'],
  ['m-sprouts-poha', 'm-chicken-keema-bowl', 'm-sattu-drink', 'm-curd-rice-pom']
];

const start = new Date(Date.now() - 38 * 86400000); // ~5.5 weeks ago
const days = [];
for (let i = 0; i < 42; i++) {
  const date = new Date(start.getTime() + i * 86400000).toISOString().slice(0, 10);
  days.push({
    date,
    mealIds: rotation[i % rotation.length],
    skipped: i % 11 === 7 // an occasional skipped day, like real life
  });
}

const gross = days.reduce((s, d) => s + d.mealIds.reduce((x, id) => x + MEALS.find((m) => m.id === id).price, 0), 0);
const sub = store.createSubscription({
  name: 'Demo User',
  phone: PHONE,
  address: '12 Demo Lane, Bengaluru 560001',
  slot: 'morning',
  weeks: 4,
  diet: 'nonveg',
  targets: { kcal: 2400, protein: 140 },
  days,
  pricing: { gross, discountPct: 10, total: Math.round(gross * 0.9) }
});

console.log(`Seeded demo subscription ${sub.id} for phone ${PHONE} (${days.length} days, ${days.filter((d) => d.date <= new Date().toISOString().slice(0, 10)).length} already delivered).`);
console.log('Open the Dashboard page and enter that phone number to see the charts.');
