# India Health/Fitness App Research — Making Lucy's Health Module Competitive in India

> Competitive/market research compiled June 2026. Original analysis based on cited public sources (linked
> at the end of each section and in the Sources list). No copyrighted text is reproduced — all figures and
> descriptions are paraphrased from the sources. Pricing is approximate and changes frequently with
> promos/coupons; verify before quoting externally.
>
> Cross-reference: `docs/MONETIZATION_STRATEGY.md` (Lucy's global pricing, unit economics, on-device/BYO-key
> margin moat). This doc adapts that strategy to Indian price sensitivity and regulation.

---

## 0. TL;DR for the team

- **The Indian market is bifurcated.** One side is **AI calorie/nutrition tracking with deep Indian-food
  coverage** (HealthifyMe is the 800-lb gorilla; its AI coach "Ria" + Snap photo logging + a 100k+ Indian
  food DB is the bar). The other side is **gym/class access + human coaching + community/gamification**
  (Cult.fit, FITPASS, Fittr, GOQii, StepSetGo/Stepathon).
- **Lucy competes squarely on the first axis** (calorie intake/burn + Dr. Lucy guardian), where its
  on-device privacy + second-brain context is a genuine differentiator. Lucy should **not** try to become a
  gym-aggregator or human-coach marketplace — those are capital/ops-heavy and not Lucy's lane.
- **The single biggest gap to close is the Indian-food calorie database + portion model** (roti/dal/regional
  dishes in katoris/pieces/glasses, not 100g portions). Without this, Lucy's health module is not credible
  in India. This is the #1 catch-up item.
- **Pricing must drop hard for India.** Lucy's global Premium is ~$9.99/mo / $69.99/yr. Indian app
  subscriptions cluster at ₹79/₹149/₹199/₹299/₹499/₹999. HealthifyMe's AI-only "Smart" tier is ~₹2,499/yr
  (~₹208/mo). Lucy should localize to roughly **₹199–399/mo and ₹1,499–1,999/yr** to be competitive while
  staying premium — far below a naive ₹830/mo USD conversion. UPI Autopay is now the table-stakes recurring
  payment rail on Google Play in India.
- **Regulation:** the **DPDP Act 2023** treats health-data handlers as "data fiduciaries" (consent,
  minimization, breach notice, erasure rights; penalties up to ₹250 crore). Lucy's on-device-first,
  privacy-first architecture is a strong fit and a marketing asset — but Dr. Lucy must avoid framing itself
  as a medical/diagnostic/telemedicine service.

---

## 1. Competitor profiles

### 1.1 HealthifyMe (the benchmark) — incl. "Ria" AI + Snap meal scan

- **Core:** India's leading nutrition/fitness app. Calorie & macro/micro tracking, personalized diet plans
  (algorithmic), human coaching tiers, and an AI nutritionist. Strong Indian-food focus.
- **Calorie/nutrition + Indian food DB:** ~**100,000+ foods** including Indian + international, regional
  recipes, restaurant chains (incl. India-specific QSR). This deep, India-native database is its core moat —
  it handles roti/dal/regional dishes and home-cooked meals far better than Western apps (MyFitnessPal etc.).
  Logging via voice, barcode, and photo. Portion handling tuned to Indian eating patterns.
- **AI features:** **Ria** — 24/7 AI nutrition coach that logs meals, counts calories, tracks macros, answers
  nutrition questions, suggests alternatives, and nudges throughout the day. **Snap** — photo meal scan that
  estimates calories and recognizes most common Indian dishes without manual entry. The "always-on AI vs.
  limited human-coach hours" angle is a core selling point.
- **Human coaching model:** Tiered. **Smart** (AI-only, no human coach). **1 Coach** (dedicated certified
  nutritionist, ~2–4 calls/mo + unlimited chat). **2 Coach** (adds a separate fitness coach). Also a **CGM**
  plan bundling a FreeStyle Libre continuous glucose sensor with the app.
- **Pricing (India, 2026, approx.):**
  - **Smart (AI-only):** ~**₹2,499/yr** (~₹208/mo); monthly ~₹300–500.
  - **1 Coach:** ~₹15,000–20,000/yr (~₹1,250–1,650/mo).
  - **2 Coach:** ~₹24,000–35,000/yr (~₹2,000–2,900/mo).
  - **Smart CGM:** ~₹4,099 one-time (with sensor).
  - (Other sources list higher "Pro/Pro Plus" annual figures ₹4,999–17,988 depending on packaging/region —
    the lineup and naming shift often; treat as directional.)
- **What it does especially well for India:** the deepest Indian-food database; an AI coach that actually
  understands desi meals; tiered human accountability layered on top of AI; CGM/metabolic angle for the
  diabetes-heavy Indian market. **This is the app Lucy is measured against on nutrition.**

### 1.2 Cult.fit / cure.fit

- **Core:** Omnichannel fitness — physical gym/class network (130+ locations) + app workouts, plus diet
  plans, nutritionist guidance, and mindfulness/meditation. More "fitness lifestyle platform" than calorie
  tracker.
- **Calorie/nutrition:** Diet plans and nutritionist guidance exist but nutrition tracking is not the core;
  Cult.fit's strength is **class/gym access and trainer-led group workouts (GX)**, not Indian-food calorie
  logging.
- **AI features:** Primarily class booking, workout content, and trackers — not a headline AI meal-scan
  product like Ria/Snap.
- **Workout/fitness:** Trainer-led group classes (HIIT, dance, yoga, S&C), live workouts, and at-home video
  content. cultpass **ELITE** = unlimited city gym/class access (pre-book up to 4 classes); **PRO** = partner
  gyms + live workouts + limited cult-center access.
- **Human coaching:** In-person trainers at centers + nutritionist guidance; meditation/mindfulness sessions.
- **Gamification/engagement:** Class streaks, booking, in-person community.
- **Pricing (India, 2026, approx.):** Unlimited packs ~**₹9,990 / 3 mo**, ~**₹14,990 / 6 mo**,
  ~**₹17,490 / 12 mo** (varies by city/tier/coupons; ~25%+ off via promos common). Membership pause allowed.
- **What it does well for India:** physical presence + community + breadth (gym, classes, mind). It owns the
  "go to a class / structured studio" use case Lucy does not and should not chase.

### 1.3 Fittr

- **Core:** Community-driven transformation platform (founded 2016, ~5M downloads; Rainmatter/Zerodha-backed).
  Coach **marketplace** + tracking + a very strong community.
- **Calorie/nutrition:** Guided calorie/macro calculation, step tracking, biometric tracking, goal setting —
  serviceable tracking, but the differentiator is the **coach + community**, not a best-in-class food DB.
- **AI features:** Lighter on headline AI than HealthifyMe; the value is human coaches + peer accountability.
- **Workout/fitness:** Structured 3–6 month transformation programs across goals (fat loss, bodybuilding,
  powerlifting, endurance, athletic performance).
- **Human coaching:** **Marketplace model** — certified coaches at various price points; user reviews/ratings
  create competition that keeps pricing accessible. Best for users who want human accountability.
- **Gamification/engagement:** Big community (500k+ FB members), challenges, transformation documentation,
  social motivation — arguably its strongest asset.
- **Pricing:** Coach-marketplace driven, so variable; positioned as accessible vs. premium competitors
  (specific public 2026 figures not consistently listed).
- **What it does well for India:** community + human-coach accountability + real, documented transformations.
  Trust and peer support, not AI.

### 1.4 GOQii

- **Core:** "Coaching-first" wellness — bundles a fitness tracker/band with a **real human coach** via a
  cloud platform that routes your data to the coach for feedback. Hardware + service hybrid.
- **Calorie/nutrition:** Logging + coach-guided diet/lifestyle, oriented around lifestyle coaching rather
  than a deep self-serve Indian-food DB.
- **AI features:** Not the headline; the value prop is human coaches + device telemetry. (GOQii has expanded
  into broader wellness/insurance-adjacent offerings over the years.)
- **Workout/fitness:** Activity/step/HR/SpO2 tracking via band; coach sets goals.
- **Human coaching:** Core differentiator — personal coaching subscription **starts ~₹2,399**; coaches give
  feedback against your tracked data.
- **Gamification/engagement:** Karma/streaks/challenges historically; device + coach accountability loop.
- **Pricing:** Coaching subscriptions bundled with a device, **from ~₹2,399** (3-month coaching bundles
  common on retail like Amazon/1mg).
- **What it does well for India:** affordable human coaching + a device, packaged for mainstream users who
  want a person checking on them.

### 1.5 FITPASS

- **Core:** **Gym/class aggregator** — one membership, many gyms. India's largest such network.
- **Calorie/nutrition:** Added a wellness stack — **FITFEAST** (personalized diet plans), **FITCOACH**
  (AI-led fitness coaching), **FITHEAL** (health check-ups/advice) on top of gym access.
- **AI features:** FITCOACH = AI-led fitness coaching (workout side, not a Ria-style food-scan product).
- **Workout/fitness:** Access to gyms + a huge variety of disciplines (Zumba, MMA, kickboxing, swimming,
  HIIT, pilates, yoga, etc.); FITPASS-TV virtual sessions from global trainers.
- **Human coaching:** Diet plans + coaching layered on; primary value is access.
- **Gamification/engagement:** Multi-city access, variety, virtual classes.
- **Pricing (India, 2026, approx.):** From ~**₹999/mo**; **FitCoach** from ~₹499/mo; **Pro** ~₹2,499/mo;
  **FITPASS 360** ~₹2,999/mo (sometimes ~₹1,667/mo annualized). 3.5k+ partner gyms, 150+ cities.
- **What it does well for India:** flexibility + breadth of access across cities; good for people who want
  many gyms/classes without locking into one chain.

### 1.6 Other notable Indian ones

- **Sworkit (available in India):** Bodyweight/equipment-light workouts — 900+ exercises, 500+ workouts
  (HIIT, Tabata, cardio, strength, yoga, Tai Chi, Pilates). Subscription (monthly/annual) with a 7-day trial;
  free kids' workouts. Workout-content app, not a nutrition/Indian-food product. Global app, not India-tuned.
- **Stepathon / Stepathlon:** **Corporate/team step challenges** — gamified 30-day team competitions,
  wearable/app step tracking, "race across the globe" distance conversion, leaderboards. B2B wellness
  engagement, not a consumer health app per se.
- **StepSetGo (SSG):** Consumer **gamified steps** app — positions itself as India's most engaging health app
  via steps + community + **rewards (convert steps into coins → redeem)**. Strong India-native engagement loop
  worth studying for Lucy's gamification.
- **Loop Health:** Runs Stepathons across Indian orgs (B2B), notable for high participation — signals that
  team/social challenges drive Indian engagement.
- **Calorie-calculator / AI-scan niche (e.g., NutriScan, Alpha Coach, and similar):** A wave of smaller
  India-focused tools building **4,000+ Indian-food databases**, AI photo recognition that estimates dish +
  portion + cooking method (oil level matters a lot in Indian home cooking), and katori/piece/glass portion
  models. These validate both the demand and the *exact technical approach* Lucy needs for Indian food.

---

## 2. Feature comparison — Lucy vs. the field

**Lucy today (relevant to health):** privacy-first, on-device second brain (memory/calendar/tasks/vault/
voice/"Hey Lucy"), with an **expanding health module = calorie intake/burn + Dr. Lucy guardian**, on-device
LLM (Phi-4) + BYO-key, and a planned food-photo vision engine. Privacy + context + zero-marginal-cost AI are
the structural advantages (see MONETIZATION_STRATEGY.md).

| Capability | HealthifyMe | Cult.fit | Fittr | GOQii | FITPASS | StepSetGo | **Lucy (now/planned)** |
|---|---|---|---|---|---|---|---|
| Indian-food calorie DB (roti/dal/regional, katori portions) | ★★★★★ | ★★ | ★★★ | ★★ | ★★ | — | **★ (gap — must build)** |
| AI meal-photo scan | ★★★★ (Snap) | — | — | — | — | — | **planned vision engine** |
| Conversational AI coach | ★★★★★ (Ria) | ★ | ★★ | ★★ (human) | ★★ | — | **★★★ (Dr. Lucy + on-device LLM)** |
| Calorie burn / activity tracking | ★★★★ | ★★★★ | ★★★ | ★★★★ (band) | ★★★ | ★★★★ (steps) | **building** |
| Human coaching | ★★★★ | ★★★ (in-person) | ★★★★★ (marketplace) | ★★★★ | ★★★ | — | **— (not Lucy's lane)** |
| Gym/class access | — | ★★★★★ | ★★ | — | ★★★★★ | — | **— (not Lucy's lane)** |
| Gamification/rewards | ★★★ | ★★★ | ★★★★ (community) | ★★★ | ★★ | ★★★★★ (rewards) | **★ (gap)** |
| Privacy / on-device | ★ (cloud) | ★ | ★ | ★ | ★ | ★ | **★★★★★ (core differentiator)** |
| Second-brain context (links meals↔mood↔calendar↔memory) | ★★ (CGM-led) | — | — | ★★ | — | — | **★★★★★ (unique)** |
| India pricing localization | ★★★★ | ★★★ | ★★★★ | ★★★★ | ★★★★ | ★★★★★ (free+rewards) | **gap — must localize** |

### Gaps Lucy MUST close to be credible in India
1. **Indian-food calorie database + portion model** (the #1 gap). Roti/dal/sabzi/rice/biryani/dosa/idli/
   regional sweets and snacks, measured in **rotis, katoris, pieces, glasses, plates** — not grams. Must
   account for **oil level, flour type, thickness, cooking method**, which swing calories dramatically.
2. **AI meal-photo scan tuned for Indian dishes** (recognize dish + estimate portion + infer cooking method).
   Lucy's planned vision engine must be trained/prompted for desi food, not generic Western plates.
3. **Calorie-burn / activity side** — step/activity integration (HealthKit/Google Fit/Health Connect, and
   wearables) so intake-vs-burn is a complete loop.
4. **India price localization + UPI** (see §3).
5. **Engagement/gamification** — Indian winners (StepSetGo, Stepathon, Fittr community) lean hard on
   streaks/rewards/social. Lucy has little here.

### Where Lucy can DIFFERENTIATE (don't copy — out-position)
- **Privacy-first / on-device** — uniquely strong under DPDP. None of the incumbents lead with on-device
  privacy; this is a genuine, defensible India story ("your health data never leaves your phone").
- **Second-brain context** — Lucy already holds your calendar, mood, memory, tasks. Dr. Lucy can connect
  **"you skipped lunch and your 3pm meeting ran long → that's why you binged at 8pm"** — proactive, human,
  contextual insight no calorie tracker can do. This is the retention engine (per MONETIZATION_STRATEGY.md).
- **Dr. Lucy as a calm guardian, not a nag or a medical claim** — warm, human copy (per AGENTS.md product
  feel), guardian/early-warning framing rather than confidence scores or diagnoses.
- **All-in-one** — health is one module of a second brain that also runs calendar/tasks/voice. Replaces
  multiple subscriptions; nobody in the Indian health set offers the second-brain wrapper.
- **Near-zero marginal cost** — on-device + BYO-key lets Lucy undercut HealthifyMe's AI-only tier on price
  while keeping margins healthy (the margin moat from MONETIZATION_STRATEGY.md). Lucy can offer a genuinely
  useful **free** Indian-food tracker as an acquisition wedge.
- **No human-coach ops / no gym network** — deliberately. Lucy stays software-only and lets that be a price
  and privacy advantage, not a feature deficit.

---

## 3. India-specific must-haves

### 3.1 Indian-food calorie database & coverage (non-negotiable)
- Build/license a **dedicated Indian-food DB** (target several thousand+ dishes): staples (roti/chapati,
  paratha, rice, dal, sabzi), regional mains (North/South/East/West — dosa, idli, vada, sambar, poha, dhokla,
  biryani varieties, curries), snacks/street food, sweets/mithai, beverages (chai with sugar/milk), and
  **India-specific restaurant/QSR** items.
- **Portion model in Indian units**: rotis (by size/thickness/flour), katoris (small/medium bowls), pieces,
  glasses/cups, plates — with sensible defaults and quick adjust. Grams should be optional/under the hood.
- **Cooking-method awareness**: oil quantity, fried vs. dry, ghee, gravy thickness — these move calories more
  than portion in Indian home cooking. The vision scan and manual log should both let users flag "more oil /
  less oil / homemade vs. restaurant."
- **Logging modalities**: text, **voice (Lucy already has on-device voice)**, photo scan, and quick "repeat
  yesterday's breakfast" — Indian meals are repetitive, so fast re-logging drives retention.

### 3.2 Regional & dietary patterns
- First-class diet filters/profiles: **Vegetarian, Vegan, Jain (no onion/garlic/root veg), Eggetarian,
  Non-veg, Halal, Satvik, lactose-considerations**. Default suggestions and "alternatives" must respect these.
- Festival/fasting awareness (Navratri/vrat foods, Ramzan, Karva Chauth, etc.) — proactive, human nudges that
  fit the culture, not generic Western "cheat day" framing.
- Regional defaults by user location/preference (a Tamil user's "breakfast" ≠ a Punjabi user's).

### 3.3 Language & localization
- Beyond English: support **Hindi first**, then high-value languages (Tamil, Telugu, Marathi, Bengali,
  Kannada, etc.) progressively — at minimum for food names, logging, and Dr. Lucy's nudges. Hinglish input
  should "just work" for voice/text logging ("do roti aur ek katori dal").
- Currency, date, units localized; calm premium dark theme already fits.

### 3.4 ₹ Pricing expectations (localize hard vs. global docs)
- **Reality:** Indian app subscriptions cluster at psychological points **₹79 / ₹119 / ₹149 / ₹199 / ₹299 /
  ₹499 / ₹999**. HealthifyMe's AI-only Smart tier is ~₹2,499/yr (~₹208/mo); gym/coach products run far
  higher but deliver physical/human value.
- **MONETIZATION_STRATEGY.md** sets global Premium at ~$9.99/mo / $69.99/yr. A naive FX conversion (~₹830/mo)
  is **too high** for the Indian self-serve health buyer. Recommend **India-specific store pricing**:
  - **Lucy Premium (India): ~₹249–399/mo, ~₹1,499–1,999/yr** (annual default; lands near/below HealthifyMe
    Smart while bundling the whole second brain). Lucy's near-zero marginal cost (on-device + BYO-key) makes
    this viable on margin where inference-bearing rivals can't follow.
  - Keep a **genuinely useful Free tier** (on-device Indian-food + voice logging) as the acquisition wedge —
    StepSetGo shows free+rewards drives huge Indian engagement.
  - Consider a low **lifetime/founder** option (BYO-key only) — credible because BYO-key has no recurring AI
    cost (per strategy doc), and Indians respond well to one-time over recurring.
- A/B test price points; Indian users are highly promo/coupon-driven (every competitor leans on discounts).

### 3.5 Payments (UPI is mandatory)
- **UPI Autopay / e-mandate** is now supported for subscriptions on **Google Play in India** and is the
  dominant recurring rail (millions of mandates created monthly). Ensure the IAP/paywall flow (RevenueCat per
  strategy doc) surfaces **UPI Autopay** on Android — not just cards. iOS uses App Store billing (cards/UPI as
  Apple supports). Do NOT route around store billing for digital subs (compliance, per strategy doc).
- Indian buyers are wary of auto-debit "traps" — make **cancellation and renewal terms extra clear** (this
  also aligns with the honest-billing brand asset in MONETIZATION_STRATEGY.md and avoids the Cal AI mistakes).

### 3.6 Data & health regulation (India)
- **DPDP Act 2023** is India's data-protection law. Health-data handlers are **"data fiduciaries"** with
  duties: **consent, purpose limitation, data minimization, breach notification, and rights to access/erasure**.
  Penalties up to **₹250 crore** for serious violations.
- **Lucy's on-device-first design is an advantage here** — minimal data leaves the device, which is the
  easiest path to compliance and a strong marketing claim. Where managed AI/vision runs in the cloud
  (Phase 2 in strategy doc), Lucy must: get **explicit consent** before sending data to AI services, disclose
  it, minimize what's sent, and support erasure.
- **ABDM / NDHM** (Ayushman Bharat Digital Mission) governs national health records — only relevant if Lucy
  ever integrates ABHA/health records; not required for a calorie/wellness tracker, but know it exists.
- **Telemedicine line:** apps offering medical consultation are regulated (Telemedicine Practice Guidelines)
  and treated as data fiduciaries. **Dr. Lucy must position as wellness/guardian, not medical advice/
  diagnosis/telemedicine** — clear "not a substitute for a doctor" disclaimers; avoid diagnostic claims.
- Standard: clear **Privacy Policy**, accurate App Privacy/Data Safety labels, appropriate age rating.

---

## 4. Prioritized "catch-up + differentiate" roadmap for Lucy's health module (India-focused)

Ordered by impact-to-effort for the Indian market. Tags: **[Catch-up]** = needed to be credible;
**[Differentiate]** = where Lucy wins.

**P0 — credibility (must-have to launch in India)**
1. **[Catch-up] Indian-food calorie database + Indian portion model** (roti/dal/regional, katori/piece/glass,
   oil/cooking-method aware). Without this, nothing else matters. Seed several thousand dishes incl. regional
   + India QSR.
2. **[Catch-up] Fast logging in Indian idioms** — voice/Hinglish ("do roti ek katori dal"), text, and
   "repeat meal" for India's repetitive eating. Leverage Lucy's existing on-device voice.
3. **[Catch-up] Diet profiles** — Veg/Vegan/Jain/Eggetarian/Non-veg/Halal/Satvik filters affecting logging
   and suggestions.
4. **[Catch-up + Differentiate] India-localized pricing + UPI Autopay** — ~₹249–399/mo / ₹1,499–1,999/yr,
   strong free tier, UPI on Play; transparent billing.

**P1 — the AI wedge (Lucy's natural strength)**
5. **[Catch-up→Differentiate] Indian-food photo scan** — vision engine tuned for desi dishes (dish + portion
   + cooking method). Matches HealthifyMe Snap; near-zero marginal cost is Lucy's pricing edge.
6. **[Differentiate] Dr. Lucy contextual guardian** — connect intake to Lucy's calendar/mood/memory ("late
   meeting → skipped lunch → 8pm binge"); proactive, human, calm. Nobody else can do this. **The retention
   moat.**
7. **[Catch-up] Calorie-burn loop** — HealthKit / Google Fit / Health Connect + wearable steps/activity, so
   intake-vs-burn is complete.

**P2 — engagement & stickiness (learn from Indian winners)**
8. **[Catch-up] Gamification** — streaks, weekly goals, gentle (human, not robotic) nudges; consider a light
   rewards/social loop inspired by StepSetGo/Fittr community (without building a gym network or coach
   marketplace).
9. **[Differentiate] Festival/fasting & regional awareness** — Navratri/vrat, Ramzan, regional default meals;
   culturally-fluent proactive insights.
10. **[Catch-up] Hindi (then regional) localization** for food names, logging, and Dr. Lucy nudges.

**P3 — trust, compliance, and positioning**
11. **[Differentiate] Privacy-first marketing** — "your health data stays on your device" as the headline
    India claim; clean App Privacy/Data Safety labels; DPDP-aligned consent for any cloud AI.
12. **[Catch-up] Compliance guardrails** — explicit consent for managed-AI/vision, erasure support, breach
    process; **Dr. Lucy = wellness guardian, not medical/telemedicine** (disclaimers, no diagnosis).

**Explicitly NOT recommended (out of lane):** building a human-coach marketplace (Fittr/GOQii), a gym/class
network (Cult.fit/FITPASS), CGM hardware, or corporate/B2B Stepathons. These are capital/ops-heavy and dilute
Lucy's privacy-first software identity. Lucy wins by being the **private, contextual, AI-native Indian-food
tracker + calm guardian inside a second brain** — at a price the incumbents' cost structures can't match.

---

## Sources
- HealthifyMe pricing/features/Ria/Snap/Indian DB: [NutriScan – HealthifyMe 2026 India pricing](https://nutriscan.app/blog/posts/healthifyme-pricing-2026-india-plans-63a87b21d0), [NutriScan – HealthifyMe worth it 2026 (Ria/photo/Indian food)](https://nutriscan.app/blog/posts/healthifyme-worth-it-2026-ria-ai-indian-food-tracker-f3167114ef), [FitTrack AI – HealthifyMe pricing 2026 review](https://www.fittrackai.in/blog/healthifyme-pricing-2026-is-it-worth-it-honest-review), [Nutrola – Is Healthify worth it 2026](https://nutrola.app/en/blog/is-healthify-worth-it-2026), [Healthify Store](https://store.healthifyme.com/products/healthifyplus-plan)
- Cult.fit / cure.fit: [magicpin – Cult.fit price & offers 2026](https://magicpin.in/blog/category/health/cult-fit-membership-price-offers), [GrabOn – Cult Fit coupons Jun 2026](https://www.grabon.in/cult-coupons/), [cure.fit support – cultpass tiers](https://support.cure.fit/support/solutions/articles/25000006138-what-are-the-various-membership-packs-available-for-cult-fit-)
- Fittr: [FitTrack AI – FITTR review 2026](https://www.fittrackai.in/blog/fittr-app-review-2026-pros-cons-and-best-alternative), [FitTrack AI – FITTR vs MyFitnessPal](https://www.fittrackai.in/blog/fittr-vs-myfitnesspal-which-is-better-for-indians-in-2026), [StartupTalky – Top fitness/diet apps India 2026](https://startuptalky.com/top-fitness-diet-apps-india-listicle/)
- GOQii: [GOQii coaching subscription](https://goqii.com/lp/coaching-subscription), [1mg – GOQii Smart Vital + coaching](https://www.1mg.com/otc/goqii-smart-vital-fitness-spo2-tracker-with-3-months-personal-coaching-subscription-otc610384)
- FITPASS: [FITPASS membership price](https://fitpass.co.in/blog/fitpass-membership-price), [FITPASS 360](https://fitpass.co.in/membership/fitpass-360), [GrabOn – FITPASS coupons Jun 2026](https://www.grabon.in/fitpass-coupons/)
- Sworkit: [Sworkit on Google Play](https://play.google.com/store/apps/details?id=sworkitapp.sworkit.com&hl=en), [JustUseApp – Sworkit details](https://justuseapp.com/en/app/527219710/sworkit-fitness-workout-app)
- Stepathon / StepSetGo / corporate challenges: [Stepathon.io](https://stepathon.io/), [MantraCare – Stepathlon](https://mantracare.org/corporate-wellness/stepathlon-steps-challenge/), [StepSetGo corporate](https://corporate.stepsetgo.com/), [Loop Health – Stepathon](https://www.loophealth.com/post/stepathon-the-ultimate-employee-wellness-and-engagement-activity)
- Indian food calorie/portion challenges + AI scan: [DesiUtils – Indian food calorie guide](https://desiutils.in/blog/calorie-guide-indian-food), [NutriScan – how to count calories in Indian food](https://nutriscan.app/blog/posts/how-to-count-calories-indian-food-1d51fcc4a5), [NutriScan – Indian food calorie calculator](https://nutriscan.app/apps/indian-food-calorie-calculator), [Alpha Coach – Indian food calories chart](https://blog.alphacoach.app/nutrition/indian-food-calories-chart/)
- DPDP Act 2023 / health data / telemedicine: [CMS – Digital health apps & telemedicine: India](https://cms.law/en/int/expert-guides/cms-expert-guide-to-digital-health-apps-and-telemedicine/india), [NMJI – India's health data landscape & DPDP](https://nmji.in/navigating-indias-evolving-healthcare-data-landscape-implications-of-the-digital-personal-data-protection-act-2023/), [Springer – DPDP 2023 & healthcare](https://link.springer.com/article/10.1186/s12982-025-00757-6), [MeitY – DPDP Act 2023 (PDF)](https://www.meity.gov.in/static/uploads/2024/06/2bf1f0e9f04e6fb4f8fef35e82c42aa5.pdf), [Ricago – DPDPA & NDHM for digital health](https://www.ricago.com/blog/legal-guidelines-for-digital-health-and-telemedicine-under-the-dpdpa)
- UPI Autopay / Indian subscription payments: [Google Blog – UPI on Google Play subscriptions](https://blog.google/intl/en-in/products/platforms/now-pay-for-subscriptions-via-upi-on-google-play/), [Android Central – Google Play UPI Autopay India](https://www.androidcentral.com/apps-software/google-play-upi-autopay-india), [Razorpay – UPI mandate](https://razorpay.com/blog/what-is-upi-mandate/), [Right to Information wiki – subscription auto-debit/cancel India 2026](https://righttoinformation.wiki/subscription-auto-debit-trap-cancellation-india)
