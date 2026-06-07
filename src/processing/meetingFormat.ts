import type { MeetingSummaryRow } from '../db/meetingSummaries';

function parseArr(json: string | null): string[] {
  if (!json) return [];
  try { const v = JSON.parse(json); return Array.isArray(v) ? v : []; } catch { return []; }
}

/** Formats a stored meeting summary row as nicely structured plain text for share/copy. */
export function formatMeetingRowText(row: MeetingSummaryRow): string {
  const lines: string[] = [];
  lines.push(`📋 ${row.title}`);
  lines.push(`🕐 ${row.duration_minutes} min`);
  lines.push('');
  if (row.headline) { lines.push(row.headline); lines.push(''); }

  const decisions = parseArr(row.key_decisions);
  if (decisions.length) { lines.push('✅ Decisions'); decisions.forEach((d) => lines.push(`  • ${d}`)); lines.push(''); }

  const actions = row.action_items ? (() => { try { return JSON.parse(row.action_items) as Array<{ task: string; owner?: string; deadline?: string }>; } catch { return []; } })() : [];
  if (actions.length) {
    lines.push('📌 Action Items');
    actions.forEach((a) => lines.push(`  • ${a.task}${a.owner ? ` → ${a.owner}` : ''}${a.deadline ? ` · ${a.deadline}` : ''}`));
    lines.push('');
  }

  const questions = parseArr(row.open_questions);
  if (questions.length) { lines.push('❓ Open Questions'); questions.forEach((q) => lines.push(`  • ${q}`)); lines.push(''); }

  if (row.next_steps) { lines.push('➡️ Next Steps'); lines.push(`  ${row.next_steps}`); lines.push(''); }

  const attendees = parseArr(row.attendees);
  if (attendees.length) lines.push(`👥 Mentioned: ${attendees.join(', ')}`);

  lines.push('');
  lines.push('— Summarized by LUCY');
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}
