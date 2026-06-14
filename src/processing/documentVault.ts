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
  keywords: string | null;
  hash: string | null;
  file_path: string | null;
  thumb: string | null;
  mime: string;
  gallery_saved: number;
  source: string;
  orig_path?: string | null;
  orig_mime?: string | null;
}

/** Map a mime/filename to a file extension for the stored original. */
function extFor(mime: string | null | undefined, name?: string | null): string {
  const m = (mime || '').toLowerCase();
  if (m === 'application/pdf') return 'pdf';
  if (m === 'image/png') return 'png';
  if (m === 'image/jpeg' || m === 'image/jpg') return 'jpg';
  if (m === 'image/heic') return 'heic';
  if (m === 'image/webp') return 'webp';
  const ext = (name || '').split('.').pop();
  return ext && ext.length <= 5 ? ext.toLowerCase() : 'bin';
}

const VAULT_SYSTEM = `You are LUCY, filing a document into the user's personal vault.
Return JSON only:
{"title":"short specific title (e.g. 'Nokia payslip — Mar 2024', 'US visa', 'Aadhaar card')",
 "bucket":"the DOCUMENT TYPE as a concise Title-Case plural category that you invent from the document itself (e.g. Payslips, Bank Statements, Visas, Certificates, ID Cards, Insurance Policies, Medical Reports, Receipts, Tax Documents, Offer Letters). Be specific to the document — prefer 'Payslips' over a vague 'Financial'.",
 "description":"a concise, searchable description. Extract key text verbatim — names, ID numbers, dates, amounts, issuer.",
 "keywords":["6-15 lowercase search tags. ALWAYS include: the document type AND its synonyms (payslip, payslips, salary slip, salary); the organization/employer/issuer (nokia, hdfc, aws); the country inferred from currency/address/issuer (₹/PAN/Aadhaar→india, $/SSN→usa, £→uk); the year/month; any person names."]}
Be generous and specific with keywords — they power search. Return JSON only.`;

const VAULT_DIR = `${documentDirectory}docvault/`;

/** Last path segment of a stored file_path (handles old absolute paths and `/`+`\` separators). */
function vaultBasename(stored: string): string {
  const cleaned = stored.replace(/[/\\]+$/, '');
  const idx = Math.max(cleaned.lastIndexOf('/'), cleaned.lastIndexOf('\\'));
  return idx >= 0 ? cleaned.slice(idx + 1) : cleaned;
}

/**
 * Candidate absolute paths for a stored file_path. iOS changes the app container UUID on every
 * rebuild/reinstall, so an absolute `documentDirectory` path saved by a previous build goes stale.
 * Always also try rebuilding `VAULT_DIR + basename` under the CURRENT container.
 */
function vaultPathCandidates(stored: string): string[] {
  const out: string[] = [];
  if (stored) out.push(stored);
  const base = vaultBasename(stored);
  if (base) out.push(`${VAULT_DIR}${base}`);
  return Array.from(new Set(out));
}

/** Reads the vault image bytes, trying the stored path then the rebuilt current-container path. */
async function readVaultBase64(stored: string): Promise<string | null> {
  for (const p of vaultPathCandidates(stored)) {
    try { return await readAsStringAsync(p, { encoding: EncodingType.Base64 }); } catch { /* try next */ }
  }
  return null;
}

async function ensureVaultDir(): Promise<void> {
  try {
    const info = await getInfoAsync(VAULT_DIR);
    if (!info.exists) await makeDirectoryAsync(VAULT_DIR, { intermediates: true });
  } catch { /* best effort */ }
}

/** Distinct categories LUCY has already created — so it reuses them instead of fragmenting. */
async function existingBuckets(db: SQLiteDatabase): Promise<string[]> {
  try {
    const rows = await db.getAllAsync<{ bucket: string }>("SELECT DISTINCT bucket FROM vault_items WHERE bucket IS NOT NULL AND bucket != ''");
    return rows.map((r) => r.bucket);
  } catch { return []; }
}

/** Vision classification for the vault — dynamic buckets that reuse existing categories. */
async function classify(base64: string, hint: string, buckets: string[]): Promise<{ title: string; bucket: string; description: string; keywords: string } | null> {
  try {
    const db = await getDatabase();
    const { available, openAIKey } = await resolveRemoteAvailability();
    if (!available || await isAiCallCapReached(db)) return null;
    const isOpenAI = !(await import('../ai/modelPreference').then((m) =>
      m.getPreferredModel(require('../config').config.openAIModel))).startsWith('claude-');
    const apiKey = isOpenAI ? openAIKey : await import('../ai/remoteAccess').then((m) => m.getRemoteOpenAIKey());
    if (!apiKey) return null;
    const existing = buckets.length
      ? `\n\nExisting categories already in this vault — REUSE the exact name if this document belongs to one of them; only invent a new category if none fits: ${buckets.join(', ')}.`
      : '';
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        max_tokens: 500,
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: `${VAULT_SYSTEM}${existing}\n\nFilename hint: ${hint}` },
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
    const parsed = JSON.parse(content.slice(start, end + 1)) as { title?: string; bucket?: string; description?: string; keywords?: string[] };
    let bucket = (parsed.bucket || 'Documents').trim().replace(/\s+/g, ' ');
    // Reuse the existing category's exact casing if it's the same one (avoids Payslips/payslip splits).
    const dupe = buckets.find((b) => b.toLowerCase() === bucket.toLowerCase());
    if (dupe) bucket = dupe;
    const keywords = Array.isArray(parsed.keywords) ? parsed.keywords.map((k) => String(k).toLowerCase().trim()).filter(Boolean).join(', ') : '';
    return { title: parsed.title?.trim() || hint || 'Document', bucket, description: parsed.description?.trim() || '', keywords };
  } catch { return null; }
}

/**
 * Saves an uploaded image into the vault: classifies it, persists the full image to the
 * app sandbox, optionally copies to Photos, stores a thumbnail + row, and enqueues a
 * capture so it shows in the timeline/memory too. Deletes only the incoming temp file.
 */
export interface VaultSaveResult {
  duplicate?: boolean;
  existing?: { id: number; title: string | null; bucket: string } | null;
  item?: VaultItem | null;
}

export async function saveImageToVault(
  tempUri: string,
  originalName: string | null,
  thumbDataUrl: string | null,
  saveToGallery: boolean,
  hash?: string | null,
  original?: { base64: string; mime: string } | null,
): Promise<VaultSaveResult> {
  const db0 = await getDatabase();

  // Duplicate check FIRST (by content hash) — skip before spending an AI classify call.
  if (hash) {
    const existing = await db0.getFirstAsync<{ id: number; title: string | null; bucket: string; orig_path: string | null }>(
      'SELECT id, title, bucket, orig_path FROM vault_items WHERE hash = ?', hash,
    );
    if (existing) {
      // Backfill the ORIGINAL file onto a duplicate that was stored before original-retention
      // existed, so re-uploading the same doc upgrades it to native-format download (no need to
      // delete the old copy first — the hash match would otherwise just reject it).
      if (original?.base64 && !existing.orig_path) {
        try {
          await ensureVaultDir();
          const ofn = `orig-${Date.now()}.${extFor(original.mime, originalName)}`;
          await writeAsStringAsync(`${VAULT_DIR}${ofn}`, original.base64, { encoding: EncodingType.Base64 });
          await db0.runAsync('UPDATE vault_items SET orig_path = ?, orig_mime = ? WHERE id = ?', ofn, original.mime || null, existing.id);
        } catch { /* keep the dup as-is if the write fails */ }
      }
      deleteAsync(tempUri, { idempotent: true }).catch(() => {});
      return { duplicate: true, existing: { id: existing.id, title: existing.title, bucket: existing.bucket } };
    }
  }

  let base64: string;
  try { base64 = await readAsStringAsync(tempUri, { encoding: EncodingType.Base64 }); }
  catch { return { item: null }; }

  const meta = await classify(base64, originalName ?? 'document', await existingBuckets(db0))
    ?? { title: originalName || 'Document', bucket: 'Documents', description: 'Saved document (enable Remote Intelligence for auto-description).', keywords: '' };

  // Persist the full image into the private vault dir. Store only the FILENAME in the DB (not the
  // absolute path) so it survives iOS container-UUID changes across rebuilds.
  await ensureVaultDir();
  const fileName = `doc-${Date.now()}.jpg`;
  const path = `${VAULT_DIR}${fileName}`;
  try { await writeAsStringAsync(path, base64, { encoding: EncodingType.Base64 }); }
  catch { return { item: null }; }

  // Persist the ORIGINAL file (e.g. the real PDF, or full-res image) so it can be viewed in full
  // and downloaded in its native format. Stored as a filename only (same container-safe scheme).
  let origFileName: string | null = null;
  let origMime: string | null = null;
  if (original?.base64) {
    try {
      const oext = extFor(original.mime, originalName);
      origFileName = `orig-${Date.now()}.${oext}`;
      await writeAsStringAsync(`${VAULT_DIR}${origFileName}`, original.base64, { encoding: EncodingType.Base64 });
      origMime = original.mime || null;
    } catch { origFileName = null; origMime = null; }
  }

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
    `INSERT INTO vault_items (title, description, bucket, keywords, hash, file_path, thumb, mime, gallery_saved, source, orig_path, orig_mime)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'image/jpeg', ?, 'upload', ?, ?)`,
    meta.title, meta.description, meta.bucket, meta.keywords, hash ?? null, fileName, thumbDataUrl ?? null, gallerySaved, origFileName, origMime,
  );

  // NOTE: vault documents are NOT enqueued as captures — the vault item IS the memory.

  deleteAsync(tempUri, { idempotent: true }).catch(() => {});
  const item = await db.getFirstAsync<VaultItem>('SELECT * FROM vault_items WHERE id = ?', res.lastInsertRowId);
  return { item };
}

export async function listVaultItems(db: SQLiteDatabase): Promise<VaultItem[]> {
  return db.getAllAsync<VaultItem>('SELECT * FROM vault_items ORDER BY created_at DESC');
}

/** Reads the full image off disk as a base64 data URL for the viewer. Falls back to the stored
 *  thumbnail when the full image is missing (e.g. lost to an older absolute path), so the user
 *  still sees the document instead of a broken "Not found". */
export async function getVaultImage(db: SQLiteDatabase, id: number): Promise<string | null> {
  const row = await db.getFirstAsync<VaultItem>('SELECT file_path, mime, thumb FROM vault_items WHERE id = ?', id);
  if (!row) return null;
  if (row.file_path) {
    const b64 = await readVaultBase64(row.file_path);
    if (b64) return `data:${row.mime || 'image/jpeg'};base64,${b64}`;
  }
  // Full image unavailable — serve the thumbnail (already a data URL) as a graceful fallback.
  return row.thumb || null;
}

/** Reads the ORIGINAL file (e.g. the real PDF) as a data URL + mime + suggested filename, for
 *  download / full-fidelity viewing. Falls back to the rasterized preview image if no original. */
export async function getVaultOriginal(
  db: SQLiteDatabase,
  id: number,
): Promise<{ dataUrl: string; mime: string; name: string } | null> {
  const row = await db.getFirstAsync<VaultItem>('SELECT title, orig_path, orig_mime, file_path, mime FROM vault_items WHERE id = ?', id);
  if (!row) return null;
  const safeTitle = (row.title || 'document').replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '') || 'document';
  if (row.orig_path) {
    const b64 = await readVaultBase64(row.orig_path);
    if (b64) {
      const mime = row.orig_mime || 'application/octet-stream';
      return { dataUrl: `data:${mime};base64,${b64}`, mime, name: `${safeTitle}.${extFor(mime, row.orig_path)}` };
    }
  }
  // No original retained (e.g. uploaded before this existed) — fall back to the preview image.
  const img = await getVaultImage(db, id);
  return img ? { dataUrl: img, mime: 'image/jpeg', name: `${safeTitle}.jpg` } : null;
}

/** Re-runs classification on an already-stored document (dynamic buckets + keywords). Used by
 *  "Re-organize" to fix items filed under the old fixed taxonomy. Reads the stored image. */
export async function reclassifyVaultItem(db: SQLiteDatabase, id: number): Promise<boolean> {
  const row = await db.getFirstAsync<VaultItem>('SELECT file_path FROM vault_items WHERE id = ?', id);
  if (!row?.file_path) return false;
  const base64 = await readVaultBase64(row.file_path);
  if (!base64) return false;
  const meta = await classify(base64, 'document', await existingBuckets(db));
  if (!meta) return false;
  await db.runAsync(
    'UPDATE vault_items SET title = ?, description = ?, bucket = ?, keywords = ? WHERE id = ?',
    meta.title, meta.description, meta.bucket, meta.keywords, id,
  );
  return true;
}

export async function refileVaultItem(db: SQLiteDatabase, id: number, bucket: string): Promise<void> {
  await db.runAsync('UPDATE vault_items SET bucket = ? WHERE id = ?', bucket.trim() || 'Other', id);
}

export async function deleteVaultItem(db: SQLiteDatabase, id: number): Promise<void> {
  const row = await db.getFirstAsync<VaultItem>('SELECT file_path, orig_path FROM vault_items WHERE id = ?', id);
  for (const stored of [row?.file_path, row?.orig_path]) {
    if (stored) for (const p of vaultPathCandidates(stored)) deleteAsync(p, { idempotent: true }).catch(() => {});
  }
  await db.runAsync('DELETE FROM vault_items WHERE id = ?', id);
}
