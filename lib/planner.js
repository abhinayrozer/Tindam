'use strict';

// Meal plan generator: builds a multi-day plan from the deliverable menu that
// hits the user's calorie + protein targets, respects diet preference, and
// keeps day-to-day variety.

const SLOT_SPLIT = { breakfast: 0.25, lunch: 0.35, snack: 0.15, dinner: 0.25 };
const SLOT_ORDER = ['breakfast', 'lunch', 'snack', 'dinner'];

// veg users see veg only; egg users see veg+egg; nonveg users see everything.
function dietAllows(pref, mealDiet) {
  if (pref === 'veg') return mealDiet === 'veg';
  if (pref === 'egg') return mealDiet === 'veg' || mealDiet === 'egg';
  return true;
}

function score(meal, kcalTarget, proteinTarget, recentIds) {
  const kcalDev = Math.abs(meal.kcal - kcalTarget) / Math.max(kcalTarget, 1);
  const protDev = Math.abs(meal.protein - proteinTarget) / Math.max(proteinTarget, 1);
  const repeat = recentIds.includes(meal.id) ? 0.8 : 0;
  return kcalDev + 1.4 * protDev + repeat;
}

function pickForSlot(meals, slot, kcalTarget, proteinTarget, pref, recentIds, excludeIds, rng) {
  const candidates = meals.filter(
    (m) => m.slots.includes(slot) && dietAllows(pref, m.diet) && !excludeIds.includes(m.id)
  );
  if (candidates.length === 0) return null;
  const ranked = candidates
    .map((m) => ({ meal: m, s: score(m, kcalTarget, proteinTarget, recentIds) }))
    .sort((a, b) => a.s - b.s);
  // Small randomness among the top picks keeps weekly plans varied.
  const pool = ranked.slice(0, Math.min(3, ranked.length));
  return pool[Math.floor(rng() * pool.length)].meal;
}

function totals(dayMeals) {
  return dayMeals.reduce(
    (t, m) => ({
      kcal: t.kcal + m.kcal,
      protein: t.protein + m.protein,
      carbs: t.carbs + m.carbs,
      fat: t.fat + m.fat,
      fiber: t.fiber + (m.fiber || 0),
      price: t.price + m.price
    }),
    { kcal: 0, protein: 0, carbs: 0, fat: 0, fiber: 0, price: 0 }
  );
}

// Boosters used to close remaining protein / calorie gaps after the 4 main slots.
function boosters(meals, pref) {
  const ids = [
    'm-whey-shake', 'm-boiled-eggs', 'm-paneer-skewers', 'm-yogurt-parfait',
    'm-pb-banana-toast', 'm-banana-oat-shake', 'm-dry-fruit-bowl', 'm-fruit-bowl', 'm-sattu-drink'
  ];
  return ids
    .map((id) => meals.find((m) => m.id === id))
    .filter((m) => m && dietAllows(pref, m.diet));
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * @param {Array} meals menu (data/meals.json)
 * @param {Object} opts { kcal, protein, diet: 'veg'|'egg'|'nonveg', days, seed }
 * @returns {{days: Array, weeklyPrice: number}}
 */
function generatePlan(meals, opts) {
  const kcal = Number(opts.kcal);
  const protein = Number(opts.protein);
  const diet = ['veg', 'egg', 'nonveg'].includes(opts.diet) ? opts.diet : 'nonveg';
  const nDays = Math.min(Math.max(Number(opts.days) || 7, 1), 28);
  if (!kcal || kcal < 1000 || kcal > 6000) throw new Error('kcal target out of range (1000–6000)');
  if (!protein || protein < 20 || protein > 400) throw new Error('protein target out of range (20–400 g)');

  const rng = mulberry32(Number(opts.seed) || 42);
  const days = [];
  let recent = []; // meal ids used in the previous 2 days

  for (let d = 0; d < nDays; d++) {
    const dayMeals = [];
    const usedToday = [];

    for (const slot of SLOT_ORDER) {
      const meal = pickForSlot(
        meals, slot,
        kcal * SLOT_SPLIT[slot],
        protein * SLOT_SPLIT[slot],
        diet, recent, usedToday, rng
      );
      if (meal) {
        dayMeals.push({ ...meal, slot });
        usedToday.push(meal.id);
      }
    }

    // Close gaps: add boosters while we're meaningfully short on protein or calories.
    // Protein gaps pick the highest-protein fit; calorie gaps pick the biggest fit.
    let t = totals(dayMeals);
    const pool = boosters(meals, diet);
    let guard = 0;
    while (guard++ < 6 && (protein - t.protein > 15 || kcal - t.kcal > 200)) {
      const needProtein = protein - t.protein > 15;
      const fits = pool.filter(
        (b) => !usedToday.includes(b.id) && t.kcal + b.kcal <= kcal + 180 &&
          (!needProtein || b.protein >= 10)
      );
      if (fits.length === 0) break;
      const pick = fits.reduce((best, b) =>
        (needProtein ? b.protein > best.protein : b.kcal > best.kcal) ? b : best
      );
      dayMeals.push({ ...pick, slot: 'add-on' });
      usedToday.push(pick.id);
      t = totals(dayMeals);
    }

    days.push({
      day: d + 1,
      meals: dayMeals.map((m) => ({
        id: m.id, slot: m.slot, name: m.name, desc: m.desc, diet: m.diet,
        kcal: m.kcal, protein: m.protein, carbs: m.carbs, fat: m.fat,
        fiber: m.fiber, price: m.price
      })),
      totals: {
        kcal: Math.round(t.kcal),
        protein: Math.round(t.protein),
        carbs: Math.round(t.carbs),
        fat: Math.round(t.fat),
        fiber: Math.round(t.fiber * 10) / 10,
        price: t.price
      }
    });

    recent = usedToday.concat(recent).slice(0, 8);
  }

  const totalPrice = days.reduce((s, d) => s + d.totals.price, 0);
  return { targets: { kcal, protein }, diet, days, totalPrice };
}

module.exports = { generatePlan, dietAllows, SLOT_SPLIT };
