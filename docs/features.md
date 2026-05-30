# LUCY — Complete Feature Reference
*Last updated: 2026-05-30*

LUCY = **L**isten · **U**nderstand · **C**onnect · **Y**ield

---

## Table of Contents
1. [Capture](#1-capture)
2. [Board (Task Management)](#2-board-task-management)
3. [Dashboard — Today Tab](#3-dashboard--today-tab)
4. [Ask LUCY](#4-ask-lucy)
5. [AI Insights](#5-ai-insights)
6. [Automation Engine](#6-automation-engine-phase-1)
7. [Meeting Intelligence](#7-meeting-intelligence)
8. [Passive Listening](#8-passive-listening)
9. [Calendar Integration](#9-calendar-integration)
10. [Device Intelligence](#10-device-intelligence)
11. [Proactive Notifications](#11-proactive-notifications)
12. [Memory Architecture](#12-memory-architecture)
13. [Connectors & Permissions](#13-connectors--permissions)
14. [Settings & Intelligence Tiers](#14-settings--intelligence-tiers)
15. [Privacy Architecture](#15-privacy-architecture)
16. [Onboarding](#16-onboarding)
17. [LUCY vs Competitors](#17-lucy-vs-competitors)

---

## 1. Capture

The Board screen is the primary capture surface. Every capture method feeds into the same processing pipeline.

### Text Capture
- Multiline text input with placeholder "What's on your mind?"
- Supports unstructured, natural-language input — no formatting needed
- Send button triggers processing; acknowledgement toast confirms

### Voice Capture
- On-device speech-to-text via iOS SFSpeechRecognizer (react-native-voice) when available
- Whisper fallback: records high-quality audio then transcribes with expo-audio
- WhatsApp-style mic button: scales and morphs corners when recording
- Tap once to start, tap again to stop — result appended to text field

### Privacy Toggle
- Per-capture "Contains private details" checkbox
- When checked: on-device intelligence masks sensitive content before any remote call
- Acknowledgement changes to "Protected thought queued"
- Private captures remain fully readable in the app; masking only applies to remote AI

### Processing Pipeline
After capture, every thought is:
1. Queued for structured extraction (tasks, expenses, reminders, ideas, people, places, interests)
2. Assigned a privacy level (normal / local / private)
3. Optionally transcribed and structured by the local or remote AI model
4. Stored in SQLite with full original text always preserved

---

## 2. Board (Task Management)

The Board is the persistent, living todo list that LUCY maintains from all your captures.

### Task Display
- Tasks auto-extracted from any capture containing action language
- Grouped by context (project/area LUCY detects) with "Urgent" group always first
- Urgent badge shown for high-urgency tasks
- Context labels shown in uppercase above each group

### Animated Completion
- Tap circle to mark done: animated check bounce, strikethrough animation, row fades out
- Done items move to "Done today" section below a divider
- Undo available immediately after marking complete
- Optional completion note captured when marking done (adds context to memory)

### Task Editing
- Long-press or tap ⋯ to open edit modal
- Inline text editing with Save / Delete actions

### Hero Section (Board Top)
- Shows greeting based on time of day (Good morning / afternoon / evening) with user's name
- LUCY IS ACTIVE card: live count of urgent signals or "All caught up"
- Collapses on scroll into a compact header with status pills
- Compact header shows: Meeting mode status, Passive listen status (with word count), Background processing mode

---

## 3. Dashboard — Today Tab

Five views accessible via a pill-style navigation:

### Now View (default)
- **Tonight card**: priority item count, organizing status
- **Mood trend bar**: weekly dominant mood with 7 colored dots (emoji + label)
- **On This Day**: memories from the same calendar date in past years — shows title, snippet, years ago, and a count of additional memories
- **Needs Context prompt**: if LUCY has clarifying questions, surfaces a tap-to-open prompt
- **Follow-ups**: trackable "Sam said he'll do X" items, with Done button
- **Reminders**: scheduled notifications with time; count of unscheduled reminders
- **Focus tasks**: top 3 high-urgency tasks or first 3 pending if none urgent

### Context View
- LUCY's clarifying questions: things where adding context would improve memory accuracy
- User types an answer and taps "Tell LUCY" — triggers re-organization pass
- Original thoughts never modified; context stored separately

### Memory View (Knowledge Map)
- **Learned Signals**: AI-derived insights with confidence levels
- **Connections**: entity relationships (person relates to project, etc.) with explanation
- **Known Topics**: all extracted entities (people, projects, ideas) with type, confidence, and evidence count
- Summary of last organization run (timestamp and trigger)

### Captured View
- Chronological list of recent captures (last 12)
- Semantic search: vector similarity search across all memories with debounced 300ms delay
- Per-capture: title, raw text, extracted key points, timestamp
- Status badge: Remembered / Organizing / etc.
- Privacy badge per item
- "View structure" toggle: reveals full structured memory text
- Updates/follow-ons linked to parent captures
- **AI Actions menu** per capture: Summarize, Improve writing, Extract action items, Translate to English, Explain this, Structure notes
- **Memory correction**: tap ? to submit a correction; LUCY re-processes with the correction

### Library View
Six tabs for browsing organized memory:
- **Todos**: all tasks with category, urgency, status
- **Ideas**: captured ideas with title and description
- **Expenses**: amounts and categories extracted from speech
- **Places**: mentioned locations with reason noted
- **Interests**: topics LUCY detected as persistent interests, with strength and mention count
- **People**: everyone mentioned in captures — mention count, last seen date, pending follow-ups

---

## 4. Ask LUCY

A conversational interface for querying your own memory.

### Chat Interface
- Threaded conversations with persistent history
- Messages stored locally per thread
- Welcome message with example suggested question
- Multi-turn follow-ups within a thread
- "Looking through memory..." state while processing

### Answer Types
- **Tasks & deadlines**: filtered, de-duplicated list with dates
- **Memory answer**: topic exploration with connections and cited sources
- **Spending answer**: expense breakdown by category with remembered payments
- **LLM response**: free-form answer with cited source chips (title + snippet from your memory)

### Automation Intent Detection
- Before sending to LLM, LUCY scans for automation intent
- If confidence ≥ 0.85, shows a confirmation card instead of a chat bubble
- User confirms in one tap; LUCY executes the action
- See [Automation Engine](#6-automation-engine-phase-1) for supported actions

### History
- All threads listed with first question and message count
- Tap any thread to re-open and continue the conversation

---

## 5. AI Insights

The Insights panel (Ask → ✦ Insights) surfaces what LUCY has noticed about your life.

### Generated Insights
- LUCY generates 6 insight questions per day based on your actual captures and patterns
- Categories: habits, relationships, progress, wellbeing, memory, device
- Each insight is a question LUCY can already answer — tap to reveal the answer
- "Ask follow-up →" button sends the question into a new chat thread
- Powered by GPT via remote intelligence (requires OpenAI key)

### Device Intelligence Insights (always available)
When no stored insights exist, LUCY surfaces four device-derived insights immediately:
1. **Capture rhythm**: most active hour, most active day, average captures per day
2. **Battery pattern**: which day of the week drains fastest, usage correlation
3. **Mood correlation**: how mood score connects to capture activity
4. **Top insight**: the single most actionable observation about current patterns

---

## 6. Automation Engine (Phase 1)

LUCY detects action intent in natural language and can execute it with one confirmation tap.

### Supported Actions

| Intent | Trigger Examples | What Happens |
|--------|-----------------|--------------|
| **Timer** | "Set a 20 minute timer", "15 min timer" | Opens iOS Shortcuts or Android alarm with duration |
| **Call** | "Call Mom", "Phone Sarah now" | Looks up contact, dials via tel: URL scheme |
| **Navigate** | "Navigate to the office", "Directions to Hyderabad" | Opens Maps (Apple or Google) with destination |
| **Play music** | "Play Focus playlist", "Put on jazz" | Opens Spotify (if installed) or Apple Music |
| **Create reminder** | "Add milk to grocery list", "Reminder to call dentist" | Writes to iOS Reminders via Calendar API |
| **Send message** | "Text Sam: I'll be 10 minutes late" | Pre-fills SMS/iMessage to contact |
| **iOS Shortcut** | "Run my morning routine shortcut" | Triggers named iOS Shortcut via URL scheme |

### Confidence Threshold
- Pattern matching with regex; only presented if confidence ≥ 0.85
- Always shows a confirmation card with the action description
- User can cancel ("Not now") — never executes without explicit confirmation

---

## 7. Meeting Intelligence

### Meeting Mode
- Accessible via "Meeting" pill in the compact header or Board screen
- Phase flow: Idle → Naming → Recording → Processing → Summary

**Recording Phase:**
- Optional meeting title (defaults to "Meeting")
- Live duration counter with pulsing red dot
- Live word count from passive listener
- End meeting button stops recording

**Processing Phase:**
- Transcript collected from passive listener buffer
- Sent to remote AI (GPT) for structured extraction

**Summary:**
- **Headline**: one-sentence meeting description
- **Key Decisions**: explicit decisions made in the meeting
- **Action Items**: task + owner + deadline for each item
- **Open Questions**: unresolved questions raised
- **Next Steps**: narrative of what happens after
- **Attendees Mentioned**: names detected in transcript
- Save to LUCY Memory: stores structured summary + full transcript as a capture

### Pre-Meeting Brief (Calendar-driven)
- 30 minutes before any calendar meeting, LUCY sends a notification
- Brief pulls from: attendee relationship history, recent captures mentioning the meeting/attendees, upcoming event details
- Enriched with GPT when remote intelligence is enabled (2 sentences, specific and actionable)
- Fallback: simple "Meeting X in N minutes at time" without LLM

### Post-Meeting Prompt
- 15 minutes after a calendar meeting ends, LUCY sends "capture your notes before they fade"
- Only fires once per event (tracked by event ID)

---

## 8. Passive Listening

Continuous background transcription — the "always listening" second brain.

### How It Works
- Start/Stop via Connectors screen or header pill
- **On-device STT** (iOS): uses SFSpeechRecognizer via react-native-voice for real-time transcription; auto-restarts every 50 seconds
- **Whisper fallback**: records in HIGH_QUALITY batches, transcribes and deletes audio file
- Word count tracked in real time; shown in header compact pill

### Batch Processing
- Configurable batch interval (default: 10 minutes)
- Batches only enqueued if ≥ 5 words captured
- Full session transcript accumulated for Meeting Mode consumption

### Indicators
- Orange indicator visible on screen when active (iOS requirement)
- Word count shown in header ("Listen: 342w")
- Red dot + "Recording meeting" in Meeting Mode recording phase

### Privacy
- Audio files deleted immediately after transcription (never stored)
- Haptic signal when listening starts (consent signal)
- Orange indicator serves as a visual consent signal

---

## 9. Calendar Integration

### Setup
- One-tap permission grant via Connectors screen or Settings
- Read-only access to device calendar events

### What LUCY Does With Calendar
1. **Ask context**: upcoming events injected into every Ask query ("Today 3pm: Budget review with Sarah IN 20 MINUTES")
2. **Pre-meeting briefs**: notification 30 minutes before, enriched with relationship history
3. **Post-meeting prompts**: notification 15 minutes after meeting ends
4. **Answer "What meetings do I have today?"**

### Event Filtering
- All-day events excluded from briefs (scheduled events only)
- Next 7 days fetched for Ask context
- Next 12 hours for brief triggering

---

## 10. Device Intelligence

LUCY reads device signals to derive life intelligence — not screen time reports, but meaningful observations.

### Battery Patterns
- Battery level recorded passively every few hours
- Detects which day of the week has heaviest drain
- Answers "What is my battery level?" in Ask
- Identifies busiest days by battery correlation

### Capture Patterns
- Tracks total captures per day, per hour, per day-of-week
- Reports: most active hour, most active day, average thoughts per day this week
- Used in daily insights and morning brief

### Mood Tracking
- Tone detected in every capture (positive, excited, calm, neutral, stressed, frustrated, negative)
- 7-day trend with dominant mood and positive/negative ratio
- Visualized as color dots in the Now view
- Fed into morning briefs and weekly insights

### Location Context (optional)
- City/area level only (not precise GPS)
- Answers "Where am I?" in Ask
- Adds location context to daily brief
- Detects time zone changes automatically

---

## 11. Proactive Notifications

LUCY reaches out to you — you don't have to check in.

### Morning Brief (7am – 9am daily)
- Checks overdue items (urgency-scored), open loops, follow-up count, relationship gaps, and mood trend
- LLM-synthesized into a warm, personal message (under 120 words) when remote intelligence is enabled
- Sent once per day, first run between 7–9am

### Weekly Insight (Sunday 6pm – 9pm)
- Analyzes past week's captures, overdue items, mood trend, and relationship gaps
- 2–3 sentence insight: patterns, delays, things worth reflecting on
- LLM-synthesized or rule-based fallback

### On This Day
- Checks for captures from the same calendar date in past years
- Surfaces as a notification ("2 years ago: your meeting with Sam about the launch")
- Also shown as a card in the Now view
- Triggers once per day, skips private captures

### Progress Check-ins (optional)
- Every 2 hours from 8am to 6pm
- Nudge to capture work updates
- Toggleable in Connectors and Settings

---

## 12. Memory Architecture

### Capture Storage
- Every capture stored with: raw transcript, extracted title, structured text, privacy level, processing status
- Structured text is a key-value format extracted by AI: type, summary, people, actions, deadlines, expenses, ideas
- Parent-child relationship for corrections and updates

### Knowledge Entities
- LUCY extracts named entities: people, projects, places, organizations, interests
- Each entity has: name, type, confidence, evidence count, privacy level
- Entities accumulate evidence across captures over time

### Knowledge Connections
- Relationships between entities: "Sam works on Q3 project", "Budget is related to Design team"
- Each connection has: source, target, relation type, explanation, confidence

### Knowledge Insights
- Higher-level observations derived from multiple captures: "You tend to stress about deadlines on Thursdays"
- Stored with confidence; used in Ask responses

### Open Loops & Follow-ups
- Open loops: "I'll come back to this later" type items — tracked until resolved
- Follow-ups: "Sam said he'll send it by Friday" — assignee + action + due date
- Both shown in Now view and resolvable with a tap

### Embeddings / Vector Search
- Captures embedded as vectors for semantic similarity search
- Powers the search bar in Captured view (find memories by meaning, not keyword)
- Threshold: 0.1 similarity minimum

### Person Context Engine
- Tracks every person mentioned: mention count, last mentioned date, typical context, pending follow-ups
- Used in pre-meeting briefs and relationship gap detection
- Shown in the People tab of Library

### Mood Engine
- Tone classification per capture
- 7-day and 14-day trend calculations
- Positive ratio, dominant mood, recent tone sequence
- Fed into morning briefs, weekly insights, and Insights panel

### Organization Runs
- Triggered: manually, automatically on background, or after clarification answers
- Rebuilds entity map, connections, and insights from stored memories
- Run log stored with: summary, entity count, connection count, trigger type, timestamp

---

## 13. Connectors & Permissions

All connectors are explained and toggled individually. Nothing connects without user action.

| Connector | What It Accesses | What LUCY Does |
|-----------|-----------------|----------------|
| **Calendar** | Device calendar events (read-only) | Pre-meeting briefs, post-meeting prompts, Ask context |
| **Location** | City/area (foreground, when app open) | Location in Ask, time zone detection |
| **Battery patterns** | Battery level every few hours | Detect busy days, answer "What's my battery?" |
| **Progress check-ins** | Notification permission | Nudge every 2h during the day to capture |
| **Passive listening** | Microphone permission | Continuous transcription in 10-minute batches |
| **Meeting mode** | Microphone permission (shared with passive) | Structured meeting summaries with one tap |

Every connector card shows exactly what permission is needed and exactly what LUCY does with it.

---

## 14. Settings & Intelligence Tiers

### Profile
- Name and "about you" paragraph stored locally
- Used to personalize every LUCY response and AI prompt (e.g., "You are talking to Vamsy, a data engineer...")

### On-Device Intelligence
- Local LLM for structured extraction and privacy masking
- Multiple model options selectable (size vs. depth tradeoff)
- Download once; all processing stays on the phone
- Local quality benchmark: runs test cases to verify the model works correctly

### Remote Intelligence (optional)
- OpenAI API key stored in secure device storage
- GPT-5.4 Nano used for: organization, meeting summaries, daily insights, morning briefs, weekly insights
- Private content masked by on-device model before any remote call
- Toggle on/off independently; key can be removed

### Background Organizing
- System-granted background windows (battery-friendly, no alarms)
- Organizes waiting captures when phone is idle/charging
- Last background run time shown

### Re-Organize Now
- Manual trigger for full memory reorganization
- Shows summary: entity count, connection count

### Reprocess All Memories
- Keeps all original captures; clears derived interpretation
- Rebuilds understanding from scratch using currently selected local model

### Processing Queue
- Real-time view: Queued / Organizing / Will retry / Remembered / Archived counts
- Retries automatic; short unmatched updates archived instead of looping

### Privacy Panel
- Explains the full privacy model
- Clarifies what "masked before sending" means and its current beta status

### Export Data
- Exports all memories as a JSON file: captures, todos, expenses, reminders, ideas, people, open loops, follow-ups
- Shareable via native share sheet

### Delete All Memories
- Wipes all captures, tasks, reminders, expenses, ideas, people, interests, loops, embeddings, mood entries
- App settings preserved; cannot be undone

---

## 15. Privacy Architecture

LUCY was designed from the ground up for privacy. The architecture has four layers:

### Layer 1 — Local-first Storage
- All data stored in SQLite on device
- Never transmitted without user action
- Works fully offline; no account required

### Layer 2 — Privacy Classification
- Every capture classified as: normal / local / private
- User can mark "Contains private details" at capture time
- LUCY's extraction also detects sensitive patterns automatically

### Layer 3 — On-Device Masking
- Before any remote AI call on private content: local model replaces sensitive details with placeholders
- "[PERSON_1] asked about [FINANCIAL_DETAIL_1]" instead of actual names/numbers
- Only placeholder text leaves the device

### Layer 4 — Selective Remote
- Only specific text sent for AI processing (never raw device data, never camera, never location data)
- OpenAI key stored in secure device keychain
- Remote intelligence is entirely optional and off by default

### What Never Leaves the Device
- Audio recordings (deleted after transcription)
- Private-classified captures (in their original form)
- Ideas (always local)
- Raw device data from battery, location, or contacts

---

## 16. Onboarding

Three-slide flow shown on first launch:

1. **Meet LUCY** — "Your private second brain. LUCY quietly captures your thoughts, connects your memories, and surfaces what matters — without you having to organize anything."
2. **Just say it** — Demonstrates natural language capture with the Q3/Sam example
3. **Ask anything** — Shows Ask examples with the "Everything stays on your device" privacy message

Skip button available; "Start capturing" completes onboarding.

---

## 17. LUCY vs Competitors

### What No Competitor Fully Replicates

| Capability | LUCY | Nearest Rival |
|-----------|------|--------------|
| Passive mobile mic listening | On-device, no hardware | Limitless (requires $99 pendant) |
| Structured entity extraction from speech | Tasks + expenses + ideas + people + places in one pass | None |
| Knowledge graph over personal life | Longitudinal, not per-session | Mem.ai (manual), Obsidian (manual plugins) |
| Morning briefs with relationship + mood context | Yes, 7am daily | None |
| On This Day retrospective | Yes, from your own notes | Day One (from photos), Rewind (screen only) |
| Pre-meeting brief from relationship memory | Yes | Limitless (wearable required) |
| Mood tracking from captured text | Yes, automatic | None |
| Private-content masking before remote AI | Yes | None |
| Full local operation with optional remote upgrade | Yes | Reflect Notes (E2E, no AI), Obsidian |

### Where Competitors Are Stronger

| Dimension | Competitor Advantage |
|-----------|---------------------|
| Speaker diarization (who said what) | Otter.ai, Limitless |
| Meeting auto-join | Otter.ai (joins calls automatically) |
| Photo/image OCR | Google Keep, Day One, Capacities |
| Apple Watch extension | Whisper Memos, Day One, 5 others |
| Desktop apps | Notion, Mem, Obsidian, Reflect |
| Collaborative/shared memory | Notion, Mem |
| Plugin ecosystem | Obsidian |
| Health/biometric integration | Apple Journal, Day One |

### Positioning Summary

- **vs Notion AI**: LUCY is mobile-first, passive, private. Notion is collaborative and structured by default.
- **vs Otter.ai**: LUCY captures your whole life, not just meetings. Otter is meeting-specialist with better speaker attribution.
- **vs Limitless**: LUCY runs on your phone. Limitless requires a $99 wearable.
- **vs Apple Journal**: LUCY extracts and organizes. Apple Journal is manual journaling with HealthKit.
- **vs Obsidian**: LUCY requires zero structure from you. Obsidian is powerful but manual.
- **vs Rewind**: LUCY is privacy-first mobile. Rewind records screens (Mac-only, high privacy concern).
- **vs Day One**: LUCY is a second brain, not a journal. Day One is photo-first journaling.
