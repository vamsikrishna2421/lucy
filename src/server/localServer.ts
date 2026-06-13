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
// The baked-in DASHBOARD_HTML is the offline/first-run fallback.
const DASHBOARD_RAW_URL = 'https://raw.githubusercontent.com/vamsikrishna2421/lucy/master/web/dashboard.html';
let dashboardCache: string | null = null;

interface TcpServer { close: () => void; listen?: (opts: unknown) => void; on?: (e: string, cb: (a: unknown) => void) => void; }
let server: TcpServer | null = null;

/** Pulls the latest dashboard from the repo and caches it. Returns bytes (0 on failure). */
async function fetchRemoteDashboard(): Promise<number> {
  try {
    const res = await fetch(`${DASHBOARD_RAW_URL}?t=${Date.now()}`, { headers: { 'Cache-Control': 'no-cache' } });
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
    if (req.method === 'POST' && req.path === '/api/task') {
      const id = Number(payload.id); const action = String(payload.action ?? '');
      if (!id) return json(400, { error: 'Missing id' });
      const todos = await import('../db/todos');
      if (action === 'complete') await todos.archiveTodo(db, id, 'completed from laptop');
      else if (action === 'delete') await todos.deleteTodo(db, id);
      else return json(400, { error: 'Bad action' });
      return json(200, { ok: true });
    }
    if (req.method === 'POST' && req.path === '/api/reflect') {
      const { reflectOnUser } = await import('../processing/reflectOnUser');
      const count = await reflectOnUser(db, true);
      return json(200, { ok: true, learned: count });
    }
    // Hot-reload the dashboard from the repo — lets UAT refresh the website with no app rebuild.
    if (req.method === 'POST' && req.path === '/api/dashboard/refresh') {
      const bytes = await fetchRemoteDashboard();
      return json(200, { ok: bytes > 0, bytes, served: dashboardCache ? 'remote' : 'baked-in' });
    }
    if (req.method === 'DELETE' && req.path.startsWith('/api/capture/')) {
      const id = Number(req.path.split('/').pop());
      if (id) { const { deleteCaptureCompletely } = await import('../db/captures'); await deleteCaptureCompletely(db, id); }
      return json(200, { ok: true });
    }
    if (req.method === 'DELETE' && req.path.startsWith('/api/fact/')) {
      const id = Number(req.path.split('/').pop());
      if (id) { const { deleteLearnedFact } = await import('../db/learnedProfile'); await deleteLearnedFact(db, id); }
      return json(200, { ok: true });
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
