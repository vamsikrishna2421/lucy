/* Pure tests for trip enrichment. Run: npx tsx tests/tripEnrichment.ts */
import { enrichTrip } from '../src/processing/tripEnrichment';

let pass = 0, fail = 0;
function ok(name: string, cond: boolean) { if (cond) { pass++; } else { fail++; console.error('FAIL:', name); } }

// People co-mentioned with the destination are surfaced; unrelated people are not.
{
  const e = enrichTrip({
    destination: 'Chicago',
    captures: ['Meeting Priya in Chicago next month', 'Lunch with Raj about the budget'],
    people: ['Priya', 'Raj', 'Meera'],
    vault: [],
  });
  ok('Priya (co-mentioned) surfaced', e.peopleToSee.includes('Priya'));
  ok('Raj (different capture) not surfaced', !e.peopleToSee.includes('Raj'));
  ok('Meera (never mentioned) not surfaced', !e.peopleToSee.includes('Meera'));
}

// Word-boundary: destination "Goa" must not match "Goal"; person "Al" must not match "always".
{
  const e = enrichTrip({
    destination: 'Goa',
    captures: ['My goal is to always plan ahead'],
    people: ['Al'],
    vault: [],
  });
  ok('no false person match on substring', e.peopleToSee.length === 0);
}

// Bookings that name the destination are surfaced; unrelated docs are not.
{
  const e = enrichTrip({
    destination: 'Chicago',
    captures: [],
    people: [],
    vault: [
      { title: 'United flight to Chicago', bucket: 'Travel' },
      { title: 'Marriott Chicago confirmation', bucket: 'Travel', keywords: 'hotel reservation' },
      { title: 'Electricity bill', bucket: 'Bills' },
      { title: 'Old Boston hotel', bucket: 'Travel' },
    ],
  });
  ok('flight to Chicago surfaced', e.bookings.includes('United flight to Chicago'));
  ok('Chicago hotel surfaced', e.bookings.includes('Marriott Chicago confirmation'));
  ok('unrelated bill not surfaced', !e.bookings.includes('Electricity bill'));
  ok('different-city travel doc not surfaced', !e.bookings.includes('Old Boston hotel'));
}

// Destination found in description/keywords, not just title.
{
  const e = enrichTrip({
    destination: 'Goa',
    captures: [],
    people: [],
    vault: [{ title: 'Hotel confirmation', description: 'Beach resort in Goa, 3 nights', bucket: 'Travel' }],
  });
  ok('match in description', e.bookings.includes('Hotel confirmation'));
}

// No destination → nothing surfaced (we never guess).
{
  const e = enrichTrip({
    destination: null,
    captures: ['Meeting Priya somewhere'],
    people: ['Priya'],
    vault: [{ title: 'Some flight', bucket: 'Travel' }],
  });
  ok('no destination → no people', e.peopleToSee.length === 0);
  ok('no destination → no bookings', e.bookings.length === 0);
}

// Caps + dedup.
{
  const e = enrichTrip({
    destination: 'Paris',
    captures: ['Paris with Alice', 'Paris with Bob', 'Paris with Carol', 'Paris with Dave', 'Paris with Eve', 'Paris with Frank'],
    people: ['Alice', 'Bob', 'Carol', 'Dave', 'Eve', 'Frank'],
    vault: [],
  }, 5);
  ok('people capped at 5', e.peopleToSee.length === 5);
}

console.log(`\ntripEnrichment: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
