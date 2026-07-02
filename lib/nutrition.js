'use strict';

// Nutrition engine: BMR (Mifflin-St Jeor), TDEE, goal-adjusted calorie and
// macro targets. All weights in kg, heights in cm, energy in kcal.

const ACTIVITY_LEVELS = {
  sedentary: { factor: 1.2, label: 'Sedentary (desk job, no workout)' },
  light: { factor: 1.375, label: 'Light (gym 1-3 days/week)' },
  moderate: { factor: 1.55, label: 'Moderate (gym 3-5 days/week)' },
  active: { factor: 1.725, label: 'Active (gym 6-7 days/week)' },
  athlete: { factor: 1.9, label: 'Athlete (2x training/physical job)' }
};

const KCAL_PER_KG_BODYWEIGHT = 7700;

function bmr({ gender, weightKg, heightCm, age }) {
  const base = 10 * weightKg + 6.25 * heightCm - 5 * age;
  return gender === 'female' ? base - 161 : base + 5;
}

// goal: 'lose' | 'maintain' | 'gain'; rateKgPerWeek: desired change speed (0.25–1)
function targetsFromStats(input) {
  const { gender = 'male', age, heightCm, weightKg, activity = 'moderate', goal = 'maintain' } = input;
  const rate = Math.min(Math.max(Number(input.rateKgPerWeek) || 0.5, 0.25), 1);

  if (!age || !heightCm || !weightKg) {
    throw new Error('age, heightCm and weightKg are required');
  }
  if (age < 14 || age > 90 || heightCm < 120 || heightCm > 230 || weightKg < 30 || weightKg > 250) {
    throw new Error('Please enter realistic age, height and weight values');
  }

  const level = ACTIVITY_LEVELS[activity] || ACTIVITY_LEVELS.moderate;
  const basal = Math.round(bmr({ gender, weightKg, heightCm, age }));
  const tdee = Math.round(basal * level.factor);

  const dailyDelta = Math.round((rate * KCAL_PER_KG_BODYWEIGHT) / 7);
  let kcal = tdee;
  if (goal === 'lose') kcal = tdee - dailyDelta;
  if (goal === 'gain') kcal = tdee + dailyDelta;

  // Never prescribe below a safe floor.
  const floor = Math.max(gender === 'female' ? 1200 : 1500, Math.round(basal * 0.85));
  if (kcal < floor) kcal = floor;

  // Protein per kg bodyweight by goal (g/kg): cutting needs more to hold muscle.
  const proteinPerKg = goal === 'lose' ? 2.0 : goal === 'gain' ? 1.8 : 1.6;
  const protein = Math.round(proteinPerKg * weightKg);
  const fat = Math.round((kcal * 0.25) / 9);
  const carbs = Math.max(0, Math.round((kcal - protein * 4 - fat * 9) / 4));
  const fiber = Math.round((kcal / 1000) * 14);

  return {
    bmr: basal,
    tdee,
    activityLabel: level.label,
    goal,
    rateKgPerWeek: rate,
    kcal,
    protein,
    carbs,
    fat,
    fiber,
    waterLitres: Math.round((weightKg * 0.033) * 10) / 10
  };
}

// Direct mode: user states calories (and optionally protein).
function targetsDirect(input) {
  const kcal = Math.round(Number(input.kcal));
  if (!kcal || kcal < 1000 || kcal > 6000) {
    throw new Error('Calorie target must be between 1000 and 6000 kcal');
  }
  let protein = Math.round(Number(input.protein) || 0);
  if (!protein) protein = Math.round((kcal * 0.25) / 4); // default 25% of energy
  const maxProtein = Math.round((kcal * 0.45) / 4);
  if (protein > maxProtein) protein = maxProtein;

  const fat = Math.round((kcal * 0.25) / 9);
  const carbs = Math.max(0, Math.round((kcal - protein * 4 - fat * 9) / 4));
  return {
    kcal,
    protein,
    carbs,
    fat,
    fiber: Math.round((kcal / 1000) * 14),
    mode: 'direct'
  };
}

module.exports = { ACTIVITY_LEVELS, bmr, targetsFromStats, targetsDirect };
