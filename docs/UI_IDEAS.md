# LUCY — UI/UX Ideas (curated proposal)

> Ideation only. Nothing here is built yet. Pick what you like and we'll implement it as additive,
> on-brand work that follows `docs/LUCY_DESIGN_SYSTEM.md`. Each idea notes rough effort (S/M/L) and
> whether it ships over-the-air (OTA) or needs a native dependency.

---

## 1. Where LUCY's visual identity stands today

**What's genuinely strong (don't re-propose):**
- **The orb is the soul.** `AnimatedFace.tsx` is already exceptional — day-phase palettes, blink with
  double-blinks, gaze drift, breath, catch-light irises, status states (listening/speaking/thinking/
  reading/music/organizing), a celebrate sparkle burst, and a self-running "ambient showcase" that
  cycles her personality at rest. This is a top-1% mascot for a productivity app.
- **Peeking review cards.** `LucyPeek.tsx` over `ReviewCardDeck.tsx` (swipe deck, progress dots, "N of M")
  is charming and unique.
- **Lumia-style workspace tiles** (`WorkspaceHome.tsx`) with per-tile accent tints, live counts, a
  featured "Plan My Day" CTA, and a "Brain & knowledge" grid.
- **Health rings** (SVG `ProgressRing` / `MacroRing`), Dr. Lucy guardian cards, the warm amber color
  system, 4-level surface depth, and a disciplined design-system doc.

**Where it feels generic or dense (the opportunity):**
- **The Home hero is text-only.** Date + greeting + one status sentence. It's calm but flat — no living
  presence, no "today at a glance," and the orb floats in a fixed top-right overlay rather than living
  inside the greeting.
- **Timeline is a wall of similar cards.** Source/note-type badges exist, but there's little rhythm,
  no day grouping headers, no sense of "today vs earlier," and weights are close together.
- **Mixed iconography + glyph systems.** Ionicons + MaterialCommunityIcons + unicode glyphs (`◎ ◈ ◉`
  in `sourceLabel`, `◷ ◐ ◍` in NotificationCenter, `✦`, emoji `📍😴👟🔥⚡🏃💚`). Reads slightly
  inconsistent vs the polished orb.
- **Empty states are mostly a line of text** (`No saved resources yet.`, `No meetings saved yet.`) — a
  missed chance for LUCY's warmth and first-run delight.
- **Alert.alert everywhere** for confirmations/results (delete, reprocess, "Meal logged ✓", background
  prompt, voice errors) — the design system explicitly flags this as the #1 cheapness tell.
- **Tab segmenteds and pills** are functional but plain; no shared "active indicator" motion across the
  Dashboard view-nav, workspace, and calendar switcher.

The through-line: **LUCY's character is alive, but the surfaces around her are quieter than she is.**
Most of the wins below are about letting her presence and motion bleed into the rest of the app.

---

## (a) The LUCY character / orb as a living presence

### 1. Living Home hero — orb embedded in the greeting · **M · OTA**
Move the orb out of the fixed top-right overlay (on Home only) and seat it inside the `homeHero` card,
left of the greeting, at ~64px. She reacts to the day's state: a soft proud smile when "all caught up,"
a gentle attentive lean when tasks are waiting, a sleepy palette at night. The greeting becomes a
two-line "Lucy speaks" moment ("Good evening, Vamsi — I tidied 3 captures while you were away.").
*Why:* turns a flat text header into the app's signature first impression; the orb stops feeling like a
floating button and becomes the host of the home screen. Draws from Duolingo's character-anchored home
and Amie's warm greeting. *(Keep the global overlay on non-Home screens unchanged.)*

### 2. Orb "look-at" tracking on scroll/tap · **S · OTA**
The orb already has a gaze system (`gaze`/`gazeUp`). Feed it the last-tapped card position or scroll
direction so her irises briefly glance toward what you just touched, then drift back. Tiny, subconscious,
deeply "alive."
*Why:* the cheapest possible "wow, it's watching me help it" beat. Borrows from Apple's Memoji eye
tracking and the classic "Pong eyes follow cursor" trick.

### 3. Reactive micro-expressions on real events · **S–M · OTA**
She has `celebrateKey` + `happy` + `sparkle` already. Wire concrete moments to them: task completed →
quick happy + one sparkle; capture saved → the `saving` state holds a beat longer with a check glint;
a meal logged → a tiny content nod instead of an `Alert`. One emotional acknowledgement per meaningful
action.
*Why:* converts silent success toasts into companion warmth; Things/Sunsama-style "satisfying done"
without being cartoonish.

### 4. Orb as the loading/thinking state app-wide · **S · OTA**
Replace bare `ActivityIndicator`s (snap-busy modal, workspace `center`, history loading) with a small
LucyPeek/orb in her `thinking` state + a one-line human caption ("Reading your photo…", "Gathering your
week…").
*Why:* every wait becomes on-brand instead of a generic spinner. Linear/Arc do this — loading is part
of the personality, not a gap.

---

## (b) Motion & micro-interactions

### 5. Shared spring "active pill" across all segmented controls · **M · OTA**
The Dashboard view-nav, Workspace tabs, Ask view switcher, and Calendar agenda/day/week/month switcher
each re-implement an active style. Build one `SegmentedControl` where the highlight **slides** (spring,
tension ~68 / friction ~12 per the design system) between options instead of hard-cutting.
*Why:* a single, premium motion signature the user feels everywhere. This is the Notion Calendar / iOS
segmented feel. Consistency win + delight win in one.

### 6. Card entrance choreography (staggered fade-rise) · **S · OTA**
Timeline cards, workspace tiles, and health cards pop in flat. Add a 1-shot staggered translateY+opacity
on first mount (each item delayed ~40ms). Native driver, runs once, honors reduce-motion.
*Why:* makes any list feel composed and intentional. This is the Linear/Vercel list-reveal pattern.

### 7. Haptic-synced press states · **S · OTA**
`haptic.tab()` exists. Add light impact on primary CTAs (Plan My Day, Save, commit-block) paired with a
subtle scale-down press (`activeOpacity` → animated `scale: 0.97`). Pull-to-refresh on Home/Timeline
fires a soft tick when it crosses the threshold.
*Why:* tactile premium feel; the difference between "app" and "crafted app."

### 8. Number roll-ups on stats · **S · OTA**
Workspace tile counts, health metric values, and calorie totals snap in. Animate them counting up from 0
on first appearance (drive a `Animated.Value`, listener → `setState` formatted int).
*Why:* the count-up is a tiny dopamine hit that makes the data feel earned. Fantastical/fitness apps use
it for exactly this.

---

## (c) Home / Timeline density & hierarchy

### 9. "Today" glance strip under the hero · **M · OTA**
A single horizontal row of 3–4 micro-cards directly under the greeting: **Next event** (from
`scheduled_blocks`), **Top task**, **Captures organizing**, **Mood today**. Each is one tappable chip
that deep-links into the right view. Replaces the lone status sentence with a real cockpit.
*Why:* answers "what matters right now" in one look — the core promise of a second brain. This is the
Fantastical/Amie "today overview" and Things "Today" list, condensed.

### 10. Timeline day-group headers + spine · **M · OTA**
Group captures by day with a sticky, quiet header ("Today", "Yesterday", "Tue · Jun 10") and a thin
left timeline spine with a colored node per card (node color = note_type/source accent already computed
in `noteTypeLabel`/`sourceLabel`).
*Why:* turns the uniform card wall into a readable life-timeline; gives the screen its name back. Draws
from Apple Journal and Day One's timeline.

### 11. Unify the badge/glyph system into one icon language · **M · OTA**
Replace the unicode source/type glyphs (`◎ ◈ ◉` in Dashboard, `◷ ◐ ◍` in NotificationCenter) with a
small curated Ionicons/MaterialCommunityIcons set, each on its accent tint chip. Document the mapping in
the design system.
*Why:* the orb is meticulously crafted; the metadata glyphs should match that polish. One coherent icon
voice is a cohesion multiplier.

### 12. Capture card weight + progressive disclosure pass · **S–M · OTA**
Establish clearer rank per the design-system anatomy: stronger title, a single lead summary line muted,
accent bar on the left tied to type, and collapse chips behind a tap by default (they already lazy-load
on expand). Less visible text at rest, more on intent.
*Why:* directly serves the brief's "less text, more visual hierarchy" and "self-teaching/glanceable" goal.

---

## (d) Calendar / Health / Workspace polish

### 13. Calendar "now" ribbon + time-of-day gradient · **M · OTA**
The day grid already has a live now-line (`#FF4D4D`, updated each minute). Add a faint vertical
time-of-day wash behind it (cool pre-dawn → warm midday → dusk amber) and a soft "now" pill that floats
on the time gutter. Past blocks dim to ~70%.
*Why:* the calendar gains a sense of time *flowing*, not just a grid. Fantastical/Notion Calendar's
quiet now-indicator, elevated with LUCY's warmth.

### 14. Replace event-action Alerts with the standard designed sheet · **M · OTA**
Block detail, conflict resolution, reprocess/delete confirmations, and the background-organizing prompt
should use the card/sheet anatomy (grip → context line → title → accent → chips → one filled primary).
The design system already mandates this and flags `Alert.alert` as an anti-pattern.
*Why:* the single highest-leverage "feels cheap → feels premium" change; touches the most surfaces.

### 15. Health: make the calorie ring the hero with a breathing pulse · **M · OTA**
The macro/calorie rings are good but sit among many cards. Promote one large calories ring to the top of
Health with the center number rolling up (idea #8), a faint breathing glow when under goal, and the three
macro rings beneath. Dr. Lucy's note tucks under as a warm aside.
*Why:* gives Health a clear focal "one thing," matching Cal-AI/Apple Fitness hero clarity.

### 16. Workspace tile "live" texture · **S · OTA**
Tiles are flat color-tints. Add the hero's faint corner glow to the featured tiles (Calendar, Lucy
Suggested) and a 1px inner top-highlight so they read as raised glass. Featured tiles get a subtle
always-on breathing on their icon.
*Why:* small lift that makes the command center feel like a control surface, not a swatch grid. Lumia /
Apple widget-gallery depth.

---

## (e) Delightful empty states & first-run

### 17. Character-led empty states (per surface) · **S–M · OTA**
Replace the one-liners (`No saved resources yet.`, `No meetings saved yet.`, listen/timeline empties)
with a small LucyPeek + a warm, specific invitation and one CTA chip. E.g. Resources: orb peeking →
"Nothing saved yet — share me a link or a reel and I'll keep it here for you." → [Add a link].
*Why:* empty states are first impressions; Things/Sunsama win loyalty here. Cheap, high charm, reuses
`LucyPeek`.

### 18. First-run "Lucy is waking up" moment · **M · OTA**
On a truly empty install (post-onboarding, pre-capture), Home shows the orb mid-`organizing`/peek with a
single line "I'm ready when you are — hold the mic, or snap anything." plus two big example chips that
seed a real capture. Fades into the normal hero once the first capture lands.
*Why:* turns the scariest screen (empty) into the most inviting; sets the companion tone immediately.

### 19. "All caught up" celebration state · **S · OTA**
When tasks + reviews + organizing are all zero, Focus Now / Home shows a calm proud orb + one sparkle and
"You're all caught up. I'll keep watch." instead of neutral copy.
*Why:* rewards the cleared-inbox feeling (Things' confetti, Inbox Zero) in LUCY's quiet register.

---

## (f) Cohesion (color, type, spacing, iconography)

### 20. Lock a type ramp + spacing tokens into shared style helpers · **M · OTA**
Many screens hand-roll font sizes (9/9.5/10/10.5/11/11.5/12.5/13.5…) and inline styles. Introduce a tiny
`text` helper / token set (eyebrow, title, body, meta) and spacing constants so every surface snaps to
the documented scale. Migrate opportunistically, not in one big sweep.
*Why:* the design doc defines the ramp; the code drifts from it. This is the quiet backbone of "premium."

### 21. Pillar/accent color discipline · **S · OTA**
Source/type accents are defined in several places (Dashboard `sourceLabel`/`noteTypeLabel`, ScheduleTab
`CATS`, NotificationCenter `TIER_COLOR`) with overlapping but slightly different hexes. Centralize a
single semantic accent map in `colors.ts` and reference it everywhere.
*Why:* "color = meaning" only works if a meaning has exactly one color across the app.

### 22. One glow + shadow recipe · **S · OTA**
`LUCY_SHADOWS` exists but cards inline ad-hoc shadows. Standardize on the presets (sm/md/lg/glow) so
elevation reads consistently and depth = importance everywhere.
*Why:* consistent depth is most of what makes a dark theme feel expensive.

---

## (g) Signature "wow" moments (memorable & shareable)

### 23. LUCY Wrapped, story-mode redesign · **M–L · OTA**
`LucyWrapped` already exists and is quarterly. Make it a full-screen, tap-through "story" (progress bars
at top, one bold stat per card, the orb reacting to each reveal, a final share card with her face + your
headline number). End on a beautiful, watermarked share image.
*Why:* the most shareable surface in the app — Spotify Wrapped is the gold standard for organic growth.
Already partly built; this is polish + motion + a share card.

### 24. "Memory constellation" — the Glossary/Galaxy as a living starfield · **L · OTA (Skia) or native**
The Galaxy/Glossary view is a natural home for a gentle particle constellation: terms/people as soft
stars, lines drawn between connected memories, slow parallax drift, tap a star to open it. The orb's
sparkle/particle vocabulary already exists to borrow from.
*Why:* an unmistakable, screenshot-worthy signature for a "second brain." Inspired by Obsidian's graph
view and Arc's spatial feel — but warm and calm. *(Pure RN/Animated is possible for a light version;
`@shopify/react-native-skia` would make it gorgeous — native dep, needs a build.)*

### 25. Pull-to-refresh = "Lucy takes a breath" · **S · OTA**
Custom pull-to-refresh on Home/Timeline: as you pull, a tiny orb appears and inhales (scale + glow up);
on release it does one organizing spin, then settles. Replaces the OS spinner.
*Why:* a delightful, repeated touchpoint people notice and mention. Duolingo/Headspace-grade
micro-moment.

### 26. Ambient "day phase" tint for the whole app chrome · **S–M · OTA**
The orb already shifts palette by time of day (`PHASE_PALETTE`). Echo a *very* faint version into the app
background/hero glow (cooler at night, warmer midday) so the whole app subtly breathes with the day.
*Why:* a quiet, premium "the app is alive with me" feeling almost nobody ships. Strong calm-futuristic
signature.

---

## ★ Top 5 — I'd do these first

1. **#14 Replace event-action Alerts with the standard designed sheet** — highest leverage; the design
   system already flags `Alert.alert` as the #1 cheapness tell, and it touches many surfaces (delete,
   reprocess, block detail, conflicts, background prompt, meal/snap results).
2. **#1 Living Home hero with the orb embedded** — the home screen is the first impression and currently
   the flattest surface; seating the (already-stellar) orb in the greeting makes LUCY instantly feel like
   a companion, not a utility.
3. **#9 "Today" glance strip** — directly delivers the second-brain promise ("what matters now") in one
   look and gives Home real cockpit value with modest effort.
4. **#5 Shared spring "active pill" segmented control** — one premium motion signature reused across four
   plain switchers; big consistency + delight return for the work.
5. **#17 Character-led empty states** — cheap, high-charm, reuses `LucyPeek`, and fixes the most
   under-loved screens (every empty list) while reinforcing brand warmth everywhere.

---

### Notes for implementation later
- Everything above is **OTA-able** except the gorgeous version of **#24 (Skia constellation)**, which
  would need a native build. A lighter RN/Animated version of #24 still ships OTA.
- All motion should use the native driver, honor reduce-motion, and follow the design-system spring
  constants (tension ~68 / friction ~12; 150–250ms fades).
- Keep every change **additive** — preserve existing engine calls, props, and behavior; change look &
  feel only. UI ships via OTA, so each item needs on-device visual sign-off.
