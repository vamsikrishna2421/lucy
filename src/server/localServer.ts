/**
 * LAN companion server — the phone hosts a tiny web dashboard on the local WiFi so a
 * laptop browser can view and control LUCY's memory bidirectionally. No cloud: the
 * laptop connects straight to the phone's LAN IP. Foreground-only, PIN-gated, off by default.
 *
 * Built on react-native-tcp-socket with a minimal HTTP/1.1 layer (one request per
 * connection, Connection: close). Native module loaded lazily so the rest of the app is
 * unaffected if it's unavailable.
 */
import * as Network from 'expo-network';
import { getDatabase } from '../db';
import { DASHBOARD_HTML } from './dashboardHtml';

export interface ServerState {
  running: boolean;
  ip: string | null;
  port: number;
  pin: string | null;
  error: string | null;
}

const PORT = 8088;
// The dashboard HTML is pulled from the public repo at runtime so it can be iterated
// WITHOUT an app rebuild: edit web/dashboard.html → push → POST /api/dashboard/refresh.
// Uses the GitHub API (Accept: raw) instead of raw.githubusercontent.com because the raw
// CDN caches by path and ignores cache-busters (stale for minutes); the API isn't CDN-
// cached, so refresh is instant. The baked-in DASHBOARD_HTML is the offline/first-run fallback.
const DASHBOARD_API_URL = 'https://api.github.com/repos/vamsikrishna2421/lucy/contents/web/dashboard.html?ref=master';
let dashboardCache: string | null = null;

interface TcpServer { close: () => void; listen?: (opts: unknown) => void; on?: (e: string, cb: (a: unknown) => void) => void; }
let server: TcpServer | null = null;

/** Pulls the latest dashboard from the repo and caches it. Returns bytes (0 on failure). */
async function fetchRemoteDashboard(): Promise<number> {
  try {
    const res = await fetch(`${DASHBOARD_API_URL}&t=${Date.now()}`, {
      // GitHub API requires a User-Agent; Accept: raw returns the file content directly.
      headers: { Accept: 'application/vnd.github.raw', 'User-Agent': 'LUCY-app', 'Cache-Control': 'no-cache' },
    });
    if (!res.ok) return 0;
    const html = await res.text();
    if (html && html.includes('</html>')) { dashboardCache = html; return html.length; }
    return 0;
  } catch { return 0; }
}
let state: ServerState = { running: false, ip: null, port: PORT, pin: null, error: null };
const listeners = new Set<(s: ServerState) => void>();

function setState(patch: Partial<ServerState>): void {
  state = { ...state, ...patch };
  listeners.forEach((l) => l(state));
}

export function getServerState(): ServerState { return state; }
export function subscribeServer(fn: (s: ServerState) => void): () => void {
  listeners.add(fn); fn(state); return () => listeners.delete(fn);
}

// ─── HTTP helpers ──────────────────────────────────────────────────────────────
interface ParsedRequest { method: string; path: string; query: Record<string, string>; headers: Record<string, string>; body: string; }

/** UTF-8 byte length of a string (HTTP Content-Length must be bytes, not JS chars). */
function utf8Len(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff) { n += 4; i++; } // surrogate pair (emoji)
    else n += 3;
  }
  return n;
}

function parseRequest(raw: string): ParsedRequest | null {
  const headerEnd = raw.indexOf('\r\n\r\n');
  if (headerEnd === -1) return null;
  const head = raw.slice(0, headerEnd);
  const lines = head.split('\r\n');
  const [method, fullPath] = lines[0].split(' ');
  if (!method || !fullPath) return null;
  const headers: Record<string, string> = {};
  for (let i = 1; i < lines.length; i++) {
    const idx = lines[i].indexOf(':');
    if (idx > 0) headers[lines[i].slice(0, idx).trim().toLowerCase()] = lines[i].slice(idx + 1).trim();
  }
  const contentLength = parseInt(headers['content-length'] ?? '0', 10) || 0;
  const body = raw.slice(headerEnd + 4);
  if (utf8Len(body) < contentLength) return null; // wait for the full body (byte-accurate)
  const [path, qs] = fullPath.split('?');
  const query: Record<string, string> = {};
  if (qs) for (const pair of qs.split('&')) { const [k, v] = pair.split('='); query[decodeURIComponent(k)] = decodeURIComponent(v ?? ''); }
  return { method, path, query, headers, body };
}

function httpResponse(status: number, contentType: string, body: string): string {
  const statusText = status === 200 ? 'OK' : status === 401 ? 'Unauthorized' : status === 404 ? 'Not Found' : status === 204 ? 'No Content' : 'Error';
  return `HTTP/1.1 ${status} ${statusText}\r\n`
    + `Content-Type: ${contentType}\r\n`
    + `Content-Length: ${utf8Len(body)}\r\n`
    + 'Access-Control-Allow-Origin: *\r\n'
    + 'Access-Control-Allow-Headers: Content-Type, X-LUCY-PIN\r\n'
    + 'Access-Control-Allow-Methods: GET, POST, DELETE, OPTIONS\r\n'
    + 'Connection: close\r\n\r\n'
    + body;
}
const json = (status: number, obj: unknown) => httpResponse(status, 'application/json', JSON.stringify(obj));

// ─── Routing ─────────────────────────────────────────────────────────────────
async function route(req: ParsedRequest): Promise<string> {
  if (req.method === 'OPTIONS') return httpResponse(204, 'text/plain', '');
  if (req.method === 'GET' && req.path === '/') return httpResponse(200, 'text/html; charset=utf-8', dashboardCache ?? DASHBOARD_HTML);

  if (req.path.startsWith('/api/')) {
    // No auth at this stage — LAN-only, security comes later.
    const db = await getDatabase();
    let payload: Record<string, unknown> = {};
    try { payload = req.body ? JSON.parse(req.body) : {}; } catch { payload = {}; }

    if (req.method === 'GET' && req.path === '/api/memory') {
      const { buildMemoryExport } = await import('../processing/memoryExport');
      return json(200, await buildMemoryExport(db));
    }
    if (req.method === 'POST' && req.path === '/api/capture') {
      const text = String(payload.text ?? '').trim();
      if (!text) return json(400, { error: 'Empty text' });
      const { enqueueTranscript, processQueue } = await import('../processing/extract');
      await enqueueTranscript(text, 'text');
      void processQueue();
      return json(200, { ok: true });
    }
    // Reprocess a capture — re-run extraction from scratch (clears derived data + re-queues).
    if (req.method === 'POST' && req.path === '/api/capture/reprocess') {
      const id = Number(payload.id);
      if (!id) return json(400, { error: 'Missing id' });
      const { resetCaptureForReprocess } = await import('../db/captures');
      await resetCaptureForReprocess(db, id);
      const { processQueue } = await import('../processing/extract');
      void processQueue();
      return json(200, { ok: true });
    }
    // Correct a capture's memory text directly, then reprocess so derived data realigns.
    if (req.method === 'POST' && req.path === '/api/capture/correct') {
      const id = Number(payload.id); const text = String(payload.text ?? '').trim();
      if (!id || !text) return json(400, { error: 'Missing id/text' });
      await db.runAsync('UPDATE captures SET raw_transcript = ? WHERE id = ?', text, id);
      const { resetCaptureForReprocess } = await import('../db/captures');
      await resetCaptureForReprocess(db, id);
      const { processQueue } = await import('../processing/extract');
      void processQueue();
      return json(200, { ok: true });
    }
    if (req.method === 'POST' && req.path === '/api/task') {
      const action = String(payload.action ?? '');
      const todos = await import('../db/todos');
      if (action === 'create') {
        const task = String(payload.task ?? '').trim();
        if (!task) return json(400, { error: 'Empty task' });
        const urgency = ['high', 'medium', 'low'].includes(String(payload.urgency)) ? String(payload.urgency) : 'medium';
        const category = String(payload.category ?? 'general').trim() || 'general';
        await db.runAsync(
          "INSERT INTO todos (task, category, urgency, context, status) VALUES (?, ?, ?, '', 'pending')",
          task, category, urgency,
        );
        return json(200, { ok: true });
      }
      const id = Number(payload.id);
      if (!id) return json(400, { error: 'Missing id' });
      if (action === 'complete') await todos.archiveTodo(db, id, 'completed from laptop');
      else if (action === 'delete') await todos.deleteTodo(db, id);
      else if (action === 'snooze') await db.runAsync("UPDATE todos SET urgency = 'low' WHERE id = ?", id);
      else return json(400, { error: 'Bad action' });
      return json(200, { ok: true });
    }
    // Ask Lucy — the full chat, from the laptop. Runs the same answer engine the app uses
    // (memory retrieval + shielded LLM), so answers are grounded in on-device memory.
    if (req.method === 'POST' && req.path === '/api/ask') {
      const question = String(payload.question ?? '').trim();
      if (!question) return json(400, { error: 'Empty question' });
      const rawHistory = Array.isArray(payload.history) ? payload.history : [];
      const history = rawHistory
        .filter((t): t is { role: string; content: string } => !!t && typeof t === 'object')
        .map((t) => ({ role: t.role === 'lucy' ? 'lucy' as const : 'user' as const, content: String(t.content ?? '') }))
        .filter((t) => t.content)
        .slice(-12);
      const { askLucy } = await import('../processing/ask');
      const capture = async (text: string): Promise<void> => {
        const { enqueueTranscript, processQueue } = await import('../processing/extract');
        await enqueueTranscript(text, 'text'); void processQueue();
      };
      const answer = await askLucy(question, capture, history);
      // Prefer the LLM prose; fall back to the structured message.
      const reply = (answer.llmResponse && answer.llmResponse.trim()) || answer.message || answer.title || '…';
      return json(200, {
        ok: true,
        reply,
        kind: answer.answerKind ?? 'llm',
        title: answer.title,
        tasks: answer.tasks ?? [],
        sources: answer.sources ?? [],
        expenses: answer.expenses ?? [],
        expenseTotal: answer.expenseTotal,
        spendingCategories: answer.spendingCategories ?? [],
      });
    }
    // Log a mood entry from the laptop.
    if (req.method === 'POST' && req.path === '/api/mood') {
      const tone = ['positive', 'neutral', 'low', 'negative'].includes(String(payload.tone)) ? String(payload.tone) : 'neutral';
      const energy = ['high', 'medium', 'low'].includes(String(payload.energy)) ? String(payload.energy) : 'medium';
      await db.runAsync('INSERT INTO mood_entries (tone, energy) VALUES (?, ?)', tone, energy);
      return json(200, { ok: true });
    }
    // Tell LUCY something directly — stored as a confirmed learned fact (feedback channel).
    if (req.method === 'POST' && req.path === '/api/feedback') {
      const text = String(payload.text ?? '').trim();
      if (!text) return json(400, { error: 'Empty feedback' });
      const category = ['preference', 'habit', 'trait', 'routine', 'goal', 'relationship', 'correction'].includes(String(payload.category))
        ? String(payload.category) : 'preference';
      const { upsertLearnedFact } = await import('../db/learnedProfile');
      await upsertLearnedFact(db, category as never, text, 'feedback');
      return json(200, { ok: true });
    }
    // Upload an image into the Document Vault. The browser sends a downscaled JPEG (full)
    // + a small thumbnail as base64 data URLs; we write the full image to a temp file and
    // hand it to the vault (classifies into a bucket, persists to the app sandbox, optionally
    // copies to Photos, enqueues a capture). Base64-in-JSON keeps it text-safe over the socket.
    if (req.method === 'POST' && req.path === '/api/upload') {
      const dataUrl = String(payload.image ?? '');
      const b64 = dataUrl.includes(',') ? dataUrl.slice(dataUrl.indexOf(',') + 1) : dataUrl;
      if (!b64) return json(400, { error: 'No image' });
      const name = String(payload.name ?? 'upload.jpg');
      const thumb = typeof payload.thumb === 'string' ? payload.thumb : null;
      const hash = typeof payload.hash === 'string' ? payload.hash : null;
      const saveToGallery = payload.gallery !== false; // default: also save to Photos
      // The ORIGINAL file (e.g. real PDF) for full-fidelity view + native-format download.
      const origRaw = typeof payload.orig === 'string' ? payload.orig : '';
      const origB64 = origRaw.includes(',') ? origRaw.slice(origRaw.indexOf(',') + 1) : origRaw;
      const origMime = typeof payload.origMime === 'string' ? payload.origMime : 'application/octet-stream';
      const original = origB64 ? { base64: origB64, mime: origMime } : null;
      try {
        const fs = await import('expo-file-system/legacy');
        const path = `${fs.cacheDirectory}lucy-upload-${Date.now()}.jpg`;
        await fs.writeAsStringAsync(path, b64, { encoding: fs.EncodingType.Base64 });
        const { saveImageToVault } = await import('../processing/documentVault');
        const r = await saveImageToVault(path, name, thumb, saveToGallery, hash, original);
        if (r.duplicate) return json(200, { ok: true, duplicate: true, existing: r.existing });
        const item = r.item;
        return json(200, { ok: !!item, id: item?.id, title: item?.title, bucket: item?.bucket, description: item?.description });
      } catch (e) {
        return json(500, { error: e instanceof Error ? e.message : 'Upload failed' });
      }
    }
    if (req.method === 'GET' && req.path === '/api/vault') {
      const { listVaultItems } = await import('../processing/documentVault');
      const items = await listVaultItems(db);
      // Return list metadata + thumbnails (small); never the full images here.
      return json(200, { items: items.map((i) => ({ id: i.id, title: i.title, description: i.description, bucket: i.bucket, keywords: i.keywords, thumb: i.thumb, gallery_saved: i.gallery_saved, created_at: i.created_at })) });
    }
    // Re-run classification on one stored document (dynamic buckets + keywords).
    if (req.method === 'POST' && req.path === '/api/vault/reclassify') {
      const id = Number(payload.id);
      if (!id) return json(400, { error: 'Missing id' });
      const { reclassifyVaultItem } = await import('../processing/documentVault');
      const ok = await reclassifyVaultItem(db, id);
      return json(200, { ok });
    }
    if (req.method === 'GET' && req.path.startsWith('/api/vault/item/')) {
      const id = Number(req.path.split('/').pop());
      const { getVaultImage } = await import('../processing/documentVault');
      const dataUrl = id ? await getVaultImage(db, id) : null;
      return dataUrl ? json(200, { ok: true, dataUrl }) : json(404, { error: 'Not found' });
    }
    // Original file (real PDF / full-res image) for download in its native format.
    if (req.method === 'GET' && req.path.startsWith('/api/vault/orig/')) {
      const id = Number(req.path.split('/').pop());
      const { getVaultOriginal } = await import('../processing/documentVault');
      const r = id ? await getVaultOriginal(db, id) : null;
      return r ? json(200, { ok: true, dataUrl: r.dataUrl, mime: r.mime, name: r.name }) : json(404, { error: 'Not found' });
    }
    if (req.method === 'POST' && req.path === '/api/vault/refile') {
      const id = Number(payload.id); const bucket = String(payload.bucket ?? '');
      if (!id || !bucket) return json(400, { error: 'Missing id/bucket' });
      const { refileVaultItem } = await import('../processing/documentVault');
      await refileVaultItem(db, id, bucket);
      return json(200, { ok: true });
    }
    if (req.method === 'DELETE' && req.path.startsWith('/api/vault/')) {
      const id = Number(req.path.split('/').pop());
      if (id) { const { deleteVaultItem } = await import('../processing/documentVault'); await deleteVaultItem(db, id); }
      return json(200, { ok: true });
    }
    // Edit the "about you" profile blurb from the laptop.
    if (req.method === 'POST' && req.path === '/api/profile') {
      const { setSetting } = await import('../db/settings');
      if (typeof payload.about === 'string') await setSetting(db, 'user_profile_about', String(payload.about).trim());
      if (typeof payload.name === 'string' && String(payload.name).trim()) await setSetting(db, 'user_profile_name', String(payload.name).trim());
      return json(200, { ok: true });
    }
    if (req.method === 'POST' && req.path === '/api/reflect') {
      const { reflectOnUser } = await import('../processing/reflectOnUser');
      const count = await reflectOnUser(db, true);
      return json(200, { ok: true, learned: count });
    }
    // Import a memory export JSON (device switch / restore) from the laptop.
    if (req.method === 'POST' && req.path === '/api/import') {
      const data = payload.data ?? payload; // accept {data:{...}} or the raw export
      const { importMemoryExport } = await import('../processing/memoryImport');
      const result = await importMemoryExport(db, data);
      return json(result.ok ? 200 : 400, result);
    }
    // Dev logs (incl. crashes) — for diagnosing field issues over the LAN.
    if (req.method === 'GET' && req.path === '/api/logs') {
      const { listDevLogs } = await import('../db/devLog');
      const rows = await listDevLogs(db, 100);
      const onlyCrash = req.query.crash === '1';
      return json(200, { logs: onlyCrash ? rows.filter((r) => r.category === 'crash' || r.error) : rows });
    }
    // Cost guard status + temporary snooze (for bulk uploads/reclassify from the laptop).
    if (req.method === 'GET' && req.path === '/api/costguard') {
      const { getCostGuard } = await import('../ai/rateLimit');
      return json(200, await getCostGuard(db));
    }
    if (req.method === 'POST' && req.path === '/api/costguard') {
      const minutes = Number(payload.minutes ?? 0);
      const { snoozeCostGuard, getCostGuard } = await import('../ai/rateLimit');
      await snoozeCostGuard(db, minutes);
      // Resuming the queue: kick the processor in case it was paused by the cap.
      if (minutes > 0) { const { processQueue } = await import('../processing/extract'); void processQueue(); }
      return json(200, await getCostGuard(db));
    }
    // Hot-reload the dashboard from the repo — lets UAT refresh the website with no app rebuild.
    if (req.method === 'POST' && req.path === '/api/dashboard/refresh') {
      const bytes = await fetchRemoteDashboard();
      return json(200, { ok: bytes > 0, bytes, served: dashboardCache ? 'remote' : 'baked-in' });
    }
    if (req.method === 'DELETE' && req.path.startsWith('/api/capture/')) {
      const id = Number(req.path.split('/').pop());
      if (id) {
        const { deleteCaptureCompletely, purgeCaptureDerivedData } = await import('../db/captures');
        if (req.query.hard === '1') { await purgeCaptureDerivedData(db, id); await db.runAsync('DELETE FROM captures WHERE id = ?', id); }
        else await deleteCaptureCompletely(db, id);
      }
      return json(200, { ok: true });
    }
    // One-shot data cleanup + graph rebuild (junk people, stale open loops). For maintenance.
    if (req.method === 'POST' && req.path === '/api/cleanup') {
      const { cleanupJunkPeople } = await import('../db/people');
      const { decayStaleOpenLoops } = await import('../db/openLoops');
      const { dedupLearnedFacts } = await import('../db/learnedProfile');
      const { recategorizeExpenses } = await import('../db/expenses');
      const peopleRemoved = await cleanupJunkPeople(db);
      const loopsResolved = await decayStaleOpenLoops(db, Number(payload.loopDays) || 30);
      const factsMerged = await dedupLearnedFacts(db);
      const expensesFixed = await recategorizeExpenses(db);
      const { organizeMemory } = await import('../processing/organizer');
      await organizeMemory(db, 'manual');
      return json(200, { ok: true, peopleRemoved, loopsResolved, factsMerged, expensesFixed });
    }
    if (req.method === 'DELETE' && req.path.startsWith('/api/fact/')) {
      const id = Number(req.path.split('/').pop());
      if (id) { const { deleteLearnedFact } = await import('../db/learnedProfile'); await deleteLearnedFact(db, id); }
      return json(200, { ok: true });
    }

    // ─── Intelligent Calendar ─────────────────────────────────────────────────
    if (req.method === 'GET' && req.path === '/api/schedule/availability') {
      const { getAvailability } = await import('../scheduling/availability');
      return json(200, { ok: true, availability: await getAvailability(db) });
    }
    if (req.method === 'POST' && req.path === '/api/schedule/availability') {
      const { setAvailability } = await import('../scheduling/availability');
      const av = await setAvailability(db, (payload.profile ?? payload) as Record<string, unknown>);
      return json(200, { ok: true, availability: av });
    }
    if (req.method === 'POST' && req.path === '/api/schedule/suggest') {
      const { suggestForText, suggestForTodo, describeResources } = await import('../scheduling');
      const r = payload.todoId
        ? await suggestForTodo(db, Number(payload.todoId))
        : await suggestForText(db, String(payload.task ?? ''), {
            durationMin: payload.durationMin ? Number(payload.durationMin) : undefined,
            deadline: typeof payload.deadline === 'string' ? payload.deadline : null,
          });
      if (!r) return json(400, { error: 'Nothing to schedule' });
      return json(200, {
        ok: true,
        meta: { ...r.meta, resourceLabel: describeResources(r.meta.resources) },
        suggestions: r.suggestions,
      });
    }
    if (req.method === 'POST' && req.path === '/api/schedule/commit') {
      const { commitBlock } = await import('../scheduling');
      const r = await commitBlock(db, {
        title: String(payload.title ?? 'Task'),
        startMs: Number(payload.startMs), endMs: Number(payload.endMs),
        resources: payload.resources as undefined,
        energy: typeof payload.energy === 'string' ? payload.energy : null,
        location: typeof payload.location === 'string' ? payload.location : null,
        todoId: payload.todoId ? Number(payload.todoId) : null,
      });
      return json(r.ok ? 200 : 409, r);
    }
    if (req.method === 'GET' && req.path === '/api/schedule') {
      const days = Math.max(1, Math.min(14, Number(req.query.days) || 2));
      const { getPlan, describeResources } = await import('../scheduling');
      const { getAvailability } = await import('../scheduling/availability');
      const now = Date.now();
      const plan = await getPlan(db, now - 2 * 60 * 60 * 1000, now + days * 24 * 60 * 60 * 1000);
      const availability = await getAvailability(db);
      return json(200, {
        ok: true,
        availability,
        blocks: plan.blocks.map((b) => ({
          id: b.id ?? null, title: b.title, start: b.start, end: b.end,
          source: b.source, todoId: b.todoId ?? null, locked: !!b.locked,
          resourceLabel: describeResources(b.resources),
        })),
        conflicts: plan.conflicts.map((c) => ({ a: c.a.title, b: c.b.title, reason: c.reason })),
      });
    }
    if (req.method === 'DELETE' && req.path.startsWith('/api/schedule/')) {
      const id = Number(req.path.split('/').pop());
      const { cancelBlock } = await import('../scheduling');
      const okc = id ? await cancelBlock(db, id) : false;
      return json(200, { ok: okc });
    }

    return json(404, { error: 'No such endpoint' });
  }
  return httpResponse(404, 'text/plain', 'Not found');
}

// ─── Server lifecycle ──────────────────────────────────────────────────────────
export async function startServer(): Promise<ServerState> {
  if (state.running) return state;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const TcpSocket = require('react-native-tcp-socket').default ?? require('react-native-tcp-socket');
    let ip: string | null = null;
    try { ip = await Network.getIpAddressAsync(); } catch { /* ignore */ }

    server = TcpSocket.createServer((socket: { on: (e: string, cb: (d?: unknown) => void) => void; write: (s: string) => void; end: (s?: string) => void; destroy: () => void }) => {
      let buffer = '';
      const send = (res: string) => {
        // write() then end() flushes the full response before the FIN, so large
        // payloads (the whole memory export) aren't truncated.
        try { socket.write(res); socket.end(); } catch { try { socket.destroy(); } catch { /* ignore */ } }
      };
      socket.on('data', (data?: unknown) => {
        buffer += typeof data === 'string' ? data : String(data);
        const req = parseRequest(buffer);
        if (!req) return; // wait for the rest
        buffer = '';
        void route(req)
          .then((res) => send(res))
          .catch(() => send(json(500, { error: 'Server error' })));
      });
      socket.on('error', () => { try { socket.destroy(); } catch { /* ignore */ } });
    });
    server?.listen?.({ port: PORT, host: '0.0.0.0' });
    server?.on?.('error', (e: unknown) => setState({ error: e instanceof Error ? e.message : 'Server error', running: false }));

    setState({ running: true, ip, pin: null, error: null });
    void fetchRemoteDashboard(); // pull the latest dashboard in the background
    return state;
  } catch (e) {
    setState({ running: false, error: e instanceof Error ? e.message : 'Could not start server' });
    return state;
  }
}

export function stopServer(): void {
  try { server?.close(); } catch { /* ignore */ }
  server = null;
  setState({ running: false, pin: null, error: null });
}
