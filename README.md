# 🥗 Tindam — Fitness Food, Delivered Daily

**Personalized Indian fitness meals on subscription.** Tell us your calorie & protein target — or just your height, weight and goal — and get a macro-counted Indian meal plan delivered fresh to your door every day. Like your milk subscription, but for your fitness diet.

## The business idea

Gym-goers know *how much* they should eat, but planning, cooking and portioning every meal, every day, is the part that fails. Delivery apps (Swiggy/Zomato) sell dishes on demand; Tindam sells **your daily nutrition target as a service**:

1. **Personalized targets** — the user enters calories/protein directly, or their body stats and goal (lose / maintain / gain). We compute BMR (Mifflin-St Jeor), TDEE, and a safe calorie + macro prescription.
2. **Indian food only** — dal khichdi, paneer bhurji, chole brown rice, boiled chicken with 300 g rice, banana oat-milk shakes, sattu coolers, seasonal fruit bowls. Healthy desi food, not international diet food.
3. **Subscription, not ordering** — pick a 1 / 2 / 4-week plan (up to 10% off), choose morning or evening delivery, and meals arrive daily. Choose tomorrow's or next week's meals in advance; change any day's meals until **8 PM the previous evening**; skip a day or pause anytime — the Country Delight model, applied to fitness food.
4. **Build your own meals** — beyond the chef's menu, users compose their own meals ingredient-by-ingredient from the full database ("200 g boiled chicken + 300 g rice + 100 g broccoli"), with macros computed live and transparent pricing (₹40 kitchen base + ₹6 per 100 kcal). Custom meals go straight into the daily box and subscription.
5. **Transparent nutrition** — an exhaustive local database of **1,034 Indian foods** with values **per 100 g / 100 ml** (calories, protein, carbs, fat, fiber, veg/egg/non-veg, seasonality). It includes the complete **IFCT 2017** (Indian Food Composition Tables, ICMR-National Institute of Nutrition — 542 lab-analyzed foods with regional names) plus ~490 curated raw foods, drinks and prepared Indian dishes.

## What's in this repo

A complete, runnable website + API with **zero external dependencies** (plain Node.js).

```
data/foods.json        Core curated foods (165 items, per-100g/100ml nutrition)
data/foods-extra.json  Curated extension (174 items: regional veg, fruits, millets…)
data/foods-extra2.json Curated prepared dishes (153 items: sabzis, dals, chaats…)
data/foods-ifct.json   Complete IFCT 2017 dataset (542 lab-analyzed foods, ICMR-NIN)
                       — 1,034 foods total
data/meals.json        41 deliverable, portioned & priced meals across 4 slots
lib/nutrition.js       BMR / TDEE / calorie & macro target engine
lib/planner.js         7-day meal plan generator (hits kcal + protein within tolerance)
lib/store.js           JSON-file store: subscriptions + custom meals (data/store/, gitignored)
server.js              HTTP server: static site + REST API
public/                The website (SPA: home, plan builder, menu, meal builder, cart,
                       nutrition DB, account) — Swiggy/Zomato-style UI
test/run-tests.js      34 tests: data integrity, engines, custom meals, cutoff rules, API
```

## Run it

```bash
node server.js        # → http://localhost:3000
npm test              # run the test suite
```

## Features implemented

- **Nutrition calculator** — two modes: direct ("3000 kcal, 160 g protein") or from body stats (gender, age, height, weight, activity level, goal, pace). Enforces safe calorie floors; scales protein per kg by goal (2.0 cut / 1.6 maintain / 1.8 bulk).
- **Meal plan generator** — fills breakfast (25%), lunch (35%), snack (15%), dinner (25%) from the menu, respecting **Pure Veg / Veg+Egg / Non-Veg** preference, avoiding repeats across days, then closes remaining calorie/protein gaps with add-on boosters (whey shake, boiled eggs, fruit & dry-fruit bowls). Deterministic per seed; one click reshuffles.
- **Custom meal builder** — search the full ingredient database, set grams/ml per ingredient, see calories/protein/carbs/fat/fiber and price update live; save it and it behaves like any menu meal (cart, subscription, account) with the veg/egg/non-veg flag derived from its ingredients. Validated server-side (known ingredients, 5–1000 g each, 50–2500 kcal total).
- **Daily box (cart)** — Swiggy-style ADD buttons and floating cart bar; the box shows daily macro meters against your targets and subscribes as a repeating daily delivery.
- **Subscription flow** — name, 10-digit phone, address, start date, delivery slot; the weekly plan or daily box is repeated across the chosen duration; pricing with 5% (2-week) / 10% (4-week) discounts.
- **Subscription management** — look up by phone; skip/unskip any upcoming day, pause/resume, cancel. The **8 PM previous-day cutoff** is enforced server-side.
- **Nutrition database explorer** — searchable, category-filterable table of all 1,034 foods with seasonal availability (mango Apr–Jul, guava Oct–Feb, bathua Nov–Feb, …). IFCT entries carry the `ifct-2017` tag and Hindi names.

## API

| Route | What it does |
|---|---|
| `GET /api/foods?q=&category=&diet=` | search the nutrition database |
| `GET /api/meals?slot=&diet=` | browse the deliverable menu |
| `POST /api/targets` | compute calorie/macro targets (stats or direct mode) |
| `POST /api/plan` | generate a multi-day meal plan for a target |
| `POST /api/custom-meals` | create a meal from raw ingredients (macros computed server-side) |
| `GET /api/custom-meals?ids=&phone=` | resolve saved custom meals |
| `POST /api/subscribe` | create a subscription |
| `GET /api/subscription?phone=` | fetch subscriptions |
| `POST /api/subscription/skip` · `/change-meals` · `/status` | manage deliveries (cutoff-checked) |

## Roadmap (next steps for the real business)

- Payments (UPI autopay mandates fit subscriptions perfectly), OTP login, delivery-area serviceability.
- Kitchen ops: daily production sheet aggregated from tomorrow's locked orders (the 8 PM cutoff exists for exactly this).
- Dietician review flow for medical conditions; renal/diabetic menu variants.
- Swap a real database (Postgres) for the JSON store; the `lib/store.js` interface is already isolated.

> Nutrition guidance here is informational, not medical advice.
