import type { SQLiteDatabase } from 'expo-sqlite';

/**
 * Persists "Hey Lucy" / tap-the-face VOICE conversations so they can be reviewed later (in-app + web).
 * Previously these were ephemeral (in-memory only). Bounded to the most recent conversations.
 */
export interface VoiceConversationRow { id: number; started_at: string; ended_at: string | null; screen_context: string | null; turn_count: number; }
export interface VoiceTurnRow { id: number; conversation_id: number; role: 'user' | 'lucy'; text: string; created_at: string; }

const MAX_CONVERSATIONS = 100;

export async function startVoiceConversation(db: SQLiteDatabase, screenContext: string | null): Promise<number> {
  const r = await db.runAsync('INSERT INTO voice_conversations (screen_context) VALUES (?)', screenContext ?? null);
  // Prune old conversations (+ their turns via the same id set).
  try {
    await db.runAsync(
      `DELETE FROM voice_conversations WHERE id NOT IN (SELECT id FROM voice_conversations ORDER BY id DESC LIMIT ?)`,
      MAX_CONVERSATIONS,
    );
    await db.runAsync('DELETE FROM voice_messages WHERE conversation_id NOT IN (SELECT id FROM voice_conversations)');
  } catch { /* prune best-effort */ }
  return r.lastInsertRowId;
}

export async function addVoiceTurn(db: SQLiteDatabase, conversationId: number, role: 'user' | 'lucy', text: string): Promise<void> {
  if (!conversationId || !text?.trim()) return;
  await db.runAsync('INSERT INTO voice_messages (conversation_id, role, text) VALUES (?, ?, ?)', conversationId, role, text.trim());
}

export async function endVoiceConversation(db: SQLiteDatabase, conversationId: number): Promise<void> {
  if (!conversationId) return;
  // Drop conversations that never got a turn (opened + closed with nothing said).
  const cnt = await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM voice_messages WHERE conversation_id = ?', conversationId);
  if (!cnt?.n) { await db.runAsync('DELETE FROM voice_conversations WHERE id = ?', conversationId); return; }
  await db.runAsync('UPDATE voice_conversations SET ended_at = CURRENT_TIMESTAMP WHERE id = ? AND ended_at IS NULL', conversationId);
}

export async function listVoiceConversations(db: SQLiteDatabase, limit = 30): Promise<Array<VoiceConversationRow & { turns: VoiceTurnRow[] }>> {
  const convos = await db.getAllAsync<VoiceConversationRow>(
    `SELECT c.*, (SELECT COUNT(*) FROM voice_messages m WHERE m.conversation_id = c.id) AS turn_count
     FROM voice_conversations c
     WHERE EXISTS (SELECT 1 FROM voice_messages m WHERE m.conversation_id = c.id)
     ORDER BY c.id DESC LIMIT ?`, limit,
  );
  const out: Array<VoiceConversationRow & { turns: VoiceTurnRow[] }> = [];
  for (const c of convos) {
    const turns = await db.getAllAsync<VoiceTurnRow>(
      'SELECT * FROM voice_messages WHERE conversation_id = ? ORDER BY id ASC', c.id,
    );
    out.push({ ...c, turns });
  }
  return out;
}
