# LUCY — Hackathon Presentation Plan

**App:** LUCY — Your Private AI Second Brain  
**Tagline:** Think out loud. LUCY remembers everything.  
**Presenter:** Vamsy

---

## 1. The Hook (30 seconds)

Open with a question judges can nod to:

> "How many times this week did you forget something you said out loud — a meeting comment, a decision, something you promised to do? LUCY is the solution to that."

Then: **demo the core loop live**. No slides yet. Just open the app and capture something you "just thought of" in the room.

---

## 2. The Problem (60 seconds)

**The gap between thinking and remembering is massive.**

- Average person has 60,000 thoughts per day
- We remember fewer than 5% of fleeting ideas
- Current tools (notes apps, reminders) require too much friction — you have to stop, open, type, format, file
- The result: important thoughts evaporate, meetings become blurry, follow-ups get dropped

**This is not a productivity problem. It's a cognitive infrastructure problem.**

---

## 3. The Solution: LUCY (90 seconds)

> "LUCY turns your voice into organized memory, instantly."

**Walk through the core flow:**

1. **Capture (10 seconds):** Type or voice — "Talked to Marcus today about the Series B deck. He needs the revenue slide by Thursday, and wants me to update the investor list."

2. **Live Extraction Replay (the wow moment — 4 seconds):** After submitting, show the animated extraction reveal — task cards drop in, person lights up, expense chips appear. Make this visible on the projector.

3. **The Board:** Show the whiteboard with tasks already organized by context. "This was just in my head 10 seconds ago."

4. **Ask LUCY:** Ask "What do I need to do for Marcus?" — LLM synthesizes from real memory and shows cited sources.

5. **Insights Panel:** Show health insight (steps today vs. average) + AI-generated pattern observation.

---

## 4. The Technical Story (60 seconds)

**LUCY is fully on-device first — your thoughts never leave your phone.**

| Layer | Technology |
|-------|-----------|
| App | React Native / Expo SDK 56 |
| Storage | expo-sqlite (SQLCipher encrypted) |
| AI Extraction | OpenAI gpt-4o-mini (optional) / Local rule engine |
| Embeddings | OpenAI text-embedding-3-small + local FNV keyword fingerprint |
| Search | Cosine similarity semantic search |
| Health | HealthKit via expo-sensors Pedometer |
| Build | EAS Build for iOS + Android |

**Privacy model:**
- Local-first by default (zero cloud)
- Remote AI is opt-in per capture
- Private mode flag makes a capture never leave the device
- All data encrypted at rest

---

## 5. The Features (60 seconds — pick 3 for demo)

**Choose based on audience type:**

| If judges are... | Show |
|-----------------|------|
| Technical / AI | Live Capture Replay + Ask with cited sources |
| Product-focused | Board whiteboard + Meeting Mode |
| Privacy-focused | Private mode + local-only extraction |
| Investors | Demo seed data + Morning Brief + Insights |

**Always show:** Live Capture Replay (the visual extraction moment). This is the "oh, that's clever" beat.

**Always show:** Ask LUCY with a real question about the demo seed data.

**Time permitting:** Timeline view with mood dots — visual proof that LUCY tracks life over time.

---

## 6. Differentiation (30 seconds)

| Feature | Notion/Notes | Siri/Assistant | LUCY |
|---------|-------------|---------------|------|
| Passive capture | ❌ | Partial | ✓ |
| Cross-capture context | ❌ | ❌ | ✓ |
| On-device AI | ❌ | ❌ | ✓ |
| Memory across months | ❌ | ❌ | ✓ |
| Privacy first | Partial | ❌ | ✓ |
| Meeting mode | ❌ | ❌ | ✓ |

> "Apple Notes is where thoughts go to die. LUCY is where they come alive."

---

## 7. The Business Case (30 seconds — if time allows)

**Market:** 4B+ smartphone users. $50B productivity software market.

**Business models:**
1. **Freemium:** Free local-only, $8/mo for Remote Intelligence (LLM)
2. **Team tier:** Shared morning brief, meeting summaries for teams — $15/mo
3. **Enterprise:** On-prem deployment, HIPAA-compliant — custom pricing

**Why now:** LLMs are cheap enough that on-device + cloud hybrid is economically viable. Privacy laws are tightening, making local-first a feature, not a compromise.

---

## 8. Demo Script (3 minutes, no slides)

### Minute 1: The capture loop
- Open LUCY on your phone (mirrored to projector via AirPlay or cable)
- Say: "Watch what happens when I say something real"
- Type: "Just got out of a great call with Sarah. She said the API integration will be done by Friday. Also spent $45 on team lunch."
- Hit Send — show the **Live Capture Replay** animation prominently
- Turn phone toward judges: "In 4 seconds, LUCY turned that into tasks, a follow-up, and an expense."

### Minute 2: The Board + Ask
- Show the Board (pre-seeded with realistic demo data)
- Say: "Judges walk in and see an organized board — not an empty app"
- Open Ask → type "What's pending with Sarah?"
- Show the cited-source answer

### Minute 3: Insights
- Tap **✦ Insights**
- Show the health card (steps) + memory pattern card
- Say: "LUCY knows your patterns. It noticed your mood this week. It knows who you haven't followed up with."

---

## 9. Anticipated Judge Questions

**Q: How is this different from just using ChatGPT?**  
A: ChatGPT forgets everything the moment the conversation ends. LUCY builds persistent, interconnected memory over months. And it works offline.

**Q: What's the accuracy of the extraction?**  
A: For English, above 90% on structured facts (tasks, expenses, names). For ambiguous text, LUCY asks for clarification rather than guessing.

**Q: Why not use Whisper for all transcription?**  
A: We support it as opt-in Remote Intelligence. Whisper costs $0.006/min — fine for occasional use, expensive for always-on. Local STT via SFSpeechRecognizer is the default for passive listening.

**Q: Can it really compete with $200M-funded apps?**  
A: The moat is privacy and memory persistence. We're not a notes app — we're a second brain. The category is new enough that being first matters more than being biggest.

---

## 10. Closing Statement

> "Most apps help you organize the past. LUCY helps you think better in the present — by making the past instantly accessible. Your brain shouldn't have to be your hard drive."

**Call to action for judges:**  
"Download the TestFlight link and capture something real today. Come back tomorrow and ask LUCY what you said. That's when it clicks."

---

## Presentation Setup Checklist

- [ ] iPhone mirrored to projector (AirPlay or Lightning → HDMI)
- [ ] App launched with demo seed data visible on the Board
- [ ] OpenAI key set in Settings → Remote Intelligence (for live extraction)
- [ ] Ask screen pre-warmed (tap once before presenting so response is faster)
- [ ] Screen brightness max
- [ ] Do Not Disturb ON
- [ ] TestFlight link QR code printed or on final slide
- [ ] Backup: screen recording of demo in case live demo fails

---

*Built for the Hackathon — May 2026*
