import type { SQLiteDatabase } from 'expo-sqlite';

export async function initializeSchema(db: SQLiteDatabase): Promise<void> {
  await db.execAsync(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS captures (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      source TEXT,
      raw_transcript TEXT,
      privacy_level TEXT DEFAULT 'normal',
      user_marked_private INTEGER DEFAULT 0,
      processed INTEGER DEFAULT 0,
      processing_error TEXT,
      extracted_title TEXT,
      structured_text TEXT,
      processed_at DATETIME,
      attempt_count INTEGER DEFAULT 0,
      next_attempt_at DATETIME,
      parent_capture_id INTEGER,
      capture_kind TEXT DEFAULT 'thought',
      archived_at DATETIME,
      archive_reason TEXT,
      guardian_note TEXT,
      FOREIGN KEY (parent_capture_id) REFERENCES captures(id)
    );

    CREATE TABLE IF NOT EXISTS todos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      capture_id INTEGER,
      task TEXT,
      category TEXT,
      urgency TEXT,
      context TEXT,
      privacy_level TEXT DEFAULT 'normal',
      status TEXT DEFAULT 'pending',
      archived_at DATETIME,
      archive_reason TEXT,
      FOREIGN KEY (capture_id) REFERENCES captures(id)
    );

    CREATE TABLE IF NOT EXISTS expenses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      capture_id INTEGER,
      amount REAL,
      description TEXT,
      category TEXT,
      privacy_level TEXT DEFAULT 'normal',
      FOREIGN KEY (capture_id) REFERENCES captures(id)
    );

    CREATE TABLE IF NOT EXISTS ideas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      capture_id INTEGER,
      title TEXT,
      description TEXT,
      type TEXT,
      privacy_level TEXT DEFAULT 'private',
      FOREIGN KEY (capture_id) REFERENCES captures(id)
    );

    CREATE TABLE IF NOT EXISTS places (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      capture_id INTEGER,
      name TEXT,
      reason TEXT,
      urgency TEXT,
      privacy_level TEXT DEFAULT 'normal',
      status TEXT DEFAULT 'pending',
      notification_id TEXT,
      scheduled_at DATETIME,
      FOREIGN KEY (capture_id) REFERENCES captures(id)
    );

    CREATE TABLE IF NOT EXISTS interests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      topic TEXT UNIQUE,
      strength TEXT,
      mention_count INTEGER DEFAULT 1,
      evidence TEXT
    );

    CREATE TABLE IF NOT EXISTS reminders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      capture_id INTEGER,
      text TEXT,
      remind_at DATETIME,
      urgency TEXT,
      privacy_level TEXT DEFAULT 'normal',
      status TEXT DEFAULT 'pending',
      archived_at DATETIME,
      archive_reason TEXT,
      FOREIGN KEY (capture_id) REFERENCES captures(id)
    );

    CREATE TABLE IF NOT EXISTS people (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE,
      first_seen DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_mentioned DATETIME,
      context TEXT
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE TABLE IF NOT EXISTS extractions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      capture_id INTEGER,
      schema_version INTEGER DEFAULT 1,
      privacy_level TEXT DEFAULT 'normal',
      structured_json TEXT,
      FOREIGN KEY (capture_id) REFERENCES captures(id)
    );

    CREATE TABLE IF NOT EXISTS questions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      question TEXT,
      intent TEXT,
      answer_summary TEXT,
      organization_hint TEXT
    );

    CREATE TABLE IF NOT EXISTS ask_threads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      title TEXT DEFAULT 'Memory conversation',
      archived INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS ask_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      thread_id INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      role TEXT,
      text TEXT,
      answer_json TEXT,
      FOREIGN KEY (thread_id) REFERENCES ask_threads(id)
    );

    CREATE TABLE IF NOT EXISTS context_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      capture_id INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      question TEXT NOT NULL,
      snippet TEXT,
      reason TEXT,
      priority TEXT DEFAULT 'medium',
      status TEXT DEFAULT 'open',
      answer_text TEXT,
      answered_at DATETIME,
      privacy_level TEXT DEFAULT 'private',
      FOREIGN KEY (capture_id) REFERENCES captures(id)
    );

    CREATE TABLE IF NOT EXISTS knowledge_entities (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entity_type TEXT NOT NULL,
      name TEXT NOT NULL,
      normalized_name TEXT NOT NULL,
      evidence_count INTEGER DEFAULT 1,
      confidence TEXT DEFAULT 'emerging',
      latest_capture_id INTEGER,
      privacy_level TEXT DEFAULT 'normal',
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(entity_type, normalized_name),
      FOREIGN KEY (latest_capture_id) REFERENCES captures(id)
    );

    CREATE TABLE IF NOT EXISTS knowledge_connections (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_entity_id INTEGER NOT NULL,
      relation TEXT NOT NULL,
      target_entity_id INTEGER NOT NULL,
      evidence_count INTEGER DEFAULT 1,
      confidence TEXT DEFAULT 'emerging',
      explanation TEXT,
      latest_capture_id INTEGER,
      privacy_level TEXT DEFAULT 'normal',
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(source_entity_id, relation, target_entity_id),
      FOREIGN KEY (source_entity_id) REFERENCES knowledge_entities(id),
      FOREIGN KEY (target_entity_id) REFERENCES knowledge_entities(id),
      FOREIGN KEY (latest_capture_id) REFERENCES captures(id)
    );

    CREATE TABLE IF NOT EXISTS knowledge_insights (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      insight_key TEXT UNIQUE NOT NULL,
      insight_type TEXT NOT NULL,
      title TEXT NOT NULL,
      detail TEXT,
      evidence_count INTEGER DEFAULT 1,
      confidence TEXT DEFAULT 'emerging',
      privacy_level TEXT DEFAULT 'private',
      observed_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS organization_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      trigger TEXT,
      summary TEXT,
      entity_count INTEGER DEFAULT 0,
      connection_count INTEGER DEFAULT 0,
      insight_count INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS open_loops (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      capture_id INTEGER,
      description TEXT NOT NULL,
      status TEXT DEFAULT 'open',
      privacy_level TEXT DEFAULT 'normal',
      resolved_at DATETIME,
      FOREIGN KEY (capture_id) REFERENCES captures(id)
    );

    CREATE TABLE IF NOT EXISTS follow_ups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      capture_id INTEGER,
      assignee TEXT,
      action TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      privacy_level TEXT DEFAULT 'normal',
      resolved_at DATETIME,
      FOREIGN KEY (capture_id) REFERENCES captures(id)
    );

    CREATE TABLE IF NOT EXISTS music_captures (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      title TEXT NOT NULL,
      artist TEXT NOT NULL,
      album TEXT,
      acr_confidence REAL,
      spotify_track_id TEXT,
      spotify_url TEXT,
      apple_music_url TEXT,
      status TEXT DEFAULT 'new'
    );

  `);

  const captureColumns = await db.getAllAsync<{ name: string }>('PRAGMA table_info(captures)');
  const existing = new Set(captureColumns.map((column) => column.name));
  if (!existing.has('processing_error')) {
    await db.execAsync('ALTER TABLE captures ADD COLUMN processing_error TEXT;');
  }
  if (!existing.has('user_marked_private')) {
    await db.execAsync('ALTER TABLE captures ADD COLUMN user_marked_private INTEGER DEFAULT 0;');
  }
  if (!existing.has('extracted_title')) {
    await db.execAsync('ALTER TABLE captures ADD COLUMN extracted_title TEXT;');
  }
  if (!existing.has('structured_text')) {
    await db.execAsync('ALTER TABLE captures ADD COLUMN structured_text TEXT;');
  }
  if (!existing.has('processed_at')) {
    await db.execAsync('ALTER TABLE captures ADD COLUMN processed_at DATETIME;');
  }
  if (!existing.has('attempt_count')) {
    await db.execAsync('ALTER TABLE captures ADD COLUMN attempt_count INTEGER DEFAULT 0;');
  }
  if (!existing.has('next_attempt_at')) {
    await db.execAsync('ALTER TABLE captures ADD COLUMN next_attempt_at DATETIME;');
  }
  if (!existing.has('parent_capture_id')) {
    await db.execAsync('ALTER TABLE captures ADD COLUMN parent_capture_id INTEGER;');
  }
  if (!existing.has('capture_kind')) {
    await db.execAsync("ALTER TABLE captures ADD COLUMN capture_kind TEXT DEFAULT 'thought';");
  }
  if (!existing.has('archived_at')) {
    await db.execAsync('ALTER TABLE captures ADD COLUMN archived_at DATETIME;');
  }
  if (!existing.has('archive_reason')) {
    await db.execAsync('ALTER TABLE captures ADD COLUMN archive_reason TEXT;');
  }
  if (!existing.has('guardian_note')) {
    await db.execAsync('ALTER TABLE captures ADD COLUMN guardian_note TEXT;');
  }
  const todoColumns = await db.getAllAsync<{ name: string }>('PRAGMA table_info(todos)');
  const existingTodoColumns = new Set(todoColumns.map((column) => column.name));
  if (!existingTodoColumns.has('archived_at')) {
    await db.execAsync('ALTER TABLE todos ADD COLUMN archived_at DATETIME;');
  }
  if (!existingTodoColumns.has('archive_reason')) {
    await db.execAsync('ALTER TABLE todos ADD COLUMN archive_reason TEXT;');
  }
  await db.execAsync(`
    CREATE INDEX IF NOT EXISTS idx_captures_created_at ON captures(created_at, id);
    CREATE INDEX IF NOT EXISTS idx_captures_parent_created_at ON captures(parent_capture_id, created_at, id);
    CREATE INDEX IF NOT EXISTS idx_questions_intent_created_at ON questions(intent, created_at, id);
    CREATE INDEX IF NOT EXISTS idx_ask_threads_active_updated ON ask_threads(archived, updated_at, id);
    CREATE INDEX IF NOT EXISTS idx_ask_messages_thread_created ON ask_messages(thread_id, created_at, id);
    CREATE INDEX IF NOT EXISTS idx_context_requests_status_created ON context_requests(status, priority, created_at, id);
    CREATE INDEX IF NOT EXISTS idx_knowledge_entities_confidence ON knowledge_entities(confidence, evidence_count, updated_at);
    CREATE INDEX IF NOT EXISTS idx_knowledge_connections_confidence ON knowledge_connections(confidence, evidence_count, updated_at);
    CREATE INDEX IF NOT EXISTS idx_knowledge_insights_observed ON knowledge_insights(observed_at, id);
    CREATE INDEX IF NOT EXISTS idx_organization_runs_created ON organization_runs(created_at, id);
  `);

  const reminderColumns = await db.getAllAsync<{ name: string }>('PRAGMA table_info(reminders)');
  const existingReminderColumns = new Set(reminderColumns.map((column) => column.name));
  if (!existingReminderColumns.has('notification_id')) {
    await db.execAsync('ALTER TABLE reminders ADD COLUMN notification_id TEXT;');
  }
  if (!existingReminderColumns.has('scheduled_at')) {
    await db.execAsync('ALTER TABLE reminders ADD COLUMN scheduled_at DATETIME;');
  }
  if (!existingReminderColumns.has('archived_at')) {
    await db.execAsync('ALTER TABLE reminders ADD COLUMN archived_at DATETIME;');
  }
  if (!existingReminderColumns.has('archive_reason')) {
    await db.execAsync('ALTER TABLE reminders ADD COLUMN archive_reason TEXT;');
  }
  await db.execAsync(`
    CREATE INDEX IF NOT EXISTS idx_open_loops_status ON open_loops(status, created_at);
    CREATE INDEX IF NOT EXISTS idx_follow_ups_status ON follow_ups(status, created_at);
    CREATE INDEX IF NOT EXISTS idx_music_captures_status ON music_captures(status, created_at);
  `);
}
