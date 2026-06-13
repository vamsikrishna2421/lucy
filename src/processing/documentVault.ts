/**
 * Document Vault — persistent, on-device document library.
 *
 * Unlike LUCY Lens (which extracts a memory and DELETES the image), the vault is for
 * documents the user deliberately keeps: ID cards, certificates, receipts, important
 * papers. Images are stored in the app's PRIVATE sandbox (documentDirectory/docvault/) —
 * and a copy is saved to Photos when requested. LUCY classifies each into a bucket and
 * writes a searchable description. Only the description leaves the device (via the same
 * vision model Lens already uses).
 */
import { readAsStringAsync, writeAsStringAsync, EncodingType, deleteAsync, makeDirectoryAsync, getInfoAsync, documentDirectory } from 'expo-file-system/legacy';
import type { SQLiteDatabase } from 'expo-sqlite';
import { enqueueTranscript } from './extract';
import { resolveRemoteAvailability } from '../ai/provider';
import { isAiCallCapReached, recordAiCall } from '../ai/rateLimit';
import { getDatabase } from '../db';

/** The default buckets LUCY classifies into; the user can re-file to any custom name. */
export const VAULT_BUCKETS = ['ID & Cards', 'Certificates', 'Financial', 'Medical', 'Travel', 'Receipts', 'Notes', 'Other'] as const;

export interface VaultItem {
  id: number;
  created_at: string;
  title: string | null;
  description: string | null;
  bucket: string;
  file_path: string | null;
  thumb: string | null;
  mime: string;
  gallery_saved: number;
  source: string;
}

const VAULT_SYSTEM = `You are LUCY, filing a document into the user's personal vault.
Look at the image and return JSON only:
{"title":"short human title (e.g. 'Aadhaar card', 'AWS certificate', 'Electricity bill Mar')",
 "bucket":"one of: ID & Cards | Certificates | Financial | Medical | Travel | Receipts | Notes | Other",
 "description":"a concise, searchable description. Extract key text verbatim — names, ID numbers, dates, amounts, issuer. Plain text, no markdown."}
Pick the single best bucket. Be specific in the title so the user can find it later.`;

const VAULT_DIR = `${documentDirectory}docvault/`;

async function ensureVaultDir(): Promise<void> {
  try {
    const info = await getInfoAsync(VAULT_DIR);
    if (!info.exists) await makeDirectoryAsync(VAULT_DIR, { intermediates: true });
  } catch { /* best effort */ }
}

/** Vision classification for the vault (separate prompt from Lens; same OpenAI vision path). */
async function classify(base64: string, hint: string): Promise<{ title: string; bucket: string; description: string } | null> {
  try {
    const db = await getDatabase();
    const { available, openAIKey } = await resolveRemoteAvailability();
    if (!available || await isAiCallCapReached(db)) return null;
    const isOpenAI = !(await import('../ai/modelPreference').then((m) =>
      m.getPreferredModel(require('../config').config.openAIModel))).startsWith('claude-');
    const apiKey = isOpenAI ? openAIKey : await import('../ai/remoteAccess').then((m) => m.getRemoteOpenAIKey());
    if (!apiKey) return null;
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        max_tokens: 500,
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: `${VAULT_SYSTEM}\n\nFilename hint: ${hint}` },
            { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${base64}`, detail: 'low' } },
          ],
        }],
      }),
    });
    void recordAiCall(db);
    if (!response.ok) return null;
    const json = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    const content = json.choices?.[0]?.message?.content ?? '';
    const start = content.indexOf('{'); const end = content.lastIndexOf('}');
    if (start === -1 || end === -1) return null;
    const parsed = JSON.parse(content.slice(start, end + 1)) as { title?: string; bucket?: string; description?: string };
    const bucket = (VAULT_BUCKETS as readonly string[]).includes(parsed.bucket ?? '') ? parsed.bucket! : 'Other';
    return { title: parsed.title?.trim() || hint || 'Document', bucket, description: parsed.description?.trim() || '' };
  } catch { return null; }
}

/**
 * Saves an uploaded image into the vault: classifies it, persists the full image to the
 * app sandbox, optionally copies to Photos, stores a thumbnail + row, and enqueues a
 * capture so it shows in the timeline/memory too. Deletes only the incoming temp file.
 */
export async function saveImageToVault(
  tempUri: string,
  originalName: string | null,
  thumbDataUrl: string | null,
  saveToGallery: boolean,
): Promise<VaultItem | null> {
  let base64: string;
  try { base64 = await readAsStringAsync(tempUri, { encoding: EncodingType.Base64 }); }
  catch { return null; }

  const meta = await classify(base64, originalName ?? 'document')
    ?? { title: originalName || 'Document', bucket: 'Other', description: 'Saved document (enable Remote Intelligence for auto-description).' };

  // Persist the full image into the private vault dir.
  await ensureVaultDir();
  const path = `${VAULT_DIR}doc-${Date.now()}.jpg`;
  try { await writeAsStringAsync(path, base64, { encoding: EncodingType.Base64 }); }
  catch { return null; }

  // Optionally copy into the device photo gallery (best-effort; needs permission once).
  let gallerySaved = 0;
  if (saveToGallery) {
    try {
      const MediaLibrary = await import('expo-media-library/legacy');
      const perm = await MediaLibrary.requestPermissionsAsync();
      if (perm.status === 'granted') { await MediaLibrary.saveToLibraryAsync(path); gallerySaved = 1; }
    } catch { /* keep the sandbox copy regardless */ }
  }

  const db = await getDatabase();
  const res = await db.runAsync(
    `INSERT INTO vault_items (title, description, bucket, file_path, thumb, mime, gallery_saved, source)
     VALUES (?, ?, ?, ?, ?, 'image/jpeg', ?, 'upload')`,
    meta.title, meta.description, meta.bucket, path, thumbDataUrl ?? null, gallerySaved,
  );

  // Also enqueue a capture so the document is part of the searchable memory/timeline.
  try { await enqueueTranscript(`[Document · ${meta.bucket}] ${meta.title}${meta.description ? ` — ${meta.description}` : ''}`, 'text', false); }
  catch { /* non-fatal */ }

  // Remove the incoming temp file (the persisted copy lives in VAULT_DIR).
  deleteAsync(tempUri, { idempotent: true }).catch(() => {});

  return db.getFirstAsync<VaultItem>('SELECT * FROM vault_items WHERE id = ?', res.lastInsertRowId);
}

export async function listVaultItems(db: SQLiteDatabase): Promise<VaultItem[]> {
  return db.getAllAsync<VaultItem>('SELECT * FROM vault_items ORDER BY created_at DESC');
}

/** Reads the full image off disk as a base64 data URL for the viewer. */
export async function getVaultImage(db: SQLiteDatabase, id: number): Promise<string | null> {
  const row = await db.getFirstAsync<VaultItem>('SELECT file_path, mime FROM vault_items WHERE id = ?', id);
  if (!row?.file_path) return null;
  try {
    const b64 = await readAsStringAsync(row.file_path, { encoding: EncodingType.Base64 });
    return `data:${row.mime || 'image/jpeg'};base64,${b64}`;
  } catch { return null; }
}

export async function refileVaultItem(db: SQLiteDatabase, id: number, bucket: string): Promise<void> {
  await db.runAsync('UPDATE vault_items SET bucket = ? WHERE id = ?', bucket.trim() || 'Other', id);
}

export async function deleteVaultItem(db: SQLiteDatabase, id: number): Promise<void> {
  const row = await db.getFirstAsync<VaultItem>('SELECT file_path FROM vault_items WHERE id = ?', id);
  if (row?.file_path) deleteAsync(row.file_path, { idempotent: true }).catch(() => {});
  await db.runAsync('DELETE FROM vault_items WHERE id = ?', id);
}
