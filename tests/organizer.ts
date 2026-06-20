/* Pure tests for the knowledge-graph projection (honest co-occurrence edges).
   Run: npx tsx tests/organizer.ts */
import { deriveKnowledgeProjection } from '../src/processing/knowledgeProjection';
import type { ExtractionEvidenceRow } from '../src/db/extractions';

let pass = 0, fail = 0;
function ok(name: string, cond: boolean) { if (cond) { pass++; } else { fail++; console.error('FAIL:', name); } }

// Build an evidence row. Only projects/areas/people/interests matter to the projection.
const ev = (
  capture_id: number,
  o: { projects?: string[]; areas?: string[]; people?: string[]; interests?: string[] },
): ExtractionEvidenceRow => ({
  capture_id,
  privacy_level: 'normal',
  structured_json: JSON.stringify({
    projects: o.projects ?? [], areas: o.areas ?? [], people: o.people ?? [],
    interests: (o.interests ?? []).map((topic) => ({ topic })),
  }),
} as ExtractionEvidenceRow);

// 1) NO fabricated relationship verbs — every edge is honest co-occurrence "appears with".
{
  const { connections } = deriveKnowledgeProjection([
    ev(1, { projects: ['Lucy'], areas: ['Health'], people: ['Priya'], interests: ['running'] }),
  ]);
  ok('every relation is "appears with"', connections.length > 0 && connections.every((c) => c.relation === 'appears with'));
  ok('no legacy verbs leak', !connections.some((c) => /involves|belongs to|connected through|relates to|includes/.test(c.relation)));
}

// 2) Structural type pairs survive a SINGLE shared capture (density preserved).
{
  const { connections } = deriveKnowledgeProjection([ev(1, { projects: ['Lucy'], people: ['Priya'] })]);
  ok('project+person edge from 1 capture (structural)', connections.length === 1);
  ok('edge carries evidence count 1 + emerging', connections[0]?.evidenceCount === 1 && connections[0]?.confidence === 'emerging');
}

// 3) Loose pairs (project+interest) need 2+ co-occurrences before they become an edge.
{
  const one = deriveKnowledgeProjection([ev(1, { projects: ['Lucy'], interests: ['running'] })]);
  ok('project+interest from 1 capture → no edge', one.connections.length === 0);
  const two = deriveKnowledgeProjection([
    ev(1, { projects: ['Lucy'], interests: ['running'] }),
    ev(2, { projects: ['Lucy'], interests: ['running'] }),
  ]);
  ok('project+interest from 2 captures → 1 edge', two.connections.length === 1);
  ok('that edge is supported (2 evidence)', two.connections[0]?.confidence === 'supported');
}

// 4) area+interest is also loose (2+), person+interest is structural (1+).
{
  const areaInterest = deriveKnowledgeProjection([ev(1, { areas: ['Health'], interests: ['running'] })]);
  ok('area+interest from 1 capture → no edge', areaInterest.connections.length === 0);
  const personInterest = deriveKnowledgeProjection([ev(1, { people: ['Priya'], interests: ['running'] })]);
  ok('person+interest from 1 capture → 1 edge (structural)', personInterest.connections.length === 1);
}

// 5) explanation tells the literal truth, with correct singular/plural.
{
  const one = deriveKnowledgeProjection([ev(1, { projects: ['Lucy'], people: ['Priya'] })]);
  ok('explanation singular', one.connections[0]?.explanation === 'Seen together in 1 remembered thought.');
  const two = deriveKnowledgeProjection([
    ev(1, { projects: ['Lucy'], people: ['Priya'] }),
    ev(2, { projects: ['Lucy'], people: ['Priya'] }),
  ]);
  ok('explanation plural', two.connections[0]?.explanation === 'Seen together in 2 remembered thoughts.');
}

// 6) entities are typed + counted.
{
  const { entities } = deriveKnowledgeProjection([
    ev(1, { projects: ['Lucy'] }), ev(2, { projects: ['Lucy'] }), ev(3, { projects: ['Lucy'] }),
  ]);
  const lucy = entities.find((e) => e.name === 'Lucy');
  ok('entity Lucy is a project', lucy?.entityType === 'project');
  ok('entity confirmed after 3 evidence', lucy?.confidence === 'confirmed');
}

console.log(`\norganizer: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
