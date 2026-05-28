import { Directory, File, Paths } from 'expo-file-system';
import type { CaptureSource, ExtractionResult } from '../types/extraction';
import { formatConnectionNote, formatMarkdownNote } from './markdown';
import { shouldWriteMarkdown } from './vaultPolicy';

const BASE_FOLDERS = [
  'Inbox',
  'Daily',
  'Memory',
  'Projects',
  'Areas',
  'People',
  'Ideas',
  'Tasks',
  'Decisions',
  'Resources',
  'Archive',
];

function safeName(value: string): string {
  const cleaned = value
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '')
    .replace(/\s+/g, ' ');
  return cleaned.slice(0, 80) || 'Untitled';
}

export function initializeVault(): Directory {
  const vault = new Directory(Paths.document, 'vault');
  vault.create({ idempotent: true, intermediates: true });
  for (const folder of BASE_FOLDERS) {
    new Directory(vault, folder).create({ idempotent: true, intermediates: true });
  }
  return vault;
}

function makeDynamicFolders(vault: Directory, result: ExtractionResult): void {
  new Directory(vault, 'Memory', 'Connections').create({ idempotent: true, intermediates: true });
  new Directory(vault, 'Memory', 'Interests').create({ idempotent: true, intermediates: true });
  for (const project of result.projects) {
    new Directory(vault, 'Projects', safeName(project)).create({ idempotent: true, intermediates: true });
  }
  for (const area of result.areas) {
    new Directory(vault, 'Areas', safeName(area)).create({ idempotent: true, intermediates: true });
  }
}

export function writeVaultNote(
  captureId: number,
  result: ExtractionResult,
  originalInput: string,
  source: CaptureSource,
  capturedAt: string,
): string | null {
  if (!shouldWriteMarkdown(result)) {
    return null;
  }
  const vault = initializeVault();
  makeDynamicFolders(vault, result);
  const createdAt = capturedAt.includes('T') ? capturedAt : `${capturedAt.replace(' ', 'T')}Z`;
  const date = createdAt.slice(0, 10);
  const filename = `${date}-${captureId}-${safeName(result.title).replace(/\s/g, '-')}.md`;
  const note = new File(vault, 'Daily', filename);
  note.create({ overwrite: true, intermediates: true });
  note.write(formatMarkdownNote(result, originalInput, source, createdAt));
  const connection = new File(vault, 'Memory', 'Connections', filename);
  connection.create({ overwrite: true, intermediates: true });
  connection.write(formatConnectionNote(result, filename, createdAt));

  for (const person of result.people) {
    const personFile = new File(vault, 'People', `${safeName(person)}-${captureId}.md`);
    personFile.create({ overwrite: true, intermediates: true });
    personFile.write(`# ${person}\n\nMentioned in: [[${filename.replace(/\.md$/, '')}]]\n`);
  }
  return note.uri;
}
