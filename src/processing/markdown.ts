import type { CaptureSource, ExtractionResult } from '../types/extraction';

function yamlString(value: string): string {
  return JSON.stringify(value);
}

function yamlList(items: string[]): string {
  return `[${items.map(yamlString).join(', ')}]`;
}

function listSection(values: string[], emptyText = 'None captured.'): string {
  return values.length ? values.map((value) => `- ${value}`).join('\n') : emptyText;
}

export function formatMarkdownNote(
  result: ExtractionResult,
  originalInput: string,
  source: CaptureSource,
  createdAt: string,
): string {
  return `---
title: ${yamlString(result.title)}
created_at: ${yamlString(createdAt)}
note_type: ${yamlString(result.note_type)}
detected_language: ${yamlString(result.detected_language)}
privacy_level: ${yamlString(result.privacy_level)}
projects: ${yamlList(result.projects)}
areas: ${yamlList(result.areas)}
people: ${yamlList(result.people)}
tags: ${yamlList(result.tags)}
source: ${yamlString(source)}
status: "processed"
---

# Summary

${result.summary}

# Original Input

${originalInput}

# Tasks

${listSection(result.tasks.map((task) => `${task.task} (${task.urgency}; ${task.category})`))}

# Expenses

${listSection(result.expenses.map((expense) => `${expense.amount} - ${expense.description} (${expense.category})`))}

# Ideas

${listSection(result.ideas.map((idea) => `${idea.title}: ${idea.description}`))}

# Decisions

${listSection(result.decisions)}

# Reminders

${listSection(result.reminders.map((reminder) => `${reminder.text} - ${reminder.time ?? 'no time'} (${reminder.urgency})`))}

# Places

${listSection(result.places.map((place) => `${place.name}: ${place.reason} (${place.urgency})`))}

# Interests

${listSection(result.interests.map((interest) => `${interest.topic} (${interest.strength}): ${interest.evidence}`))}

# Related Links

None captured.

# Suggested Next Actions

${listSection(result.tasks.map((task) => task.task))}
`;
}

function wikiLink(path: string, label: string): string {
  return `[[${path}|${label}]]`;
}

function safeWikiSegment(value: string): string {
  return value
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '')
    .replace(/\s+/g, ' ')
    .slice(0, 80) || 'Untitled';
}

export function formatConnectionNote(
  result: ExtractionResult,
  dailyFilename: string,
  createdAt: string,
): string {
  const memoryName = dailyFilename.replace(/\.md$/, '');
  const connections = [
    ...result.projects.map((project) => `- Project: ${wikiLink(`Projects/${safeWikiSegment(project)}/Workspace`, project)}`),
    ...result.areas.map((area) => `- Area: ${wikiLink(`Areas/${safeWikiSegment(area)}/Workspace`, area)}`),
    ...result.people.map((person) => `- Person: ${wikiLink(`People/${safeWikiSegment(person)}`, person)}`),
    ...result.interests.map((interest) => `- Interest: ${wikiLink(`Memory/Interests/${safeWikiSegment(interest.topic)}`, interest.topic)}`),
    ...result.tasks.map((task) => `- Action: ${task.task}`),
    ...result.decisions.map((decision) => `- Decision: ${decision}`),
  ];
  return `---
title: ${yamlString(`Connections - ${result.title}`)}
created_at: ${yamlString(createdAt)}
type: "connection-map"
privacy_level: ${yamlString(result.privacy_level)}
---

# Connected Memory

Source thought: ${wikiLink(`Daily/${memoryName}`, result.title)}

## Connections

${connections.length ? connections.join('\n') : '- No stable connections identified yet.'}

## Why This Exists

This is LUCY's readable connection trail for Obsidian graph view. The encrypted local memory remains the source of truth.
`;
}
