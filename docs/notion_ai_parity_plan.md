# LUCY — Notion AI Parity Plan

*Last updated: 2026-05-30*

---

## 1. Feature Parity Matrix

| Notion AI Feature | What It Does | LUCY Equivalent | Priority | Backend | Frontend | Data Model | AI Logic | Privacy Notes |
|---|---|---|---|---|---|---|---|---|
| AI writing assistant | Rewrite, improve, fix grammar, translate inline | "Improve this" action on any capture or note | P0 | Prompt templates | Text action menu on cards | None | LLM call with instruction | Mask private captures before remote call |
| Summarize note | One-click summary of any page | Summarize button on Captured cards | P0 | OpenAI/local call | Summary modal on capture card | Add `summary_override` col | System + content prompt | Skip private captures |
| Ask over workspace | Q&A across all notes/memories | Ask LUCY (already built) | P0 ✅ | Vector search + LLM | Ask screen | `capture_embeddings` (built) | RAG with citations | Filter by privacy_level |
| Generate action items | Extract tasks from any text | Already extracted on capture | P0 ✅ | extraction pipeline | Board screen | `todos` table | Extraction prompt | Respect privacy_level |
| Brainstorm ideas | Free-form ideation from a seed | "Brainstorm from this" in Ask | P1 | LLM prompt | Ask screen follow-up action | None | Brainstorm system prompt | Ideas always private |
| Translate text | Translate any selected text | Translate in capture correction flow | P1 | LLM call | Long-press → translate | None | Translate prompt | — |
| Explain text | Explain selected passage | Long-press → explain | P1 | LLM call | Long-press context menu | None | Explain prompt | — |
| Search across workspace | Global semantic search | Search bar in Captured tab (built) | P0 ✅ | Vector search (built) | Search UI (built) | `capture_embeddings` | Cosine similarity | — |
| "What did I say about X?" | Lookup memory by topic | Ask LUCY + vector search | P0 ✅ | Vector search | Ask screen | — | RAG | — |
| Summarize week/period | Time-bounded summary | "Summarize my week" in Ask | P1 | Filter captures by date + LLM | Ask screen | Date-filtered query | Summary prompt with date context | — |
| Source citations | Show which notes were used to answer | Add sources array to LucyAnswer | P0 | Return matched captures | Message bubble shows sources | — | Include source IDs in context | Privacy: skip private captures |
| Auto-tag & organize | AI categorizes notes | Already: tags, projects, areas extracted | P0 ✅ | Extraction pipeline | Library tab | `tags`, `projects` | Extraction prompt | — |
| Create pages from messy notes | Structure unstructured text | "Structure this" action | P1 | LLM call | Action menu | None | Structure prompt | — |
| Meeting notes | Record/transcribe/summarize/action items | Passive listening (built) + meeting mode | P0 | PassiveListener + extraction | Listen button + meeting summary | None | Extraction on transcript | — |
| Detect open loops | Unfinished threads | Open loops (built) | P0 ✅ | Extraction + DB | Loose ends section | `open_loops` | AI extraction | — |
| Detect repeated patterns | Surface recurring themes | Pattern detection (built) | P1 ✅ | Knowledge graph | Today → Memory | `knowledge_entities` | Organizer | — |
| Daily digest | Summary notification | Daily digest (built) | P1 ✅ | Background task | Notification | — | — | — |
| Morning brief | Proactive daily summary | Morning brief (built) | P1 ✅ | Background task | Notification | `mood_entries` | LLM synthesis | — |
| User-created agents | Custom automation workflows | Agent system (P3) | P3 | Agent runner | Agent builder UI | `agents` table | Workflow LLM | Sandboxed |
| Weekly review agent | Automated weekly analysis | Weekly insight (built) | P2 ✅ | Background task | Notification | — | LLM | — |
| Gmail connector | Pull emails into workspace | Gmail OAuth + ingestion | P2 | OAuth + email parser | Settings connector | `connectors` table | Email extraction | User consent required |
| Google Calendar | Events + reminders | Calendar OAuth | P2 | OAuth + event sync | Settings connector | — | Event extraction | — |
| Google Drive | Documents in workspace | Drive OAuth + doc parser | P3 | OAuth + doc fetch | Settings connector | — | Doc extraction | — |
| GitHub | Issues/PRs as tasks | GitHub OAuth | P3 | OAuth + webhook | Settings connector | — | Issue extraction | — |
| Web research | Answer with web context | Web search tool in Ask | P2 | WebSearch MCP | Ask screen | — | RAG with web results | Clearly label web vs memory |
| Relationship intelligence | People context | Person contexts (built) | P1 ✅ | `person_contexts` | People tab in Library | `person_contexts` | — | — |
| Mood tracking | Emotional context | Mood entries (built) | P2 ✅ | `mood_entries` | — (not shown yet) | — | Mood extraction | — |
| "Why did LUCY show this?" | Explainability | Human notification detail screens (built) | P0 ✅ | — | Notification detail modal | — | Explanation prompt | — |
| User-controlled deletion | GDPR-style data control | Not built | P1 | DB delete cascade | Settings → Data | — | — | Critical for trust |
| Activity logs | What AI did and why | Not built | P2 | `activity_log` table | Settings → Activity | — | — | — |
| Export user data | Download all memories | Not built | P2 | JSON export function | Settings | — | — | Privacy requirement |
| Per-source permissions | Control what AI can read | Privacy levels (partial) | P1 | `privacy_level` per capture | Privacy toggle (built) | — | Filter by level | — |
| Local redaction | Mask private before cloud | Built (partial) | P0 ✅ | Remote redaction module | — | — | Masking prompt | Core privacy guarantee |

---

## 2. Current Codebase Audit

### Implemented (✅)
- Manual capture → AI extraction (tasks, expenses, reminders, decisions, ideas, people, loose ends, follow-ups, mood)
- Passive listening (expo-audio + Whisper fallback)
- Vector embeddings (OpenAI + keyword fingerprint fallback)
- Semantic search bar in Captured tab
- Cross-capture context injection at extraction time
- Ask LUCY with LLM answers from memory context
- Knowledge graph (entities, connections, insights)
- Morning brief (7-9am daily, LLM-synthesized)
- Weekly insight (Sunday evenings)
- Relationship intelligence (`person_contexts`)
- Temporal urgency engine
- Cascade reminders (15/10/5 min before + at time)
- Pattern detection notification
- Daily digest notification
- Human notification detail screens
- Memory correction (? button)
- Board whiteboard with task animations
- Mood extraction and storage
- Local redaction before remote AI calls
- User profile (name + about → injected into AI)

### Partially Implemented (⚠️)
- Source citations: Ask LUCY answers but doesn't show which captures were used
- Mood display: extracted and stored but not shown in UI
- "Improve this" / "Summarize this": not exposed as user actions on cards
- Activity logs: no tracking of what AI did and why
- User data export: not built

### Missing (❌)
- Source citations in Ask answers
- Text actions menu (rewrite, improve, translate, explain, summarize)
- Create structured page from messy note
- User-controlled data deletion
- Activity/audit log
- Export user data
- Connectors (Gmail, Calendar, Drive, GitHub)
- Web research in Ask
- Agent builder / custom agents
- Admin controls

### Technical Debt
- Garbage files accumulate in git root (fix: add proper `.gitignore` entries)
- `@react-native-voice/voice` incompatible with RN 0.76 — STT fallback only works via Whisper
- Android local builds fail due to CMake path issue on Windows — use EAS always

---

## 3. Architecture Design

```
┌─────────────────────────────────────────────────────────┐
│                     LUCY ARCHITECTURE                    │
├─────────────────────────────────────────────────────────┤
│  CAPTURE LAYER                                          │
│  Manual text → enqueueTranscript()                      │
│  Passive audio → expo-audio → Whisper → enqueue         │
│  Connectors → Gmail/Calendar/Drive adapters → enqueue   │
├─────────────────────────────────────────────────────────┤
│  EXTRACTION LAYER                                       │
│  AI extraction prompt → structured JSON                 │
│  Mood, tasks, people, expenses, reminders, loops        │
│  Cross-capture context injection (vector search)        │
│  Privacy masking before remote calls                    │
├─────────────────────────────────────────────────────────┤
│  MEMORY STORE (SQLite + SQLCipher)                      │
│  captures, todos, reminders, expenses, ideas, places    │
│  open_loops, follow_ups, knowledge_entities             │
│  capture_embeddings, person_contexts, mood_entries      │
│  connectors, activity_log (to add)                      │
├─────────────────────────────────────────────────────────┤
│  INTELLIGENCE LAYER                                     │
│  Vector search (cosine similarity on embeddings)        │
│  Knowledge graph organizer                              │
│  Temporal urgency engine                                │
│  Relationship engine                                    │
│  Morning brief / weekly insight generators              │
├─────────────────────────────────────────────────────────┤
│  ANSWER ENGINE (Ask LUCY)                              │
│  RAG: question → embeddings → top-K captures           │
│  LLM: system prompt + context + question → answer      │
│  Citations: return source capture IDs with answer      │
│  Text actions: rewrite/summarize/translate/explain     │
├─────────────────────────────────────────────────────────┤
│  PROACTIVE ENGINE (Background)                          │
│  Pattern detection                                      │
│  Morning brief                                          │
│  Weekly insight                                         │
│  Cascade reminders                                      │
│  Relationship gap alerts                                │
├─────────────────────────────────────────────────────────┤
│  CONNECTOR LAYER (Phase 6)                              │
│  OAuth adapters (Gmail, Calendar, Drive, GitHub)        │
│  Sync scheduler                                         │
│  Source labeling (memory vs connector vs web)           │
├─────────────────────────────────────────────────────────┤
│  AGENT LAYER (Phase 5)                                  │
│  Agent definition (goal, triggers, steps, permissions)  │
│  Agent runner (step-by-step with LLM)                   │
│  Agent log (what it did, why)                           │
└─────────────────────────────────────────────────────────┘
```

---

## 4. Implementation Phases

### Phase 1 — Core AI Writing + Memory (NOW, P0)
**Smallest working vertical slice:**
1. User saves note → embeddings generated → Ask question → Answer with cited sources → Suggest action items
2. Text actions on any capture: Summarize, Improve, Translate, Explain
3. Source citations in Ask answers

**Files to create/modify:**
- `src/processing/textActions.ts` — rewrite/summarize/translate/explain
- `src/screens/Ask.tsx` — show source captures below answers
- `src/processing/ask.ts` — return sources with LucyAnswer
- `src/screens/Dashboard.tsx` — text action menu on Captured cards

### Phase 2 — Workspace Intelligence (Next sprint)
- Global semantic search ✅ (done)
- Time-bounded queries ("summarize my week")
- Structured page creation from messy notes
- User data deletion from Settings
- Activity log

### Phase 3 — Passive/Proactive AI (Next 2 weeks)
- Most of this is built (morning brief, weekly insight, pattern detection)
- Add mood display in Today tab
- Add "Why did LUCY show this?" to all notifications ✅ (built)
- Improve notification detail screens with LLM synthesis

### Phase 4 — Meeting Intelligence
- Dedicated "Meeting mode" in passive listening
- Meeting summary screen after stopping
- Link meeting to people/projects automatically

### Phase 5 — Agents
- Agent definition schema
- Agent runner with LLM
- Built-in agents: weekly review, task cleanup, meeting follow-up

### Phase 6 — Connectors
- Gmail OAuth → email ingestion → extraction
- Google Calendar → event sync → reminders
- Each connector answer must cite its source

### Phase 7 — Admin/Privacy
- User-controlled memory deletion
- Per-source permissions  
- Activity logs
- "Why did LUCY show this?" in every notification (partial ✅)
- Export all user data as JSON

---

## 5. Immediate Next Steps (P0 this session)

1. **Source citations in Ask answers** — modify `LucyAnswer` to include `sources: CaptureRow[]`, render in Ask screen
2. **Text actions menu on Captured cards** — long-press → Summarize / Improve / Translate / Explain
3. **User data deletion** — Settings → Delete all memories (with confirmation)
4. **Mood timeline** — Show mood trend in Today → Memory or a new Mood section

---

*This document should be updated as features are completed.*
