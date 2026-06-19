/* Pure tests for the trip co-pilot detector. Run: npx tsx tests/trip.ts */
import { detectTrip, tripPlan, TRIP_CHECKLIST } from '../src/processing/trip';

let pass = 0, fail = 0;
function ok(name: string, cond: boolean) { if (cond) { pass++; } else { fail++; console.error('FAIL:', name); } }

const DAY = 86_400_000;
const now = new Date(2026, 5, 19, 12, 0, 0).getTime(); // Fri Jun 19 2026

// ── detectTrip ──────────────────────────────────────────────────────────────────
const a = detectTrip('Flying to Chicago next Friday for the conference.', now);
ok('detects a flight', !!a);
ok('captures destination Chicago', a?.destination === 'Chicago');
ok('captures a departure date', !!a && a.dates.some((d) => d.label === 'Departure' && !!d.dueISO));

const b = detectTrip('Trip to New York, leaving on Aug 12.', now);
ok('two-word destination', b?.destination === 'New York');
ok('departure parses a month date', !!b && b.dates.some((d) => d.label === 'Departure' && !!d.dueISO));

const c = detectTrip('Visiting Boston on Monday, flying back on Thursday.', now);
ok('visiting → destination', c?.destination === 'Boston');
ok('has a return date', !!c && c.dates.some((d) => d.label === 'Return' && !!d.dueISO));

ok('booked a hotel is a trip (no destination)', (() => { const s = detectTrip('Booked the hotel for the work trip.', now); return !!s && s.destination === null; })());
ok('itinerary phrasing detected', !!detectTrip('Finalised the itinerary for the holiday in Goa.', now));

// negatives — no false trips
ok('going to the gym is not a trip', detectTrip('Going to the gym after work.', now) === null);
ok('booked a table is not a trip', detectTrip('Booked a table at the new restaurant.', now) === null);
ok('plain note is not a trip', detectTrip('Had a long call about the budget.', now) === null);
ok('empty is null', detectTrip('', now) === null);

// ── checklist + plan ──────────────────────────────────────────────────────────────
ok('checklist has the standard steps', TRIP_CHECKLIST.length >= 8);
ok('checklist includes check-in', TRIP_CHECKLIST.some((s) => /check in online/i.test(s.task)));
ok('checklist ends at leave-for-airport (offset 0)', TRIP_CHECKLIST.some((s) => s.offsetDays === 0 && /airport/i.test(s.task)));

const depart = new Date(now + 20 * DAY).toISOString();
const plan = tripPlan(depart, now);
ok('plan has one dated step per checklist item', plan.length === TRIP_CHECKLIST.length);
ok('plan preserves order', plan[0].task === TRIP_CHECKLIST[0].task);
ok('no plan step lands in the past', plan.every((p) => Date.parse(p.dueISO) >= now));
ok('leave-for-airport lands on departure', Math.abs(Date.parse(plan[plan.length - 1].dueISO) - (now + 20 * DAY)) < DAY);
ok('invalid departure → empty plan', tripPlan('nope').length === 0);

console.log(`\ntrip: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
