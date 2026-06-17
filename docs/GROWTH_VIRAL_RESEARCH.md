# Lucy — Viral Growth & Social-Sharing Research

> Goal: get Lucy's users to organically market it. Lucy is a privacy-first, mostly on-device
> personal AI second-brain + health app with **no backend / no social graph** today. So this
> research deliberately favors **share-OUT artifacts** (export a beautiful image/card to the user's
> own social/messaging) and **lightweight referral** that don't require building a social network or
> shipping personal data to a server. Anything that needs server infrastructure is flagged
> explicitly with **[NEEDS BACKEND]**.

> Research date: June 2026. All claims are sourced; no copyrighted text is reproduced — mechanics
> and figures are summarized in original wording. Reported figures come from secondary
> case-study write-ups and should be treated as directional, not audited.

---

## Part 1 — Historical case studies

For each: the exact mechanic, why it spread, and the lesson for Lucy.

### 1. Dropbox — double-sided referral

**Mechanic.** Every user got a unique invite link. When an invited friend signed up, **both**
sides received bonus storage (500 MB each), stackable up to ~16 GB (Basic) / 32 GB (Plus). The
reward was the product itself (more storage), granted automatically with no claim form. The
invitee landing page was personalized (it named the referrer), pre-filled the email, and minimized
the signup form.

**Why it spread.** The reward was *intrinsic to the product* — more storage made Dropbox more
useful, so referring wasn't begging, it was self-interest. Double-sided removed the awkwardness
(your friend benefits too). It was frictionless and instant. Reportedly lifted signups ~60% and
drove ~3,900% growth over ~15 months; ~2.8M referral invites in the first ~18 months. Crucially,
~⅓ of users already came from word-of-mouth *before* the program — the program **amplified existing
love**, it didn't manufacture it.

**Lesson for Lucy.** The best referral reward is *more product value*, not cash. But Lucy's value
is private and on-device — there's no "give your friend storage" lever without a server. So Lucy's
referral reward should be an **on-device unlock** (premium theme, advanced insight, extra face
animation, a power feature) that costs nothing to fulfill and needs no backend.

Sources: [Referral Rock](https://referralrock.com/blog/dropbox-referral-program/),
[Viral Loops](https://viral-loops.com/blog/dropbox-grew-3900-simple-referral-program/),
[GrowSurf](https://growsurf.com/blog/dropbox-referral-program/).

### 2. Spotify Wrapped — annual shareable recap

**Mechanic.** Once a year, Spotify packages each user's listening data into a sequence of bold,
animated, vertical story-cards (top songs, top artist, minutes streamed, genre "personality") and
gives a one-tap **Share to Instagram/TikTok/Stories** button. The artifact is personal, flattering,
identity-affirming, and time-boxed to a single cultural moment.

**Why it spread.** It turns *private data into public identity* — people share it because it says
something about who they are. It's synchronized (everyone posts in the same week → a feed-wide
event → FOMO for non-users). Reportedly 60M+ shares and 2B+ social impressions in a year, ~90M+
people engaging — effectively hundreds of millions in free advertising where users do the work.

**Lesson for Lucy.** Lucy **already has "LUCY Wrapped" (quarterly)** and a working
image-export/share pipeline (`src/components/LucyWrapped.tsx` composites all stat cards into one
PNG via `react-native-view-shot` + `expo-sharing`). This is Lucy's single biggest existing growth
asset. The wins are: (a) make the exported card *gorgeous and unmistakably Lucy-branded* so it
markets the app on sight, (b) lean into a **synchronized seasonal moment** (everyone's Q-recap
drops the same week), and (c) per-slide share (Spotify lets you share individual cards, not just
the whole poster).

Sources: [NoGood](https://nogood.io/blog/spotify-wrapped-marketing-strategy/),
[Wikipedia: Spotify Wrapped](https://en.wikipedia.org/wiki/Spotify_Wrapped),
[Binghamton University](https://www.binghamton.edu/news/story/5948/why-spotify-wrapped-goes-viral-every-year-binghamton-university-experts-weigh-in).

### 3. Wordle — spoiler-free emoji share grid

**Mechanic.** After playing, a **Share** button copies a compact emoji grid (green/yellow/gray
squares) showing *how* you did **without revealing the answer**. One puzzle per day, identical for
everyone.

**Why it spread.** The grid is **spoiler-free social currency** — you brag about your result and
others can compare without the experience being ruined, so it's safe and rewarding to post. **Daily
scarcity** (one puzzle, shared once, wait till tomorrow) made each share feel special and prevented
burnout. The format is tiny, text-only, and renders anywhere. Notably the emoji grid was *invented
by players*, not the creator — he just productized it. From ~90 players to ~300K daily in weeks;
1.2M+ results shared on Twitter in the first ~13 days of Jan 2022.

**Lesson for Lucy.** A shareable artifact can be **abstract/text-only and still go viral** if it's
spoiler-free and comparable. Lucy can ship an *emoji-glyph version* of a streak or a day that
conveys "I did the thing" **without exposing any private content** — perfect for a privacy-first
app. Also: watch what *users* spontaneously share and productize it.

Sources: [Slate interview with Josh Wardle](https://slate.com/culture/2022/01/wordle-game-creator-wardle-twitter-scores-strategy-stats.html),
[Webflow Blog](https://webflow.com/blog/wordle-design),
[Why #Wordle Went Viral (LinkedIn)](https://www.linkedin.com/pulse/why-wordle-went-viral-cynthia-lieberman).

### 4. Robinhood (waitlist) & PayPal — referral

**Robinhood mechanic.** Pre-launch **waitlist with visible position**. After signing up you
immediately saw your rank and a "share to move up the line" CTA; every friend who joined via your
link bumped you higher (and later, free shares of stock worth a randomized small amount). Reportedly
~1M users on the waitlist *before launch*; ~10K signups day one, ~50K week one; ~53% cheaper than
other channels.

**PayPal mechanic.** Paid **cash for both sides** (~$20 each early, dialed down to $10 then $5 as
they scaled), capped per user. Drove a reported ~7–10% *daily* growth rate during the blitz.

**Why they spread.** Robinhood gamified *status and impatience* (climb the line) plus variable
reward (mystery free stock = a scratch-card dopamine hit). PayPal simply bought the network with
cash because the lifetime value justified it.

**Lessons for Lucy.** (1) A **waitlist with a leaderboard position** is a cheap pre-launch / new-
feature growth loop — but it **[NEEDS BACKEND]** to track positions and links. (2) **Variable /
surprise rewards** ("unlock a *random* premium Lucy face/theme when a friend joins") outperform
fixed ones. (3) Paying cash is off-strategy for Lucy — its reward currency should be product
unlocks, not money.

Sources: [Viral Loops — Robinhood](https://viral-loops.com/blog/how-robinhoods-referral-built-a-1m-user/),
[Prefinery — Robinhood](https://www.prefinery.com/blog/referral-programs/prelaunch-campaign/robinhood/),
[Referral Rocket — PayPal](https://blogs.referralrocket.io/paypals-referral-program-a-case-study/),
[ReferralCandy — PayPal](https://www.referralcandy.com/blog/paypal-referrals).

### 5. Duolingo & Snapchat — streaks

**Mechanic.** A visible counter of consecutive days of the core action. Duolingo adds **streak
freezes** (forgiveness), streak wagers, and separated the streak from the daily goal to lower
friction. Snapchat's Snapstreaks count consecutive days two friends exchange snaps, with a warning
emoji before it dies.

**Why they work.** **Loss aversion** — once you've built a 100-day streak you'll do almost anything
not to lose it (people fear losing a streak more than they value extending it). Reported impact:
Duolingo next-day retention rose from ~12% to ~55% over time; streak freeze cut churn ~21% for
at-risk users; users with a 7+ day streak are ~2.3× more likely to engage daily. Snapstreaks
reportedly drove users to open Snapchat 30–40× a day.

**Lessons for Lucy.** Streaks are a **retention** engine (essential — virality is pointless if
users churn) and a *milestone* engine that **creates the moments worth sharing** (a 30/100/365-day
card is a great share-out artifact). Lucy already has health/streaks. Two musts: a **forgiveness
mechanic** (streak freeze) so it feels human/calm (on-brand: "warm, not robotic"), and
**milestone celebration cards** the user can export. Pure on-device — no backend.

Sources: [Yu-kai Chou — Streak Design](https://yukaichou.com/gamification-study/master-the-art-of-streak-design-for-short-term-engagement-and-long-term-success/),
[Trophy — Duolingo case study](https://trophy.so/blog/duolingo-gamification-case-study),
[Plotline — Streaks](https://www.plotline.so/blog/streaks-for-gamification-in-mobile-apps).

### 6. BeReal — synchronized daily prompt

**Mechanic.** Once a day, at a random time that's **the same for everyone worldwide**, a push
notification gives you ~2 minutes to post. You can't view friends' posts until you post yours
(no lurking). Grew via a college-ambassador program + TikTok chatter; iPhone App of the Year 2022.

**Why it spread.** A **synchronized global moment** manufactures simultaneous engagement and
talk-about-it-ness; reciprocity ("post to see") forces participation; scarcity/time-pressure
creates urgency and authenticity.

**Lessons for Lucy.** The *synchronized moment* is the transferable idea (it powers Wrapped too):
a daily/weekly **"Lucy moment"** prompt — e.g. a once-a-day nudge to capture one thought — builds
habit. BeReal's *friend-feed* reciprocity **[NEEDS BACKEND]** and conflicts with Lucy's no-social-
graph ethos, so adopt the *prompt/cadence* idea, not the social feed.

Sources: [Contrary Research — BeReal](https://research.contrary.com/company/bereal),
[BeReal Help — the notification](https://help.bereal.com/hc/en-us/articles/15416869159197--Time-to-BeReal-Notification).

### 7. Strava — segments, clubs & "Year in Sport"

**Mechanic.** **Segments** turn every stretch of road into its own micro-leaderboard, so almost
anyone can be "top 10 *locally*" even if they'll never be globally elite. **Kudos** = lightweight
social validation. **Clubs** = interest/locale groups. **Year in Sport** = an annual Wrapped-style
shareable recap (recently moved behind an $80 paywall, which reduced its free viral reach).

**Why it works.** Segments **decompose one impossible global competition into thousands of winnable
local ones**, so far more users feel the motivation to compete and share. Clubs reportedly grew
audience +279% over a period, ~2× mainstream social.

**Lessons for Lucy.** (1) **Decompose achievement** so wins feel attainable and frequent — Lucy
should celebrate small personal-best moments ("most thoughts captured this week," "best focus
streak this month"), not just rare big ones. These are **personal** bests, not leaderboards, so
they stay private/on-device. (2) Strava's social comparison (segments vs. others, kudos) and clubs
are **[NEEDS BACKEND]** + a social graph — skip for now. (3) The **paywall lesson**: don't lock the
*shareable* recap behind payment — that's your free marketing; keep Wrapped free to share.

Sources: [Latterly — Strava strategy](https://www.latterly.org/strava-marketing-strategy/),
[Trophy — Strava case study](https://trophy.so/blog/strava-gamification-case-study),
[Strava Year in Sport](https://support.strava.com/hc/en-us/articles/22067973274509-Your-Year-in-Sport),
[Ars/Harvard mirror on the paywall](https://tagteam.harvard.edu/hub_feeds/3415/feed_items/17132945/content).

### 8. Cross-cutting viral-loop theory (k-factor)

**Key numbers/ideas.** Virality ≈ **K-factor = (invites per user) × (invite→signup conversion)**.
K ≥ 1.0 = self-sustaining exponential growth (rare). For consumer apps, sustained K ≈ 0.15–0.25 is
good, ~0.4 great, ~0.7 outstanding. **Cycle time matters as much as K** — a lower-K loop that
completes in 2 days beats a higher-K loop that takes 14. Boosters: surface invites **early in
onboarding when excitement peaks**, **personalize** the invite with the sender's name (Dropbox),
and **gate a real feature behind inviting** (Loom unlocked editing features for inviting coworkers).

**Lessons for Lucy.** (1) Optimize both blades: make the share artifact compelling (raises
conversion) *and* prompt sharing often at high-emotion moments (raises invites + shortens cycle).
(2) Even a modest K (0.2–0.4) materially lowers paid-acquisition cost. (3) The share-OUT artifact
*is* the invite — the branded image is the personalized, low-friction, no-backend invite.

Sources: [First Round — K-factor](https://review.firstround.com/glossary/k-factor-virality/),
[Founderpath — K-factor tactics](https://founderpath.com/blog/how-to-go-viral),
[Medium — boost K-factor](https://medium.com/@dsmithdesignleadership/how-to-boost-your-products-k-factor-through-virality-invite-share-join-5abce77ce830).

### Patterns that repeat across every winner
1. **Turn private data into public identity** (Wrapped, Year in Sport) — people share what flatters
   them / says who they are.
2. **Spoiler-free / privacy-safe artifacts spread further** (Wordle) — you can share the *shape* of
   an achievement without the contents. **This is gold for a privacy-first app.**
3. **Loss aversion + streaks** drive the daily habit that makes anything else possible.
4. **Make wins attainable and frequent** (Strava segments) — many small celebrations > rare big ones.
5. **Synchronized moments** manufacture simultaneous attention and FOMO.
6. **The best referral reward is product value, granted instantly and frictionlessly.**
7. **Don't paywall your shareable** — it's free advertising (Strava's mistake).

---

## Part 2 — Apply to Lucy

Lucy's assets: thought capture, memory/insights, calendar, knowledge graph, health/streaks, an
existing **quarterly "LUCY Wrapped"**, and an animated face. Existing infra confirmed in the
codebase: `react-native-view-shot` (5.1.0), `expo-sharing`, `expo-media-library`, `expo-file-system`
are all installed, and `src/components/LucyWrapped.tsx` already composites stat cards into one PNG
and shares it. **The share-OUT pipeline already exists** — most ideas below are reskins/extensions
of a proven pattern, not new infrastructure.

Legend: ✅ = pure on-device, fits privacy ethos, no server. ⚠️ = needs some server. **[NEEDS BACKEND]**
called out inline.

### A. Shareable artifacts (share-OUT — export an image to the user's own social/messaging)

These all reuse the `captureRef → expo-sharing` pattern already in `LucyWrapped.tsx`. **No personal
data ever leaves the device except the image the user themselves chooses to post.**

1. **✅ "LUCY Wrapped" card — polish + per-slide share + seasonal drop.**
   Already built. Upgrades: (a) make each slide individually shareable (Spotify does this — more
   share surfaces = higher K), (b) ensure every exported image carries a tasteful **Lucy logo +
   tagline + a short join URL/QR** so it self-markets and doubles as the invite, (c) fire a
   **synchronized seasonal notification** ("Your Q2 Wrapped is ready") so recaps drop together for a
   mini cultural moment. Highest leverage because it's done and proven.

2. **✅ Health-streak / milestone cards.**
   On hitting 7/30/100/365-day streaks or a personal best, auto-offer a celebratory branded card
   ("100 days with Lucy 🔥"). Pairs with a **streak-freeze forgiveness** mechanic (Duolingo) to keep
   it calm/human and reduce churn. Shows the *number*, not the private content. Loss aversion +
   milestone = a moment users *want* to post.

3. **✅ Spoiler-free "day/week glyph" card (Wordle-style).**
   Render a privacy-safe abstract: e.g. a small grid/orb pattern that encodes "captured N thoughts,
   M focus blocks, hit my streak" as colored glyphs — **no readable content**, just the *shape* of a
   good day. This is the purest privacy-first viral artifact: comparable and braggable while
   exposing nothing. On-brand with the animated face (the glyph can be Lucy's face reacting to your
   day).

4. **✅ "What Lucy learned about me" card.**
   A tasteful, *user-curated* card summarizing a fun, non-sensitive insight ("Lucy noticed I do my
   best thinking at 11pm"). **Privacy guardrails are essential**: user must explicitly pick/approve
   what's on the card; default to vague/fun framings; never auto-include names, passwords, health
   specifics, or anything the existing Privacy Shield would tokenize. Reuse the Privacy Shield logic
   to *block* sensitive tokens from ever rendering on a shareable.

5. **✅ "Animated face" sticker / short clip export.**
   Lucy's animated face is a unique brand asset. Export it as a sticker or a 3–5s clip reacting to a
   milestone ("Lucy is proud of your 30-day streak"). Highly recognizable, no data exposure, great
   on Stories. (Static sticker is trivial with current libs; a short clip needs a frame-capture/
   encode step — heavier but still on-device.)

6. **✅ Calendar / "Plan My Day" win card.**
   After Lucy auto-resolves a busy day or clears conflicts, offer a "Lucy untangled my week" card
   (counts only, no event details). Celebrates the calendar engine without exposing the calendar.

7. **✅ Quote/thought-of-the-week card (user-selected).**
   Let the user pick one of *their own* captured thoughts they're happy to share and render it as a
   beautiful Lucy-branded typographic card. User-chosen content = zero privacy risk.

### B. Referral / invite loops

1. **✅ Share artifact = the invite (no backend).**
   Bake a **join link + small QR + tagline** into every exported card. The image already spreads;
   making it carry the install link turns share-OUT into acquisition for free. This is the
   single most privacy-aligned, lowest-effort loop and needs **no server** — the link just points to
   the App Store / a static landing page.

2. **⚠️ Double-sided referral with on-device unlock rewards. [PARTIAL BACKEND]**
   Dropbox model, Lucy-flavored: when a friend installs via your link, **both unlock a premium
   on-device reward** (exclusive Lucy face/theme, an advanced insight, a power feature). The *reward
   fulfillment is on-device and free*, but **attributing the install to a referrer needs a minimal
   backend or a deferred-deep-link service** (e.g., an attribution provider) to tell device A that
   device B installed via its code. Keep it to *anonymous referral codes*, not identities — no
   personal data, just "code X drove one install." Variable/surprise reward (Robinhood) outperforms
   fixed.

3. **⚠️ "Unlock by inviting" feature gate. [PARTIAL BACKEND]**
   Loom-style: a desirable feature unlocks after N installs from your code. Same attribution
   requirement as #2. Powerful but only worth it once #1 and the artifacts are shipped.

4. **⚠️ Pre-launch / new-feature waitlist with leaderboard position. [NEEDS BACKEND]**
   Robinhood model for a future big feature. Effective but explicitly server-dependent (track
   positions + referral links). Park it.

### C. Habit / cadence (retention — fuels everything above)

1. **✅ Daily "Lucy moment" prompt.**
   BeReal-style cadence (without the social feed): a gentle once-a-day nudge to capture one thought,
   building the habit that produces the data that makes Wrapped/streaks worth sharing. On-device
   notification, no server.

2. **✅ Streaks + streak-freeze forgiveness.**
   Already have streaks; add Duolingo-style forgiveness and milestone moments (feeds B/A.2).

### Privacy backstop (applies to all share-OUT)
Before any card renders, run candidate text through the existing **Privacy Shield** tokenizer to
strip names/passwords/sensitive entities, and require **explicit user approval** of any card that
contains derived content. Default to *numbers and shapes* (streak counts, glyphs) over raw content.
This keeps every shareable consistent with Lucy's on-device, privacy-first promise.

### What needs a backend vs. what doesn't (summary)
| Idea | On-device only? | Notes |
|---|---|---|
| Wrapped card polish + per-slide share + seasonal drop | ✅ Yes | Already built |
| Streak/milestone cards + streak freeze | ✅ Yes | — |
| Spoiler-free day/week glyph card | ✅ Yes | Purest privacy-first artifact |
| "What Lucy learned about me" card | ✅ Yes | Gate via Privacy Shield + user approval |
| Animated-face sticker/clip export | ✅ Yes | Clip export is heavier but local |
| Calendar/Plan-My-Day win card | ✅ Yes | Counts only |
| User-selected thought card | ✅ Yes | User-chosen = safe |
| Join link + QR baked into cards | ✅ Yes | Link → store/landing page only |
| Daily "Lucy moment" prompt | ✅ Yes | Local notification |
| Double-sided referral w/ unlock reward | ⚠️ Partial | Reward local; **attribution needs server/deep-link service** |
| "Unlock by inviting" feature gate | ⚠️ Partial | Same attribution need |
| Waitlist + leaderboard position | ❌ No | **[NEEDS BACKEND]** |
| Strava-style segments/clubs/kudos, BeReal friend feed | ❌ No | Needs social graph; off-ethos for now |

---

## Part 3 — Prioritized recommendation (highest leverage, lowest effort first)

**Tier 0 — Ship now (pure on-device, mostly reusing existing code, fits privacy ethos perfectly):**

1. **Bake a Lucy join-link + small QR + tagline into every exported card.** Lowest effort
   (cosmetic + a static link), turns the *existing* Wrapped share into an acquisition loop. Do this
   first — it makes every other share-out artifact also a growth artifact.
2. **Polish the Wrapped export + add per-slide sharing + a synchronized seasonal "your Wrapped is
   ready" notification.** The pipeline already exists in `LucyWrapped.tsx`; this is Lucy's single
   biggest proven asset. Make the image gorgeous and unmistakably branded.
3. **Streak milestone celebration cards + streak-freeze forgiveness.** Retention (the prerequisite
   for any virality) *and* a steady stream of share-worthy moments. On-brand "warm, not robotic."

**Tier 1 — Fast follow (on-device, slightly more design/build):**

4. **Spoiler-free day/week "glyph" card.** The most *defensibly privacy-first* viral artifact —
   braggable, comparable, exposes nothing. A signature Lucy move competitors can't easily copy
   without a privacy story.
5. **Animated-face sticker export.** Cheap to do as a static sticker; leverages Lucy's most unique
   brand asset for instant recognition on social.
6. **"What Lucy learned about me" card** (gated by Privacy Shield + explicit approval) and
   **user-selected thought card.** Highest "wow," needs the most privacy care — do after the safer
   artifacts.

**Tier 2 — Needs infrastructure (do only after Tier 0/1 prove the share-out loop works):**

7. **Double-sided referral with on-device unlock rewards** — strongest classic loop, but needs a
   minimal attribution/deep-link layer. ⚠️ Partial backend.
8. **"Unlock by inviting" feature gate** — same attribution dependency. ⚠️
9. **Waitlist + leaderboard, and any social-graph features (segments/clubs/kudos/friend feeds)** —
   ❌ explicitly require a backend + social graph and partially conflict with the no-social-graph
   ethos. Park until there's a reason to build server infrastructure.

**Bottom line.** Lucy's privacy-first, on-device constraint is a *growth advantage*, not a handicap:
the highest-leverage viral moves (Wrapped, streak/milestone cards, spoiler-free glyphs, branded
share-out artifacts with an embedded join link) are exactly the ones that need **no backend and
expose no data** — and Lucy already owns the export pipeline to ship them. Build the share-OUT layer
first, defer anything requiring attribution or a social graph.

---

### Sources
- Dropbox: [Referral Rock](https://referralrock.com/blog/dropbox-referral-program/) · [Viral Loops](https://viral-loops.com/blog/dropbox-grew-3900-simple-referral-program/) · [GrowSurf](https://growsurf.com/blog/dropbox-referral-program/)
- Spotify Wrapped: [NoGood](https://nogood.io/blog/spotify-wrapped-marketing-strategy/) · [Wikipedia](https://en.wikipedia.org/wiki/Spotify_Wrapped) · [Binghamton University](https://www.binghamton.edu/news/story/5948/why-spotify-wrapped-goes-viral-every-year-binghamton-university-experts-weigh-in)
- Wordle: [Slate](https://slate.com/culture/2022/01/wordle-game-creator-wardle-twitter-scores-strategy-stats.html) · [Webflow](https://webflow.com/blog/wordle-design) · [LinkedIn](https://www.linkedin.com/pulse/why-wordle-went-viral-cynthia-lieberman)
- Robinhood: [Viral Loops](https://viral-loops.com/blog/how-robinhoods-referral-built-a-1m-user/) · [Prefinery](https://www.prefinery.com/blog/referral-programs/prelaunch-campaign/robinhood/)
- PayPal: [Referral Rocket](https://blogs.referralrocket.io/paypals-referral-program-a-case-study/) · [ReferralCandy](https://www.referralcandy.com/blog/paypal-referrals)
- Duolingo/Snapchat streaks: [Yu-kai Chou](https://yukaichou.com/gamification-study/master-the-art-of-streak-design-for-short-term-engagement-and-long-term-success/) · [Trophy](https://trophy.so/blog/duolingo-gamification-case-study) · [Plotline](https://www.plotline.so/blog/streaks-for-gamification-in-mobile-apps)
- BeReal: [Contrary Research](https://research.contrary.com/company/bereal) · [BeReal Help](https://help.bereal.com/hc/en-us/articles/15416869159197--Time-to-BeReal-Notification)
- Strava: [Latterly](https://www.latterly.org/strava-marketing-strategy/) · [Trophy](https://trophy.so/blog/strava-gamification-case-study) · [Strava Year in Sport](https://support.strava.com/hc/en-us/articles/22067973274509-Your-Year-in-Sport)
- Viral-loop theory: [First Round](https://review.firstround.com/glossary/k-factor-virality/) · [Founderpath](https://founderpath.com/blog/how-to-go-viral) · [Medium](https://medium.com/@dsmithdesignleadership/how-to-boost-your-products-k-factor-through-virality-invite-share-join-5abce77ce830)
