import type { ExtractionResult } from '../types/extraction';

type ExplicitExtraction = Partial<ExtractionResult>;

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function expenseCategory(description: string): 'food' | 'transport' | 'shopping' | 'entertainment' | 'other' {
  if (/\b(grocer(?:y|ies)|breakfast|lunch|dinner|coffee|meal|food)\b/i.test(description)) {
    return 'food';
  }
  if (/\b(auto|uber|lyft|taxi|bus|train|fuel|gas|transport)\b/i.test(description)) {
    return 'transport';
  }
  if (/\b(movie|concert|ticket|game)\b/i.test(description)) {
    return 'entertainment';
  }
  return 'other';
}

export function extractExplicitEnglishFact(transcript: string): ExplicitExtraction | null {
  const scopedProjectTask = transcript.match(
    /^\s*for\s+(.+?)\s+project\s+(.+?),\s*i\s+(?:need|have)\s+to\s+(.+?)[.!?]?\s*$/i,
  );
  if (scopedProjectTask) {
    const area = capitalize(scopedProjectTask[1].trim());
    const project = capitalize(scopedProjectTask[2].trim());
    const task = capitalize(scopedProjectTask[3].trim());
    return {
      title: task,
      summary: transcript.trim(),
      note_type: 'task',
      detected_language: 'english',
      projects: [project],
      areas: [area],
      tasks: [{
        task,
        category: 'other',
        urgency: /\b(today|tonight|urgent|now|deadline)\b/i.test(task) ? 'high' : 'medium',
        context: area,
      }],
    };
  }

  const scopedTask = transcript.match(
    /^\s*for\s+(.+?),\s*i\s+(?:need|have)\s+to\s+(.+?)[.!?]?\s*$/i,
  );
  if (scopedTask) {
    const area = capitalize(scopedTask[1].trim());
    const task = capitalize(scopedTask[2].trim());
    return {
      title: task,
      summary: transcript.trim(),
      note_type: 'task',
      detected_language: 'english',
      areas: [area],
      tasks: [{
        task,
        category: 'other',
        urgency: /\b(today|tonight|urgent|now|deadline)\b/i.test(task) ? 'high' : 'medium',
        context: area,
      }],
    };
  }

  const projectRelationship = transcript.match(
    /^\s*project\s+(.+?)\s+involves\s+(.+?)\s+in\s+(?:the\s+)?(.+?)(?:\s+area)?[.!?]?\s*$/i,
  );
  if (projectRelationship) {
    const project = capitalize(projectRelationship[1].trim());
    const person = capitalize(projectRelationship[2].trim());
    const area = capitalize(projectRelationship[3].trim());
    return {
      title: `${project} project context`,
      summary: transcript.trim(),
      note_type: 'project_update',
      detected_language: 'english',
      projects: [project],
      people: [person],
      areas: [area],
    };
  }

  const paymentTask = transcript.match(/^\s*(?:i\s+)?(?:need|have)\s+to\s+pay\s+(.+?)[.!?]?\s*$/i);
  if (paymentTask) {
    const subject = paymentTask[1].trim();
    return {
      title: `Pay ${subject}`,
      summary: transcript.trim(),
      note_type: 'task',
      detected_language: 'english',
      tasks: [{
        task: `Pay ${subject}`,
        category: 'expense',
        urgency: /\b(today|tonight|urgent|now)\b/i.test(subject) ? 'high' : 'medium',
        context: '',
      }],
    };
  }

  const expense = transcript.match(
    /^\s*(?:i\s+)?(?:paid|spent)\s+(?:\$\s*|usd\s*)?(\d+(?:\.\d{1,2})?)\s*(?:dollars?|usd)?\s+(?:for|on)\s+(.+?)(?:\s+(?:today|yesterday|tonight))?[.!?]?\s*$/i,
  );
  if (expense) {
    const amount = expense[1];
    const description = capitalize(expense[2].trim().replace(/\s+(today|yesterday|tonight)$/i, ''));
    return {
      title: `${description} expense`,
      summary: transcript.trim(),
      note_type: 'thought',
      detected_language: 'english',
      expenses: [{ amount, description, category: expenseCategory(description) }],
    };
  }

  const decision = transcript.match(/^\s*i\s+(?:have\s+)?decided\s+to\s+(.+?)[.!?]?\s*$/i);
  if (decision) {
    const action = capitalize(decision[1].trim());
    return {
      title: `${action} decision`,
      summary: transcript.trim(),
      note_type: 'decision',
      detected_language: 'english',
      decisions: [action],
    };
  }

  return null;
}
