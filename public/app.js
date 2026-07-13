'use strict';

/* Tindam SPA — hash-routed, Swiggy-style UI, talks to the local JSON API. */

const app = document.getElementById('app');

const state = {
  targets: load('tindam.targets'),
  plan: load('tindam.plan'),
  diet: load('tindam.diet') || 'nonveg',
  cart: load('tindam.cart') || {},          // mealId -> qty
  myMealIds: load('tindam.myMeals') || [],  // custom meal ids created on this device
  menu: null,        // catalog meals
  customMeals: [],   // resolved custom meals for this device
  foods: null,
  icons: null,       // /icons/map.json — food & meal id -> bundled SVG icon
  user: null,        // logged-in account (user | staff | admin)
  googleClientId: null
};

/* ---------------- Icon helpers (bundled Twemoji SVGs) ---------------- */

function uiIcon(key, cls) {
  const file = state.icons && state.icons.ui[key];
  return file ? `<img class="${cls || 'fico'}" src="/icons/${file}" alt="" loading="lazy">` : '';
}

function foodIcon(f, cls) {
  const file = state.icons && (state.icons.foods[f.id] || state.icons.ui.custom);
  if (!file) return `<span class="${cls || 'fico'}">${foodEmoji(f)}</span>`;
  return `<img class="${cls || 'fico'}" src="/icons/${file}" alt="" loading="lazy">`;
}

function mealIcon(m, cls) {
  let file = state.icons && state.icons.meals[m.id];
  if (!file && state.icons) {
    const t = m.tags || [];
    file = t.includes('shake') ? state.icons.ui.shake
      : t.includes('bowl') ? state.icons.ui.bowl
      : state.icons.ui.custom;
  }
  if (!file) return `<span class="${cls || 'fico'}">${mealEmoji(m)}</span>`;
  return `<img class="${cls || 'fico'}" src="/icons/${file}" alt="" loading="lazy">`;
}

function load(key) {
  try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
}
function persist(key, val) { localStorage.setItem(key, JSON.stringify(val)); }

async function api(path, opts) {
  const res = await fetch(path, opts && {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(opts)
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const dietDot = (d) => `<span class="diet-dot diet-${d}" title="${d}"></span>`;
const inr = (n) => '₹' + Number(n).toLocaleString('en-IN');

/* Deterministic pseudo-rating so cards look like a food app (4.0–4.8). */
function rating(id) {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return (4.0 + (h % 9) / 10).toFixed(1);
}
function ratingCount(id) {
  let h = 0;
  for (const c of id) h = (h * 17 + c.charCodeAt(0)) >>> 0;
  return 60 + (h % 440);
}

/* Emoji "photo" for a meal, keyword-based. */
function mealEmoji(m) {
  const n = m.name.toLowerCase();
  if ((m.tags || []).includes('shake')) return '🥤';
  if ((m.tags || []).includes('bowl')) return '🍉';
  if (/(shake|smoothie|drink|chaas|lassi)/.test(n)) return '🥤';
  if (/(chicken|tandoori|biryani)/.test(n)) return '🍗';
  if (/(fish|prawn)/.test(n)) return '🐟';
  if (/egg/.test(n)) return '🍳';
  if (/(paneer|tofu)/.test(n)) return '🧀';
  if (/(fruit|banana)/.test(n)) return '🍉';
  if (/(nut|makhana|chikki)/.test(n)) return '🥜';
  if (/(oats|porridge|dalia|muesli)/.test(n)) return '🥣';
  if (/(idli|dosa|uttapam|chilla|dhokla)/.test(n)) return '🥞';
  if (/(rice|pulao|khichdi|bath)/.test(n)) return '🍛';
  if (/(salad|sprout)/.test(n)) return '🥗';
  if (/(soup|stew|curry|dal|sambar|rajma|chole)/.test(n)) return '🍲';
  if (/(roti|phulka|paratha|thepla|toast|sandwich)/.test(n)) return '🫓';
  return '🍽️';
}
const heroBg = ['#ffe8d1', '#e8f6ec', '#fdeef0', '#eef2fd', '#fdf6e0', '#eafaf7'];
function mealHeroStyle(id) {
  let h = 0;
  for (const c of id) h = (h * 13 + c.charCodeAt(0)) >>> 0;
  return `background:${heroBg[h % heroBg.length]}`;
}

function macroChips(m) {
  return `<div class="macros">
    <span>${Math.round(m.kcal)} kcal</span><span>P ${m.protein}g</span>
    <span>C ${m.carbs}g</span><span>F ${m.fat}g</span>
  </div>`;
}

function allMeals() { return [...(state.menu || []), ...state.customMeals]; }
function mealById(id) { return allMeals().find((m) => m.id === id); }

/* ---------------- Cart ---------------- */

function cartCount() { return Object.values(state.cart).reduce((a, b) => a + b, 0); }
function cartTotals() {
  const t = { kcal: 0, protein: 0, carbs: 0, fat: 0, price: 0 };
  for (const [id, qty] of Object.entries(state.cart)) {
    const m = mealById(id);
    if (!m) continue;
    t.kcal += m.kcal * qty; t.protein += m.protein * qty;
    t.carbs += m.carbs * qty; t.fat += m.fat * qty; t.price += m.price * qty;
  }
  return t;
}

window.cartAdd = (id, delta) => {
  const next = (state.cart[id] || 0) + delta;
  if (next <= 0) delete state.cart[id];
  else state.cart[id] = Math.min(next, 9);
  persist('tindam.cart', state.cart);
  refreshCartUi();
  // re-render add controls in place
  document.querySelectorAll(`[data-addctl="${id}"]`).forEach((el) => { el.outerHTML = addControl(id); });
  if (location.hash.startsWith('#/cart')) renderCart();
};

function addControl(id) {
  const qty = state.cart[id] || 0;
  if (qty === 0) {
    return `<button class="add-btn" data-addctl="${id}" onclick="cartAdd('${id}',1)">Add</button>`;
  }
  return `<span class="qty-ctrl" data-addctl="${id}">
    <button onclick="cartAdd('${id}',-1)">−</button><span>${qty}</span><button onclick="cartAdd('${id}',1)">+</button>
  </span>`;
}

function refreshCartUi() {
  const n = cartCount();
  const badge = document.getElementById('cart-badge');
  badge.hidden = n === 0;
  badge.textContent = n;
  const mount = document.getElementById('cart-bar-mount');
  if (n === 0 || location.hash.startsWith('#/cart')) { mount.innerHTML = ''; return; }
  const t = cartTotals();
  mount.innerHTML = `
    <div class="cart-bar" onclick="location.hash='#/cart'">
      <span>${n} item${n > 1 ? 's' : ''} in your daily box<span class="sub">${Math.round(t.kcal)} kcal · ${Math.round(t.protein)} g protein</span></span>
      <span>${inr(t.price)}/day &nbsp;→</span>
    </div>`;
}

/* ---------------- Router ---------------- */

const routes = {
  '/': renderHome,
  '/plan': renderPlan,
  '/menu': renderMenu,
  '/create': renderCreate,
  '/shake': renderShake,
  '/bowl': renderBowl,
  '/foods': renderFoods,
  '/cart': renderCart,
  '/dashboard': renderDashboard,
  '/account': renderAccount,
  '/login': renderLogin,
  '/signup': renderSignup,
  '/forgot': renderForgot,
  '/reset': renderReset,
  '/admin': renderAdmin,
  '/staff': renderStaff
};

function navigate() {
  const path = (location.hash.replace(/^#/, '') || '/').split('?')[0];
  const view = routes[path] || renderHome;
  document.querySelectorAll('#nav a').forEach((a) => {
    a.classList.toggle('active', a.dataset.route === path);
  });
  window.scrollTo(0, 0);
  app.classList.remove('page-in');
  void app.offsetWidth; // restart the enter animation
  app.classList.add('page-in');
  Promise.resolve(view()).then(refreshCartUi);
}
window.addEventListener('hashchange', navigate);

/* Global search: jump to menu with query. */
document.getElementById('global-search').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    menuFilter.q = e.target.value.trim();
    menuFilter.slot = ''; menuFilter.diet = '';
    location.hash = '#/menu';
    if (location.hash === '#/menu') renderMenu();
  }
});

/* ---------------- Home ---------------- */

const CATEGORY_RAIL = [
  { icon: 'muscle', label: 'High Protein', q: 'high-protein' },
  { icon: 'chicken', label: 'Chicken', q: 'chicken' },
  { icon: 'paneer', label: 'Paneer', q: 'paneer' },
  { icon: 'breakfast', label: 'Breakfast', slot: 'breakfast' },
  { icon: 'lunch', label: 'Lunch Bowls', slot: 'lunch' },
  { icon: 'salad', label: 'Weight Loss', q: 'weight-loss' },
  { icon: 'fruit', label: 'Fruit Bowls', q: 'fruit' },
  { icon: 'shake', label: 'Shakes', q: 'shake' },
  { icon: 'millet', label: 'Millets', q: 'millet' },
  { icon: 'dinner', label: 'Light Dinner', slot: 'dinner' }
];

function catRailHtml(activeQ) {
  return `<div class="cat-rail">
    ${CATEGORY_RAIL.map((c) => `
      <button class="cat-item ${activeQ && (c.q === activeQ || c.slot === activeQ) ? 'active' : ''}"
        onclick="railJump('${c.q || ''}','${c.slot || ''}')">
        <span class="cat-ico">${uiIcon(c.icon, 'fico-rail')}</span><small>${c.label}</small>
      </button>`).join('')}
  </div>`;
}

window.railJump = (q, slot) => {
  menuFilter.q = q; menuFilter.slot = slot; menuFilter.diet = '';
  if (location.hash === '#/menu') renderMenu();
  else location.hash = '#/menu';
};

function mealCardHtml(m) {
  const custom = m.id.startsWith('cm-');
  return `
  <div class="card meal-card">
    <div class="meal-hero" style="${mealHeroStyle(m.id)}">
      ${mealIcon(m, 'fico-hero')}
      <span class="veg-mark">${dietDot(m.diet)}</span>
      <span class="rating">★ ${rating(m.id)}</span>
    </div>
    <div class="meal-body">
      <h4>${esc(m.name)}${custom ? ' <span class="chip">My creation</span>' : ''}</h4>
      <p class="desc">${esc(m.desc)} <span class="muted">· ${ratingCount(m.id)} ratings</span></p>
      ${macroChips(m)}
      <div>${(m.slots || []).map((s) => `<span class="chip green">${s}</span>`).join('')}</div>
      <div class="meal-foot">
        <span class="price">${inr(m.price)}</span>
        ${addControl(m.id)}
      </div>
    </div>
  </div>`;
}

function renderHome() {
  const popular = (state.menu || []).filter((m) =>
    (m.tags || []).includes('signature') || (m.tags || []).includes('high-protein')).slice(0, 6);
  const floats = ['mango', 'broccoli', 'berry', 'banana', 'fish', 'avocado', 'roti', 'grape']
    .map((k) => uiIcon(k, 'hero-float')).join('');
  app.innerHTML = `
  <section class="hero">
    <div class="hero-floats" aria-hidden="true">${floats}</div>
    <h1>Eat for your goal.<br>We cook & deliver. Every day.</h1>
    <p>Tindam is a fitness food subscription for India. Tell us your calorie & protein target —
       or just your height, weight and goal — and get macro-counted Indian meals
       delivered fresh daily. No ordering, no cooking, no guesswork.</p>
    <a class="btn btn-primary" href="#/plan">Build my free plan →</a>
    <a class="btn btn-outline" href="#/create" style="margin-left:.6rem">Create your own meal</a>
    <div class="hero-badges">
      <span>🇮🇳 100% Indian meals</span>
      <span>📊 Macro-counted portions</span>
      <span>🧑‍🍳 Build meals from 1,000+ ingredients</span>
      <span>🔁 Change tomorrow's meal till 8 PM</span>
    </div>
  </section>

  <h2 class="section-title" style="margin-top:1rem">What's your vibe today?</h2>
  ${catRailHtml()}

  <h2 class="section-title">Popular right now</h2>
  <div class="grid grid-3">${popular.map(mealCardHtml).join('')}</div>

  <h2 class="section-title">How it works</h2>
  <div class="grid grid-4 steps">
    <div class="card"><h3>Set your target</h3><p class="muted">Enter calories & protein, or your height, weight and goal — we calculate your needs (Mifflin-St Jeor).</p></div>
    <div class="card"><h3>Pick or build meals</h3><p class="muted">Take our 7-day plan, or build your own meals ingredient by ingredient from 1,000+ Indian foods.</p></div>
    <div class="card"><h3>Subscribe</h3><p class="muted">1, 2 or 4 weeks. Morning or evening delivery. Up to 10% off on longer plans.</p></div>
    <div class="card"><h3>Eat & repeat</h3><p class="muted">Fresh meals daily, like your milk delivery. Skip, pause, or change tomorrow's box before 8 PM.</p></div>
  </div>

  <h2 class="section-title">Popular targets</h2>
  <div class="grid grid-3">
    <div class="card"><h3>🔥 Fat loss</h3><p class="muted">~1,800 kcal · 130 g protein. High-volume, high-protein meals that keep you full.</p><a class="btn btn-outline btn-small" href="#/plan" onclick="presetTarget(1800,130)">Try this target</a></div>
    <div class="card"><h3>⚖️ Lean maintain</h3><p class="muted">~2,200 kcal · 120 g protein. Balanced thalis and bowls for staying in shape.</p><a class="btn btn-outline btn-small" href="#/plan" onclick="presetTarget(2200,120)">Try this target</a></div>
    <div class="card"><h3>💪 Muscle gain</h3><p class="muted">~3,000 kcal · 160 g protein. Chicken-rice bulk bowls, paneer bowls, shakes.</p><a class="btn btn-outline btn-small" href="#/plan" onclick="presetTarget(3000,160)">Try this target</a></div>
  </div>`;
}

window.presetTarget = (kcal, protein) => {
  state.targets = { kcal, protein, mode: 'direct' };
  persist('tindam.targets', state.targets);
};

/* ---------------- Menu ---------------- */

let menuFilter = { slot: '', diet: '', q: '' };

async function renderMenu() {
  if (!state.menu) state.menu = (await api('/api/meals')).meals;
  const slots = ['breakfast', 'lunch', 'snack', 'dinner'];
  let list = allMeals();
  if (menuFilter.slot) list = list.filter((m) => m.slots.includes(menuFilter.slot));
  if (menuFilter.diet === 'veg') list = list.filter((m) => m.diet === 'veg');
  if (menuFilter.diet === 'egg') list = list.filter((m) => m.diet !== 'nonveg');
  if (menuFilter.q) {
    const n = menuFilter.q.toLowerCase();
    list = list.filter((m) =>
      m.name.toLowerCase().includes(n) || m.desc.toLowerCase().includes(n) ||
      (m.tags || []).some((t) => t.includes(n)));
  }

  app.innerHTML = `
  <h2 class="section-title" style="margin-top:.4rem">Our menu</h2>
  <p class="muted">Every meal is portioned and macro-counted. Prices per delivered portion. Add meals to build your daily box.</p>
  ${catRailHtml(menuFilter.q || menuFilter.slot)}
  <div class="chip-row">
    <button class="chip-btn ${!menuFilter.slot ? 'active' : ''}" onclick="setMenuFilter('slot','')">All slots</button>
    ${slots.map((s) => `<button class="chip-btn ${menuFilter.slot === s ? 'active' : ''}" onclick="setMenuFilter('slot','${s}')">${s[0].toUpperCase() + s.slice(1)}</button>`).join('')}
    <span style="width:.6rem"></span>
    <button class="chip-btn ${!menuFilter.diet ? 'active' : ''}" onclick="setMenuFilter('diet','')">All diets</button>
    <button class="chip-btn ${menuFilter.diet === 'veg' ? 'active' : ''}" onclick="setMenuFilter('diet','veg')">🟢 Veg</button>
    <button class="chip-btn ${menuFilter.diet === 'egg' ? 'active' : ''}" onclick="setMenuFilter('diet','egg')">🟡 Veg + Egg</button>
    ${menuFilter.q ? `<button class="chip-btn active" onclick="setMenuFilter('q','')">“${esc(menuFilter.q)}” ✕</button>` : ''}
    <span class="muted">${list.length} meals</span>
  </div>
  <div class="grid grid-3" style="margin-top:1rem">
    ${list.map(mealCardHtml).join('') || '<p class="muted">No meals match — try clearing filters.</p>'}
  </div>`;
}

window.setMenuFilter = (k, v) => { menuFilter[k] = v; renderMenu(); };

/* ---------------- Create your own meal ---------------- */

const builder = { items: [], q: '', slots: ['lunch', 'dinner'] };

async function renderCreate() {
  if (!state.foods) {
    const res = await api('/api/foods');
    state.foods = res.foods;
    state.foodCategories = res.categories;
  }
  app.innerHTML = `
  <h2 class="section-title" style="margin-top:.4rem">🧑‍🍳 Create your own meal</h2>
  <p class="muted">Pick any ingredients from our ${state.foods.length}-item Indian food database, set the grams, and we'll cook it exactly like that — macros computed live. Pricing: ₹40 kitchen base + ₹6 per 100 kcal.</p>
  <div class="builder-grid" style="margin-top:1rem">
    <div class="card">
      <div class="field"><label>Search ingredients</label>
        <input id="b-search" placeholder="chicken, paneer, brown rice, broccoli…" value="${esc(builder.q)}"></div>
      <div class="ing-list" id="b-results"></div>
    </div>
    <div class="card">
      <h3>Your meal</h3>
      <div id="plate-stage-mount"></div>
      <div class="field" style="margin-top:.6rem"><label>Meal name</label>
        <input id="b-name" placeholder="e.g. My Bulk Bowl" maxlength="60"></div>
      <div class="field"><label>Serve as</label>
        <div class="chip-row">
          ${['breakfast', 'lunch', 'snack', 'dinner'].map((s) =>
            `<button class="chip-btn ${builder.slots.includes(s) ? 'active' : ''}" onclick="toggleSlot('${s}')">${s}</button>`).join('')}
        </div></div>
      <div id="b-picked"></div>
      <div id="b-totals"></div>
      <button class="btn btn-primary" style="margin-top:.8rem" onclick="saveCustomMeal()">Save meal & add to box</button>
      <div id="b-error"></div>
    </div>
  </div>
  ${state.customMeals.length ? `
    <h2 class="section-title">My creations</h2>
    <div class="grid grid-3">${state.customMeals.map(mealCardHtml).join('')}</div>` : ''}`;

  document.getElementById('b-search').addEventListener('input', (e) => {
    builder.q = e.target.value;
    renderBuilderResults();
  });
  renderBuilderResults();
  renderBuilderPicked();
}

function renderBuilderResults() {
  const n = builder.q.trim().toLowerCase();
  let list = state.foods.filter((f) => !['Oils & Fats'].includes(f.category) || n);
  if (n) {
    list = state.foods.filter((f) =>
      f.name.toLowerCase().includes(n) || f.category.toLowerCase().includes(n) ||
      (f.tags || []).some((t) => t.includes(n)));
  }
  list = list.slice(0, 40);
  document.getElementById('b-results').innerHTML = list.map((f) => `
    <div class="ing-row">
      ${foodIcon(f, 'fico-xs')}${dietDot(f.diet)}<span class="nm">${esc(f.name)}</span>
      <span class="kc">${f.kcal} kcal · ${f.protein}g P /${f.unit === '100ml' ? '100ml' : '100g'}</span>
      <button class="add-btn" style="padding:.25rem .8rem" onclick="builderAdd(event,'${f.id}')">Add</button>
    </div>`).join('') || '<div class="ing-row muted">No ingredients found.</div>';
}

window.builderAdd = (ev, foodId) => {
  if (builder.items.some((i) => i.foodId === foodId)) return;
  if (builder.items.length >= 15) { alert('Maximum 15 ingredients per meal'); return; }
  builder.items.push({ foodId, grams: 100 });
  renderBuilderPicked(foodId);
  const f = state.foods.find((x) => x.id === foodId);
  const stageEl = document.getElementById('plate-stage');
  const srcEl = ev && ev.target ? ev.target : null;
  flyIcon(srcEl, stageEl, f, () => landStageItem(stageEl, foodId));
};
window.builderRemove = (foodId) => {
  builder.items = builder.items.filter((i) => i.foodId !== foodId);
  renderBuilderPicked();
};
window.builderGrams = (foodId, val) => {
  const it = builder.items.find((i) => i.foodId === foodId);
  if (it) it.grams = Number(val) || 0;
  renderPlateStage();
  renderBuilderTotals();
};

function plateStageHtml(pendingId) {
  const items = builder.items.map((it, i) => {
    const f = state.foods.find((x) => x.id === it.foodId);
    return f ? stageItemHtml(f, platePos(it.foodId, it.grams, i), it.foodId === pendingId) : '';
  }).join('');
  return `<div class="stage stage-plate" id="plate-stage">
    <div class="stage-inner">
      ${plateSvg()}
      <div class="stage-items">${items}</div>
    </div>
    ${builder.items.length === 0 ? '<div class="hint">An empty plate — add ingredients and we’ll plate them up 🍽️</div>' : ''}
  </div>`;
}

function renderPlateStage(pendingId) {
  const mount = document.getElementById('plate-stage-mount');
  if (mount) mount.innerHTML = plateStageHtml(pendingId || null);
}
window.toggleSlot = (s) => {
  if (builder.slots.includes(s)) builder.slots = builder.slots.filter((x) => x !== s);
  else builder.slots.push(s);
  renderCreate();
};

function renderBuilderPicked(pendingId) {
  const box = document.getElementById('b-picked');
  if (!box) return;
  renderPlateStage(pendingId);
  box.innerHTML = builder.items.length === 0
    ? '<p class="muted" style="padding:.6rem 0">No ingredients yet — search on the left and hit Add.</p>'
    : builder.items.map((it) => {
      const f = state.foods.find((x) => x.id === it.foodId);
      return `<div class="picked-row">
        ${foodIcon(f, 'fico-xs')}${dietDot(f.diet)}<span style="flex:1">${esc(f.name)}</span>
        <input type="number" min="5" max="1000" step="5" value="${it.grams}"
          oninput="builderGrams('${f.id}', this.value)"> <span class="muted">${f.unit === '100ml' ? 'ml' : 'g'}</span>
        <button class="x" onclick="builderRemove('${f.id}')">✕</button>
      </div>`;
    }).join('');
  renderBuilderTotals();
}

function renderBuilderTotals() {
  const box = document.getElementById('b-totals');
  if (!box) return;
  let kcal = 0, protein = 0, carbs = 0, fat = 0, fiber = 0;
  for (const it of builder.items) {
    const f = state.foods.find((x) => x.id === it.foodId);
    const k = (Number(it.grams) || 0) / 100;
    kcal += f.kcal * k; protein += f.protein * k; carbs += f.carbs * k;
    fat += f.fat * k; fiber += (f.fiber || 0) * k;
  }
  const price = Math.max(49, Math.round((40 + (kcal / 100) * 6) / 5) * 5);
  box.innerHTML = builder.items.length === 0 ? '' : `
    <div class="result-strip" style="margin:.8rem 0 0">
      <div class="stat"><b>${Math.round(kcal)}</b><small>kcal</small></div>
      <div class="stat"><b>${Math.round(protein)} g</b><small>Protein</small></div>
      <div class="stat"><b>${Math.round(carbs)} g</b><small>Carbs</small></div>
      <div class="stat"><b>${Math.round(fat)} g</b><small>Fat</small></div>
      <div class="stat"><b>${Math.round(fiber)} g</b><small>Fiber</small></div>
      <div class="stat"><b>${inr(price)}</b><small>Price/portion</small></div>
    </div>`;
}

window.saveCustomMeal = async () => {
  const errBox = document.getElementById('b-error');
  errBox.innerHTML = '';
  try {
    if (builder.slots.length === 0) throw new Error('Pick at least one slot (breakfast/lunch/snack/dinner)');
    const res = await api('/api/custom-meals', {
      name: document.getElementById('b-name').value.trim(),
      phone: load('tindam.phone') || null,
      slots: builder.slots,
      items: builder.items
    });
    confettiBurst(document.getElementById('plate-stage'));
    state.customMeals.push(res.meal);
    state.myMealIds.push(res.meal.id);
    persist('tindam.myMeals', state.myMealIds);
    builder.items = [];
    window.cartAdd(res.meal.id, 1);
    renderCreate();
    document.querySelector('.section-title:last-of-type')?.scrollIntoView({ behavior: 'smooth' });
  } catch (e) {
    errBox.innerHTML = `<div class="error-box">${esc(e.message)}</div>`;
  }
};

/* ---------------- Visual stage: bowl / glass / plate animations ---------------- */

const REDUCED_MOTION = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function posHash(id, salt) {
  let h = salt || 7;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h;
}

function foodIconSrc(f) {
  const file = state.icons && (state.icons.foods[f.id] || state.icons.ui.custom);
  return file ? `/icons/${file}` : null;
}

function stageItemHtml(f, pos, pending) {
  const src = foodIconSrc(f);
  const inner = src
    ? `<img src="${src}" alt="">`
    : `<span style="font-size:${Math.round(pos.size * 0.8)}px">${foodEmoji(f)}</span>`;
  return `<span class="stage-item ${pending ? 'pending' : ''}" data-stage-id="${f.id}"
    style="left:${pos.x}%;top:${pos.y}%;width:${pos.size}px;height:${pos.size}px;--rot:${pos.rot}deg;--bob-delay:${pos.delay}s">${inner}</span>`;
}

/* Deterministic per-food positions (index-salted so items don't pile up). */
function bowlPos(id, qty, i) {
  const h = posHash(id, 7 + (i || 0) * 11);
  return {
    x: 24 + (h % 53), y: 32 + ((h >>> 5) % 16),
    rot: -18 + ((h >>> 3) % 37), delay: ((h >>> 7) % 20) / 10,
    size: Math.round(Math.min(54, 26 + qty * 0.16))
  };
}
function glassPos(id, qty, fillPct, i) {
  const h = posHash(id, 5 + (i || 0) * 11);
  const surface = 100 - fillPct; // top of the liquid, % of glass height
  const depth = Math.max(4, Math.round(fillPct * 0.55));
  return {
    x: 20 + (h % 61), y: Math.min(86, surface + 10 + ((h >>> 4) % depth)),
    rot: -20 + ((h >>> 3) % 41), delay: ((h >>> 7) % 20) / 10,
    size: Math.round(Math.min(32, 16 + qty * 0.1))
  };
}
function platePos(id, grams, i) {
  const h = posHash(id, 13 + (i || 0) * 11);
  return {
    x: 30 + (h % 41), y: 46 + ((h >>> 4) % 16),
    rot: -15 + ((h >>> 6) % 31), delay: ((h >>> 8) % 20) / 10,
    size: Math.round(Math.min(50, 24 + grams * 0.14))
  };
}

function bowlSvgBack() {
  return `<svg class="bowl-back" width="300" height="150" viewBox="0 0 300 150" aria-hidden="true">
    <ellipse cx="150" cy="142" rx="104" ry="8" fill="rgba(120,60,10,.14)"/>
    <ellipse cx="150" cy="38" rx="118" ry="26" fill="#f3d9b8"/>
    <ellipse cx="150" cy="40" rx="106" ry="21" fill="#e9c39a"/>
  </svg>`;
}
function bowlSvgFront() {
  return `<svg class="bowl-front" width="300" height="150" viewBox="0 0 300 150" aria-hidden="true">
    <defs>
      <linearGradient id="bowlBody" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#ff9a4d"/>
        <stop offset=".55" stop-color="#f0762e"/>
        <stop offset="1" stop-color="#d95a18"/>
      </linearGradient>
    </defs>
    <path d="M32 38 A118 26 0 0 0 268 38 A118 100 0 0 1 32 38 Z" fill="url(#bowlBody)"/>
    <ellipse cx="150" cy="38" rx="118" ry="26" fill="none" stroke="rgba(255,255,255,.75)" stroke-width="3"/>
    <path d="M56 74 Q82 108 128 120" stroke="rgba(255,255,255,.38)" stroke-width="7" stroke-linecap="round" fill="none"/>
  </svg>`;
}
function plateSvg() {
  return `<svg class="plate-svg" width="300" height="160" viewBox="0 0 300 160" aria-hidden="true">
    <ellipse cx="150" cy="150" rx="112" ry="8" fill="rgba(120,60,10,.13)"/>
    <defs>
      <radialGradient id="plateG" cx=".5" cy=".42" r=".65">
        <stop offset="0" stop-color="#ffffff"/>
        <stop offset=".62" stop-color="#f6f1e8"/>
        <stop offset=".8" stop-color="#ffffff"/>
        <stop offset="1" stop-color="#d9d2c4"/>
      </radialGradient>
    </defs>
    <ellipse cx="150" cy="84" rx="132" ry="58" fill="url(#plateG)" stroke="#e5ddcf"/>
    <ellipse cx="150" cy="82" rx="94" ry="40" fill="#f1e9db" opacity=".8"/>
  </svg>`;
}

/* Shake liquid colour — blend picked ingredients into one smoothie shade. */
const LIQUID_COLORS = [
  [/spinach|spirulina|moringa|wheat-germ/, [104, 187, 92]],
  [/beetroot/, [198, 40, 91]],
  [/cocoa|coffee|chocolate/, [141, 90, 59]],
  [/strawberr|raspberr|frozen-berries|cherr|watermelon/, [240, 98, 146]],
  [/blueberr|blackberr|jamun/, [126, 87, 194]],
  [/mango|papaya|orange|kinnow|persimmon/, [255, 167, 38]],
  [/banana|chikoo|date|honey|jaggery|sattu|peanut|almond butter|oats/, [243, 201, 105]],
  [/coconut water/, [214, 234, 189]],
  [/water/, [173, 216, 230]],
  [/milk|curd|yogurt|whey|casein|protein|cream/, [250, 244, 232]]
];
function liquidColorFor(f) {
  const n = (f.id + ' ' + f.name).toLowerCase();
  for (const [re, c] of LIQUID_COLORS) if (re.test(n)) return c;
  return [246, 224, 168];
}

/* Fly a food icon from the clicked tile into the stage, arcing like a toss. */
function flyIcon(srcEl, destEl, f, done) {
  if (REDUCED_MOTION || !srcEl || !destEl || !document.body.animate) { done && done(); return; }
  const a = srcEl.getBoundingClientRect();
  const b = destEl.getBoundingClientRect();
  const ghost = document.createElement('div');
  ghost.className = 'fly-ghost';
  const src = foodIconSrc(f);
  ghost.innerHTML = src ? `<img src="${src}" alt="">` : `<span style="font-size:34px">${foodEmoji(f)}</span>`;
  const x0 = a.left + a.width / 2, y0 = a.top + a.height / 2;
  const dx = (b.left + b.width / 2) - x0;
  const dy = (b.top + b.height * 0.42) - y0;
  ghost.style.left = x0 + 'px';
  ghost.style.top = y0 + 'px';
  document.body.appendChild(ghost);
  const anim = ghost.animate([
    { transform: 'translate(-50%,-50%) scale(1) rotate(0deg)', opacity: 1 },
    { transform: `translate(calc(-50% + ${dx * 0.5}px), calc(-50% + ${dy * 0.5 - 70}px)) scale(1.2) rotate(-14deg)`, opacity: 1, offset: 0.55 },
    { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(.6) rotate(10deg)`, opacity: 0.9 }
  ], { duration: 640, easing: 'cubic-bezier(.3,.6,.35,1)' });
  anim.onfinish = () => { ghost.remove(); done && done(); };
}

/* Reveal the pending stage item with a drop-bounce and a landing ripple. */
function landStageItem(stageEl, foodId) {
  if (!stageEl) return;
  const item = stageEl.querySelector(`[data-stage-id="${foodId}"]`);
  if (!item) return;
  item.classList.remove('pending');
  item.classList.add('drop');
  const ripple = document.createElement('span');
  ripple.className = 'stage-ripple';
  ripple.style.left = item.style.left;
  ripple.style.top = item.style.top;
  item.parentElement.appendChild(ripple);
  setTimeout(() => ripple.remove(), 600);
}

function confettiBurst(el) {
  if (REDUCED_MOTION || !el) return;
  const r = el.getBoundingClientRect();
  const colors = ['#ff5f1f', '#ffb347', '#ff3d77', '#3fbf77', '#5aa9ff', '#ffd166'];
  for (let i = 0; i < 16; i++) {
    const p = document.createElement('span');
    p.className = 'confetti';
    p.style.left = (r.left + r.width / 2) + 'px';
    p.style.top = (r.top + r.height * 0.4) + 'px';
    p.style.background = colors[i % colors.length];
    p.style.setProperty('--cx', (Math.random() * 220 - 110) + 'px');
    p.style.setProperty('--cy', (-40 - Math.random() * 150) + 'px');
    p.style.setProperty('--cr', (Math.random() * 520 - 260) + 'deg');
    document.body.appendChild(p);
    setTimeout(() => p.remove(), 950);
  }
}

/* ---------------- Mixers: Shake Mixer & Fruit Bowl Builder ---------------- */

const MIXERS = {
  shake: {
    icon: '🥤', title: 'Shake Mixer',
    intro: 'Mix your own shake — pick a base, throw in fruits, protein and boosters. Nutrition updates live as you pour. We blend it fresh and deliver it chilled.',
    namePh: 'e.g. Morning Power Shake', suffixWord: 'Shake', suffixRe: /shake|smoothie/i,
    slots: ['breakfast', 'snack'], verb: 'Blend',
    groups: [
      { key: 'base', label: '1 · Pick your liquid base', single: true, step: 50, defaultQty: 250, unit: 'ml',
        ids: ['drinking-water', 'milk-toned', 'milk-full-cream', 'milk-skim', 'milk-buffalo', 'oat-milk', 'almond-milk', 'soy-milk', 'coconut-water'] },
      { key: 'fruit', label: '2 · Fruits', step: 25, defaultQty: 100, unit: 'g',
        ids: ['banana', 'mango', 'papaya', 'strawberry', 'chikoo', 'apple', 'pineapple', 'blueberries', 'frozen-berries-mix', 'dates-dried'] },
      { key: 'protein', label: '3 · Protein', step: 10, defaultQty: 30, unit: 'g',
        ids: ['whey-protein', 'pea-protein-powder', 'casein-protein-powder', 'greek-yogurt', 'curd-low-fat', 'sattu-flour', 'peanut-butter', 'almond-butter'] },
      { key: 'boost', label: '4 · Boosters', step: 5, defaultQty: 10, unit: 'g',
        ids: ['chia-seeds', 'flax-seeds', 'basil-seeds-sabja', 'oats-raw', 'cocoa-powder', 'spirulina', 'wheat-germ', 'almonds', 'walnuts', 'coconut-cream', 'dried-dates-powder', 'honey', 'jaggery', 'spinach', 'beetroot'] }
    ]
  },
  bowl: {
    icon: '🍉', title: 'Fruit Bowl Builder',
    intro: 'Build your own fruit bowl — pick seasonal fruits by the gram, add crunch and creamy extras. Full nutrition (calories, protein, carbs, fat, fiber) updates live. Cut fresh every morning.',
    namePh: 'e.g. Rainbow Recovery Bowl', suffixWord: 'Bowl', suffixRe: /bowl/i,
    slots: ['breakfast', 'snack'], verb: 'Build',
    groups: [
      { key: 'fruit', label: '1 · Pick your fruits (grams)', step: 25, defaultQty: 100, unit: 'g',
        ids: ['banana', 'apple', 'papaya', 'mango', 'guava', 'orange', 'kinnow', 'mosambi', 'grapefruit', 'pomegranate', 'watermelon', 'muskmelon', 'honeydew-melon', 'grapes', 'chikoo', 'pineapple', 'kiwi', 'strawberry', 'raspberry', 'blackberry-imported', 'blueberries', 'pear', 'peach', 'plum', 'custard-apple', 'litchi', 'longan', 'ifct-e059', 'ifct-e043', 'ifct-e061', 'jamun', 'rose-apple', 'rasbhari', 'loquat', 'dragon-fruit', 'persimmon-japani-phal', 'fig-fresh', 'cherries', 'avocado', 'tender-coconut-malai'] },
      { key: 'top', label: '2 · Toppings & crunch', step: 5, defaultQty: 10, unit: 'g',
        ids: ['almonds', 'walnuts', 'pistachios', 'pumpkin-seeds', 'sunflower-seeds', 'chia-seeds', 'raisins', 'dried-figs', 'dates-dried', 'makhana', 'magaz-seeds', 'honey', 'peanut-butter'] },
      { key: 'extra', label: '3 · Creamy extras (optional)', step: 50, defaultQty: 100, unit: 'g',
        ids: ['greek-yogurt', 'hung-curd', 'curd-low-fat'] }
    ]
  }
};

let mixerKind = 'shake';
const mixQtyState = { shake: {}, bowl: {} }; // kind -> foodId -> grams/ml

function renderShake() { mixerKind = 'shake'; return renderMixer(); }
function renderBowl() { mixerKind = 'bowl'; return renderMixer(); }

async function renderMixer() {
  if (!state.foods) {
    const res = await api('/api/foods');
    state.foods = res.foods;
    state.foodCategories = res.categories;
  }
  const cfg = MIXERS[mixerKind];
  const mine = state.customMeals.filter((m) => (m.tags || []).includes(mixerKind));
  app.innerHTML = `
  <h2 class="section-title" style="margin-top:.4rem">${cfg.icon} ${esc(cfg.title)}</h2>
  <p class="muted">${esc(cfg.intro)}</p>
  <div class="builder-grid" style="margin-top:1rem">
    <div>
      ${cfg.groups.map((g) => `
      <div class="card" style="margin-bottom:1rem">
        <h3 style="font-size:1.02rem">${esc(g.label)}</h3>
        <div class="shake-grid">
          ${g.ids.map((id) => {
            const f = state.foods.find((x) => x.id === id);
            return f ? mixItemHtml(g, f) : '';
          }).join('')}
        </div>
      </div>`).join('')}
    </div>
    <div class="card" style="position:sticky;top:70px">
      <h3>Your ${esc(cfg.suffixWord.toLowerCase())}</h3>
      <div id="sh-stage"></div>
      <div class="field" style="margin-top:.6rem"><label>${esc(cfg.suffixWord)} name</label>
        <input id="sh-name" placeholder="${esc(cfg.namePh)}" maxlength="60"></div>
      <div id="sh-recipe"></div>
      <div id="sh-totals"></div>
      <button class="btn btn-primary" style="margin-top:.8rem" onclick="saveMix()">${cfg.icon} ${esc(cfg.verb)}, save & add to box</button>
      <div id="sh-error"></div>
    </div>
  </div>
  ${mine.length ? `
    <h2 class="section-title">My ${esc(cfg.suffixWord.toLowerCase())}s</h2>
    <div class="grid grid-3">${mine.map(mealCardHtml).join('')}</div>` : ''}`;
  renderMixSummary();
}

function mixItemHtml(g, f) {
  const qty = mixQtyState[mixerKind][f.id] || 0;
  return `<div class="shake-item ${qty ? 'on' : ''}" id="mixitem-${f.id}">
    <button class="shake-pick" onclick="mixToggle(event,'${f.id}','${g.key}')">
      <span class="shake-emoji">${foodIcon(f, 'fico-md')}</span>
      <small>${esc(f.name.split('/')[0].split('(')[0].trim())}</small>
      <span class="kc">${f.kcal} kcal/${f.unit === '100ml' ? '100ml' : '100g'}</span>
      ${f.season ? `<span class="kc" style="color:var(--primary-dark);font-weight:700">${esc(f.season)}</span>` : ''}
    </button>
    ${qty ? `<span class="qty-ctrl">
      <button onclick="mixQty('${f.id}',${-g.step})">−</button>
      <span>${qty}${g.unit}</span>
      <button onclick="mixQty('${f.id}',${g.step})">+</button>
    </span>` : ''}
  </div>`;
}

function refreshMixTile(id) {
  const cfg = MIXERS[mixerKind];
  const g = cfg.groups.find((x) => x.ids.includes(id));
  const f = state.foods.find((x) => x.id === id);
  const el = document.getElementById('mixitem-' + id);
  if (el && g && f) el.outerHTML = mixItemHtml(g, f);
}

/* The live scene in the summary card: a filling glass or a fruit bowl. */
function mixerStageHtml(pendingId) {
  const cfg = MIXERS[mixerKind];
  const entries = Object.entries(mixQtyState[mixerKind]);
  const empty = entries.length === 0;

  if (mixerKind === 'bowl') {
    const items = entries.map(([id, qty], i) => {
      const f = state.foods.find((x) => x.id === id);
      return f ? stageItemHtml(f, bowlPos(id, qty, i), id === pendingId) : '';
    }).join('');
    return `<div class="stage stage-bowl" id="mix-stage">
      <div class="stage-inner">
        ${bowlSvgBack()}
        <div class="stage-items">${items}</div>
        ${bowlSvgFront()}
      </div>
      ${empty ? '<div class="hint">Your bowl is waiting — tap a fruit and watch it drop in 🍓</div>' : ''}
    </div>`;
  }

  // Shake glass: liquid level & colour follow what you pour in.
  const baseGroup = cfg.groups.find((g) => g.key === 'base');
  let total = 0, colorW = 0;
  const colorAcc = [0, 0, 0];
  for (const [id, qty] of entries) {
    const f = state.foods.find((x) => x.id === id);
    if (!f) continue;
    total += qty;
    const c = liquidColorFor(f);
    colorAcc[0] += c[0] * qty; colorAcc[1] += c[1] * qty; colorAcc[2] += c[2] * qty;
    colorW += qty;
  }
  const fill = empty ? 0 : Math.max(18, Math.min(94, Math.round((total / 550) * 100)));
  const rgb = colorW ? colorAcc.map((v) => Math.round(v / colorW)) : [250, 244, 232];
  const light = rgb.map((v) => Math.round(v + (255 - v) * 0.35));
  const chunks = entries
    .filter(([id]) => !(baseGroup && baseGroup.ids.includes(id)))
    .map(([id, qty], i) => {
      const f = state.foods.find((x) => x.id === id);
      return f ? stageItemHtml(f, glassPos(id, qty, fill, i), id === pendingId) : '';
    }).join('');
  const bubbles = fill ? Array.from({ length: 5 }, (_, i) =>
    `<span class="bubble" style="left:${14 + i * 16}%;--sz:${5 + (i % 3) * 3}px;--dur:${2.4 + i * 0.5}s;--delay:${i * 0.7}s;--rise:${Math.round(fill * 1.6)}px"></span>`
  ).join('') : '';
  return `<div class="stage stage-glass" id="mix-stage">
    <div class="stage-inner">
      ${fill ? '<div class="glass-straw"></div>' : ''}
      <div class="glass-wrap">
        <div class="glass-liquid" style="height:${fill}%;background:linear-gradient(180deg, rgb(${light.join(',')}) 0%, rgb(${rgb.join(',')}) 60%)"></div>
        ${bubbles}
        <div class="stage-items">${chunks}</div>
      </div>
    </div>
    ${empty ? '<div class="hint">Empty glass — pick a base to start pouring 🥛</div>' : ''}
  </div>`;
}

function foodEmoji(f) {
  const n = f.name.toLowerCase();
  if (/drinking water|coconut water/.test(n)) return '💧';
  if (/milk/.test(n)) return '🥛';
  if (/banana/.test(n)) return '🍌';
  if (/mango/.test(n)) return '🥭';
  if (/pomegranate/.test(n)) return '🔴';
  if (/watermelon/.test(n)) return '🍉';
  if (/muskmelon|guava|papaya|chikoo|custard/.test(n)) return '🍈';
  if (/apple(?! )/.test(n) || /^apple/.test(n)) return '🍎';
  if (/persimmon/.test(n)) return '🟠';
  if (/orange/.test(n)) return '🍊';
  if (/grape/.test(n)) return '🍇';
  if (/kiwi/.test(n)) return '🥝';
  if (/pear/.test(n)) return '🍐';
  if (/avocado/.test(n)) return '🥑';
  if (/litchi|jamun/.test(n)) return '🫐';
  if (/dragon/.test(n)) return '🩷';
  if (/strawberr|berr/.test(n)) return '🍓';
  if (/pineapple/.test(n)) return '🍍';
  if (/date/.test(n)) return '🌴';
  if (/raisin|fig/.test(n)) return '🟤';
  if (/pista|pumpkin seed|sunflower|magaz/.test(n)) return '🌻';
  if (/makhana/.test(n)) return '⚪';
  if (/whey|protein|casein|sattu/.test(n)) return '💪';
  if (/yogurt|curd/.test(n)) return '🥣';
  if (/peanut|almond butter/.test(n)) return '🥜';
  if (/almond|walnut/.test(n)) return '🌰';
  if (/cocoa/.test(n)) return '🍫';
  if (/honey/.test(n)) return '🍯';
  if (/jaggery/.test(n)) return '🟤';
  if (/spinach/.test(n)) return '🥬';
  if (/beetroot/.test(n)) return '🟣';
  if (/spirulina/.test(n)) return '🌿';
  return '✨';
}

window.mixToggle = (ev, id, groupKey) => {
  const cfg = MIXERS[mixerKind];
  const qtys = mixQtyState[mixerKind];
  const g = cfg.groups.find((x) => x.key === groupKey);
  const adding = !qtys[id];
  const cleared = [];
  if (!adding) {
    delete qtys[id];
  } else {
    if (g.single) for (const other of g.ids) if (qtys[other]) { cleared.push(other); delete qtys[other]; }
    qtys[id] = g.defaultQty;
  }
  refreshMixTile(id);
  cleared.forEach(refreshMixTile);
  renderMixSummary(adding ? id : null);
  if (adding) {
    const f = state.foods.find((x) => x.id === id);
    const stageEl = document.getElementById('mix-stage');
    const srcEl = ev && ev.target ? ev.target.closest('.shake-pick') : null;
    flyIcon(srcEl, stageEl, f, () => landStageItem(stageEl, id));
  }
};

window.mixQty = (id, delta) => {
  const qtys = mixQtyState[mixerKind];
  const next = (qtys[id] || 0) + delta;
  if (next <= 0) delete qtys[id];
  else qtys[id] = Math.min(next, 500);
  refreshMixTile(id);
  renderMixSummary();
};

function mixTotals() {
  let kcal = 0, protein = 0, carbs = 0, fat = 0, fiber = 0;
  for (const [id, grams] of Object.entries(mixQtyState[mixerKind])) {
    const f = state.foods.find((x) => x.id === id);
    if (!f) continue;
    const k = grams / 100;
    kcal += f.kcal * k; protein += f.protein * k; carbs += f.carbs * k;
    fat += f.fat * k; fiber += (f.fiber || 0) * k;
  }
  return { kcal, protein, carbs, fat, fiber };
}

function renderMixSummary(pendingId) {
  const cfg = MIXERS[mixerKind];
  const entries = Object.entries(mixQtyState[mixerKind]);
  const recipeBox = document.getElementById('sh-recipe');
  const totalsBox = document.getElementById('sh-totals');
  if (!recipeBox) return;
  const stageBox = document.getElementById('sh-stage');
  if (stageBox) stageBox.innerHTML = mixerStageHtml(pendingId || null);
  recipeBox.innerHTML = entries.length === 0
    ? `<p class="muted" style="padding:.5rem 0">Empty ${mixerKind === 'shake' ? 'glass — pick a base' : 'bowl — pick some fruits'} to start.</p>`
    : entries.map(([id, grams]) => {
      const f = state.foods.find((x) => x.id === id);
      return `<div class="picked-row"><span style="flex:1;display:flex;align-items:center;gap:.4rem">${foodIcon(f, 'fico-xs')} ${esc(f.name.split('/')[0].split('(')[0].trim())}</span>
        <span class="muted">${grams}${f.unit === '100ml' ? ' ml' : ' g'}</span></div>`;
    }).join('');
  const t = mixTotals();
  const price = Math.max(49, Math.round((40 + (t.kcal / 100) * 6) / 5) * 5);
  totalsBox.innerHTML = entries.length === 0 ? '' : `
    <div class="result-strip" style="margin:.8rem 0 0">
      <div class="stat"><b>${Math.round(t.kcal)}</b><small>kcal</small></div>
      <div class="stat"><b>${Math.round(t.protein)} g</b><small>Protein</small></div>
      <div class="stat"><b>${Math.round(t.carbs)} g</b><small>Carbs</small></div>
      <div class="stat"><b>${Math.round(t.fat)} g</b><small>Fat</small></div>
      <div class="stat"><b>${Math.round(t.fiber)} g</b><small>Fiber</small></div>
      <div class="stat"><b>${inr(price)}</b><small>Price</small></div>
    </div>`;
}

window.saveMix = async () => {
  const cfg = MIXERS[mixerKind];
  const errBox = document.getElementById('sh-error');
  errBox.innerHTML = '';
  const stageEl = document.getElementById('mix-stage');
  try {
    const entries = Object.entries(mixQtyState[mixerKind]);
    if (entries.length === 0) throw new Error(mixerKind === 'shake' ? 'Pick at least a base and one ingredient' : 'Pick at least one fruit');
    let name = document.getElementById('sh-name').value.trim();
    if (name && !cfg.suffixRe.test(name)) name += ' ' + cfg.suffixWord;
    if (stageEl && !REDUCED_MOTION) stageEl.classList.add('blending');
    // Let the blend/toss animation play while the request runs.
    const [res] = await Promise.all([
      api('/api/custom-meals', {
        name,
        kind: mixerKind,
        phone: load('tindam.phone') || null,
        slots: cfg.slots,
        items: entries.map(([foodId, grams]) => ({ foodId, grams }))
      }),
      new Promise((r) => setTimeout(r, REDUCED_MOTION ? 0 : 1300))
    ]);
    confettiBurst(stageEl);
    state.customMeals.push(res.meal);
    state.myMealIds.push(res.meal.id);
    persist('tindam.myMeals', state.myMealIds);
    mixQtyState[mixerKind] = {};
    window.cartAdd(res.meal.id, 1);
    renderMixer();
  } catch (e) {
    if (stageEl) stageEl.classList.remove('blending');
    errBox.innerHTML = `<div class="error-box">${esc(e.message)}</div>`;
  }
};

/* ---------------- Dashboard ---------------- */

const dash = { from: null, to: null };

function renderDashboard() {
  const savedPhone = load('tindam.phone') || '';
  const today = new Date().toISOString().slice(0, 10);
  const monthAgo = new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10);
  dash.from = dash.from || monthAgo;
  dash.to = dash.to || today;
  app.innerHTML = `
  <h2 class="section-title" style="margin-top:.4rem">📊 My dashboard</h2>
  <div class="card">
    <div class="dash-controls">
      <div class="field" style="margin:0"><label>Phone</label>
        <input id="d-phone" maxlength="10" placeholder="10-digit phone" value="${esc(savedPhone)}"></div>
      <div class="field" style="margin:0"><label>From</label><input id="d-from" type="date" value="${dash.from}" max="${today}"></div>
      <div class="field" style="margin:0"><label>To</label><input id="d-to" type="date" value="${dash.to}" max="${today}"></div>
      <div class="chip-row" style="margin:0;align-self:end">
        <button class="chip-btn" onclick="dashRange(7)">7 days</button>
        <button class="chip-btn" onclick="dashRange(30)">30 days</button>
        <button class="chip-btn" onclick="dashRange(90)">90 days</button>
      </div>
      <button class="btn btn-primary" style="align-self:end" onclick="loadDash()">Show</button>
    </div>
    <div id="d-error"></div>
  </div>
  <div id="dash-body"></div>
  <div id="viz-tip" class="viz-tip" hidden></div>`;
  if (savedPhone) loadDash();
}

window.dashRange = (days) => {
  const today = new Date().toISOString().slice(0, 10);
  dash.to = today;
  dash.from = new Date(Date.now() - (days - 1) * 86400000).toISOString().slice(0, 10);
  document.getElementById('d-from').value = dash.from;
  document.getElementById('d-to').value = dash.to;
  loadDash();
};

window.loadDash = async () => {
  const phone = document.getElementById('d-phone').value.trim();
  dash.from = document.getElementById('d-from').value;
  dash.to = document.getElementById('d-to').value;
  const errBox = document.getElementById('d-error');
  errBox.innerHTML = '';
  try {
    const d = await api(`/api/dashboard?phone=${encodeURIComponent(phone)}&from=${dash.from}&to=${dash.to}`);
    persist('tindam.phone', phone);
    renderDashBody(d);
  } catch (e) {
    errBox.innerHTML = `<div class="error-box">${esc(e.message)}</div>`;
  }
};

function renderDashBody(d) {
  const box = document.getElementById('dash-body');
  if (d.daysTracked === 0 && d.orders.length === 0) {
    box.innerHTML = `<div class="card" style="margin-top:1rem;text-align:center;padding:3rem">
      <p style="font-size:3rem">📭</p>
      <p class="muted">No history for this number yet. <a href="#/plan">Start a subscription</a> and your nutrition will show up here.<br>
      (Demo: run <code>node scripts/seed-demo.js</code> and look up <b>9000000001</b>.)</p></div>`;
    return;
  }
  const t = d.targets && d.targets.kcal ? d.targets : null;
  box.innerHTML = `
  <div class="result-strip" style="margin-top:1.2rem">
    <div class="stat"><b>${d.daysTracked}</b><small>Days delivered</small></div>
    <div class="stat"><b>${d.averages.kcal}</b><small>Avg kcal/day</small></div>
    <div class="stat"><b>${d.averages.protein} g</b><small>Avg protein/day</small></div>
    <div class="stat"><b>${d.averages.fiber} g</b><small>Avg fiber/day</small></div>
    <div class="stat"><b>${inr(d.totals.price)}</b><small>Spent in range</small></div>
  </div>

  <div class="card" style="margin-top:1rem">
    <h3>Calories per day</h3>
    <p class="muted" style="font-size:.82rem">${esc(d.from)} → ${esc(d.to)}${t ? ` · dashed line = your ${t.kcal} kcal target` : ''}</p>
    ${barChartSvg(d.daily, 'kcal', '#eb6834', t && t.kcal, 'kcal')}
  </div>
  <div class="card" style="margin-top:1rem">
    <h3>Protein per day</h3>
    <p class="muted" style="font-size:.82rem">grams of protein delivered${t ? ` · dashed line = your ${t.protein} g target` : ''}</p>
    ${barChartSvg(d.daily, 'protein', '#008300', t && t.protein, 'g')}
  </div>

  <div class="grid grid-2" style="margin-top:1rem;align-items:start">
    <div class="card">
      <h3>Where your calories came from</h3>
      <p class="muted" style="font-size:.82rem">average daily macro split (by energy)</p>
      ${macroSplitHtml(d.averages)}
    </div>
    <div class="card">
      <h3>Your most-eaten meals</h3>
      ${d.topMeals.length === 0 ? '<p class="muted">No meals in range.</p>' :
        d.topMeals.map((m) => `
        <div class="slot-line">
          <span style="flex:1">${esc(m.name)}</span>
          <span class="chip">${m.count}×</span>
        </div>`).join('')}
    </div>
  </div>

  <h2 class="section-title">Order history</h2>
  ${d.orders.map((o) => `
    <div class="card" style="margin-bottom:.8rem">
      <div class="day-head">
        <h3 style="font-size:1rem">${esc(o.id)} <span class="pill-status ${esc(o.status)}">${esc(o.status)}</span></h3>
        <span class="muted">${o.weeks} week${o.weeks > 1 ? 's' : ''} · ${esc(o.slot)} · ${esc(o.diet)} · ${esc(o.start || '')} → ${esc(o.end || '')}</span>
        <b>${inr(o.total)}</b>
      </div>
    </div>`).join('')}`;
  wireVizTips();
}

/* Single-series bar chart. Recessive grid, sparse date ticks, 2px bar gaps,
   rounded data-ends, dashed target line, hover tooltip per bar. */
function barChartSvg(daily, key, color, target, unit) {
  if (daily.length === 0) return '<p class="muted">No delivered days in this range.</p>';
  const W = 760, H = 220, padL = 44, padR = 10, padT = 12, padB = 26;
  const iw = W - padL - padR, ih = H - padT - padB;
  const max = Math.max(...daily.map((d) => d[key]), target || 0) * 1.12 || 1;
  const bw = Math.max(3, Math.min(34, iw / daily.length - 2));
  const x = (i) => padL + (iw / daily.length) * i + ((iw / daily.length) - bw) / 2;
  const y = (v) => padT + ih - (v / max) * ih;

  const gridN = 4;
  const grid = Array.from({ length: gridN + 1 }, (_, i) => {
    const v = Math.round((max / gridN) * i);
    return `<line x1="${padL}" y1="${y(v)}" x2="${W - padR}" y2="${y(v)}" stroke="#eef0ee" stroke-width="1"/>
      <text x="${padL - 6}" y="${y(v) + 4}" text-anchor="end" class="viz-axis">${v}</text>`;
  }).join('');

  const tickEvery = Math.max(1, Math.ceil(daily.length / 8));
  const bars = daily.map((d, i) => {
    const h = Math.max(2, padT + ih - y(d[key]));
    return `<rect x="${x(i)}" y="${y(d[key])}" width="${bw}" height="${h}" rx="3"
      fill="${color}" class="viz-bar" data-tip="${esc(d.date)} — ${d[key]} ${unit}"/>` +
      (i % tickEvery === 0
        ? `<text x="${x(i) + bw / 2}" y="${H - 8}" text-anchor="middle" class="viz-axis">${d.date.slice(5)}</text>`
        : '');
  }).join('');

  const targetLine = target ? `
    <line x1="${padL}" y1="${y(target)}" x2="${W - padR}" y2="${y(target)}"
      stroke="#52514e" stroke-width="1.5" stroke-dasharray="6 4"/>
    <text x="${W - padR}" y="${y(target) - 5}" text-anchor="end" class="viz-target">target ${target}</text>` : '';

  return `<svg viewBox="0 0 ${W} ${H}" class="viz" role="img" aria-label="${key} per day bar chart">
    ${grid}${bars}${targetLine}
  </svg>`;
}

/* Average macro split as one horizontal stacked bar: 3 fixed-order hues,
   2px surface gaps, direct labels (relief rule for low-contrast hues). */
function macroSplitHtml(avg) {
  const eC = avg.carbs * 4, eP = avg.protein * 4, eF = avg.fat * 9;
  const total = eC + eP + eF || 1;
  const segs = [
    { name: 'Carbs', kcal: eC, grams: avg.carbs, color: '#2a78d6' },
    { name: 'Protein', kcal: eP, grams: avg.protein, color: '#1baf7a' },
    { name: 'Fat', kcal: eF, grams: avg.fat, color: '#eda100' }
  ].map((s) => ({ ...s, pct: Math.round((s.kcal / total) * 100) }));
  return `
  <div class="macro-stack">
    ${segs.map((s) => `<div class="seg" style="width:${(s.kcal / total) * 100}%;background:${s.color}"
      title="${s.name}: ${s.pct}% of calories"></div>`).join('')}
  </div>
  <div class="macro-legend">
    ${segs.map((s) => `<span><i style="background:${s.color}"></i> ${s.name} <b>${s.pct}%</b> · ${s.grams} g/day</span>`).join('')}
  </div>`;
}

function wireVizTips() {
  const tip = document.getElementById('viz-tip');
  document.querySelectorAll('.viz-bar').forEach((bar) => {
    bar.addEventListener('mouseenter', (e) => {
      tip.textContent = bar.dataset.tip;
      tip.hidden = false;
    });
    bar.addEventListener('mousemove', (e) => {
      tip.style.left = (e.pageX + 12) + 'px';
      tip.style.top = (e.pageY - 30) + 'px';
    });
    bar.addEventListener('mouseleave', () => { tip.hidden = true; });
  });
}

/* ---------------- Cart / Daily box ---------------- */

function meterHtml(label, value, target, unit) {
  if (!target) return '';
  const pct = Math.min(100, Math.round((value / target) * 100));
  const over = value > target * 1.1;
  return `
    <div><b>${label}</b> <span class="muted">${Math.round(value)} / ${target} ${unit} ${over ? '⚠️ over' : ''}</span></div>
    <div class="bar"><div class="fill ${over ? 'over' : ''}" style="width:${pct}%"></div></div>`;
}

function renderCart() {
  const entries = Object.entries(state.cart).map(([id, qty]) => ({ meal: mealById(id), qty })).filter((e) => e.meal);
  const t = cartTotals();
  const tg = state.targets;

  app.innerHTML = `
  <h2 class="section-title" style="margin-top:.4rem">🛒 Your daily box</h2>
  <p class="muted">This box gets delivered <b>every day</b> of your subscription. You can still change any single day later (till 8 PM the evening before).</p>
  ${entries.length === 0 ? `
    <div class="card" style="margin-top:1rem;text-align:center;padding:3rem">
      <p style="font-size:3rem">🍽️</p>
      <p class="muted">Your box is empty. Add meals from the <a href="#/menu">menu</a>, or <a href="#/create">create your own</a>.</p>
    </div>` : `
  <div class="grid grid-2" style="margin-top:1rem;align-items:start">
    <div class="card">
      ${entries.map(({ meal, qty }) => `
        <div class="cart-line">
          ${mealIcon(meal, 'fico-md')}
          <span class="info">${dietDot(meal.diet)} <b>${esc(meal.name)}</b><br>
            <span class="muted" style="font-size:.8rem">${meal.kcal} kcal · ${meal.protein} g protein</span></span>
          ${addControl(meal.id)}
          <span class="line-price">${inr(meal.price * qty)}</span>
        </div>`).join('')}
      <div class="cart-line" style="border-bottom:none">
        <span class="info"><b>Daily total</b><br><span class="muted" style="font-size:.8rem">${Math.round(t.kcal)} kcal · ${Math.round(t.protein)} g protein · ${Math.round(t.carbs)} g carbs · ${Math.round(t.fat)} g fat</span></span>
        <span class="line-price">${inr(t.price)}/day</span>
      </div>
      ${tg ? `<div class="macro-meter">
        ${meterHtml('Calories', t.kcal, tg.kcal, 'kcal')}
        ${meterHtml('Protein', t.protein, tg.protein, 'g')}
      </div>` : `<div class="notice">Tip: <a href="#/plan">set your targets</a> to see how this box stacks up against your daily calories & protein.</div>`}
    </div>
    <div class="card">
      <h3>Subscribe to this box</h3>
      <div class="field" style="margin-top:.8rem"><label>Full name</label><input id="s-name" placeholder="Your name"></div>
      <div class="field"><label>Phone (10 digits — used to manage your subscription)</label><input id="s-phone" maxlength="10" placeholder="98XXXXXXXX" value="${esc(load('tindam.phone') || '')}"></div>
      <div class="field"><label>Delivery address</label><textarea id="s-address" rows="2" placeholder="Flat, street, area, city, PIN"></textarea></div>
      <div class="field"><label>Plan length</label>
        <select id="s-weeks">
          <option value="1">1 week — full price</option>
          <option value="2">2 weeks — 5% off</option>
          <option value="4" selected>4 weeks — 10% off</option>
        </select></div>
      <div class="field"><label>Delivery slot</label>
        <select id="s-slot"><option value="morning">Morning (6–9 AM)</option><option value="evening">Evening (5–8 PM)</option></select></div>
      <div class="field"><label>Start date</label><input id="s-start" type="date"></div>
      <div id="s-price" class="notice"></div>
      <button class="btn btn-primary" onclick="subscribeCart()">Confirm subscription</button>
      <div id="s-error"></div>
    </div>
  </div>`}`;

  if (entries.length) wireCheckout(() => cartTotals().price);
  refreshCartUi();
}

window.subscribeCart = async () => {
  const errBox = document.getElementById('s-error');
  errBox.innerHTML = '';
  try {
    const weeks = Number(document.getElementById('s-weeks').value);
    const startVal = document.getElementById('s-start').value;
    if (!startVal) throw new Error('Pick a start date');
    const mealIds = Object.entries(state.cart).flatMap(([id, qty]) => Array(qty).fill(id));
    if (mealIds.length === 0) throw new Error('Your box is empty');
    const start = new Date(startVal + 'T00:00:00');
    const days = [];
    for (let i = 0; i < weeks * 7; i++) {
      const date = new Date(start.getTime() + i * 86400000).toISOString().slice(0, 10);
      days.push({ date, mealIds });
    }
    const res = await api('/api/subscribe', {
      name: document.getElementById('s-name').value.trim(),
      phone: document.getElementById('s-phone').value.trim(),
      address: document.getElementById('s-address').value.trim(),
      slot: document.getElementById('s-slot').value,
      weeks,
      diet: state.diet,
      targets: state.targets ? { kcal: state.targets.kcal, protein: state.targets.protein } : { kcal: 0, protein: 0 },
      days
    });
    persist('tindam.phone', res.subscription.phone);
    state.cart = {};
    persist('tindam.cart', state.cart);
    errBox.innerHTML = `<div class="success-box">🎉 Subscription <b>${esc(res.subscription.id)}</b> confirmed!
      First delivery on <b>${esc(days[0].date)}</b> (${esc(res.subscription.slot)} slot).
      Total: <b>${inr(res.subscription.pricing.total)}</b>.
      Manage it in <a href="#/account">My Subscription</a>.</div>`;
    refreshCartUi();
  } catch (e) {
    errBox.innerHTML = `<div class="error-box">${esc(e.message)}</div>`;
  }
};

/* ---------------- Plan builder ---------------- */

function renderPlan() {
  const t = state.targets;
  app.innerHTML = `
  <h2 class="section-title" style="margin-top:.4rem">Build your personalized plan</h2>
  <div class="tab-row">
    <button class="chip-btn ${!planTab || planTab === 'direct' ? 'active' : ''}" onclick="setPlanTab('direct')">I know my calories</button>
    <button class="chip-btn ${planTab === 'stats' ? 'active' : ''}" onclick="setPlanTab('stats')">Calculate from my body</button>
  </div>
  <div id="target-form" class="card"></div>
  <div id="target-result">${t ? targetResultHtml(t) : ''}</div>
  <div id="plan-area">${state.plan ? planHtml(state.plan) : ''}</div>`;
  renderTargetForm();
  if (state.plan) wireCheckout(() => state.plan.totalPrice / 7);
}

let planTab = 'direct';
window.setPlanTab = (tab) => { planTab = tab; renderPlan(); };

function renderTargetForm() {
  const box = document.getElementById('target-form');
  if (planTab === 'stats') {
    box.innerHTML = `
    <div class="grid grid-2">
      <div>
        <div class="field"><label>Gender</label>
          <select id="f-gender"><option value="male">Male</option><option value="female">Female</option></select></div>
        <div class="field"><label>Age (years)</label><input id="f-age" type="number" min="14" max="90" placeholder="e.g. 26"></div>
        <div class="field"><label>Height (cm)</label><input id="f-height" type="number" min="120" max="230" placeholder="e.g. 172"></div>
        <div class="field"><label>Weight (kg)</label><input id="f-weight" type="number" min="30" max="250" placeholder="e.g. 74"></div>
      </div>
      <div>
        <div class="field"><label>Activity level</label>
          <select id="f-activity">
            <option value="sedentary">Sedentary (desk job, no workout)</option>
            <option value="light">Light (gym 1-3 days/week)</option>
            <option value="moderate" selected>Moderate (gym 3-5 days/week)</option>
            <option value="active">Active (gym 6-7 days/week)</option>
            <option value="athlete">Athlete (2x training)</option>
          </select></div>
        <div class="field"><label>Goal</label>
          <select id="f-goal">
            <option value="lose">Lose weight / fat</option>
            <option value="maintain" selected>Maintain</option>
            <option value="gain">Gain weight / muscle</option>
          </select></div>
        <div class="field"><label>How fast? (kg per week)</label>
          <select id="f-rate">
            <option value="0.25">Gentle — 0.25 kg/week</option>
            <option value="0.5" selected>Steady — 0.5 kg/week</option>
            <option value="0.75">Aggressive — 0.75 kg/week</option>
            <option value="1">Very aggressive — 1 kg/week</option>
          </select></div>
        <button class="btn btn-primary" onclick="calcStats()">Calculate my targets</button>
      </div>
    </div>
    <div id="form-error"></div>`;
  } else {
    const t = state.targets || {};
    box.innerHTML = `
    <div class="grid grid-2">
      <div class="field"><label>Daily calories (kcal)</label>
        <input id="f-kcal" type="number" min="1000" max="6000" placeholder="e.g. 2500" value="${t.kcal || ''}"></div>
      <div class="field"><label>Daily protein (g) — optional</label>
        <input id="f-protein" type="number" min="20" max="400" placeholder="e.g. 120" value="${t.protein || ''}"></div>
    </div>
    <button class="btn btn-primary" onclick="calcDirect()">Set my targets</button>
    <div id="form-error"></div>`;
  }
}

function showFormError(msg) {
  document.getElementById('form-error').innerHTML = `<div class="error-box">${esc(msg)}</div>`;
}

window.calcDirect = async () => {
  try {
    const t = await api('/api/targets', {
      mode: 'direct',
      kcal: document.getElementById('f-kcal').value,
      protein: document.getElementById('f-protein').value
    });
    state.targets = t;
    persist('tindam.targets', t);
    document.getElementById('target-result').innerHTML = targetResultHtml(t);
  } catch (e) { showFormError(e.message); }
};

window.calcStats = async () => {
  try {
    const t = await api('/api/targets', {
      mode: 'stats',
      gender: document.getElementById('f-gender').value,
      age: Number(document.getElementById('f-age').value),
      heightCm: Number(document.getElementById('f-height').value),
      weightKg: Number(document.getElementById('f-weight').value),
      activity: document.getElementById('f-activity').value,
      goal: document.getElementById('f-goal').value,
      rateKgPerWeek: document.getElementById('f-rate').value
    });
    state.targets = t;
    persist('tindam.targets', t);
    document.getElementById('target-result').innerHTML = targetResultHtml(t);
  } catch (e) { showFormError(e.message); }
};

function targetResultHtml(t) {
  const extra = t.bmr
    ? `<div class="stat"><b>${t.bmr}</b><small>BMR kcal</small></div>
       <div class="stat"><b>${t.tdee}</b><small>TDEE kcal</small></div>` : '';
  return `
  <div class="card" style="margin-top:1rem">
    <h3>Your daily targets</h3>
    <div class="result-strip">
      ${extra}
      <div class="stat"><b>${t.kcal}</b><small>Calories</small></div>
      <div class="stat"><b>${t.protein} g</b><small>Protein</small></div>
      <div class="stat"><b>${t.carbs} g</b><small>Carbs</small></div>
      <div class="stat"><b>${t.fat} g</b><small>Fat</small></div>
      <div class="stat"><b>${t.fiber} g</b><small>Fiber</small></div>
      ${t.waterLitres ? `<div class="stat"><b>${t.waterLitres} L</b><small>Water</small></div>` : ''}
    </div>
    <label>Food preference</label>
    <div class="chip-row">
      <button class="chip-btn ${state.diet === 'veg' ? 'active' : ''}" onclick="setDiet('veg')">🟢 Pure Veg</button>
      <button class="chip-btn ${state.diet === 'egg' ? 'active' : ''}" onclick="setDiet('egg')">🟡 Veg + Egg</button>
      <button class="chip-btn ${state.diet === 'nonveg' ? 'active' : ''}" onclick="setDiet('nonveg')">🔴 Non-Veg</button>
    </div>
    <button class="btn btn-primary" onclick="makePlan()">Generate my 7-day plan →</button>
    <span class="muted" style="margin-left:.8rem">Free — no signup needed</span>
    <div id="plan-error"></div>
  </div>`;
}

window.setDiet = (d) => {
  state.diet = d;
  persist('tindam.diet', d);
  document.getElementById('target-result').innerHTML = targetResultHtml(state.targets);
};

window.makePlan = async (seed) => {
  try {
    const plan = await api('/api/plan', {
      kcal: state.targets.kcal,
      protein: state.targets.protein,
      diet: state.diet,
      days: 7,
      seed: seed || Math.floor(Math.random() * 1e6)
    });
    state.plan = plan;
    persist('tindam.plan', plan);
    document.getElementById('plan-area').innerHTML = planHtml(plan);
    wireCheckout(() => state.plan.totalPrice / 7);
    document.getElementById('plan-area').scrollIntoView({ behavior: 'smooth' });
  } catch (e) {
    const el = document.getElementById('plan-error');
    if (el) el.innerHTML = `<div class="error-box">${esc(e.message)}</div>`;
  }
};

function planHtml(plan) {
  const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const cards = plan.days.map((d) => `
    <div class="card day-card">
      <div class="day-head">
        <h3>Day ${d.day} · ${dayNames[(d.day - 1) % 7]}</h3>
        <span class="muted">${inr(d.totals.price)}/day</span>
      </div>
      ${d.meals.map((m) => `
        <div class="slot-line">
          <span class="slot-tag">${esc(m.slot)}</span>
          <span style="flex:1">${dietDot(m.diet)} ${esc(m.name)}</span>
          <span class="kcal">${m.kcal} kcal · ${m.protein}g P</span>
        </div>`).join('')}
      <div class="day-totals">Total: ${d.totals.kcal} kcal · ${d.totals.protein} g protein · ${d.totals.carbs} g carbs · ${d.totals.fat} g fat</div>
    </div>`).join('');

  return `
  <h2 class="section-title">Your 7-day plan <span class="muted" style="font-size:.95rem">(target ${plan.targets.kcal} kcal · ${plan.targets.protein} g protein)</span></h2>
  <p class="muted">Not feeling a day? <button class="btn btn-ghost btn-small" onclick="makePlan()">↻ Shuffle the plan</button>
    &nbsp;Want full control? <a href="#/create">Create your own meals</a> and build a box in the <a href="#/menu">menu</a>.</p>
  <div class="grid grid-2" style="margin-top:1rem">${cards}</div>
  <div class="card" style="margin-top:1.4rem">
    <h3>Subscribe to this plan</h3>
    <p class="muted">Fresh meals delivered daily. Weekly price for this plan: <b>${inr(plan.totalPrice)}</b>. Change any day's meals until 8 PM the evening before.</p>
    <div class="grid grid-2" style="margin-top:.8rem">
      <div>
        <div class="field"><label>Full name</label><input id="s-name" placeholder="Your name"></div>
        <div class="field"><label>Phone (10 digits — used to manage your subscription)</label><input id="s-phone" maxlength="10" placeholder="98XXXXXXXX" value="${esc(load('tindam.phone') || '')}"></div>
        <div class="field"><label>Delivery address</label><textarea id="s-address" rows="3" placeholder="Flat, street, area, city, PIN"></textarea></div>
      </div>
      <div>
        <div class="field"><label>Plan length</label>
          <select id="s-weeks">
            <option value="1">1 week — full price</option>
            <option value="2">2 weeks — 5% off</option>
            <option value="4" selected>4 weeks — 10% off</option>
          </select></div>
        <div class="field"><label>Delivery slot</label>
          <select id="s-slot"><option value="morning">Morning (6–9 AM)</option><option value="evening">Evening (5–8 PM)</option></select></div>
        <div class="field"><label>Start date</label><input id="s-start" type="date"></div>
        <div id="s-price" class="notice"></div>
        <button class="btn btn-primary" onclick="subscribePlan()">Confirm subscription</button>
      </div>
    </div>
    <div id="s-error"></div>
  </div>`;
}

/* dailyPriceFn: () => average price per day, used for the live total preview */
function wireCheckout(dailyPriceFn) {
  const start = document.getElementById('s-start');
  if (!start) return;
  const tomorrow = new Date(Date.now() + 86400000);
  start.min = start.value = tomorrow.toISOString().slice(0, 10);
  const weeksSel = document.getElementById('s-weeks');
  const updatePrice = () => {
    const w = Number(weeksSel.value);
    const disc = w === 4 ? 0.1 : w === 2 ? 0.05 : 0;
    const total = Math.round(dailyPriceFn() * 7 * w * (1 - disc));
    document.getElementById('s-price').innerHTML =
      `Total for ${w} week${w > 1 ? 's' : ''}: <b>${inr(total)}</b>` +
      (disc ? ` <span class="chip">${disc * 100}% off applied</span>` : '');
  };
  weeksSel.addEventListener('change', updatePrice);
  updatePrice();
}

window.subscribePlan = async () => {
  const errBox = document.getElementById('s-error');
  errBox.innerHTML = '';
  try {
    const weeks = Number(document.getElementById('s-weeks').value);
    const startVal = document.getElementById('s-start').value;
    if (!startVal) throw new Error('Pick a start date');
    const start = new Date(startVal + 'T00:00:00');

    // Repeat the 7-day plan across the subscription length, one entry per date.
    const days = [];
    for (let i = 0; i < weeks * 7; i++) {
      const date = new Date(start.getTime() + i * 86400000).toISOString().slice(0, 10);
      const planDay = state.plan.days[i % state.plan.days.length];
      days.push({ date, mealIds: planDay.meals.map((m) => m.id) });
    }

    const res = await api('/api/subscribe', {
      name: document.getElementById('s-name').value.trim(),
      phone: document.getElementById('s-phone').value.trim(),
      address: document.getElementById('s-address').value.trim(),
      slot: document.getElementById('s-slot').value,
      weeks,
      diet: state.diet,
      targets: { kcal: state.targets.kcal, protein: state.targets.protein },
      days
    });
    persist('tindam.phone', res.subscription.phone);
    errBox.innerHTML = `<div class="success-box">🎉 Subscription <b>${esc(res.subscription.id)}</b> confirmed!
      First delivery on <b>${esc(days[0].date)}</b> (${esc(res.subscription.slot)} slot).
      Total: <b>${inr(res.subscription.pricing.total)}</b>.
      Manage it any time in <a href="#/account">My Subscription</a>.</div>`;
  } catch (e) {
    errBox.innerHTML = `<div class="error-box">${esc(e.message)}</div>`;
  }
};

/* ---------------- Foods (nutrition DB) ---------------- */

let foodFilter = { q: '', category: '' };

async function renderFoods() {
  if (!state.foods) {
    const res = await api('/api/foods');
    state.foods = res.foods;
    state.foodCategories = res.categories;
  }
  let list = state.foods;
  if (foodFilter.category) list = list.filter((f) => f.category === foodFilter.category);
  if (foodFilter.q) {
    const n = foodFilter.q.toLowerCase();
    list = list.filter((f) => f.name.toLowerCase().includes(n) || (f.tags || []).some((t) => t.includes(n)));
  }

  app.innerHTML = `
  <h2 class="section-title" style="margin-top:.4rem">Indian food nutrition database</h2>
  <p class="muted">${state.foods.length} foods · values per <b>100 g</b> (solids) or <b>100 ml</b> (liquids). Sources: IFCT 2017 (ICMR-NIN) & USDA FoodData Central.</p>
  <div class="food-toolbar" style="margin-top:1rem">
    <input id="food-q" placeholder="Search: paneer, millet, high-protein…" value="${esc(foodFilter.q)}">
    <select id="food-cat">
      <option value="">All categories</option>
      ${state.foodCategories.map((c) => `<option value="${esc(c)}" ${foodFilter.category === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}
    </select>
    <span class="muted" style="align-self:center">${list.length} results</span>
  </div>
  <div class="table-wrap">
    <table class="nutri">
      <thead><tr>
        <th>Food</th><th>Category</th><th>Per</th>
        <th class="num">Kcal</th><th class="num">Protein</th><th class="num">Carbs</th>
        <th class="num">Fat</th><th class="num">Fiber</th><th>Season</th>
      </tr></thead>
      <tbody>
        ${list.map((f) => `
        <tr>
          <td><span class="food-cell">${foodIcon(f, 'fico-xs')} ${dietDot(f.diet)} ${esc(f.name)}</span></td>
          <td class="muted">${esc(f.category)}</td>
          <td class="muted">${esc(f.unit)}</td>
          <td class="num"><b>${f.kcal}</b></td>
          <td class="num">${f.protein} g</td>
          <td class="num">${f.carbs} g</td>
          <td class="num">${f.fat} g</td>
          <td class="num">${f.fiber} g</td>
          <td>${f.season ? `<span class="chip">${esc(f.season)}</span>` : '<span class="muted">Year-round</span>'}</td>
        </tr>`).join('')}
      </tbody>
    </table>
  </div>`;

  document.getElementById('food-q').addEventListener('input', (e) => {
    foodFilter.q = e.target.value;
    renderFoods();
    const el = document.getElementById('food-q');
    el.focus(); el.setSelectionRange(el.value.length, el.value.length);
  });
  document.getElementById('food-cat').addEventListener('change', (e) => {
    foodFilter.category = e.target.value;
    renderFoods();
  });
}

/* ---------------- Account / My subscription ---------------- */

async function renderAccount() {
  const savedPhone = load('tindam.phone') || '';
  app.innerHTML = `
  <h2 class="section-title" style="margin-top:.4rem">My subscription</h2>
  <div class="card" style="max-width:480px">
    <div class="field"><label>Registered phone number</label>
      <input id="acct-phone" maxlength="10" placeholder="10-digit phone" value="${esc(savedPhone)}"></div>
    <button class="btn btn-primary" onclick="lookup()">View my deliveries</button>
    <div id="acct-error"></div>
  </div>
  <div id="acct-list"></div>`;
  if (savedPhone) lookup();
}

window.lookup = async () => {
  const phone = document.getElementById('acct-phone').value.trim();
  const errBox = document.getElementById('acct-error');
  errBox.innerHTML = '';
  try {
    const res = await api(`/api/subscription?phone=${encodeURIComponent(phone)}`);
    persist('tindam.phone', phone);
    const box = document.getElementById('acct-list');
    if (res.subscriptions.length === 0) {
      box.innerHTML = `<div class="notice" style="margin-top:1rem">No active subscription for this number. <a href="#/plan">Build a plan</a> or fill a <a href="#/menu">daily box</a> to get started.</div>`;
      return;
    }
    box.innerHTML = res.subscriptions.map((s) => subCardHtml(s, res.mealNames || {})).join('');
  } catch (e) {
    errBox.innerHTML = `<div class="error-box">${esc(e.message)}</div>`;
  }
};

function editable(dateStr) {
  const cutoff = new Date(dateStr + 'T00:00:00');
  cutoff.setDate(cutoff.getDate() - 1);
  cutoff.setHours(20, 0, 0, 0);
  return new Date() < cutoff;
}

function subCardHtml(sub, mealNames) {
  const today = new Date().toISOString().slice(0, 10);
  const upcoming = sub.days.filter((d) => d.date >= today).slice(0, 14);
  const mealName = (id) => mealNames[id] || (mealById(id) || {}).name || id;
  return `
  <div class="card" style="margin-top:1.2rem">
    <div class="day-head">
      <h3>${esc(sub.id)} <span class="pill-status ${esc(sub.status)}">${esc(sub.status)}</span></h3>
      <span class="muted">${sub.weeks} week plan · ${esc(sub.slot)} delivery${sub.targets.kcal ? ` · target ${sub.targets.kcal} kcal / ${sub.targets.protein} g protein` : ''}</span>
    </div>
    <p class="muted">Deliver to: ${esc(sub.address)} · Paid: <b>${inr(sub.pricing.total)}</b>${sub.pricing.discountPct ? ` (${sub.pricing.discountPct}% off)` : ''}</p>
    <div style="margin:.7rem 0">
      ${sub.status === 'active' ? `<button class="btn btn-ghost btn-small" onclick="setStatus('${sub.id}','paused')">⏸ Pause</button>` : ''}
      ${sub.status === 'paused' ? `<button class="btn btn-outline btn-small" onclick="setStatus('${sub.id}','active')">▶ Resume</button>` : ''}
      ${sub.status !== 'cancelled' ? `<button class="btn btn-danger btn-small" onclick="cancelSub('${sub.id}')">Cancel subscription</button>` : ''}
    </div>
    <div class="notice">You can skip a day or change its meals until <b>8 PM the previous evening</b>.</div>
    ${upcoming.length === 0 ? '<p class="muted">No upcoming deliveries in this plan.</p>' : ''}
    ${upcoming.map((d) => `
      <div class="slot-line ${d.skipped ? 'skipped' : ''}">
        <span class="slot-tag">${esc(d.date)}</span>
        <span style="flex:1">${d.mealIds.map((id) => esc(mealName(id))).join(' · ')}</span>
        ${editable(d.date) && sub.status === 'active'
          ? `<button class="btn btn-ghost btn-small" onclick="skipDay('${sub.id}','${d.date}',${!d.skipped})">${d.skipped ? 'Undo skip' : 'Skip'}</button>`
          : `<span class="muted" style="font-size:.8rem">${d.skipped ? 'skipped' : 'locked'}</span>`}
      </div>`).join('')}
  </div>`;
}

window.skipDay = async (id, date, skip) => {
  try {
    await api('/api/subscription/skip', { id, date, skip });
    lookup();
  } catch (e) { alert(e.message); }
};

window.setStatus = async (id, status) => {
  try {
    await api('/api/subscription/status', { id, status });
    lookup();
  } catch (e) { alert(e.message); }
};

window.cancelSub = async (id) => {
  if (!confirm('Cancel this subscription? This cannot be undone.')) return;
  window.setStatus(id, 'cancelled');
};

/* ---------------- Auth: login, signup, reset ---------------- */

function renderAuthArea() {
  const box = document.getElementById('auth-area');
  // Staff and admin get a focused header: hide the consumer nav.
  const consumerNav = document.getElementById('nav');
  consumerNav.style.display = state.user && state.user.role !== 'user' ? 'none' : '';
  if (!state.user) {
    box.innerHTML = `<a class="btn btn-primary btn-small" href="#/login">Login</a>`;
    return;
  }
  const u = state.user;
  const roleLink = u.role === 'admin' ? '<a href="#/admin">⚙️ Admin Console</a>'
    : u.role === 'staff' ? '<a href="#/staff">📦 Staff Orders</a>' : '';
  box.innerHTML = `
    <span class="user-chip" onclick="this.classList.toggle('open')">
      <span class="avatar">${esc((u.name || u.username)[0].toUpperCase())}</span>
      <b>${esc(u.name.split(' ')[0])}</b> <small>▾</small>
      <span class="user-menu">
        <small class="muted">${esc(u.username)} · ${esc(u.role)}</small>
        ${roleLink}
        ${u.role === 'user' ? '<a href="#/dashboard">📊 My Dashboard</a><a href="#/account">🗓 My Subscription</a>' : ''}
        <a href="#/" onclick="logout(event)">↪ Log out</a>
      </span>
    </span>`;
}

window.logout = async (e) => {
  if (e) e.preventDefault();
  try { await api('/api/auth/logout', {}); } catch { /* session already gone */ }
  state.user = null;
  renderAuthArea();
  location.hash = '#/';
  navigate();
};

function authShell(title, inner) {
  return `
  <div class="auth-wrap">
    <div class="card auth-card">
      <h2 style="margin-bottom:.2rem">${title}</h2>
      ${inner}
    </div>
  </div>`;
}

function renderLogin() {
  app.innerHTML = authShell('Welcome back 👋', `
    <p class="muted">Sign in to manage your meals and deliveries.</p>
    <div class="field" style="margin-top:1rem"><label>Username or email</label><input id="l-id" autocomplete="username"></div>
    <div class="field"><label>Password</label><input id="l-pass" type="password" autocomplete="current-password"></div>
    <button class="btn btn-primary" style="width:100%" onclick="doLogin()">Sign in</button>
    <div id="l-error"></div>
    <p class="muted" style="margin-top:.7rem;text-align:center"><a href="#/forgot">Forgot password?</a></p>
    <div class="auth-divider"><span>or</span></div>
    <div id="google-slot"></div>
    <p class="muted" style="margin-top:1rem;text-align:center">New to Tindam? <a href="#/signup"><b>Create an account</b></a></p>`);
  mountGoogleButton();
  document.getElementById('l-pass').addEventListener('keydown', (e) => { if (e.key === 'Enter') window.doLogin(); });
}

window.doLogin = async () => {
  const errBox = document.getElementById('l-error');
  errBox.innerHTML = '';
  try {
    const res = await api('/api/auth/login', {
      id: document.getElementById('l-id').value.trim(),
      password: document.getElementById('l-pass').value
    });
    afterLogin(res.user);
  } catch (e) {
    errBox.innerHTML = `<div class="error-box">${esc(e.message)}</div>`;
  }
};

function afterLogin(user) {
  state.user = user;
  if (user.phone) persist('tindam.phone', user.phone);
  renderAuthArea();
  location.hash = user.role === 'admin' ? '#/admin' : user.role === 'staff' ? '#/staff' : '#/';
  navigate();
}

function mountGoogleButton() {
  const slot = document.getElementById('google-slot');
  if (!slot) return;
  if (!state.googleClientId) {
    slot.innerHTML = `<button class="btn btn-ghost" style="width:100%" disabled>Continue with Google — available once GOOGLE_CLIENT_ID is configured</button>`;
    return;
  }
  slot.innerHTML = '<div id="g-btn" style="display:flex;justify-content:center"></div>';
  const init = () => {
    window.google.accounts.id.initialize({
      client_id: state.googleClientId,
      callback: async (resp) => {
        try {
          const res = await api('/api/auth/google', { credential: resp.credential });
          afterLogin(res.user);
        } catch (e) { alert(e.message); }
      }
    });
    window.google.accounts.id.renderButton(document.getElementById('g-btn'), { theme: 'outline', size: 'large', width: 320 });
  };
  if (window.google && window.google.accounts) return init();
  const s = document.createElement('script');
  s.src = 'https://accounts.google.com/gsi/client';
  s.onload = init;
  s.onerror = () => { slot.innerHTML = '<p class="muted" style="text-align:center">Could not load Google sign-in.</p>'; };
  document.head.appendChild(s);
}

function renderSignup() {
  app.innerHTML = authShell('Create your account', `
    <p class="muted">Track your macros, manage deliveries, save your creations.</p>
    <div class="field" style="margin-top:1rem"><label>Full name</label><input id="s-name2" autocomplete="name"></div>
    <div class="field"><label>Username</label><input id="s-user" autocomplete="username" placeholder="letters, numbers, . _ -"></div>
    <div class="field"><label>Email</label><input id="s-email" type="email" autocomplete="email"></div>
    <div class="field"><label>Phone (10 digits, for deliveries — optional)</label><input id="s-phone2" maxlength="10"></div>
    <div class="field"><label>Password (8+ characters)</label><input id="s-pass" type="password" autocomplete="new-password"></div>
    <button class="btn btn-primary" style="width:100%" onclick="doSignup()">Create account</button>
    <div id="s-error2"></div>
    <div class="auth-divider"><span>or</span></div>
    <div id="google-slot"></div>
    <p class="muted" style="margin-top:1rem;text-align:center">Already have an account? <a href="#/login"><b>Sign in</b></a></p>`);
  mountGoogleButton();
}

window.doSignup = async () => {
  const errBox = document.getElementById('s-error2');
  errBox.innerHTML = '';
  try {
    const res = await api('/api/auth/signup', {
      name: document.getElementById('s-name2').value.trim(),
      username: document.getElementById('s-user').value.trim(),
      email: document.getElementById('s-email').value.trim(),
      phone: document.getElementById('s-phone2').value.trim() || null,
      password: document.getElementById('s-pass').value
    });
    afterLogin(res.user);
  } catch (e) {
    errBox.innerHTML = `<div class="error-box">${esc(e.message)}</div>`;
  }
};

function renderForgot() {
  app.innerHTML = authShell('Reset your password', `
    <p class="muted">Enter your username or email and we'll generate a reset link (valid 30 minutes).</p>
    <div class="field" style="margin-top:1rem"><label>Username or email</label><input id="f-id"></div>
    <button class="btn btn-primary" style="width:100%" onclick="doForgot()">Send reset link</button>
    <div id="f-out"></div>
    <p class="muted" style="margin-top:1rem;text-align:center"><a href="#/login">← Back to sign in</a></p>`);
}

window.doForgot = async () => {
  const out = document.getElementById('f-out');
  try {
    const res = await api('/api/auth/forgot', { id: document.getElementById('f-id').value.trim() });
    out.innerHTML = `<div class="success-box">${esc(res.message)}${res.devResetLink
      ? `<br><a href="${esc(res.devResetLink)}"><b>Open reset link →</b></a> <small class="muted">(shown here because no email service is configured)</small>` : ''}</div>`;
  } catch (e) {
    out.innerHTML = `<div class="error-box">${esc(e.message)}</div>`;
  }
};

function renderReset() {
  const token = new URLSearchParams(location.hash.split('?')[1] || '').get('token') || '';
  app.innerHTML = authShell('Choose a new password', `
    <div class="field" style="margin-top:1rem"><label>New password (8+ characters)</label><input id="r-pass" type="password" autocomplete="new-password"></div>
    <button class="btn btn-primary" style="width:100%" onclick="doReset('${esc(token)}')">Update password</button>
    <div id="r-out"></div>`);
}

window.doReset = async (token) => {
  const out = document.getElementById('r-out');
  try {
    const res = await api('/api/auth/reset', { token, password: document.getElementById('r-pass').value });
    out.innerHTML = `<div class="success-box">${esc(res.message)} <a href="#/login"><b>Sign in →</b></a></div>`;
  } catch (e) {
    out.innerHTML = `<div class="error-box">${esc(e.message)}</div>`;
  }
};

/* ---------------- Admin console ---------------- */

function guard(role) {
  if (!state.user) { location.hash = '#/login'; return false; }
  if (state.user.role !== role && state.user.role !== 'admin') {
    app.innerHTML = '<div class="card" style="margin-top:2rem;text-align:center;padding:3rem"><p>🔒 This area needs a ' + esc(role) + ' account.</p></div>';
    return false;
  }
  return true;
}

async function renderAdmin() {
  if (!guard('admin')) return;
  let ov, users, subs;
  try {
    [ov, users, subs] = await Promise.all([
      api('/api/admin/overview'), api('/api/admin/users'), api('/api/admin/subscriptions')
    ]);
  } catch (e) {
    app.innerHTML = `<div class="error-box" style="margin-top:2rem">${esc(e.message)}</div>`;
    return;
  }
  app.innerHTML = `
  <h2 class="section-title" style="margin-top:.4rem">⚙️ Admin console</h2>
  <div class="result-strip">
    <div class="stat"><b>${ov.users}</b><small>Users</small></div>
    <div class="stat"><b>${ov.staff}</b><small>Staff</small></div>
    <div class="stat"><b>${ov.subscriptions}</b><small>Subscriptions</small></div>
    <div class="stat"><b>${ov.activeSubscriptions}</b><small>Active</small></div>
    <div class="stat"><b>${ov.customMeals}</b><small>Custom meals</small></div>
  </div>

  <div class="grid grid-2" style="align-items:start">
    <div class="card">
      <h3>👥 Accounts</h3>
      <div class="table-wrap"><table class="nutri"><thead><tr><th>Name</th><th>Username</th><th>Role</th><th>Via</th><th></th></tr></thead><tbody>
        ${users.users.map((u) => `<tr>
          <td>${esc(u.name)}</td><td class="muted">${esc(u.username)}${u.email ? `<br><small>${esc(u.email)}</small>` : ''}</td>
          <td><span class="chip ${u.role === 'admin' ? '' : 'green'}">${esc(u.role)}</span></td>
          <td class="muted">${esc(u.via || '-')}</td>
          <td>${u.role !== 'admin' ? `<button class="btn btn-danger btn-small" onclick="adminRemoveUser('${u.id}','${esc(u.username)}')">Remove</button>` : ''}</td>
        </tr>`).join('')}
      </tbody></table></div>
      <div id="adm-user-msg"></div>
      <h3 style="margin-top:1.2rem">➕ Create staff account</h3>
      <div class="grid grid-2" style="margin-top:.5rem">
        <div class="field"><label>Name</label><input id="st-name"></div>
        <div class="field"><label>Username</label><input id="st-user"></div>
      </div>
      <div class="field"><label>Password (8+ chars)</label><input id="st-pass" type="password"></div>
      <button class="btn btn-primary btn-small" onclick="adminCreateStaff()">Create staff</button>
      <div id="adm-staff-msg"></div>
    </div>

    <div class="card">
      <h3>📦 Subscriptions</h3>
      <div class="table-wrap"><table class="nutri"><thead><tr><th>ID</th><th>Customer</th><th>Window</th><th>Status</th><th></th></tr></thead><tbody>
        ${subs.subscriptions.map((s) => `<tr>
          <td class="muted">${esc(s.id)}<br><small>${inr(s.total)}</small></td>
          <td>${esc(s.name)}<br><small class="muted">${esc(s.phone)}</small></td>
          <td class="muted"><small>${esc(s.start || '')} →<br>${esc(s.end || '')}</small></td>
          <td><span class="pill-status ${esc(s.status)}">${esc(s.status)}</span></td>
          <td>
            ${s.status === 'active' ? `<button class="btn btn-ghost btn-small" onclick="adminSubStatus('${s.id}','paused')">Pause</button>` : ''}
            ${s.status === 'paused' ? `<button class="btn btn-outline btn-small" onclick="adminSubStatus('${s.id}','active')">Resume</button>` : ''}
            ${s.status !== 'cancelled' ? `<button class="btn btn-danger btn-small" onclick="adminSubStatus('${s.id}','cancelled')">Cancel</button>` : ''}
          </td>
        </tr>`).join('')}
      </tbody></table></div>
    </div>
  </div>

  <div class="card" style="margin-top:1.2rem">
    <h3>🧾 Audit log <button class="btn btn-ghost btn-small" onclick="adminAudit()">Show full log</button></h3>
    <div id="audit-list">${auditRows(ov.audit)}</div>
  </div>`;
}

function auditRows(list) {
  return list.map((a) => `
    <div class="slot-line">
      <span class="slot-tag" style="min-width:150px">${esc(a.ts.replace('T', ' ').slice(0, 19))}</span>
      <span class="chip">${esc(a.event)}</span>
      <span style="flex:1">${esc(a.detail)}</span>
      <span class="muted"><small>${esc(a.actor)}</small></span>
    </div>`).join('') || '<p class="muted">No events yet.</p>';
}

window.adminAudit = async () => {
  const res = await api('/api/admin/audit');
  document.getElementById('audit-list').innerHTML = auditRows(res.audit);
};

window.adminRemoveUser = async (id, username) => {
  if (!confirm(`Remove account "${username}"? This cannot be undone.`)) return;
  try { await api('/api/admin/users/remove', { userId: id }); renderAdmin(); }
  catch (e) { document.getElementById('adm-user-msg').innerHTML = `<div class="error-box">${esc(e.message)}</div>`; }
};

window.adminCreateStaff = async () => {
  const msg = document.getElementById('adm-staff-msg');
  try {
    const res = await api('/api/admin/staff', {
      name: document.getElementById('st-name').value.trim(),
      username: document.getElementById('st-user').value.trim(),
      password: document.getElementById('st-pass').value
    });
    msg.innerHTML = `<div class="success-box">Staff account <b>${esc(res.staff.username)}</b> created — share the username & password with them.</div>`;
    setTimeout(renderAdmin, 1200);
  } catch (e) {
    msg.innerHTML = `<div class="error-box">${esc(e.message)}</div>`;
  }
};

window.adminSubStatus = async (id, status) => {
  if (status === 'cancelled' && !confirm(`Cancel subscription ${id}?`)) return;
  try { await api('/api/admin/subscriptions/status', { id, status }); renderAdmin(); }
  catch (e) { alert(e.message); }
};

/* ---------------- Staff order board ---------------- */

const STATUS_LABELS = {
  accepted: '✅ Accepted', preparing: '👨‍🍳 Preparing', scheduled: '🛵 Scheduled',
  delivered: '📦 Delivered', rejected: '🚫 Rejected', not_delivered: '⚠️ Not delivered'
};

let staffDate = null;

async function renderStaff() {
  if (!guard('staff')) return;
  staffDate = staffDate || new Date().toISOString().slice(0, 10);
  let data;
  try { data = await api(`/api/staff/orders?date=${staffDate}`); }
  catch (e) { app.innerHTML = `<div class="error-box" style="margin-top:2rem">${esc(e.message)}</div>`; return; }

  const counts = {};
  for (const o of data.orders) counts[o.status] = (counts[o.status] || 0) + 1;

  app.innerHTML = `
  <h2 class="section-title" style="margin-top:.4rem">📦 Kitchen & delivery board</h2>
  <div class="card">
    <div class="dash-controls">
      <div class="field" style="margin:0"><label>Delivery date</label><input id="stf-date" type="date" value="${staffDate}"></div>
      <button class="btn btn-ghost" style="align-self:end" onclick="staffShift(-1)">← Prev day</button>
      <button class="btn btn-ghost" style="align-self:end" onclick="staffShift(1)">Next day →</button>
      <span class="muted" style="align-self:end">${data.orders.length} order${data.orders.length === 1 ? '' : 's'} ·
        ${Object.entries(counts).map(([s, n]) => `${STATUS_LABELS[s] || s}: ${n}`).join(' · ') || 'none'}</span>
    </div>
  </div>
  ${data.orders.length === 0 ? `<div class="card" style="margin-top:1rem;text-align:center;padding:3rem"><p class="muted">No deliveries scheduled for ${esc(staffDate)}.</p></div>` : ''}
  ${data.orders.map((o) => `
    <div class="card order-card" style="margin-top:1rem">
      <div class="day-head">
        <h3 style="font-size:1.02rem">${esc(o.customer)} <span class="chip">${esc(o.slot)} slot</span> ${dietDot(o.diet)}</h3>
        <span class="order-status st-${esc(o.status)}">${STATUS_LABELS[o.status] || esc(o.status)}</span>
      </div>
      <p class="muted">📍 ${esc(o.address)} · 📞 ${esc(o.phone)} · <small>${esc(o.subId)}</small></p>
      <p style="margin:.4rem 0"><b>Prepare:</b> ${o.meals.map((m) => `<span class="chip green">${esc(m)}</span>`).join(' ')}</p>
      <div class="chip-row">
        ${data.statuses.map((s) => `
          <button class="chip-btn ${o.status === s ? 'active' : ''}"
            onclick="staffSetStatus('${o.subId}','${o.date}','${s}')">${STATUS_LABELS[s]}</button>`).join('')}
      </div>
    </div>`).join('')}`;

  document.getElementById('stf-date').addEventListener('change', (e) => { staffDate = e.target.value; renderStaff(); });
}

window.staffShift = (delta) => {
  const d = new Date(staffDate + 'T00:00:00');
  d.setDate(d.getDate() + delta);
  staffDate = d.toISOString().slice(0, 10);
  renderStaff();
};

window.staffSetStatus = async (subId, date, status) => {
  try { await api('/api/staff/orders/status', { subId, date, status }); renderStaff(); }
  catch (e) { alert(e.message); }
};

/* ---------------- Boot ---------------- */

(async function boot() {
  try { state.icons = await api('/icons/map.json'); } catch { /* emoji fallback */ }
  try {
    const [me, cfg] = await Promise.all([api('/api/auth/me'), api('/api/auth/config')]);
    state.user = me.user;
    state.googleClientId = cfg.googleClientId;
    if (state.user && state.user.phone) persist('tindam.phone', state.user.phone);
  } catch { /* logged out */ }
  renderAuthArea();
  try {
    state.menu = (await api('/api/meals')).meals;
    if (state.myMealIds.length) {
      const res = await api(`/api/custom-meals?ids=${state.myMealIds.join(',')}`);
      state.customMeals = res.meals;
      // prune ids the server no longer knows
      state.myMealIds = res.meals.map((m) => m.id);
      persist('tindam.myMeals', state.myMealIds);
    }
  } catch { /* offline-tolerant: pages fetch lazily */ }
  navigate();
})();
