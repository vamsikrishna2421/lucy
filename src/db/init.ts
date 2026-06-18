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

    CREATE TABLE IF NOT EXISTS learned_facts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category TEXT NOT NULL,
      statement TEXT NOT NULL,
      normalized TEXT UNIQUE NOT NULL,
      confidence TEXT DEFAULT 'emerging',
      evidence_count INTEGER DEFAULT 1,
      source TEXT DEFAULT 'reflection',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_seen_at DATETIME DEFAULT CURRENT_TIMESTAMP
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

    CREATE TABLE IF NOT EXISTS capture_embeddings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      capture_id INTEGER NOT NULL UNIQUE,
      embedding TEXT NOT NULL,
      model TEXT DEFAULT 'keyword',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (capture_id) REFERENCES captures(id)
    );

    CREATE TABLE IF NOT EXISTS person_contexts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      last_mentioned DATETIME,
      mention_count INTEGER DEFAULT 1,
      typical_context TEXT,
      pending_followups INTEGER DEFAULT 0,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS mood_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      capture_id INTEGER,
      tone TEXT DEFAULT 'neutral',
      energy TEXT DEFAULT 'medium',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (capture_id) REFERENCES captures(id)
    );

    CREATE TABLE IF NOT EXISTS vault_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      title TEXT,
      description TEXT,
      bucket TEXT DEFAULT 'Other',
      keywords TEXT,
      hash TEXT,
      file_path TEXT,
      thumb TEXT,
      mime TEXT DEFAULT 'image/jpeg',
      gallery_saved INTEGER DEFAULT 0,
      source TEXT DEFAULT 'upload',
      orig_path TEXT,
      orig_mime TEXT
    );

    CREATE TABLE IF NOT EXISTS projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      name TEXT NOT NULL,
      description TEXT,
      color TEXT,
      status TEXT DEFAULT 'active'
    );

    CREATE TABLE IF NOT EXISTS scheduled_blocks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      todo_id INTEGER,
      title TEXT,
      start_at INTEGER,
      end_at INTEGER,
      resources TEXT,
      energy TEXT,
      location TEXT,
      status TEXT DEFAULT 'committed',
      locked INTEGER DEFAULT 0,
      calendar_event_id TEXT
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
  if (!existing.has('split_origin_id')) {
    // The capture this one was split out of (journal → dated/event captures). Lets a
    // reprocess remove prior split children instead of duplicating them.
    await db.execAsync('ALTER TABLE captures ADD COLUMN split_origin_id INTEGER;');
  }
  if (!existing.has('listen_session_id')) {
    // Groups all batch chunks from a single Listen session together. Generated at
    // passiveListener.start() and passed through enqueueTranscript for every batch.
    await db.execAsync('ALTER TABLE captures ADD COLUMN listen_session_id TEXT;');
  }
  if (!existing.has('capture_kind')) {
    await db.execAsync("ALTER TABLE captures ADD COLUMN capture_kind TEXT DEFAULT 'thought';");
  }
  if (!existing.has('source_image_path')) {
    // On-device path to the ORIGINAL photo a capture was read from (LUCY Lens). Kept as the
    // source-of-truth so the user can review the real image from the capture node. On-device only.
    await db.execAsync('ALTER TABLE captures ADD COLUMN source_image_path TEXT;');
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
  if (!existing.has('protected_values')) {
    // JSON array of {value, kind} that the Privacy Shield masked from the cloud
    // (passwords + people names). Used to highlight protected values in the UI.
    await db.execAsync('ALTER TABLE captures ADD COLUMN protected_values TEXT;');
  }
  const todoColumns = await db.getAllAsync<{ name: string }>('PRAGMA table_info(todos)');
  const existingTodoColumns = new Set(todoColumns.map((column) => column.name));
  if (!existingTodoColumns.has('archived_at')) {
    await db.execAsync('ALTER TABLE todos ADD COLUMN archived_at DATETIME;');
  }
  if (!existingTodoColumns.has('archive_reason')) {
    await db.execAsync('ALTER TABLE todos ADD COLUMN archive_reason TEXT;');
  }
  // Persistent list/category assignment set by the user or by LUCY's reorganizer.
  // When NULL, the Tasks board falls back to regex-based auto-categorization.
  if (!existingTodoColumns.has('list_name')) {
    await db.execAsync('ALTER TABLE todos ADD COLUMN list_name TEXT;');
  }

  // Recurring reminders: a recurrence rule ('daily'|'weekdays'|'weekly'|'monthly'); NULL = one-shot.
  // When a recurring reminder is acknowledged/fires, its remind_at advances to the next occurrence
  // instead of being consumed (see src/processing/reminderRecurrence.ts).
  const reminderRecurCols = await db.getAllAsync<{ name: string }>('PRAGMA table_info(reminders)');
  if (!new Set(reminderRecurCols.map((c) => c.name)).has('recurrence')) {
    await db.execAsync('ALTER TABLE reminders ADD COLUMN recurrence TEXT;');
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
    CREATE TABLE IF NOT EXISTS battery_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      recorded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      battery_level REAL NOT NULL,
      is_charging INTEGER DEFAULT 0,
      hour_of_day INTEGER NOT NULL,
      day_of_week INTEGER NOT NULL,
      captures_since_last INTEGER DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_battery_recorded ON battery_snapshots(recorded_at);

    CREATE TABLE IF NOT EXISTS error_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      occurred_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      context TEXT NOT NULL,
      message TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_error_log_occurred ON error_log(occurred_at);

    CREATE TABLE IF NOT EXISTS ai_call_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      called_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_ai_call_log_called ON ai_call_log(called_at);

    CREATE TABLE IF NOT EXISTS location_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      recorded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      hour_key TEXT NOT NULL UNIQUE,
      date_key TEXT NOT NULL,
      city TEXT,
      region TEXT,
      country TEXT,
      latitude REAL,
      longitude REAL
    );
    CREATE INDEX IF NOT EXISTS idx_location_snapshots_date ON location_snapshots(date_key);

    CREATE TABLE IF NOT EXISTS health_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      recorded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      date_key TEXT NOT NULL UNIQUE,
      steps INTEGER DEFAULT 0,
      sleep_hours REAL,
      resting_hr INTEGER,
      active_minutes INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_health_snapshots_date ON health_snapshots(date_key);

    CREATE TABLE IF NOT EXISTS lucy_notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      identifier TEXT UNIQUE,
      kind TEXT NOT NULL,
      tier INTEGER NOT NULL DEFAULT 2,
      title TEXT NOT NULL,
      body TEXT,
      data_json TEXT,
      scheduled_for DATETIME,
      entity_id TEXT,
      entity_kind TEXT,
      read_at DATETIME,
      dismissed_at DATETIME,
      expired_at DATETIME
    );
    CREATE INDEX IF NOT EXISTS idx_lucy_notifications_created ON lucy_notifications(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_lucy_notifications_tier ON lucy_notifications(tier, read_at, dismissed_at);

    CREATE TABLE IF NOT EXISTS pending_staleness_reviews (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kind TEXT NOT NULL,
      item_id INTEGER NOT NULL,
      item_text TEXT NOT NULL,
      related_id INTEGER,
      related_text TEXT,
      scheduled_for TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      dismissed_at DATETIME
    );
    CREATE INDEX IF NOT EXISTS idx_staleness_kind_item ON pending_staleness_reviews(kind, item_id, dismissed_at);

    CREATE TABLE IF NOT EXISTS online_resources (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      url TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL DEFAULT '',
      platform TEXT NOT NULL DEFAULT 'web',
      thumbnail TEXT,
      topic TEXT NOT NULL DEFAULT 'General',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_online_resources_topic ON online_resources(topic, created_at DESC);

    CREATE TABLE IF NOT EXISTS brain_pulses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      generated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      category TEXT NOT NULL,
      headline TEXT NOT NULL,
      detail TEXT,
      source_capture_ids TEXT,
      seen_at DATETIME,
      dismissed_at DATETIME,
      notified INTEGER DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_brain_pulses_generated ON brain_pulses(generated_at, dismissed_at);

    CREATE TABLE IF NOT EXISTS pending_actions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      capture_id INTEGER NOT NULL UNIQUE,
      action_json TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (capture_id) REFERENCES captures(id)
    );

    CREATE TABLE IF NOT EXISTS meeting_summaries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      recorded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      duration_minutes INTEGER DEFAULT 0,
      headline TEXT,
      key_decisions TEXT,
      action_items TEXT,
      open_questions TEXT,
      next_steps TEXT,
      attendees TEXT,
      raw_transcript TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_open_loops_status ON open_loops(status, created_at);
    CREATE INDEX IF NOT EXISTS idx_follow_ups_status ON follow_ups(status, created_at);
    CREATE INDEX IF NOT EXISTS idx_music_captures_status ON music_captures(status, created_at);
    CREATE INDEX IF NOT EXISTS idx_capture_embeddings_capture ON capture_embeddings(capture_id);
    CREATE INDEX IF NOT EXISTS idx_mood_entries_created ON mood_entries(created_at);
    CREATE INDEX IF NOT EXISTS idx_person_contexts_name ON person_contexts(name);

    -- ── Brain Galaxy ──────────────────────────────────────────────────────────
    -- Self-referencing topic tree. depth=0 = Life Area, depth=1 = Topic, depth=2+ = Sub-topic.
    -- path is the full ancestry chain (e.g. "1/4/12/") for O(1) subtree queries.
    CREATE TABLE IF NOT EXISTS brain_topics (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      parent_id     INTEGER REFERENCES brain_topics(id) ON DELETE SET NULL,
      depth         INTEGER NOT NULL DEFAULT 0,
      path          TEXT NOT NULL DEFAULT '',
      name          TEXT NOT NULL,
      emoji         TEXT,
      description   TEXT,
      color_hint    TEXT,
      is_misc       INTEGER DEFAULT 0,
      is_archived   INTEGER DEFAULT 0,
      item_count    INTEGER DEFAULT 0,
      created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_brain_topics_parent ON brain_topics(parent_id);
    CREATE INDEX IF NOT EXISTS idx_brain_topics_path   ON brain_topics(path);
    CREATE INDEX IF NOT EXISTS idx_brain_topics_depth  ON brain_topics(depth, is_archived);

    -- Polymorphic join: any extracted artifact → topic
    CREATE TABLE IF NOT EXISTS topic_items (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      topic_id      INTEGER NOT NULL REFERENCES brain_topics(id) ON DELETE CASCADE,
      table_name    TEXT NOT NULL,
      row_id        INTEGER NOT NULL,
      confidence    REAL DEFAULT 1.0,
      classified_by TEXT DEFAULT 'user',
      created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(table_name, row_id, topic_id)
    );
    CREATE INDEX IF NOT EXISTS idx_topic_items_topic ON topic_items(topic_id, table_name);
    CREATE INDEX IF NOT EXISTS idx_topic_items_row   ON topic_items(table_name, row_id);

    -- LLM-proposed merge candidates between similar topics
    CREATE TABLE IF NOT EXISTS topic_merge_proposals (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      topic_a_id      INTEGER NOT NULL REFERENCES brain_topics(id) ON DELETE CASCADE,
      topic_b_id      INTEGER NOT NULL REFERENCES brain_topics(id) ON DELETE CASCADE,
      similarity_score REAL NOT NULL,
      reason          TEXT,
      status          TEXT DEFAULT 'pending',
      created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
      resolved_at     DATETIME
    );
    CREATE INDEX IF NOT EXISTS idx_merge_proposals_status ON topic_merge_proposals(status, created_at);

    -- One-time seeding run record
    CREATE TABLE IF NOT EXISTS topic_seeding_runs (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      run_at        DATETIME DEFAULT CURRENT_TIMESTAMP,
      capture_count INTEGER,
      proposed_json TEXT,
      status        TEXT DEFAULT 'pending'
    );
  `);

  // item_count denormalized triggers (kept in TS — SQLite trigger syntax is fragile in execAsync)
  // Triggers are skipped; item_count is maintained by insertTopicItem / removeTopicItem helpers.

  // ── Dev log table (in-app AI call history for debugging) ──────────────────────────────────
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS dev_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      category TEXT NOT NULL,
      model TEXT NOT NULL DEFAULT '',
      input_preview TEXT NOT NULL DEFAULT '',
      output_preview TEXT NOT NULL DEFAULT '',
      duration_ms INTEGER NOT NULL DEFAULT 0,
      error TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_dev_log_created ON dev_log(created_at DESC);
    -- Self-improving brain (propose-and-confirm): when a new capture corrects/enriches an earlier
    -- note, a proposal is recorded here; the user applies/dismisses it (never auto-rewrites memory).
    CREATE TABLE IF NOT EXISTS memory_update_proposals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      new_capture_id INTEGER NOT NULL,
      old_capture_id INTEGER NOT NULL,
      kind TEXT NOT NULL DEFAULT 'enrichment',
      summary TEXT NOT NULL DEFAULT '',
      suggested_context TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'open'
    );
    CREATE INDEX IF NOT EXISTS idx_memupd_status ON memory_update_proposals(status, created_at DESC);
    -- Hot-path indexes (core-logic audit 2026-06-17): these tables were scanned with status filters /
    -- range queries but had no supporting index — fine at MVP scale, slow as the memory store grows.
    CREATE INDEX IF NOT EXISTS idx_todos_status ON todos(status, archived_at);
    CREATE INDEX IF NOT EXISTS idx_reminders_status_remind ON reminders(status, remind_at);
    CREATE INDEX IF NOT EXISTS idx_expenses_created ON expenses(created_at);
    CREATE INDEX IF NOT EXISTS idx_expenses_category ON expenses(category);
    CREATE INDEX IF NOT EXISTS idx_scheduled_blocks_status_range ON scheduled_blocks(status, start_at, end_at);
  `);

  // ── lucy_notifications column migrations (schema evolved across builds 1.0.95→1.0.101) ──
  // The table was created without identifier/expired_at/scheduled_for/entity_* columns.
  // ALTER TABLE is safe to run on every startup — IF NOT EXISTS equivalent via column check.
  const notifCols = await db.getAllAsync<{ name: string }>('PRAGMA table_info(lucy_notifications)');
  if (notifCols.length > 0) {
    const nc = new Set(notifCols.map((c) => c.name));
    if (!nc.has('identifier'))    await db.execAsync('ALTER TABLE lucy_notifications ADD COLUMN identifier TEXT;');
    if (!nc.has('scheduled_for')) await db.execAsync('ALTER TABLE lucy_notifications ADD COLUMN scheduled_for DATETIME;');
    if (!nc.has('entity_id'))     await db.execAsync('ALTER TABLE lucy_notifications ADD COLUMN entity_id TEXT;');
    if (!nc.has('entity_kind'))   await db.execAsync('ALTER TABLE lucy_notifications ADD COLUMN entity_kind TEXT;');
    if (!nc.has('expired_at'))    await db.execAsync('ALTER TABLE lucy_notifications ADD COLUMN expired_at DATETIME;');
  }

  const vaultCols = await db.getAllAsync<{ name: string }>('PRAGMA table_info(vault_items)');
  if (vaultCols.length > 0) {
    const vc = new Set(vaultCols.map((c) => c.name));
    if (!vc.has('keywords')) await db.execAsync('ALTER TABLE vault_items ADD COLUMN keywords TEXT;');
    if (!vc.has('hash')) await db.execAsync('ALTER TABLE vault_items ADD COLUMN hash TEXT;');
    if (!vc.has('orig_path')) await db.execAsync('ALTER TABLE vault_items ADD COLUMN orig_path TEXT;');
    if (!vc.has('orig_mime')) await db.execAsync('ALTER TABLE vault_items ADD COLUMN orig_mime TEXT;');
  }

  // Health / nutrition vertical (calorie intake + body profile + goals).
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS body_profile (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      sex TEXT, birth_year INTEGER, height_cm REAL, weight_kg REAL, body_fat_pct REAL,
      activity_level TEXT DEFAULT 'moderate', goal TEXT DEFAULT 'maintain',
      gentle_mode INTEGER DEFAULT 0, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS nutrition_goals (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      calorie_goal INTEGER, protein_g INTEGER, carbs_g INTEGER, fat_g INTEGER, water_ml INTEGER,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS food_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date_key TEXT NOT NULL, meal_type TEXT, name TEXT NOT NULL, qty REAL, unit TEXT,
      calories REAL, protein_g REAL, carbs_g REAL, fat_g REAL, fiber_g REAL, sugar_g REAL, sodium_mg REAL,
      source TEXT, confidence TEXT, photo_uri TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_food_log_date ON food_log(date_key);
    CREATE TABLE IF NOT EXISTS medications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL, dosage TEXT, times TEXT, notes TEXT,
      active INTEGER DEFAULT 1, created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS medication_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      medication_id INTEGER NOT NULL, date_key TEXT NOT NULL, time_label TEXT,
      taken_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_medication_log_date ON medication_log(medication_id, date_key);
  `);

  // Voice conversations ("Hey Lucy" / tap-the-face) — persisted so they can be reviewed in-app + web.
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS voice_conversations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      started_at DATETIME DEFAULT CURRENT_TIMESTAMP, ended_at DATETIME, screen_context TEXT
    );
    CREATE TABLE IF NOT EXISTS voice_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id INTEGER NOT NULL, role TEXT NOT NULL, text TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_voice_messages_conv ON voice_messages(conversation_id, id);
  `);

  // Circuit breaker: if a device-calendar read was in-flight when the app last died, expo-calendar
  // likely crashed natively on a bad event. Auto-pause calendar sync so the app stops crash-looping
  // (the user can resume it from the calendar). Self-healing — runs once per startup.
  try {
    const inflight = await db.getFirstAsync<{ value: string }>("SELECT value FROM settings WHERE key = 'cal_read_inflight'");
    if (inflight?.value === '1') {
      await db.runAsync("INSERT INTO settings (key, value) VALUES ('device_calendar_sync', 'off') ON CONFLICT(key) DO UPDATE SET value = 'off'");
      await db.runAsync("INSERT INTO settings (key, value) VALUES ('cal_read_inflight', '') ON CONFLICT(key) DO UPDATE SET value = ''");
    }
  } catch { /* settings table absent on very first run — nothing to break */ }
}
