# LUCY Design System & UI Pattern Library

> **Theme: LIGHT + INDIGO** (rebrand 2026-06-20, inspired by the `scuts` reference app).
> This is the source of truth every UI pass follows so cards/sheets/popups look premium and consistent.
> LUCY's feel (AGENTS.md): warm, intelligent, calm, futuristic — a quiet companion, not robotic.
> Light, airy, premium; white soft-shadow cards; crisp near-black type; less text + more visual
> hierarchy; generous whitespace; great empty states. The amber Lucy orb is the one warm accent that
> survives the rebrand — everything around it is light surfaces with an indigo intelligence accent.

## Golden rule: tokens, never hex
Always import from `src/config/colors.ts`:
```ts
import { LUCY_COLORS, LUCY_SHADOWS } from '../config/colors';
```
Never hardcode a hex value. The token KEYS are stable, so flipping the palette re-skins the whole app.
The only allowed literals are documented source accents: **device calendar `#5B8CFF`** (= `LUCY_COLORS.info`)
and the **now-line `#FF4D4D`**. White text on a filled indigo/accent button may use `LUCY_COLORS.white`.

## Palette (`LUCY_COLORS`)
**Surfaces (depth — each step is one level UP):**
- `background` `#F1F2F8` — screen background (light lavender-gray; the page, never a card)
- `surface` `#FFFFFF` — white cards, the default card fill
- `surfaceRaised` `#F6F7FC` — input fields, chips, cards-on-cards, secondary tiles
- `surfaceElevated` / `surfaceSheet` `#FFFFFF` — tooltips, dropdowns, bottom sheets (white + shadow)

**Text (near-black hierarchy — establish rank, never two equal weights adjacent):**
- `textDark` `#15161B` — primary text / titles
- `textMuted` `#6A6E7D` — secondary / body
- `textSubtle` `#9AA0B0` — tertiary / meta / labels
- `textFaint` `#B8BCC8` — disabled / placeholder / empty-state icons

**Borders (hairlines that define depth, never harsh):**
- `border` `#E6E8F1` — standard card border / hairline
- `borderSoft` `#EDEFF5` — subtle dividers, header/nav separators
- `divider` `#EEF0F6` — list separators

**Primary (indigo — the intelligence accent, replaces the old amber glow):**
- `primary` `#5C50DC` — main CTA fill, active icon/label, highlights
- `primaryGlow` `#7468E6` — hover/active, eyebrow text on light
- `primaryDeep` `#4A3FC2` — pressed state
- `primarySoft` `#ECEAFB` — indigo-tinted chip/badge/icon-ring backgrounds
- `primaryMist` `#F4F3FD` — barely-there tint (active pill backgrounds)
- `primaryLine` `#D9D5F6` — indigo outline on active/tinted surfaces

**Accents (multi-color on light — use for category/source meaning):**
`violet #8C5CEB` · `rose #ED66AE` · `teal`/`cyan #1FBDAB` · `gold #FAB23A`

**Semantic:** `success #2EB56B` · `warning #EE9A1C` · `error #E54D4D` · `info #5B8CFF` (= device calendar)

**Tinting convention (ported from scuts):** for a colored chip/badge, use the accent at low alpha on a
light surface and the accent for text/icon:
- chip/pill background = `color + '24'` (≈14% alpha), text/icon = `color`
- soft button background = `color + '1F'` (≈12% alpha), text/icon = `color`
- icon ring background = `LUCY_COLORS.primarySoft` (or `color + '1A'`), with `primaryLine` border

## Shadows (`LUCY_SHADOWS`) — soft NEUTRAL elevation
On light theme, depth comes from a **soft neutral shadow + a hairline border**, not from contrast. Use a
shadow on white cards; do not stack a heavy shadow under a card that already sits on `surfaceRaised`.
- `sm` — subtle lift (secondary cards, chips that float)
- `md` — standard card elevation (the default for a white `surface` card)
- `lg` — modal / bottom-sheet elevation
- `glow` — a soft **indigo** lift for active/focused interactive elements (the voice button, a selected
  primary). Use sparingly; it is the one place color enters the shadow.

```ts
card: { backgroundColor: LUCY_COLORS.surface, borderRadius: 22, padding: 18, ...LUCY_SHADOWS.md }
```

## Spacing & radius (8pt-ish rhythm)
- Spacing scale: **4 / 8 / 12 / 16 / 20 / 24**. Screen padding **18**. Card padding **16–20**.
  Section gaps **12–16**. Default inter-element gap **14**.
- Radius scale: **chips 12–14**, **cards 18–22**, **sheets/hero 24–26**, **pills 999**. Bigger surface
  ⇒ bigger radius. (scuts: card 22, control 14, pill 999.)
- Tap targets ≥ **44px**. Hit slop on small icons.

## Type scale
- **Eyebrow/kicker:** 10–11 / weight 900 / letterSpacing ~1 / UPPERCASE / color `primary` (or the
  category accent). One short label that sets context above a title.
- **Card title:** 15–19 / weight 800–900 / `textDark`. **Screen/sheet title:** 20–25 / 900 / `textDark`.
- **Body:** 13–14 / `textMuted` / lineHeight ~1.4.
- **Meta/labels:** 11–12.5 / 700–800 / `textSubtle`.
- **Stat numbers:** large (20–28) / 800–900 / `textDark`.

## The component kit — `src/components/ui.tsx` (use these first)
A shared, scuts-derived kit built on `LUCY_COLORS`. **Reach for these before writing bespoke styles** so
every screen shares one anatomy. API:
- `Card` — white `surface`, radius 22, padding 18, `LUCY_SHADOWS.md`. The default container.
- `PrimaryButton({ title, onPress, icon?, disabled? })` — solid `primary`, radius 14, **white** label.
  One filled primary per surface.
- `SecondaryButton({ title, onPress, icon?, tint? })` — `tint + '1F'` background, `tint` label, radius 14.
- `Pill({ label, color, icon? })` — `color + '24'` background, `color` text, radius 999. Category/status.
- `SectionHeader({ title, subtitle?, right? })` — title 19/800 `textDark` + dim subtitle 13.5 `textMuted`.
- `StatTile({ value, label, icon?, tint? })` — a white card with a big number + small label.
- `TextField` — `surfaceRaised` background + `border` hairline, radius 14, `textFaint` placeholder.
- `EmptyState({ icon, title, text? })` — faint `textFaint` icon + 800 title + muted text, roomy padding.
- `Icon`, `Avatar`, `PriorityDot` helpers.

(LUCY also has **character-led** variants for hero moments: `LucyEmptyState` puts the breathing amber orb
above the copy; `LucyPeek` perches the orb gripping a card's top lip. Use those on the emptiest lists and
on pop-up cards; use the plain `EmptyState`/`Card` elsewhere.)

## Card / sheet anatomy (the popup standard)
A bottom-sheet/popup card reads top→bottom:
1. **Grip** — 40×4 rounded bar, centered, `border` color (sheets that slide up).
2. **Accent** — a thin color bar/dot (36×3) tied to the item's category/source, above the title.
3. **Context line** — small UPPERCASE eyebrow (when / where / source) in `primary`/accent.
4. **Title** — large, 900, `textDark`. The clear focal point.
5. **Message/body** — `textMuted`, lineHeight ~1.4. Short.
6. **Sections** — eyebrow label + a row of **chips** (one tap = one action), grouped by intent.
7. **Actions** — bottom: one filled `PrimaryButton` (indigo, white text) + outline/secondary;
   destructive = `error`-tinted outline (`error` text, transparent bg). Never two filled primaries.
- **Backdrop:** a soft scrim `rgba(20,22,40,0.40)` (light theme — lighter than the old dark scrim),
  tap-to-dismiss; the inner card swallows taps. `animationType="slide"`/spring for sheets, `"fade"` for
  centered dialogs.
- Generous whitespace; **one focal thing**; progressive disclosure (chips/expanders over walls of text).

## Motion
RN `Animated` on the **native driver**. The signature spring is **tension ~68, friction ~12** (calm
slide-up, no cartoon overshoot); fades **150–250ms**. Press feedback springs to **scale 0.97**. Entrance =
fade + a small **~12px** rise. Reuse the shared `Motion` primitives (`FadeInUp`, `Stagger`, `ScreenFade`,
`PressableScale`) and `SegmentedControl`'s sliding pill rather than re-rolling physics. Honor
**Reduce Motion** (the Motion kit already does — content snaps to its final state).

The **Lucy orb** (`AnimatedFace`) is the app's signature charm: breathing, blinking, gaze drift,
catch-lights, day-phase tinting, and per-status expressions (listening/speaking/thinking/reading/music).
Keep it warm amber and **alive**, never gimmicky — it must read beautifully on white.

## Patterns to copy (studied from top apps)
- **scuts** (our sibling app) — the reference for this light system: white radius-22 cards with soft
  neutral shadow, indigo solid buttons, tinted pills, calm density, crisp near-black hierarchy.
- **Linear / Notion / Amie** — clean type, subtle color labels, calm density, keyboard-fast minimalism.
- **Things / Sunsama** — intentional, roomy, beautiful empty states, gentle copy.
- **Apple/iOS sheets** — grip + grouped sections + one clear primary action; chips over dropdowns.
- General: **color = meaning** (source/category), one-tap actions, summaries over walls of text, human
  copy ("Suggested from your routine" not "protected_window"), confident empty states.

## Anti-patterns (fix these)
- **Hardcoded hex** — especially leftover dark literals (`#0B0B0F`, `#15161B` typed inline, `#1A1206`),
  amber literals (`#FF8C42`), or dark text on a filled button. Filled indigo/accent buttons take **white**
  text, not dark espresso.
- **Dark-theme leftovers** — dark card/sheet/cloud backgrounds, heavy `rgba(0,0,0,…)` shadows or overlays
  on white (a soft neutral shadow or a light scrim is correct now), low-contrast gray-on-gray text.
- Plain `Alert.alert` for anything that deserves a designed card → use `ActionSheet`/a designed modal.
- Flat single-surface cards with no depth/accent/hierarchy; cramped chip spacing; tiny tap targets.
- All-text rows at one weight; no eyebrow/section structure; abrupt sheets (no grip, no rounded top).
- Robotic labels + bare technical strings.

## Checklist before shipping any card/popup
[ ] uses `LUCY_COLORS` + `LUCY_SHADOWS` tokens (no stray hex) · [ ] light surfaces + soft neutral shadow +
hairline border (no dark leftovers) · [ ] clear type hierarchy (eyebrow/title/body/meta) · [ ] depth
(surface step + accent) · [ ] chips for actions, **one** filled indigo primary with white text · [ ] grip +
slide for sheets · [ ] soft light scrim, tap-dismiss · [ ] ≥44px targets · [ ] human copy · [ ]
empty/loading states · [ ] reuses the `ui.tsx` kit / `Motion` where it fits · [ ] matches surrounding
screens.
