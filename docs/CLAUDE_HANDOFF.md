# Lucy — Handoff for the UI/Design Agent (Codex)

Written by Claude Code. Everything a new agent needs before changing the UI. **Do not change app
logic** based on this doc — it's a map, not a task. Read `AGENTS.md` and
`docs/LUCY_UI_REDESIGN_BRIEF.md` too.

## 1. Stack & architecture
- **React Native + Expo SDK 56**, **New Architecture ON**, **TypeScript**. (Read v56 docs.)
- **Navigation is custom/state-based — NOT react-navigation or expo-router.** The root `App.tsx`
  holds a `screen` state (`'dashboard' | 'capture' | 'settings'`) and renders a custom **bottom tab
  bar**. Inside the dashboard, `src/screens/Dashboard.tsx` switches a `ViewMode`
  (`'Timeline' | 'Focus Now' | 'Ask Lucy' | 'Health' | 'Brain'`) — note **"Brain" is the bottom-tab
  internal key for what the UI now labels "Workspace"** (kept stable to avoid churn).
- **Styling = React Native `StyleSheet.create` + a theme object** in `src/config/colors.ts`
  (`LUCY_COLORS`). No NativeWind/styled-components. Dark, warm-premium palette:
  `primary` #FF8C42 (orange CTA), `background` #0C0B09, `surface`/`surfaceRaised`, `textDark` (cream),
  `textMuted`, `textFaint`, `border`, `error`. **Use these tokens, don't hardcode hex.**
- **Data**: SQLCipher SQLite via `expo-sqlite`. Schema + migrations in `src/db/init.ts`; per-entity
  modules in `src/db/*` (captures, todos, reminders, expenses, people, projects, schedule,
  learnedProfile, …). All on-device.
- **Local processing**: `src/processing/*` — `extract.ts` (LLM extraction pipeline), `organizer.ts`,
  `calendarConnector.ts`, `notifications.ts`, etc.
- **Scheduling engine** (conflict-free calendar): `src/scheduling/*` — `resources.ts` (canCoexist),
  `classify.ts`, `scheduler.ts`, `rearrange.ts`, `availability.ts`, `index.ts`. Pure + unit-tested
  (`tests/calendar.ts`).
- **Voice command brain**: `src/voice/commandRouter.ts` (NL → action), `src/voice/appManual.ts`.
- **AI**: `src/ai/*` — `provider.ts`, `openai.ts`, `device.ts` (on-device LLM via react-native-
  executorch, **lazily required + guarded — never eager-import on non-arm64**), `embeddings.ts`,
  `modelPreference.ts`.
- **LAN web companion / "the website"**: `src/server/localServer.ts` is a tiny HTTP server the phone
  runs over WiFi; `web/dashboard.html` is a **single-file vanilla-JS SPA** it serves at
  `http://<phone-ip>:8088`. The dashboard **hot-reloads from the repo** (no rebuild) — its own dark
  CSS-var theme. The user does most testing here.

## 2. Where the UI lives (what Codex will touch)
**Phone app UI**
- `App.tsx` — root, bottom tab bar, top-level screens, share/deep-link handling, the center voice mic.
- `src/screens/Dashboard.tsx` — the biggest UI file: Home, Timeline, Ask Lucy, Health, and the
  Workspace ("Brain") `LibraryView` with its tab strip + tile home.
- `src/screens/Settings.tsx`.
- `src/components/*.tsx` — `WorkspaceHome.tsx` (Lumia tile command center), `ScheduleTab.tsx`
  (calendar: agenda/day/week/month), `DocumentsTab.tsx`, `ProjectsTab.tsx`, others.
- `src/config/colors.ts` — the theme. Animations: `src/config/haptics`, Animated API in App.tsx.
**Website UI**
- `web/dashboard.html` — everything (sidebar nav, sections, calendar, tiles, animated orb face).
  Bump the `dashboard rev N` header marker when you change it.

## 3. Features already built (don't remove)
Capture (text/voice/share) · Timeline · Ask Lucy (recall/synthesis/spending/today/scheduling) · Tasks
· **Workspace** Lumia tile command center (Calendar, Reminders, Documents, Resources, Projects, Lucy
Suggested + Plan-My-Day + Quick actions) · **Calendar** (on-device, conflict-free, agenda/day/week/
month, drag-to-reschedule on web, recurring, habits, edit-event, swap-to-accommodate, color
categories) · Documents vault (upload/search/dedup/download) · Resources/links · Projects · Brain
(Glossary/knowledge graph, People, Ideas, Meetings, Listen) · Health (mood) · Money (expenses) ·
About You (profile, learned profile, feedback, Reflect, cost guard, export/import) · Guide (in-app
manual + how-to) · Voice command brain (context-aware single mic) · Animated Lucy orb (web) · Privacy
shield + on-device LLM.

## 4. Pending / known issues (UI-relevant)
- **Premium in-app calendar look** — the agenda/day/week/month works but isn't visually premium yet.
- **Animated Lucy face** — rich on web; the in-app orb could get the same treatment.
- Recurring reminders, Reminders fully in app, and assorted minor bugs — see the backlog (Claude owns
  the logic side). Codex: focus on look/feel, not these.

## 5. Run / verify / ship
- `npm install` (uses `patch-package` postinstall).
- Type-check everything: `npx tsc --noEmit` (run before finishing).
- Engine tests: `npx tsx tests/calendar.ts`.
- **Shipping**: JS/UI changes go out via **EAS Update (OTA)** — no rebuild. A **Codemagic** build is
  only needed for native dep/config changes. `app.json` `runtimeVersion` must stay `"2"` (the live
  builds are on runtime 1 and 2; Claude dual-publishes OTAs to both).
- **Website**: edit `web/dashboard.html`, push, and it hot-reloads onto the phone-served site (the
  phone pulls latest). Validate its `<script>` parses before shipping.

## 6. Environment / keys
- No secrets needed to run the UI. Remote AI is optional (user adds an OpenAI/Claude key in Settings →
  Remote Intelligence); without it Lucy uses the on-device LLM. Don't hardcode keys.
- Bundle id / scheme: `com.anonymous.lucy`, URL scheme `lucy://` (used for Siri deep-link).

## 7. Guardrails for the UI agent
- Don't touch: `src/server/localServer.ts` API contract, `src/scheduling/*` logic, `src/db/*` schema,
  `src/voice/*`, `src/ai/device.ts` executorch guards, the OTA flow, `app.json` runtimeVersion.
- Do change: components/screens, `colors.ts` theme, layout/spacing/typography/animation,
  `web/dashboard.html` look. Keep API calls + data shapes intact.
- Work on the **`codex-lucy-redesign`** branch; small commits; summarize changed files + how to test.
