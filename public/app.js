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
  foods: null
};

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
  '/foods': renderFoods,
  '/cart': renderCart,
  '/account': renderAccount
};

function navigate() {
  const path = (location.hash.replace(/^#/, '') || '/').split('?')[0];
  const view = routes[path] || renderHome;
  document.querySelectorAll('#nav a').forEach((a) => {
    a.classList.toggle('active', a.dataset.route === path);
  });
  window.scrollTo(0, 0);
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
  { emoji: '💪', label: 'High Protein', q: 'high-protein' },
  { emoji: '🍗', label: 'Chicken', q: 'chicken' },
  { emoji: '🧀', label: 'Paneer', q: 'paneer' },
  { emoji: '🥣', label: 'Breakfast', slot: 'breakfast' },
  { emoji: '🍛', label: 'Lunch Bowls', slot: 'lunch' },
  { emoji: '🥗', label: 'Weight Loss', q: 'weight-loss' },
  { emoji: '🍉', label: 'Fruit Bowls', q: 'fruit' },
  { emoji: '🥤', label: 'Shakes', q: 'shake' },
  { emoji: '🌾', label: 'Millets', q: 'millet' },
  { emoji: '🌙', label: 'Light Dinner', slot: 'dinner' }
];

function catRailHtml(activeQ) {
  return `<div class="cat-rail">
    ${CATEGORY_RAIL.map((c) => `
      <button class="cat-item ${activeQ && (c.q === activeQ || c.slot === activeQ) ? 'active' : ''}"
        onclick="railJump('${c.q || ''}','${c.slot || ''}')">
        <span class="cat-ico">${c.emoji}</span><small>${c.label}</small>
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
      ${mealEmoji(m)}
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
  app.innerHTML = `
  <section class="hero">
    <h1>Eat for your goal.<br>We cook & deliver. Every day.</h1>
    <p>Tindam is a fitness food subscription for India. Tell us your calorie & protein target —
       or just your height, weight and goal — and get macro-counted Indian meals
       delivered fresh daily. No ordering, no cooking, no guesswork.</p>
    <a class="btn btn-primary" href="#/plan">Build my free plan →</a>
    <a class="btn btn-outline" href="#/create" style="margin-left:.6rem">Create your own meal</a>
    <div class="hero-badges">
      <span>🇮🇳 100% Indian meals</span>
      <span>📊 Macro-counted portions</span>
      <span>🧑‍🍳 Build meals from 300+ ingredients</span>
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
    <div class="card"><h3>Pick or build meals</h3><p class="muted">Take our 7-day plan, or build your own meals ingredient by ingredient from 300+ Indian foods.</p></div>
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
      ${dietDot(f.diet)}<span class="nm">${esc(f.name)}</span>
      <span class="kc">${f.kcal} kcal · ${f.protein}g P /${f.unit === '100ml' ? '100ml' : '100g'}</span>
      <button class="add-btn" style="padding:.25rem .8rem" onclick="builderAdd('${f.id}')">Add</button>
    </div>`).join('') || '<div class="ing-row muted">No ingredients found.</div>';
}

window.builderAdd = (foodId) => {
  if (builder.items.some((i) => i.foodId === foodId)) return;
  if (builder.items.length >= 15) { alert('Maximum 15 ingredients per meal'); return; }
  builder.items.push({ foodId, grams: 100 });
  renderBuilderPicked();
};
window.builderRemove = (foodId) => {
  builder.items = builder.items.filter((i) => i.foodId !== foodId);
  renderBuilderPicked();
};
window.builderGrams = (foodId, val) => {
  const it = builder.items.find((i) => i.foodId === foodId);
  if (it) it.grams = Number(val) || 0;
  renderBuilderTotals();
};
window.toggleSlot = (s) => {
  if (builder.slots.includes(s)) builder.slots = builder.slots.filter((x) => x !== s);
  else builder.slots.push(s);
  renderCreate();
};

function renderBuilderPicked() {
  const box = document.getElementById('b-picked');
  if (!box) return;
  box.innerHTML = builder.items.length === 0
    ? '<p class="muted" style="padding:.6rem 0">No ingredients yet — search on the left and hit Add.</p>'
    : builder.items.map((it) => {
      const f = state.foods.find((x) => x.id === it.foodId);
      return `<div class="picked-row">
        ${dietDot(f.diet)}<span style="flex:1">${esc(f.name)}</span>
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
          <span style="font-size:1.6rem">${mealEmoji(meal)}</span>
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
          <td>${dietDot(f.diet)} ${esc(f.name)}</td>
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

/* ---------------- Boot ---------------- */

(async function boot() {
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
