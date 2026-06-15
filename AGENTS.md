# Lucy — Agent Instructions

> Read this before doing any work. Two coding agents share this repo:
> - **Claude Code** = engineering (backend, bug-fixing, integrations, scheduling/voice engines, OTA/build).
> - **Codex** = UI/UX redesign (frontend look, screens, spacing, typography, animation, polish).
> Stay in your lane and on your branch (see "Branches" below) so you don't collide.

## ⚠️ Expo has changed
This is **Expo SDK 56** with the **New Architecture ON**. Read the exact versioned docs at
https://docs.expo.dev/versions/v56.0.0/ before writing native/Expo code. Do not assume older APIs.

## What Lucy is (product feel)
Lucy is a **passive AI second-brain / assistant** — warm, intelligent, calm, futuristic; not robotic,
not ghost-like. It feels like a helpful companion that quietly follows the user and is proactive but
human. It captures thoughts (text/voice), organizes memory, manages a conflict-free calendar, tasks,
reminders, documents, and answers/acts via a voice command brain — all stored privately on-device.

## Codex role (UI/UX)
- Improve UI/UX: visual design, frontend structure, screens, spacing, typography, animation, polish.
- **Preserve working backend logic** unless explicitly asked; **do not remove existing features**.
- Mobile-first; **Lumia-style workspace tiles/cards** where appropriate; clean dark premium theme;
  less text, more visual hierarchy; calm but futuristic; great empty states.
- Notification/insight copy must be **human**, not robotic metadata
  (e.g. "Lucy brought this up because you were trying to remember it earlier" — not confidence scores).
- Prefer small, reviewable commits. Inspect the current app before redesigning.
- **Before editing, read** `docs/CLAUDE_HANDOFF.md` (architecture + what exists) and
  `docs/LUCY_UI_REDESIGN_BRIEF.md` (the design brief). Identify framework, routing, styling, entry files.
- **Done means**: app builds, no broken routes/screens, redesign is consistent, and you summarize
  changed files + how to test.

## Branches
- `master` — Claude Code's line and the **build source** (Codemagic builds master; OTAs publish from
  the working tree). Keep it releasable.
- `codex-lucy-redesign` — Codex's UI redesign branch. Do UI work here. Merge into `master` only after
  testing. Do **not** let both agents edit the same files on the same branch at once.

## Build / run / ship (reference — see docs/CLAUDE_HANDOFF.md for detail)
- Type-check: `npx tsc --noEmit`. Web dashboard JS is plain — validate before shipping.
- Engine tests: `npx tsx tests/calendar.ts`.
- App is shipped via **EAS Update (OTA)** for JS changes (no rebuild); a Codemagic build is only
  needed for native dependency/config changes.
- The web companion is `web/dashboard.html` (a single-file SPA the phone serves over LAN at :8088);
  it **hot-reloads** from the repo — bump its `dashboard rev N` marker on changes.
