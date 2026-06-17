# Calendar — UX redesign + Google/Teams/Outlook sync (research + plan)

_Researched 2026-06-17. Sources: Eleken calendar UI guide, Efficient.app & 2sync app round-ups,
Expo Calendar docs, Microsoft/Apple account-sync guides (links at bottom)._

## What the best apps do (patterns to copy)
- **Fantastical** — the signature combo: a compact **overview (week/month strip) + a scrollable
  hour-by-hour timeline** below it. Overview for context, timeline for detail, on one screen.
  Plus **natural-language input** ("dinner every Thursday at 7") instead of dropdowns.
- **Notion Calendar** — clean typography, **subtle color labels**, calm/scannable, nothing shouty.
- **Amie** — design-first: minimal, smooth animation, tasks + events unified.
- **Sunsama** — calm, intentional daily planning; reflect on workload.
- Common primitives: **now-line** (current-time indicator), **color by source/category**,
  **month dots** (not just counts), today-anchored, one-tap "Today", fast view switching.

## LUCY's gaps (before this pass)
1. The screen led with hero + planner + queue + conflict cards; the actual calendar was buried at the
   bottom → felt dense, not "calendar-first".
2. **It only showed LUCY's own on-device blocks** — your real Google/Teams/Outlook meetings were
   invisible, AND the scheduler placed focus blocks without knowing about them (could double-book a
   real meeting).
3. No now-line; month view showed a bare count; no source distinction.

## Sync strategy (DECIDED — no backend, privacy-first)
**Use the OS account + `expo-calendar` (already installed), NOT direct Google/Microsoft Graph APIs.**

Why: direct APIs need OAuth, token storage + refresh, and a backend to hold secrets — all of which
conflict with LUCY's on-device, no-backend, privacy stance. The device-account path is simpler,
two-way, free/busy-aware, and covers BOTH providers:
- **Google**: iPhone Settings → Calendar → Accounts → add Google → Calendars ON (Android: Google
  account syncs automatically).
- **Teams/Outlook**: a "Teams calendar" IS the user's Microsoft 365 calendar. iPhone Settings →
  Calendar → Accounts → add Outlook/Exchange; Android: Outlook app or Exchange account with calendar
  sync. Native Exchange ActiveSync is fully two-way (meeting responses, free/busy).

Once the account is added at the OS level, those events sync into the phone's native calendar, and
`expo-calendar` reads them via `getCalendarsAsync` + `getEventsAsync`. Managed calendars may be
read-only (`allowsModifications`), which is fine — LUCY treats them as read-only busy time.

### Shipped this pass (runtime 4, OTA — no rebuild; calendar perms already in the build)
- `buildBusy` now merges `calendarBusyBlocks` → LUCY **schedules around** real meetings and **shows**
  them. `getPlan` returns them flagged `source:'calendar'`; device-vs-device overlaps are NOT counted
  as LUCY conflicts (only LUCY-block-vs-meeting overlaps are).
- `ScheduleTab`: device events render in a distinct blue with a 📅 tag + "From your calendar" (read-
  only, won't be edited); a **"Connect Google, Teams & Outlook"** CTA (requests permission + OS setup
  guidance) when not connected, and a "Synced" pill when connected; a live **now-line** in day/week.

## Next phase (proposed — needs user's visual pick)
1. **Calendar-first layout** (Fantastical pattern): lead with a week strip + agenda; demote the
   planner/loose-tasks/conflict cards into a collapsible "Plan with Lucy" section.
2. **Month dots** colored by category/source instead of a count badge.
3. Optionally **write LUCY blocks back to the device calendar** (createEventAsync) so they show in
   Google/Outlook too — opt-in, only to a writable calendar.
4. Per-calendar toggles (choose which connected calendars appear) + show the calendar's name/color.
5. Mirror the calmer layout in the web companion.

## Sources
- https://www.eleken.co/blog-posts/calendar-ui
- https://efficient.app/best/calendar · https://2sync.com/blog/best-calendar-apps
- https://docs.expo.dev/versions/latest/sdk/calendar/
- https://learn.microsoft.com/en-us/answers/questions/4440952/link-teams-calendar-and-iphone
- https://calendarbridge.com/blog/how-to-sync-outlook-calendar-with-iphone/
