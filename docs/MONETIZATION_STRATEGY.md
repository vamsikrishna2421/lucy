# Lucy Monetization Strategy (June 2026)

> Synthesis of three research passes: competitor pricing, pricing/unit-economics, and the
> tech-stack/expenses to monetize. Estimates with assumptions stated. **Strategy only — nothing built.**

## The one insight that drives everything
Lucy's AI runs **on-device (Phi-4)** or on the **user's own API key (BYO-key)** → the marginal AI cost
of the *current* feature set is effectively **$0**. The only feature with a real per-use cloud cost is
**food-photo vision — and that's ~$0.0003–0.006 per photo (basically free).** So Lucy's variable costs
are tiny and the business is **fixed-cost-dominated**: break-even is low and almost every subscriber is
profit. The on-device/BYO-key architecture is a **margin moat** inference-bearing competitors (Cal AI,
Mem, Notion AI) structurally can't match. **Design rule: never gate privacy or basic capture; gate
convenience, scale, managed (no-key) AI, the health vision engine + Dr. Lucy, and the LAN companion.**

## Competitive landscape (where Lucy sits)
- AI second-brain (mymind, Reflect, Mem, Saner): **~$8–13/mo, ~$96–144/yr**.
- General AI assistants (ChatGPT/Claude/Gemini): **$20/mo** ceiling.
- AI calorie/health (Cal AI $49.99/yr, MacroFactor $71.99/yr, MyFitnessPal $79.99/yr, Bearable ~$35/yr):
  annual **$40–100**, with $12–20/mo anchors and (risky) weekly-price paywall tricks.
- Lucy is **a premium all-in-one** (second brain + calendar + tasks + vault + voice/"Hey Lucy" + health/
  Dr. Lucy) that replaces 3–5 separate subscriptions → priced **above note apps, below the $20 AI ceiling.**

## Recommended pricing
- **Lucy Free** — unlimited text + on-device voice capture, core memory/calendar/tasks/reminders,
  on-device LLM + BYO-key, vault/graph capped (~500 entries / ~1 GB), export. Genuinely useful forever
  (acquisition engine + privacy brand). $0 marginal cost to us.
- **Lucy Premium — launch at $9.99/mo or $69.99/yr** (annual default, ~42% off; the two research picks
  were $9.99/$59.99 and $12.99/$89.99 — $9.99/$69.99 splits them; A/B test up toward $12.99). Includes:
  **managed AI (no key needed)** — the #1 friction-killer; unlimited captures/vault; **unlimited food-photo
  scans + Dr. Lucy health guardian + advanced analytics**; "Hey Lucy" + conversational mode; **LAN web
  companion**; sync; with a **"use my own key" toggle** as a $0-cost pressure valve.
- **Lucy Pro / Family — $19.99/mo or $149.99/yr (launch later)** — higher managed-AI quota, up to 5
  family members (shared Dr. Lucy), document OCR/advanced search, early access. Acts as the **anchor**
  that makes Premium feel like a deal. Family plan is a differentiator (absent from indie second-brain set).
- **Founder Lifetime ($199–249, limited, BYO-key only)** — credible *because* BYO-key has no recurring AI
  cost; bootstraps cash + reviews. **Never** offer lifetime that bundles managed AI.
- **Trial:** real Free tier **plus** a **7-day Premium trial** at the aha moment (test 14-day). Strong
  Day-0 onboarding (most cancels happen Day 0). **No weekly pricing** (that got Cal AI delisted).
- **Aha/paywall trigger** (not at install): (1) first food-photo returns instant macros → "unlimited
  scans + Dr. Lucy, start trial"; (2) hitting the BYO-key wall → "Premium just works, no key."

## Unit economics (per Premium user, 15% Small Business Program fee)
| | BYO-key user | Typical managed | Managed-heavy |
|---|---:|---:|---:|
| Net after 15% store fee (on $9.99) | $8.49 | $8.49 | $8.49 |
| Vision + LLM + infra + support COGS | ~$0.70 | ~$1.75 | ~$5.15 |
| **Gross margin** | **~92%** | **~79%** | **~39%** |
Vision is negligible even "unlimited"; the only real cost risk is **frontier-LLM tokens on managed
Premium** → mitigate with on-device-first routing, per-user fair-use caps, and steering heavy users to
BYO-key (they self-select off the P&L). At the 30% fee (past ~$1M/yr) margins drop ~4–6 pts.

## Projections (5% blended free→paid, ~$6.50 blended ARPpU, ~79% margin)
| Downloads | Paid | MRR | ARR | Gross profit |
|---:|---:|---:|---:|---:|
| 10k | 500 | ~$3.3k | ~$39k | ~$31k |
| 50k | 2.5k | ~$16k | ~$195k | ~$154k |
| 200k | 10k | ~$65k | ~$780k | ~$616k |
Break-even ~**1,850 paying users (~$12k MRR)** at a modest fixed burn. (Note: Cal AI spends ~$770k/mo on
ads — if pursuing paid UA, model CAC payback: at $6.50 ARPpU a $30 CAC needs ~6 mo retention.)
Caveat: AI apps earn +41% Year-1 LTV but churn ~36% worse on monthly → **annual default is critical**;
Dr. Lucy's proactive insights + the second-brain's compounding switching cost are the retention engines.

## Tech stack + expenses
- **IAP: RevenueCat** (`react-native-purchases` + config plugin; needs a dev build — fine, Lucy uses
  Codemagic). Free under **$2,500/mo tracked revenue, then 1%**. Gives entitlements, receipt validation,
  cross-platform sync, restore, dashboards — **no backend needed for BYO-key**. (Raw StoreKit2 + Play
  Billing = $0 fee but weeks of DIY + a backend for cross-platform sync; not worth it early.)
- **Paywall:** start with **RevenueCat Paywalls** (free, built-in); add **Superwall** later for A/B tests
  (250 conv/mo free, then ~$0.20/conv).
- **Backend:** **NONE for Phase 1** (BYO-key + on-device; entitlements client-side via RevenueCat).
  **Required for managed AI (Phase 2)** — you can't ship your own API key in the app. Minimal serverless
  proxy (**Cloudflare Workers** ~$0–5/mo, or Supabase Edge) that: gates by RevenueCat entitlement
  (webhook → KV/D1), proxies LLM/vision with server-held keys, and **meters + rate-limits usage** (this is
  what protects margin). Proxy infra is cheap; **model tokens dominate cost.**
- **Cloud AI prices (per 1M):** GPT-4o $2.50/$10, GPT-4o-mini $0.15/$0.60, Claude Haiku 4.5 $1/$5, Sonnet
  4.6 $3/$15, Gemini 3 Flash $0.50/$3. Food photo ≈ $0.0003 (mini/Flash) to $0.006 (4o). Prompt caching
  ~90% off cached input — big lever for Lucy's repeated context prefix. Managed AI cost/active-user:
  light ~$0.03–0.06, medium ~$0.25–0.60, heavy ~$2–5/mo.
- **Other:** Apple $99/yr, Google $25 once, EAS (free→$19→~$99/mo by MAU; watch egress), Codemagic CI,
  PostHog (free 1M events) + Sentry (free→$26/mo), support (Crisp/Plain free / email), Resend email,
  privacy-policy hosting (free + ~$12/yr domain), optional Supabase Pro $25/mo only if cloud sync added.
- **Rough monthly all-in:** Phase 1 (BYO-key, no backend) **~$10–30/mo**. Medium scale w/ managed AI
  (~25k MAU, 1.5k paying) **~$900–1,200/mo, AI tokens dominate.**

## Compliance (the Cal AI cautionary tale — it broke 3 rules and got pulled Apr 2026)
- **IAP only** (no external/Stripe checkout in-app for digital subs).
- **Honest paywall:** clearly show the real charged price, period, auto-renew, and how to cancel BEFORE
  purchase. No weekly-price-front, no hidden annual total, no "personalized pricing" trick.
- **Restore Purchases** button (Apple requires it; RevenueCat `restorePurchases()`).
- **Privacy policy** + accurate App Privacy / Play Data Safety labels; disclose when data goes to AI
  services + get consent (relevant once managed-AI proxy is live; BYO-key/on-device label stays clean).
- Avoid **ATT** by staying first-party analytics (keeps the privacy story). Mind 2026 child-safety laws →
  set an appropriate age rating.

## Phased plan
- **Phase 0:** Apple/Google accounts, privacy policy, App Privacy/Data Safety, Sentry + PostHog.
- **Phase 1 (fastest revenue, ~$10–30/mo, NO backend):** RevenueCat + compliant paywall + Restore +
  entitlement gating; keep BYO-key as the AI path → $0 token cost. Gate: unlimited vault/captures, LAN
  companion, "Hey Lucy"/conversation, advanced health/Dr. Lucy.
- **Phase 2 (managed AI):** Cloudflare Workers proxy (entitlement gate + metering + model routing +
  caching), food-photo vision endpoint, updated privacy disclosures. This is what justifies "no key"
  Premium and unlimited photo health.
- **Phase 3 (optimize):** Superwall A/B testing, EAS scale, optional cloud sync/backup.

## Bottom line
Launch **Premium at ~$9.99/mo or $69.99/yr** (annual default), default to **managed AI** for low friction
with **BYO-key** as a $0-cost pressure valve and Free anchor. Gate convenience/scale/managed-AI/health-
vision/LAN — never privacy or capture. Margins are exceptional (75–92%) because on-device makes vision the
only variable cost and vision is ~free. Start monetizing in **Phase 1 with just RevenueCat (no backend,
~$10–30/mo)**; the cost curve only turns on when you *choose* to provide managed AI — at which point
metering + model-routing in the proxy is what protects margin. Make **transparent billing a brand asset**
(the opposite of Cal AI).
