/** Knowledge tool — the user's brain graph: top entities + how they connect. Wraps the KG listers. */
import type { LucyTool } from '../types';

export const knowledgeTool: LucyTool = {
  name: 'knowledge',
  description: "The user's knowledge graph — recurring topics/projects/people and how they connect ('what am I connected to', 'what keeps coming up', 'how does X relate to Y', 'what's my brain map'). For structural/relationship questions across their memory.",
  async run(ctx, args) {
    void args;
    const { listKnowledgeEntities, listKnowledgeConnections } = await import('../../../db/knowledge');
    const [entities, connections] = await Promise.all([
      listKnowledgeEntities(ctx.db).catch(() => [] as Array<{ name: string; entity_type: string; evidence_count: number }>),
      listKnowledgeConnections(ctx.db).catch(() => [] as Array<{ source_name?: string; target_name?: string; relation: string }>),
    ]);
    const topEntities = [...entities].sort((a, b) => (b.evidence_count ?? 0) - (a.evidence_count ?? 0)).slice(0, 8);
    const eLine = topEntities.map((e) => `${e.name} (${e.entity_type})`).join(', ');
    const cLine = connections.slice(0, 8)
      .map((c) => (c.source_name && c.target_name ? `${c.source_name} ${c.relation} ${c.target_name}` : null))
      .filter(Boolean).join('; ');
    const prose = topEntities.length
      ? `Top in your brain: ${eLine}.${cLine ? `\nConnections: ${cLine}.` : ''}`
      : 'The knowledge graph is still building — capture more and it fills in.';
    return { kind: 'knowledge', data: { entities: topEntities.length, connections: connections.length }, prose };
  },
};
