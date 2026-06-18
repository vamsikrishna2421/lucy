# LUCY Design System & UI Pattern Library

The reference any UI work (esp. the `ui-designer` agent) follows so cards/sheets/popups look premium and
consistent. LUCY's feel (AGENTS.md): warm, intelligent, calm, futuristic — a quiet companion, not robotic.
Dark, premium, Lumia-style tiles/cards, less text + more visual hierarchy, great empty states.

## Tokens (use these, never hardcode hex)
`src/config/colors.ts` → `LUCY_COLORS`:
- Surfaces (depth): `background` < `surface` < `surfaceRaised` (cards on cards step UP one level).
- Text (hierarchy): `textDark` (primary) → `textMuted` → `textSubtle` → `textFaint`. Never put two
  same-weight text colors adjacent; establish rank.
- Brand: `primary` (amber) + `primaryGlow`/`primaryLine`/`primaryMist` (tints for eyebrows, borders, halos).
- Semantic: `error`, `gold`. Source accents: device calendar = `#5B8CFF`, now-line = `#FF4D4D`.

## Spacing & radius (8pt-ish rhythm)
- Spacing scale: 4 / 8 / 12 / 16 / 20 / 24. Card padding 16–20. Section gaps 12–16.
- Radius scale: chips 12–14, cards 18–22, sheets/hero 24–26, pills 999. Bigger surface ⇒ bigger radius.
- Tap targets ≥ 44px. Hit slop on small icons.

## Type scale
- Eyebrow/kicker: 10–11, weight 900, letterSpacing ~1, UPPERCASE, `primaryGlow`.
- Card title: 15–18 / 900. Screen/sheet title: 20–25 / 900. Body: 13–14 / `textMuted`, lineHeight ~1.4.
- Meta/labels: 11–12.5 / 700–800 / `textSubtle`. Numbers (stats): big + 900.

## Card / sheet anatomy (the popup standard)
A bottom-sheet/popup card should read top→bottom:
1. **Grip** (40×4 rounded bar, centered) for sheets that slide up.
2. **Context line** (small, muted): when/where/source — before the title.
3. **Title** (large, 900). Make it the clear focal point.
4. **Accent**: a thin color bar/dot tied to the item's category/source (left or above title).
5. **Sections**: an eyebrow label + a row of **chips** (one tap = one action). Group by intent.
6. **Primary/secondary actions** at the bottom: filled primary (amber) + outline secondary; destructive = error outline. Never two filled primaries.
- Backdrop: `rgba(0,0,0,0.55)`, tap-to-dismiss; inner card swallows taps. `animationType="slide"` for sheets, `"fade"` for centered dialogs.
- Generous whitespace; one focal thing; progressive disclosure (don't dump everything — chips/expanders).

## Motion
RN `Animated` (native driver) — spring for slide-up (tension ~68, friction ~12), 150–250ms fades. Subtle,
never bouncy-cartoonish. Honor reduce-motion where possible.

## Patterns to copy (studied from top apps)
- **Fantastical** — overview (week strip) + scrollable timeline together; natural-language add.
- **Notion Calendar / Amie / Linear** — clean type, subtle color labels, calm density, keyboard-fast,
  design-first minimalism.
- **Things / Sunsama** — intentional, roomy, beautiful empty states, gentle copy.
- **Apple/iOS sheets** — grip + grouped sections + clear primary action; chips over dropdowns.
- General: color = meaning (source/category), one-tap actions, summaries over walls of text, human copy
  ("Suggested from your routine" not "protected_window"), confident empty states.

## Anti-patterns (what made our cards feel cheap — fix these)
- Plain `Alert.alert` for anything that deserves a designed card (event actions, suggestions, confirmations).
- Flat single-surface cards with no depth/accent/hierarchy; cramped chip spacing; tiny tap targets.
- All-text rows at one weight; no eyebrow/section structure; abrupt (no grip, no rounded top).
- Robotic labels + bare technical strings.

## Checklist before shipping any card/popup
[ ] uses LUCY_COLORS tokens · [ ] clear type hierarchy (eyebrow/title/body/meta) · [ ] depth (surface step
+ accent) · [ ] chips for actions, one filled primary · [ ] grip + slide for sheets · [ ] tap-dismiss
backdrop · [ ] ≥44px targets · [ ] human copy · [ ] empty/loading states · [ ] matches surrounding screens.
