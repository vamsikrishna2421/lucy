/**
 * Trip co-pilot ENRICHMENT — pure, deterministic, unit-tested (no DB/native imports).
 *
 * Turns the data LUCY already has into two concrete, grounded additions for a "Trip to X" project:
 *   • people to see  — known people the user has mentioned alongside the destination
 *   • saved bookings — vault documents that name the destination (flight/hotel/ticket confirmations)
 *
 * Precision over recall: we only surface a person/doc when it's clearly tied to THIS destination, so the
 * trip project never fills with noise. Empty in → empty out (the plan just omits the section).
 */
export interface TripEnrichmentInput {
  destination: string | null;
  captures: string[];   // recent capture texts (raw transcripts)
  people: string[];     // known person names
  vault: Array<{ title?: string | null; description?: string | null; keywords?: string | null; bucket?: string | null }>;
}

export interface TripEnrichment {
  peopleToSee: string[];
  bookings: string[];   // document titles
}

/** Whole-word, case-insensitive containment (so "Al" doesn't match "always", "Goa" not "Goal"). */
function mentions(haystack: string, needle: string): boolean {
  const n = needle.trim();
  if (!n) return false;
  const esc = n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\b${esc}\\b`, 'i').test(haystack);
}

export function enrichTrip(input: TripEnrichmentInput, maxPeople = 5, maxBookings = 6): TripEnrichment {
  const dest = (input.destination ?? '').trim();

  // People the user has mentioned in the SAME breath as the destination.
  const peopleToSee: string[] = [];
  if (dest) {
    const destCaptures = input.captures.filter((c) => mentions(c, dest));
    const seen = new Set<string>();
    for (const raw of input.people) {
      const name = raw.trim();
      if (!name || seen.has(name.toLowerCase())) continue;
      if (destCaptures.some((c) => mentions(c, name))) {
        peopleToSee.push(name);
        seen.add(name.toLowerCase());
        if (peopleToSee.length >= maxPeople) break;
      }
    }
  }

  // Saved documents that name the destination (their confirmations almost always do).
  const bookings: string[] = [];
  if (dest) {
    const seenDoc = new Set<string>();
    for (const v of input.vault) {
      const hay = [v.title, v.description, v.keywords, v.bucket].filter(Boolean).join(' ');
      if (!mentions(hay, dest)) continue;
      const title = (v.title ?? '').trim() || 'Saved document';
      const key = title.toLowerCase();
      if (seenDoc.has(key)) continue;
      seenDoc.add(key);
      bookings.push(title);
      if (bookings.length >= maxBookings) break;
    }
  }

  return { peopleToSee, bookings };
}
