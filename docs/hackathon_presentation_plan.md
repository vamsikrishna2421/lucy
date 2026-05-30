# LUCY — Hackathon Presentation Plan

**App:** LUCY — Your Private AI Second Brain  
**Tagline:** Say it. LUCY remembers it.  
**Presenter:** Vamsy

---

## 1. The Hook (30 seconds)

Open with a question judges can nod to:

> "How many times this week did you forget something important you just said — a decision in a meeting, something you promised, an idea you had in the shower? LUCY is the fix."

Then: **demo the core loop live**. No slides yet. Open the app, capture something real from the room.

---

## 2. The Problem (60 seconds)

**The gap between thinking and remembering is expensive.**

- We have 60,000+ thoughts a day — fewer than 5% are ever captured
- Current tools have too much friction: stop what you're doing, open an app, type, organize, file
- Voice memos are unstructured — you can't search, act on, or query them later
- Notes apps are graveyards — things go in but never surface again

**This is not a productivity problem. It's a cognitive infrastructure problem.**

---

## 3. The Solution: LUCY (90 seconds)

> "LUCY is the fastest path from a thought to an organized memory."

**Walk through the core flow:**

1. **Voice Capture (10 seconds):** Tap the voice button, speak naturally:  
   *"Talked to Marcus about the Series B deck. He needs the revenue slide by Thursday and wants me to update the investor list."*  
   Release — Whisper converts speech to text on-device. One tap, done.

2. **Live Extraction Replay (the wow moment — 4 seconds):** After submitting, an animated modal appears showing extracted artifacts dropping in — a task card, a person card, a follow-up chip. "LUCY just turned your voice into organized data."

3. **The Board:** Show the whiteboard with tasks already organized by context. "That was just in your head 15 seconds ago."

4. **Ask LUCY:** Type "What do I need to do for Marcus?" — LUCY synthesizes from your real captured memory and shows exactly which capture it drew from.

5. **Insights Panel:** Show the AI-generated pattern observations + health data from your phone.

---

## 4. The Technical Story (60 seconds)

**LUCY is built on a privacy-first hybrid model — your raw data stays on your device, and only sanitized context reaches the cloud.**

| Layer | Technology |
|-------|-----------|
| App | React Native / Expo SDK 56 (iOS + Android) |
| Storage | expo-sqlite with SQLCipher encryption |
| Voice Input | On-device Whisper (intentional, user-triggered) |
| Privacy Filter | Local PII abstraction — sensitive info masked before any cloud call |
| AI Extraction | OpenAI gpt-4o-mini (receives sanitized version only) |
| Embeddings | OpenAI text-embedding-3-small + local FNV keyword fingerprint fallback |
| Search | Cosine similarity semantic search over stored embeddings |
| Health | expo-sensors Pedometer + HealthKit (iOS) |
| Build | EAS Build for iOS + Android |

**How the privacy model actually works:**

1. You speak → Whisper converts to text, locally on your device
2. Text is stored encrypted in your local SQLite database
3. LUCY's privacy filter runs: it identifies and abstracts sensitive details (names of people in private captures, specific numbers, flagged keywords)
4. Only the sanitized, abstracted version is sent to OpenAI for AI extraction
5. The raw original is never sent — it stays on your device
6. You can mark any capture as "Private" — those never leave the device at all, processed by local rules only

**This gives you AI intelligence without exposing your raw thoughts to the cloud.**

---

## 5. The Features (60 seconds — pick 3 for demo)

**Choose based on audience type:**

| If judges are... | Show |
|-----------------|------|
| Technical / AI | Live Extraction Replay + Ask with cited sources + privacy abstraction layer |
| Product-focused | Board whiteboard + Timeline view + voice capture flow |
| Privacy-focused | Private mode flag + what gets sent vs. what stays local |
| Investors | Demo seed data + Insights panel + Morning Brief notification |

**Always show:** Live Capture Replay — the animated extraction moment. This is the "oh, that's clever" beat.

**Always show:** Ask LUCY with a real question about the demo data. Show the cited source chips.

**Time permitting:** Timeline view — visual proof that LUCY builds memory over time.

---

## 6. Differentiation (30 seconds)

| Feature | Notion / Notes | Siri / Assistant | LUCY |
|---------|---------------|-----------------|------|
| Voice → structured memory | ❌ | ❌ | ✓ |
| Cross-capture context | ❌ | ❌ | ✓ |
| Privacy-first (PII abstraction) | ❌ | ❌ | ✓ |
| Memory across months | ❌ | ❌ | ✓ |
| Ask about the past | ❌ | Partial | ✓ |
| Meeting mode + summary | ❌ | ❌ | ✓ |

> "Apple Notes is where thoughts go to die. LUCY is where they come alive."

---

## 7. What LUCY Does NOT Do (important — don't oversell)

Be ready if a judge asks about always-on listening:

- **LUCY does not do passive always-on listening** — voice capture is intentional. You tap the button, speak, release. This was a deliberate choice: always-on transcription with Whisper is not reliable enough for production quality, and it raises privacy concerns we're not ready to navigate.
- **LUCY is not 100% on-device** — raw thoughts are stored locally, but extraction intelligence requires the cloud (OpenAI). The privacy abstraction layer is what makes this acceptable.
- Passive listening exists as a prototype toggle for power users in meeting scenarios, but it's not the primary capture flow.

Knowing what you don't do, and why, makes you more credible than apps that overpromise.

---

## 8. The Business Case (30 seconds — if time allows)

**Market:** 4B+ smartphone users. $50B productivity software market.

**Business models:**
1. **Freemium:** Free with local-only private captures; $8/mo unlocks Remote Intelligence (OpenAI extraction + Ask)
2. **Team tier:** Shared context, meeting summaries across a team — $15/user/mo
3. **Enterprise:** Private cloud deployment, bring-your-own LLM, HIPAA-compliant packaging — custom pricing

**Why now:** LLMs are cheap enough that privacy-first hybrid AI is economically viable for an indie app. Voice is the natural input for modern humans — but no one has made the output organized enough to act on.

---

## 9. Demo Script (3 minutes, no slides)

### Minute 1: The voice capture loop
- Open LUCY on your phone (mirrored to projector)
- Say: "Watch what happens when I say something real"
- Tap the voice button — speak naturally: *"Just got out of a call with Sarah. She said the API will be done by Friday. I promised to send her the backend credentials today. Spent $45 on the team lunch."*
- Release — Whisper transcribes on-device, text appears in the input
- Tap Send → show the **Live Capture Replay** animation prominently
- "In 4 seconds: task, follow-up, expense. All organized. From your voice."

### Minute 2: The Board + Ask
- Show the Board (demo seed data pre-loaded — judges see an organized board, not an empty app)
- Open Ask → type "What's pending with Sarah?"
- Show the cited-source answer: LUCY pulls from the capture you just made

### Minute 3: Insights
- Tap **✦ Insights**
- Show the health card (steps today vs. weekly average from iPhone)
- Show a memory pattern card: "LUCY noticed something about your week"
- "This is LUCY becoming your second brain — not just a notes dump."

---

## 10. Anticipated Judge Questions

**Q: How is this different from just using ChatGPT?**  
A: ChatGPT has no memory between sessions. LUCY builds persistent, searchable, structured memory from your own voice, over months. The intelligence is yours — not generic.

**Q: Does my data go to the cloud?**  
A: Your raw text stays on your device. LUCY's privacy filter abstracts sensitive details before anything is sent to OpenAI. You can also mark any capture as Private — those are never sent at all.

**Q: Why not just use Siri or Google Assistant?**  
A: Siri and Google can set reminders. LUCY builds interconnected memory — it knows that the person you mentioned on Monday is the same person you followed up with on Wednesday, and can surface that when you ask.

**Q: Why not use always-on listening? It would be more seamless.**  
A: We tested it. Always-on transcription with Whisper has reliability issues — background noise, accents, and battery drain make it not production-ready. More importantly, always-on recording raises real consent and trust issues. LUCY's intentional tap-to-capture is a deliberate design choice: capture when it matters, not everything.

**Q: What's the accuracy of the extraction?**  
A: For structured English (tasks, expenses, names, dates), above 90%. For ambiguous text, LUCY asks for clarification rather than guessing wrong.

**Q: Can it really compete with $200M-funded apps?**  
A: The moat is memory persistence + privacy. Most apps are capture tools — LUCY is a retrieval and reasoning tool built on what you've already said. The category is new enough that being thoughtful matters more than being biggest.

---

## 11. Closing Statement

> "Most apps help you dump thoughts. LUCY helps you use them — by making months of your own thinking instantly searchable, actionable, and connected."

**Call to action for judges:**  
"Download the TestFlight link. Capture one real thought today. Ask LUCY about it tomorrow morning. That's when it clicks."

---

## Presentation Setup Checklist

- [ ] iPhone mirrored to projector (AirPlay or Lightning → HDMI)
- [ ] Demo seed data loaded — Board should show pre-organized tasks on first open
- [ ] OpenAI key set in Settings → Remote Intelligence (required for Ask + Extraction)
- [ ] Ask screen pre-warmed: send one question before presenting so the first demo response is fast
- [ ] Voice button tested — tap, speak, release, confirm Whisper text appears in input
- [ ] Screen brightness max
- [ ] Do Not Disturb ON
- [ ] TestFlight QR code printed or on a final slide
- [ ] **Backup:** screen recording of the entire demo flow stored on the phone, ready if live demo fails

---

*Built for the Hackathon — May 2026*
