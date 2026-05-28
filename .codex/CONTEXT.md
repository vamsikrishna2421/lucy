# LUCY — Your Second Brain, Always Listening

## Agent Protocol

Before coding, read this file plus `PROGRESS.md` and `TODO.md`. After every working session, update `PROGRESS.md`, `TODO.md`, `SESSION_LOG.md`, `DECISIONS.md`, and `ERRORS.md`.

## Product

LUCY is a privacy-first passive AI companion that captures natural speech and organizes tasks, expenses, ideas, places, resources, people context, decisions, preferences, and reminders. It must work for any user and language, including code-switched input such as Tanglish. Nothing in implementation may hardcode user-specific people, projects, businesses, folders, or categories.

For the MVP, speech transcription is external: a user dictates through the WhisperFlow keyboard into a text field. A future share-sheet path accepts text without opening the app first. Native audio recording, Whisper, and passive always-on capture are deliberately outside Phase 1.

## Privacy Contract

All data remains on-device by default. Every item has one privacy level:

- `private`: on-device only, encrypted, local LLM only, never synchronized.
- `local`: on-device and eligible for user-controlled personal-device synchronization.
- `normal`: standard processing; external AI is allowed only when configured.

Before external AI processing, scan text for sensitive content such as confidential ideas or business plans, credentials, account details, health information, or intimate relationship content. Sensitive input must be forced to `private` and processed locally. Ideas default to `private`. User override comes later. Private items must never be written to vault markdown.

## Architecture

```text
Capture (WhisperFlow text in Phase 1)
  -> sensitivity scan and privacy routing
  -> AIProvider only (Claude for configured normal content, Ollama for private/offline)
  -> review before save
  -> encrypted SQLite structured data + markdown vault for non-private captures
  -> dashboard and later notifications/widgets
```

All AI calls must go through `src/ai/provider.ts`. Business logic must not call Claude or Ollama implementations directly. Provider surface:

```ts
AIProvider.analyze(transcript, privacyLevel)
AIProvider.urgentScan(transcript, privacyLevel)
AIProvider.summarize(notes, privacyLevel)
```

Routing rules: `private` and `local` use Ollama only; `normal` may use Claude after explicit external-processing opt-in; offline mode forces Ollama. A local-provider failure must never cause private input to fall through to an external service.

## Processing Tiers

- Tier 1, every 5 minutes: cheap urgent reminder or appointment scan.
- Tier 2, every 2 hours: deep extraction from accumulated transcript text.
- Tier 3, daily at a configurable time: digest, deduplication, interest graph, and suggested priorities.

Only the Phase 1 direct text deep-extraction path is implemented initially.

## Extraction Schema

Every extraction produces English field values irrespective of input language:

```json
{
  "title": "string",
  "summary": "string",
  "note_type": "thought|task|idea|decision|meeting|journal|resource|reminder|project_update",
  "detected_language": "english|hindi|telugu|tanglish|mixed|other",
  "privacy_level": "private|local|normal",
  "privacy_reason": "string",
  "projects": ["string"],
  "areas": ["string"],
  "people": ["string"],
  "tasks": [{"task":"string","category":"youtube|place|idea|learning|errand|call|expense|other","urgency":"high|medium|low","context":"string"}],
  "expenses": [{"amount":"string","description":"string","category":"food|transport|shopping|entertainment|other"}],
  "ideas": [{"title":"string","description":"string","type":"startup|creative|personal|other"}],
  "places": [{"name":"string","reason":"string","urgency":"soon|someday"}],
  "interests": [{"topic":"string","strength":"strong|moderate","evidence":"string"}],
  "decisions": ["string"],
  "reminders": [{"text":"string","time":"ISO 8601 string or null","urgency":"high|medium|low"}],
  "tags": ["string"],
  "suggested_folders": ["string"],
  "low_audio_warning": false,
  "clarifications": [{"snippet":"string","question":"string"}]
}
```

## Storage

SQLite is the queryable on-device source of truth. Required tables are:

```sql
CREATE TABLE captures (id INTEGER PRIMARY KEY AUTOINCREMENT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, source TEXT, raw_transcript TEXT, privacy_level TEXT DEFAULT 'normal', processed INTEGER DEFAULT 0);
CREATE TABLE todos (id INTEGER PRIMARY KEY AUTOINCREMENT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, capture_id INTEGER, task TEXT, category TEXT, urgency TEXT, context TEXT, privacy_level TEXT DEFAULT 'normal', status TEXT DEFAULT 'pending', FOREIGN KEY (capture_id) REFERENCES captures(id));
CREATE TABLE expenses (id INTEGER PRIMARY KEY AUTOINCREMENT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, capture_id INTEGER, amount REAL, description TEXT, category TEXT, privacy_level TEXT DEFAULT 'normal', FOREIGN KEY (capture_id) REFERENCES captures(id));
CREATE TABLE ideas (id INTEGER PRIMARY KEY AUTOINCREMENT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, capture_id INTEGER, title TEXT, description TEXT, type TEXT, privacy_level TEXT DEFAULT 'private', FOREIGN KEY (capture_id) REFERENCES captures(id));
CREATE TABLE places (id INTEGER PRIMARY KEY AUTOINCREMENT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, capture_id INTEGER, name TEXT, reason TEXT, urgency TEXT, privacy_level TEXT DEFAULT 'normal', status TEXT DEFAULT 'pending', FOREIGN KEY (capture_id) REFERENCES captures(id));
CREATE TABLE interests (id INTEGER PRIMARY KEY AUTOINCREMENT, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP, topic TEXT UNIQUE, strength TEXT, mention_count INTEGER DEFAULT 1, evidence TEXT);
CREATE TABLE reminders (id INTEGER PRIMARY KEY AUTOINCREMENT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, capture_id INTEGER, text TEXT, remind_at DATETIME, urgency TEXT, privacy_level TEXT DEFAULT 'normal', status TEXT DEFAULT 'pending', FOREIGN KEY (capture_id) REFERENCES captures(id));
CREATE TABLE people (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, first_seen DATETIME DEFAULT CURRENT_TIMESTAMP, last_mentioned DATETIME, context TEXT);
CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);
```

Implementation also keeps an append-only `extractions` ledger containing each normalized structured interpretation for a capture. This preserves the history needed for future reprocessing, recategorization, and intelligence improvements without overwriting source input.

Markdown is an Obsidian-compatible human-readable vault for non-private content only. It begins with generic folders:

```text
vault/Inbox  vault/Daily  vault/Memory  vault/Projects  vault/Areas
vault/People  vault/Ideas  vault/Tasks  vault/Decisions  vault/Resources  vault/Archive
```

Project, area, and person structures are created only from extracted content. Notes are append-only and contain YAML metadata plus Summary, Original Input, Tasks, Expenses, Ideas, Decisions, Reminders, Places, Interests, Related Links, and Suggested Next Actions sections.

## Technical Direction

- Mobile: React Native + Expo + TypeScript.
- On-device data: `expo-sqlite`, SQLCipher where private data is present, and `expo-file-system`.
- Device key protection: `expo-secure-store`; random generation: `expo-crypto`.
- Notifications/task scheduling: `expo-notifications`, `expo-task-manager` in later phases.
- Normal extraction: Anthropic Claude Haiku through the provider boundary.
- Private extraction: Ollama `phi3` through the provider boundary.
- Optional desktop/web dashboard is deferred.

Direct mobile embedding of an Anthropic API key is acceptable only for prototype validation, never for a distributed build.

## Phases

1. React Native text-capture app, SQLite, vault, privacy/provider pipeline, review, and dashboard. WhisperFlow keyboard supplies clean text; microphone control is a coming-soon placeholder.
2. WhisperFlow Share Sheet receiver for iOS and Android.
3. Tiered background processing and notifications.
4. iOS surfacing, widgets, and app-open triggers.
5. Local LLM/full offline hardening and quality comparison.
6. Native in-app audio recording, Whisper, and VAD.
7. Android foreground always-on capture.
8. Interest graph, semantic search, patterns, and proactive intelligence.

## Phase 1 Exit Criteria

User can dictate or type text, review the extracted result, save it, and see todos, ideas, expenses, places, and interests in the dashboard. Privacy routing must mark ideas private and omit them from markdown; normal todos and expenses must create markdown notes. Validate behavior with at least three Tanglish text examples. Do not build audio, Whisper, or share-sheet integration in Phase 1.
