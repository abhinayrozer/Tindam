'use strict';

// Build the bundled food-icon set: maps every food & meal to a Twemoji SVG,
// copies only the SVGs actually used into public/icons/, and writes
// public/icons/map.json for the frontend.
//
// Usage: node scripts/build-icons.js /path/to/node_modules/@twemoji/svg
// (install the source once with: npm i @twemoji/svg)

const fs = require('fs');
const path = require('path');
const { glyphFor, twemojiFile } = require('../lib/food-glyphs');

const SRC = process.argv[2];
if (!SRC || !fs.existsSync(SRC)) {
  console.error('Pass the @twemoji/svg assets directory as the first argument.');
  process.exit(1);
}

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'public', 'icons');
fs.mkdirSync(OUT, { recursive: true });

const FOOD_FILES = ['foods.json', 'foods-extra.json', 'foods-extra2.json', 'foods-ifct.json', 'foods-dishes.json'];
const foods = FOOD_FILES.flatMap((f) => JSON.parse(fs.readFileSync(path.join(ROOT, 'data', f), 'utf8')).foods);
const meals = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'meals.json'), 'utf8')).meals;

const map = { foods: {}, meals: {}, ui: {} };
const needed = new Set();

for (const f of foods) {
  const file = twemojiFile(glyphFor(f));
  map.foods[f.id] = file;
  needed.add(file);
}
for (const m of meals) {
  // meals are prepared dishes — classify with the dish ruleset
  const file = twemojiFile(glyphFor({ name: m.name, category: 'Prepared Indian Meals' }));
  map.meals[m.id] = file;
  needed.add(file);
}
// glyphs the UI itself uses (custom meal kinds, rail, hero, misc)
const UI = {
  shake: '🥤', bowl: '🍉', custom: '🍽️', salad: '🥗', muscle: '💪', chicken: '🍗',
  paneer: '🧀', breakfast: '🥣', lunch: '🍛', weight: '🥗', fruit: '🍉', millet: '🌾',
  dinner: '🍲', logo: '🥗', box: '🍱', spark: '✨', fire: '🔥', leaf: '🌿', egg: '🍳',
  grape: '🍇', mango: '🥭', avocado: '🥑', berry: '🫐', banana: '🍌', broccoli: '🥦',
  fish: '🐟', roti: '🫓', shake2: '🧃', nuts: '🥜', chart: '📊', cart: '🛒', empty: '📭'
};
for (const [k, e] of Object.entries(UI)) {
  const file = twemojiFile(e);
  map.ui[k] = file;
  needed.add(file);
}

let copied = 0;
const missing = [];
for (const file of needed) {
  const src = path.join(SRC, file);
  if (!fs.existsSync(src)) { missing.push(file); continue; }
  fs.copyFileSync(src, path.join(OUT, file));
  copied++;
}

fs.writeFileSync(path.join(OUT, 'map.json'), JSON.stringify(map));
fs.writeFileSync(path.join(OUT, 'ATTRIBUTION.md'),
  'Food icons are Twemoji graphics (https://github.com/jdecked/twemoji), licensed CC-BY 4.0. Code MIT.\n');

console.log(`foods mapped: ${Object.keys(map.foods).length}, meals: ${Object.keys(map.meals).length}`);
console.log(`icons copied: ${copied}, missing from source: ${missing.length}${missing.length ? ' → ' + missing.join(', ') : ''}`);

// coverage report: how many fell through to a category fallback?
const counts = {};
for (const f of foods) {
  const g = glyphFor(f);
  counts[g] = (counts[g] || 0) + 1;
}
console.log('glyph distribution:', Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([g, n]) => `${g}${n}`).join(' '));
