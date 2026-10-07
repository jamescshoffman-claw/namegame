#!/usr/bin/env node
// Reports how many programmed days namegame.fun has left before the schedule
// starts repeating. Reads public/js/data.js directly, so it is always in sync
// with what is deployed from this checkout.
//
//   node tools/schedule-status.mjs          -> human-readable
//   node tools/schedule-status.mjs --json   -> {"value":..,"hint":..,...} for the Agent Hub
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, '..', 'public', 'js', 'data.js'), 'utf8');
const GameData = vm.runInNewContext(src + '\n;GameData', { Date, Set, Math });

const { SCHEDULE, EPOCH, CATEGORIES } = GameData;
const today = GameData.dayIndex();                 // 0-based day index for today
const lastProgrammed = SCHEDULE.length - 1;        // last index with a hand-picked triple
const daysLeft = lastProgrammed - today;           // 0 = today is the last fresh day
const dateFor = i => { const d = new Date(EPOCH); d.setDate(d.getDate() + i); return d; };
const fmt = d => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

const used = new Set(SCHEDULE.flat());
const unused = Object.keys(CATEGORIES).filter(k => !used.has(k));
const todays = SCHEDULE[today % SCHEDULE.length];

const out = {
  todayIndex: today,
  todayDay: today + 1,
  programmedDays: SCHEDULE.length,
  daysLeft,
  lastFreshDate: fmt(dateFor(lastProgrammed)),
  repeatingSince: daysLeft < 0 ? fmt(dateFor(lastProgrammed + 1)) : null,
  todaysCategories: todays.map(k => CATEGORIES[k].title),
  todaysIsRepeat: today > lastProgrammed,
  categoryCount: Object.keys(CATEGORIES).length,
  unusedCategories: unused,
};

if (process.argv.includes('--json')) {
  const value = daysLeft >= 0 ? daysLeft : `${-daysLeft} over`;
  const hint = daysLeft >= 0
    ? `fresh through ${out.lastFreshDate}`
    : `repeating since ${out.repeatingSince}`;
  console.log(JSON.stringify({ value, hint, ...out }));
} else {
  console.log(`Today is day ${out.todayDay} (index ${today}). Programmed: ${SCHEDULE.length} days.`);
  if (daysLeft >= 0) console.log(`${daysLeft} fresh day(s) left; last fresh day is ${out.lastFreshDate}.`);
  else console.log(`OUT OF CATEGORIES: repeating since ${out.repeatingSince} (${-daysLeft} days ago).`);
  console.log(`Today's triple${out.todaysIsRepeat ? ' (a repeat)' : ''}: ${out.todaysCategories.join(' / ')}`);
  console.log(`${out.categoryCount} categories defined, ${unused.length} never scheduled: ${unused.join(', ') || 'none'}`);
}
