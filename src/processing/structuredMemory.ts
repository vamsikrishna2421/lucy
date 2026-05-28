import type { ExtractionResult } from '../types/extraction';

function sentenceList(values: string[]): string {
  return values.filter(Boolean).join('; ');
}

export function formatStructuredMemory(result: ExtractionResult): string {
  const lines = [`Title: ${result.title}`];
  if (result.summary.trim()) {
    lines.push(`Summary: ${result.summary.trim()}`);
  }
  lines.push(`Type: ${result.note_type}`);
  const context = [
    result.projects.length ? `Project: ${sentenceList(result.projects)}` : '',
    result.areas.length ? `Area: ${sentenceList(result.areas)}` : '',
    result.people.length ? `People: ${sentenceList(result.people)}` : '',
  ].filter(Boolean);
  if (context.length) {
    lines.push(context.join(' | '));
  }
  if (result.tasks.length) {
    lines.push(`Actions: ${sentenceList(result.tasks.map((task) => `${task.task} [${task.urgency}]`))}`);
  }
  if (result.reminders.length) {
    lines.push(`Reminders: ${sentenceList(result.reminders.map((reminder) => `${reminder.text} [${reminder.time ?? 'time unspecified'}]`))}`);
  }
  if (result.expenses.length) {
    lines.push(`Expenses: ${sentenceList(result.expenses.map((expense) => `${expense.amount} - ${expense.description}`))}`);
  }
  if (result.decisions.length) {
    lines.push(`Decisions: ${sentenceList(result.decisions)}`);
  }
  if (result.ideas.length) {
    lines.push(`Ideas: ${sentenceList(result.ideas.map((idea) => `${idea.title}: ${idea.description}`))}`);
  }
  return lines.join('\n');
}
