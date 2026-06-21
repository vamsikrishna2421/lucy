# LUCY UI Redesign — Design Proposal v2 (information architecture + visual system)

> Design logic only. No implementation. Round 2 of adversarial multi-persona review.
> v1 was unanimously rejected. The root flaw: v1 applied ONE "calm SaaS" grammar uniformly
> (hide-by-default, one hero, KPI tiles, single-home, search-off-landing), which broke memory
> retrieval, power-user density, feature discoverability, and platform/a11y. v2's central fix is a
> **Surface Taxonomy**: different surface TYPES get different density/warmth/disclosure rules.

## Changelog v1 → v2 (objection → resolution)
- **Memory retrieval** (Wellness O1/O2/O5, Fintech O2/O5/O6, IA O4): the user's OWN captures (Timeline,
  Galaxy, a feature's full list, search results) are now **Memory surfaces** — complete, scannable,
  virtualized, never algorithmically collapsed to "top 3". Progressive disclosure (D2) applies ONLY to
  Lucy-DERIVED content. New second primary loop: **rediscover/browse-past** is co-equal with capture.
- **Warmth / the Lucy character** (Wellness O3/O4): new pillar **P1-Warmth** — the orb is a persistent
  ambient companion, Lucy-voiced narrative is a content type, amber is a protected brand element. Emotional
  surfaces (Health/mood) lead with a warm narrative, NOT judging KPI numbers. "Warm-premium," not
  "corporate-clean."
- **Global search** (Wellness O5, Fintech O3, IA O4): new pillar **P2-Search** — one omnipresent,
  cross-feature search affordance in every screen header. Distinct from in-list filter chips. Search is
  never demoted behind a tab.
- **Discoverability & cross-surfacing** (IA O1/O2/O3/O5/O6, Fintech O5): new pillar **P3-Discovery** —
  keep one canonical EDIT home per datum, but PRESERVE read-only cross-surface teasers + peer-to-peer
  entity cross-links + a labeled/searchable feature directory that always lists every feature (even empty).
  C4 is re-scoped: remove only DUPLICATE WIDGET RENDERING, never contextual reflection/teasers.
- **Distribution over counts** (Fintech O1): summary rows for large collections show a **micro-distribution**
  ("12 overdue · 31 today · 18 blocked"), never a bare "N →".
- **Platform / a11y / perf** (Mobile O1-O7, Fintech O7): new section **P4** as hard acceptance criteria —
  thumb-zone capture, Dynamic Type reflow, FlashList virtualization, 48dp targets, safe areas, disclosure
  a11y semantics, inline summary actions, and a density-mode for loaded states.

## Goals (revised)
- G1 Warm-premium + uncongested — a clear focal point on DECISION/landing surfaces; a calm-but-COMPLETE
  river on MEMORY surfaces. (Not "minimal everywhere.")
- G2 Preserve 100% of features AND their discoverability (a feature no one can find = removed).
- G3 **Two co-primary loops:** (1) capture → glance-at-now; (2) rediscover/browse-past. Both 1-tap, thumb-reachable.
- G4 Density that genuinely scales to hundreds of items (virtualization + density mode), without visual collapse.

## 1. Surface Taxonomy (the core decision — replaces "one rule everywhere")
Every screen is classified; its type dictates density, warmth, disclosure, and whether KPIs are allowed.

- **S-MEMORY** (Timeline, Galaxy, search results, a feature's full list of the user's own items).
  Rules: COMPLETE + chronological/scannable; recognition-first dense rows; FlashList-virtualized; global
  search + in-context filter; **NO algorithmic top-3 collapse of the user's own content**; a "density mode"
  (compact rows) auto-engages past a count threshold. This is where retrieval lives.
- **S-DECISION** (Focus Now, Plan My Day, Lucy-Suggested — Lucy-DERIVED, ranked content).
  Rules: progressive disclosure IS appropriate (top items + "See all"); **distribution summaries** not bare
  counts; **inline actions** (complete / snooze / confirm) on summary rows; ranking is the product here.
- **S-EMOTIONAL** (Health, mood, wellbeing).
  Rules: lead with a warm, Lucy-voiced narrative ("You've been low on sleep — want an earlier wind-down?");
  numbers available below / on tap; **never** a judging big-number hero. Gentle tone is mandatory.
- **S-OPERATIONAL** (Money, task counts, storage, processing).
  Rules: KPI/stat tiles ARE allowed and encouraged — but as DISTRIBUTION (segments), and softened; neutral
  domains only.
- **S-DIRECTORY** (Workspace).
  Rules: a LABELED, searchable map of ALL features (shown even when empty, with inviting empty states);
  most-used features promotable to Home/bottom-bar; this is the navigational backbone, not an opaque hub.

## 2. Cross-cutting pillars
- **P1 — Warmth / character (protected).** The Lucy orb is a persistent ambient presence (header/empty/
  hero moments). Lucy-voiced narrative is a first-class content type. Amber is a PROTECTED brand color,
  exempt from "accent = meaning only." Definition of done for "professional" = warm-premium.
- **P2 — Global search (omnipresent).** A single slim search/command affordance in every screen header,
  searching ACROSS all features (notes, tasks, docs, people, meetings, money…). Never behind a tab.
  Filter chips (scoped) are separate and live in the relevant list.
- **P3 — Discovery & cross-surfacing.** (a) One canonical EDIT home per datum. (b) Read-only TEASERS of
  high-value items appear on Home/Timeline as discovery hooks ("Lucy logged $42 → Money"). (c) Peer-to-peer
  entity cross-links (a Meeting links to its People + Tasks) so workflows don't round-trip the hub.
  (d) First-run + empty-state feature hints + Lucy proactive teasers ("I can track meetings — want to see?").
  (e) The directory lists every feature regardless of data.
- **P4 — Platform / a11y / perf (hard acceptance criteria).**
  - Capture: a persistent BOTTOM-anchored bar in the thumb zone (above the nav, safe-area aware) — resolves
    Q3 toward a bar, not a top hero card. KPIs/greeting may sit high; the ACTION sits low.
  - Virtualization: every list (incl. "See all") uses FlashList with stable heights; target 60fps, no blank cells.
  - Dynamic Type: tiles/cards grow vertically; no `numberOfLines={1}` on KPI labels; single-column tile
    fallback above a fontScale threshold; tested at fontScale 2.0.
  - Touch targets: every tappable ≥48dp with ≥8dp spacing; hitSlop where the visual is smaller.
  - Disclosure a11y: `accessibilityRole="button"`, `accessibilityState={{expanded}}`, accessible name
    includes the count; announce on expand; summary rows expose their key datum to the a11y tree.
  - Safe areas: `useSafeAreaInsets` for hero top padding and the bottom capture bar; defined stacking with
    the existing center-mic nav so nothing sits under the home indicator.
  - Density mode: a compact row variant (reduced height/gap) auto-engages on S-MEMORY past a count threshold
    (and/or a user toggle) so a loaded account doesn't become endless scroll.

## 3. Per-surface application (concrete)
- **Home (landing).** Compresses the greeting to an inline eyebrow + the orb (P1). Body = an S-DECISION
  "what matters now" (top items + distribution summary + inline actions) + read-only discovery teasers (P3).
  Persistent bottom capture bar (P4) + global search in the header (P2). NOT a wall of competing controls.
- **Timeline (S-MEMORY).** Complete virtualized river of the user's captures; global search + filter chips
  here; never collapsed to top-3; density mode when large.
- **Workspace (S-DIRECTORY).** Labeled, searchable feature list/grid; all features visible (empty included);
  promote top 2-3 to Home/bottom-bar.
- **Health (S-EMOTIONAL).** Warm narrative hero; metrics on tap.
- **Money (S-OPERATIONAL).** Distribution KPI tiles, softened.
- **Galaxy (S-MEMORY).** Browsable/scannable topic tree; recognition-first.

## 4. Resolved inter-sector conflicts (explicit)
- **Density (fintech) vs Calm (wellness):** resolved by the Surface Taxonomy — S-MEMORY/S-OPERATIONAL are
  dense + scannable; Home/S-EMOTIONAL are calm. Not uniform.
- **Discoverability (IA) vs Decongestion (v1):** resolved by P3 — keep cross-surface read-only teasers +
  cross-links + directory; remove ONLY duplicate widget rendering. Multi-entry discovery is preserved.
- **KPI judgment (wellness) vs distribution-at-a-glance (fintech):** resolved by surface type — distribution
  KPIs on S-OPERATIONAL; warm narrative (numbers on tap) on S-EMOTIONAL.
- **Recognition vs recall (fintech O6):** S-MEMORY preserves dense scannable lists (recognition); search (P2)
  serves recall. Both, on the right surfaces.

## 5. Tradeoffs (revised)
- T1 Progressive disclosure now applies ONLY to S-DECISION (derived) content; the cost (a tap) is paid only
  where Lucy's ranking is the value, never on the user's own memories.
- T2 S-MEMORY density mode trades roominess for scannability when loaded — accepted (recognition beats air
  at scale).
- T3 More surfaces/teasers/cross-links add design+build complexity vs a flat hide-everything model —
  accepted; it's the cost of a discoverable super-app.

## 6. Assumptions (revised — attack these)
- A1 **TWO co-primary loops** (capture; rediscover) — retrieval/browsing is first-class, not deliberate-only.
- A2 All features stay AND remain discoverable (teasers + directory + first-run).
- A3 Mobile portrait, one-handed primary; thumb-zone action; tested down to 360dp width + fontScale 2.0.
- A4 Power users have hundreds of items; virtualization + density mode are mandatory, not optional.
- A5 An extra tap is acceptable ONLY on S-DECISION disclosure — never for global search or own-memory retrieval.

## 7. Open questions (narrowed)
- Q1 Which 2-3 features get promoted out of the directory onto Home/bottom-bar (data-driven by usage)?
- Q2 Exact count threshold + row spec for S-MEMORY "density mode."
- Q3 RESOLVED — capture is a persistent bottom thumb-zone bar.

---

# v3 — Visual Craft layer + "rich-yet-simple" synthesis

> v2 passed the architecture panel (4/4) but was unanimously REJECTED by the consumer-design panel
> (YouTube, Netflix, WhatsApp, Instagram): it specified WHERE things go, never WHAT THEY LOOK/FEEL LIKE.
> v3 adds the missing visual-craft layer AND simplifies the user-facing model, while preserving every
> architecture invariant panel 1 approved. North star: **visually rich, behaviorally simple** (Instagram/
> Netflix look; WhatsApp simplicity).

## Consumer-panel objections → resolutions
- **No hero / focal moment; orb is a corner glyph** (Netflix O1/O2, YouTube O3, Instagram O2) → Home gets a
  **living-orb HERO** centerpiece (scaled, time-of-day ambient wash, one warm personalized line); one
  dominant element per viewport. The orb is the emotional anchor, not a 32px badge.
- **"Warm-premium" undefined; generic Material look** (YouTube O2, Instagram O5/O6) → new **Pillar P5
  (Visual Craft System)** makes it measurable (type, depth, color, radii, motion tokens).
- **Memory = spreadsheet; content not treated as media** (YouTube O1, Instagram O1) → **media-forward,
  content-type-aware Memory cards**: photo→thumbnail, voice→live waveform, doc→cover/favicon, place→map
  snippet, person→avatar, plain text→typed glyph-chip + domain color. Layout: media-left / title / one-line
  context / time-right. Density mode becomes an OPT-IN toggle (never auto-default) and never shrinks the
  visual anchor.
- **No motion/transition choreography** (Netflix O6, Instagram O3) → P5 **motion language**: shared-element
  transitions (teaser→canonical, capture→glance, Home→Timeline), spring-based disclosure expand, defined
  easing/duration tokens, a capture-confirm + gentle celebratory moment. Respects reduce-motion (a11y).
- **Distribution as joyless text** (Instagram O4, YouTube O6) → a **visual segmented/proportional micro-bar**
  with restrained color + count-up on appear. BUT per WhatsApp, the DEFAULT is a one-line human summary
  ("3 things need you today"); the segmented viz is the on-expand detail, not the default wall.
- **No gesture richness** (Instagram O7) → P5 **gesture + haptic layer**: swipe-to-act on rows
  (complete/snooze), long-press peek for cross-links, pull-to-capture / pull-to-search, a haptic map
  (capture / complete / surface). All optional + settings-respecting.
- **Galaxy reduced to an outline** (YouTube O5) → Galaxy becomes a genuinely visual **constellation**
  (nodes sized/colored by volume + recency), with a list fallback.
- **Emotional surface = text on white** (Netflix O4) → S-EMOTIONAL gets an **art-directed mood canvas**
  (gradient/light that shifts with the user's state) carrying the Lucy-voiced narrative.
- **Teasers as inline prose** (YouTube O4) → teasers are a distinct **image-bearing card type**, capped +
  rotated, visually separated from the feed.

## Simplification (WhatsApp) — reconciled without breaking panel 1
- **Two felt behaviors, not five.** The 5-type Surface Taxonomy is now an INTERNAL builder's tool. The USER
  experiences two consistent grammars: **"My stuff"** (their own content — complete, scannable, media-rich)
  and **"Lucy's stuff"** (derived/ranked — disclosable, tappable, actionable). Warmth is a TONE applied
  across both, not a separate layout engine. (Panel-1's per-surface rules still hold under the hood.)
- **Home = one job.** Capture (bottom bar) + the user's river as the body, with the Lucy hero on top and ONE
  focal "what matters now" card — not a stack of six regions. Decision detail, KPIs, and the directory are
  one swipe/tap away.
- **One number default.** A human sentence by default; the distribution micro-bar appears on expand (serves
  WhatsApp's simplicity AND fintech's distribution-on-demand AND Instagram's "make it visual").
- **Capture is THE primary action;** retrieval/rediscover stays first-class by being woven into Home (the
  river) + omnipresent search (P2) — it no longer competes as a separate "loop" for the same real estate.
- **Discovery is contextual + real-data**, not marketing. Keep read-only teasers of REAL user data
  ("Lucy logged $42 → Money") and in-context offers (a meeting note offers to add its people). CUT
  speculative "I can track meetings — want to see?" nudges (robotic, per AGENTS.md). Empty features live in
  a quiet directory "More", still discoverable, not padding Home.

## Pillar P5 — Visual Craft System (new; the missing layer)
Concrete, measurable tokens (to be encoded in `colors.ts` + a new `type.ts`/`motion.ts` + `ui.tsx`):
- **Type:** a dual system — a warm DISPLAY face for Lucy's voice/greetings/hero numbers (optical, larger,
  characterful) vs a clean UI face for data/labels; a real scale (e.g. 34/28/22/17/15/13/11) with deliberate
  weight contrast. Lucy's narrative always renders in the display voice.
- **Depth & light:** an elevation system distinct from flat Material — layered translucency/blur for overlays
  + a signature **amber glow/gradient** for Lucy moments (orb halo, hero wash) rather than flat fills; soft
  neutral shadow for ordinary cards (already in LUCY_SHADOWS).
- **Color:** the light/indigo ramp (done) + amber as the protected warmth/brand element + per-domain accent
  tokens for content-type glyph-chips (the media fallback).
- **Shape/space:** radii (cards 20-24, hero 26-28, chips 999), the 4/8pt grid (done).
- **Motion:** spring tokens (tension/friction), easing+duration tokens, shared-element transition rules,
  orb state machine (idle-breathe / listening / thinking / speaking / celebrate), count-up for numbers.
  Reduce-motion downgrades to fades.
- **Gesture/haptic:** the swipe/long-press/pull map + a haptic map; all optional.
- **Media:** the content-type-aware media-card spec for S-MEMORY + image-bearing teaser + constellation nodes.

## Preserved panel-1 invariants (so v3 doesn't regress the approved architecture)
Memory completeness (no algorithmic collapse of the user's own content) — KEPT (and now media-rich). Global
omnipresent search — KEPT. Feature discoverability (labeled/searchable directory + contextual + real-data
teasers) — KEPT (only speculative marketing nudges cut). Distribution available — KEPT (now a viz, on
expand). P4 platform/a11y/perf — KEPT + extended (motion respects reduce-motion; haptics/gestures optional;
media cards still virtualized). The Surface Taxonomy still governs per-surface density/warmth under the hood.

## v3 open questions
- Q4 The display typeface choice (bundled font vs system) — a build/asset decision.
- Q5 Constellation rendering approach for Galaxy (svg nodes) + its perf budget.
