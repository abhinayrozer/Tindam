'use strict';

/* Tindam SPA — hash-routed, talks to the local JSON API. */

const app = document.getElementById('app');

const state = {
  targets: load('tindam.targets'),
  plan: load('tindam.plan'),
  diet: load('tindam.diet') || 'nonveg',
  menu: null,
  foods: null
};

function load(key) {
  try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
}
function persist(key, val) {
  localStorage.setItem(key, JSON.stringify(val));
}

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

function macroChips(m) {
  return `<div class="macros">
    <span>${Math.round(m.kcal)} kcal</span><span>P ${m.protein}g</span>
    <span>C ${m.carbs}g</span><span>F ${m.fat}g</span>
  </div>`;
}

/* ---------------- Router ---------------- */

const routes = {
  '/': renderHome,
  '/plan': renderPlan,
  '/menu': renderMenu,
  '/foods': renderFoods,
  '/account': renderAccount
};

function navigate() {
  const path = (location.hash.replace(/^#/, '') || '/').split('?')[0];
  const view = routes[path] || renderHome;
  document.querySelectorAll('#nav a').forEach((a) => {
    a.classList.toggle('active', a.dataset.route === path);
  });
  window.scrollTo(0, 0);
  view();
}
window.addEventListener('hashchange', navigate);

/* ---------------- Home ---------------- */

function renderHome() {
  app.innerHTML = `
  <section class="hero">
    <h1>Eat for your goal.<br>We cook & deliver. Every day.</h1>
    <p>Tindam is a fitness food subscription for India. Tell us your calorie & protein target —
       or just your height, weight and goal — and get a personalized Indian meal plan
       delivered fresh to your door daily. No ordering, no cooking, no guesswork.</p>
    <a class="btn btn-primary" href="#/plan">Build my free plan →</a>
    <a class="btn btn-outline" href="#/menu" style="margin-left:.6rem">See the menu</a>
    <div class="hero-badges">
      <span>🇮🇳 100% Indian meals</span>
      <span>📊 Macro-counted portions</span>
      <span>🔁 Change tomorrow's meal till 8 PM</span>
      <span>⏸️ Pause or skip any day</span>
    </div>
  </section>

  <h2 class="section-title">How it works</h2>
  <div class="grid grid-4 steps">
    <div class="card"><h3>Set your target</h3><p class="muted">Enter calories & protein directly, or your height, weight and goal — we calculate your daily needs scientifically (Mifflin-St Jeor).</p></div>
    <div class="card"><h3>Get your plan</h3><p class="muted">A 7-day Indian meal plan matched to your macros — breakfast, lunch, snack, dinner. Swap anything you don't like.</p></div>
    <div class="card"><h3>Subscribe</h3><p class="muted">Pick 1, 2 or 4 weeks. Choose morning or evening delivery. Up to 10% off on longer plans.</p></div>
    <div class="card"><h3>Eat & repeat</h3><p class="muted">Fresh meals daily, like your milk delivery. Skip a day, pause a week, or change tomorrow's meal before 8 PM.</p></div>
  </div>

  <h2 class="section-title">Why Tindam and not a food app?</h2>
  <div class="grid grid-3">
    <div class="card"><h3>🎯 Built around your macros</h3><p class="muted">Delivery apps sell dishes. We deliver your daily calorie and protein target, portioned to the gram — 300 g rice means 300 g rice.</p></div>
    <div class="card"><h3>🥘 Desi, not diet-bland</h3><p class="muted">Dal khichdi, paneer bhurji, chole brown rice, sattu coolers, seasonal fruit bowls — real Indian food engineered for fitness.</p></div>
    <div class="card"><h3>📚 Transparent nutrition</h3><p class="muted">Every ingredient in our database shows values per 100 g / 100 ml — calories, protein, carbs, fat, fiber, and seasonality.</p></div>
  </div>

  <h2 class="section-title">Popular targets</h2>
  <div class="grid grid-3">
    <div class="card"><h3>Fat loss</h3><p class="muted">~1,800 kcal · 130 g protein. High-volume, high-protein meals that keep you full.</p><a class="btn btn-outline btn-small" href="#/plan" onclick="presetTarget(1800,130)">Try this target</a></div>
    <div class="card"><h3>Lean maintain</h3><p class="muted">~2,200 kcal · 120 g protein. Balanced thalis and bowls for staying in shape.</p><a class="btn btn-outline btn-small" href="#/plan" onclick="presetTarget(2200,120)">Try this target</a></div>
    <div class="card"><h3>Muscle gain</h3><p class="muted">~3,000 kcal · 160 g protein. Chicken-rice bulk bowls, paneer bowls, shakes.</p><a class="btn btn-outline btn-small" href="#/plan" onclick="presetTarget(3000,160)">Try this target</a></div>
  </div>`;
}

window.presetTarget = (kcal, protein) => {
  state.targets = { kcal, protein, mode: 'direct' };
  persist('tindam.targets', state.targets);
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
  <div id="plan-area">${state.plan ? planHtml(state.plan) : ''}</div>
  <div id="checkout-area"></div>`;
  renderTargetForm();
  if (state.plan) wireCheckout();
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
    wireCheckout();
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
          <span style="flex:1">${dietDot(m.diet)}${esc(m.name)}</span>
          <span class="kcal">${m.kcal} kcal · ${m.protein}g P</span>
        </div>`).join('')}
      <div class="day-totals">Total: ${d.totals.kcal} kcal · ${d.totals.protein} g protein · ${d.totals.carbs} g carbs · ${d.totals.fat} g fat</div>
    </div>`).join('');

  return `
  <h2 class="section-title">Your 7-day plan <span class="muted" style="font-size:.95rem">(target ${plan.targets.kcal} kcal · ${plan.targets.protein} g protein)</span></h2>
  <p class="muted">Not feeling a day? <button class="btn btn-ghost btn-small" onclick="makePlan()">↻ Shuffle the plan</button></p>
  <div class="grid grid-2" style="margin-top:1rem">${cards}</div>
  <div class="card" style="margin-top:1.4rem">
    <h3>Subscribe to this plan</h3>
    <p class="muted">Fresh meals delivered daily. Weekly price for this plan: <b>${inr(plan.totalPrice)}</b>. Change any day's meals until 8 PM the evening before.</p>
    <div class="grid grid-2" style="margin-top:.8rem">
      <div>
        <div class="field"><label>Full name</label><input id="s-name" placeholder="Your name"></div>
        <div class="field"><label>Phone (10 digits — used to manage your subscription)</label><input id="s-phone" maxlength="10" placeholder="98XXXXXXXX"></div>
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
        <button class="btn btn-primary" onclick="subscribe()">Confirm subscription</button>
      </div>
    </div>
    <div id="s-error"></div>
  </div>`;
}

function wireCheckout() {
  const start = document.getElementById('s-start');
  if (!start) return;
  const tomorrow = new Date(Date.now() + 86400000);
  start.min = start.value = tomorrow.toISOString().slice(0, 10);
  const weeksSel = document.getElementById('s-weeks');
  const updatePrice = () => {
    const w = Number(weeksSel.value);
    const disc = w === 4 ? 0.1 : w === 2 ? 0.05 : 0;
    const total = Math.round(state.plan.totalPrice * w * (1 - disc));
    document.getElementById('s-price').innerHTML =
      `Total for ${w} week${w > 1 ? 's' : ''}: <b>${inr(total)}</b>` +
      (disc ? ` <span class="chip">${disc * 100}% off applied</span>` : '');
  };
  weeksSel.addEventListener('change', updatePrice);
  updatePrice();
}

window.subscribe = async () => {
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

/* ---------------- Menu ---------------- */

let menuFilter = { slot: '', diet: '' };

async function renderMenu() {
  if (!state.menu) state.menu = (await api('/api/meals')).meals;
  const slots = ['breakfast', 'lunch', 'snack', 'dinner'];
  let list = state.menu;
  if (menuFilter.slot) list = list.filter((m) => m.slots.includes(menuFilter.slot));
  if (menuFilter.diet === 'veg') list = list.filter((m) => m.diet === 'veg');
  if (menuFilter.diet === 'egg') list = list.filter((m) => m.diet !== 'nonveg');

  app.innerHTML = `
  <h2 class="section-title" style="margin-top:.4rem">Our menu</h2>
  <p class="muted">Every meal is portioned and macro-counted. Prices per delivered portion.</p>
  <div class="chip-row" style="margin-top:1rem">
    <button class="chip-btn ${!menuFilter.slot ? 'active' : ''}" onclick="setMenuFilter('slot','')">All slots</button>
    ${slots.map((s) => `<button class="chip-btn ${menuFilter.slot === s ? 'active' : ''}" onclick="setMenuFilter('slot','${s}')">${s[0].toUpperCase() + s.slice(1)}</button>`).join('')}
    <span style="width:1rem"></span>
    <button class="chip-btn ${!menuFilter.diet ? 'active' : ''}" onclick="setMenuFilter('diet','')">All diets</button>
    <button class="chip-btn ${menuFilter.diet === 'veg' ? 'active' : ''}" onclick="setMenuFilter('diet','veg')">🟢 Veg</button>
    <button class="chip-btn ${menuFilter.diet === 'egg' ? 'active' : ''}" onclick="setMenuFilter('diet','egg')">🟡 Veg + Egg</button>
  </div>
  <div class="grid grid-3" style="margin-top:1.2rem">
    ${list.map((m) => `
      <div class="card meal-card">
        <div class="title-row"><h4>${dietDot(m.diet)}${esc(m.name)}</h4><span class="price">${inr(m.price)}</span></div>
        <p class="muted">${esc(m.desc)}</p>
        ${macroChips(m)}
        <div>${m.slots.map((s) => `<span class="chip amber">${s}</span>`).join('')}${(m.tags || []).slice(0, 2).map((t) => `<span class="chip">${t}</span>`).join('')}</div>
      </div>`).join('')}
  </div>`;
}

window.setMenuFilter = (k, v) => { menuFilter[k] = v; renderMenu(); };

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
  <p class="muted">${state.foods.length} foods · values per <b>100 g</b> (solids) or <b>100 ml</b> (liquids). Sources: IFCT 2017 (ICMR-NIN) & USDA.</p>
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
          <td>${dietDot(f.diet)}${esc(f.name)}</td>
          <td class="muted">${esc(f.category)}</td>
          <td class="muted">${esc(f.unit)}</td>
          <td class="num"><b>${f.kcal}</b></td>
          <td class="num">${f.protein} g</td>
          <td class="num">${f.carbs} g</td>
          <td class="num">${f.fat} g</td>
          <td class="num">${f.fiber} g</td>
          <td>${f.season ? `<span class="chip amber">${esc(f.season)}</span>` : '<span class="muted">Year-round</span>'}</td>
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
      box.innerHTML = `<div class="notice" style="margin-top:1rem">No active subscription for this number. <a href="#/plan">Build a plan</a> to get started.</div>`;
      return;
    }
    box.innerHTML = res.subscriptions.map(subCardHtml).join('');
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

function subCardHtml(sub) {
  const today = new Date().toISOString().slice(0, 10);
  const upcoming = sub.days.filter((d) => d.date >= today).slice(0, 14);
  const menu = state.menu || [];
  const mealName = (id) => {
    const m = menu.find((x) => x.id === id);
    return m ? m.name : id;
  };
  return `
  <div class="card" style="margin-top:1.2rem">
    <div class="day-head">
      <h3>${esc(sub.id)} <span class="pill-status ${esc(sub.status)}">${esc(sub.status)}</span></h3>
      <span class="muted">${sub.weeks} week plan · ${esc(sub.slot)} delivery · target ${sub.targets.kcal} kcal / ${sub.targets.protein} g protein</span>
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
  try { state.menu = (await api('/api/meals')).meals; } catch { /* menu loads lazily later */ }
  navigate();
})();
