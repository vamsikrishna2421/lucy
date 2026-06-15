/**
 * appManual.ts — the single source of truth for "how do I / where is / what can you do" help.
 *
 * Two exports:
 *  - LUCY_MANUAL: a thorough markdown manual of EVERY feature (what / where / how), written so the
 *    AI can answer help questions accurately on phone or web.
 *  - manualSections(): exactly 3 sections the website renders as a Help/Manual page.
 *
 * Pure strings + a pure function. No imports, no side effects. Keep this in sync with the real app.
 *
 * Navigation vocabulary used throughout (so answers point to the right place):
 *  - Phone bottom bar: Home, Workspace, the center Voice mic, and the Capture (+) screen. Settings
 *    and "About You" live behind the header gear / profile.
 *  - Home top tabs: Timeline, Focus Now, Ask Lucy, Health.
 *  - Workspace tile ("command center"): Calendar, Documents, Resources, Projects, Bookmarks (coming
 *    soon), plus Lucy Suggested, "Plan my day", and Quick actions. Brain areas (Glossary, People,
 *    Ideas, Meetings, Listen) and Money also live under Workspace/Brain.
 *  - Website (LAN companion): open http://<phone-ip>:8088 on a laptop on the SAME WiFi. It mirrors
 *    the app with a left sidebar for every section.
 */

export const LUCY_MANUAL: string = `# LUCY — Complete User Manual

LUCY is your personal AI second brain. You capture life as it happens (text, voice, shared files),
LUCY structures it into memory on your device, and you ask it anything later. Most processing is
on-device and private. You can drive LUCY from the phone or from a laptop over your home WiFi.

---

## Getting around

### On the phone
- **Bottom bar:** **Home**, **Workspace**, the center **Voice mic**, and the **Capture (+)** screen.
- **Home** has top tabs: **Timeline**, **Focus Now**, **Ask Lucy**, **Health**.
- **Workspace** is the command center tile — open it for Calendar, Documents, Resources, Projects,
  Bookmarks (coming soon), Lucy Suggested, "Plan my day", and Quick actions. Brain areas (Glossary,
  People, Ideas, Meetings, Listen) and Money live here too.
- **Settings** and **About You** are behind the header gear / profile.

### On the laptop (website / LAN companion)
- LUCY's phone hosts a live web mirror at **http://<phone-ip>:8088**. Put the laptop on the SAME
  WiFi, open that address, and you get a full premium web app with a left sidebar for every section.
- Find the exact address in **About You / Settings → Laptop access (LAN companion)**.

---

## 1. Capture — get things into LUCY

- **What it does:** Records anything you want LUCY to remember and auto-extracts the structured bits
  (tasks, people, places, expenses, ideas, dates) into your memory.
- **Where:** Phone — the **Capture (+)** screen (and the **Voice mic**). Website — the **Capture**
  section in the sidebar.
- **How:**
  - **Text:** type or paste a note and save it. LUCY structures it automatically.
  - **Voice:** tap the mic and speak. Transcription happens **on-device** — your audio never goes to
    the cloud. The transcript is captured and structured like any note.
  - **Share to LUCY:** from any other app's share sheet, send an **image, PDF, or text** to LUCY. It
    is captured, and documents are filed into your vault automatically.
- **Result:** every capture lands in your **Timeline** and feeds **Ask Lucy**.

## 2. Timeline — everything you've captured

- **What it does:** A reverse-chronological feed of all your captures and what LUCY made of them.
- **Where:** Phone — **Home → Timeline** (also the default Home view). Website — **Timeline**.
- **How:** scroll the feed, open any item to see details and the structured memory extracted from it,
  give feedback, or ask LUCY about that item.

## 3. Ask Lucy — natural-language Q&A over your memory

- **What it does:** Answers questions using everything you've captured. It can recall facts,
  synthesize ("what do you know about X"), total your spending, suggest priorities, and schedule.
- **Where:** Phone — **Home → Ask Lucy**. Website — **Ask Lucy**. You can also just speak a question
  to the **Voice mic**.
- **How:** ask in plain language, for example:
  - Recall: "What did I say about the dentist?"
  - Synthesis: "What do you know about my apartment search?"
  - Spending: "How much did I spend on food this month?"
  - Focus: "What should I focus on today?"
  - Scheduling: "When should I do the gym this week?"

## 4. Tasks — your to-dos

- **What it does:** Tracks todos with an **urgency** level and **categories**.
- **Where:** Phone — tasks surface on the **Capture** screen / Focus Now and Workspace. Website —
  **Tasks**.
- **How:** add a task (type it, or say "add a task to …"), set urgency/category, then **complete** or
  **delete** it. Open todos can be auto-scheduled by the Calendar's "Plan my day".

## 5. Workspace — the command center

- **What it does:** A top-level tile that gathers your productivity surfaces in one place.
- **Where:** Phone — the **Workspace** bottom tab. Website — the **Workspace** section.
- **Contains:** tiles for **Calendar**, **Documents**, **Resources**, **Projects**, **Bookmarks**
  (coming soon), plus **Lucy Suggested**, a **Plan my day** button, and **Quick actions**.

### 5a. Calendar — LUCY's own on-device calendar

- **What it does:** A private calendar LUCY owns and schedules (no Google/Apple sync). It schedules
  **conflict-free** using a resource model: every event uses resources (focus / self / location /
  voice / hands), and two events overlap only when their resources don't clash — so a phone call and
  a walk can co-exist, but two focus blocks cannot.
- **Where:** Phone — **Workspace → Calendar**. Website — **Calendar** (with drag-to-reschedule).
- **How / key actions:**
  - **Find time for X:** ask "find time for a 30-minute review" and LUCY places it in an open slot.
  - **Plan my day:** auto-schedules your open todos into the day's free, resource-compatible slots.
  - **Views:** **Agenda**, **Day**, **Week**, **Month**.
  - **Drag-to-reschedule:** on the website, drag an event to move it.
  - **Block fixed commitments:** pin events that must not move; scheduling works around them.
  - **Recurring events:** "every day", "every weekday", or "weekly".
  - **Healthy-habit windows:** daily slots for walk / lunch / gym / dinner.
  - **Work hours** apply on weekdays only.
  - **Availability settings:** set work hours, sleep, buffer time, and peak-focus windows (peak focus
    is learned from your mood logs).
  - **Color-coded categories:** Health, Meals, Meetings, Errands, Focus.

### 5b. Documents — your vault

- **What it does:** A private document vault for **images and PDFs**, auto-organized into buckets.
- **Where:** Phone — **Workspace → Documents**. Website — **Documents**.
- **How:** upload (or share-to-LUCY) images and PDFs; LUCY auto-sorts them into buckets, detects
  **duplicates**, and lets you **smart-search** by keyword. You can **view** a document and
  **download the original file**. Everything stays **on-device**.

### 5c. Resources — online links

- **What it does:** Saves online links / resources you want to keep.
- **Where:** Phone — **Workspace → Resources**. Website — **Resources**.
- **How:** save a link ("save this link …" or paste a URL); revisit them from the Resources list.

### 5d. Projects — a space per personal project

- **What it does:** A dedicated workspace for each personal project so related captures, tasks, and
  notes group together.
- **Where:** Phone — **Workspace → Projects**. Website — **Projects**.
- **How:** create a project ("start a project called …"), then file work into it.

## 6. Brain — your knowledge graph and entities

- **What it does:** The structured side of your memory, broken into:
  - **Glossary:** a knowledge graph of entities and the connections between them.
  - **People:** the people LUCY knows about from your captures.
  - **Ideas:** captured ideas.
  - **Meetings:** meeting captures and summaries.
  - **Listen data:** what LUCY has gathered from listening sessions.
- **Where:** Phone — under **Workspace / Brain**. Website — the corresponding sidebar sections.
- **How:** browse entities, open a person or term to see connected memories, review ideas/meetings.

## 7. Health — mood

- **What it does:** Log your **mood** and see your mood **distribution** over time. Peak-focus
  windows in the Calendar are learned from this.
- **Where:** Phone — **Home → Health**. Website — **Health**.
- **How:** log how you feel ("I feel great", or pick a mood); review the distribution chart.

## 8. Money — expenses

- **What it does:** Tracks expenses **by category** so you can ask spending questions in Ask Lucy.
- **Where:** Phone — under **Workspace / Brain → Money**. Website — **Money**.
- **How:** capture spending (a receipt image or "spent $12 on lunch"); review totals by category.

## 9. About You — profile, learning, and controls

- **What it does:** Your settings and the controls over how LUCY learns and spends.
- **Where:** Phone — header **profile / About You**. Website — **About You**.
- **Includes:**
  - **Profile:** your basic info.
  - **Learned profile:** durable facts LUCY has learned about you, injected into every AI answer so
    responses stay personal. You can review it here.
  - **Give feedback:** tell LUCY when an answer was right/wrong; it learns from this.
  - **Reflect now:** trigger LUCY to reflect over recent memory and update what it knows about you.
  - **Cost guard:** a **daily AI-call limit**; when reached, LUCY **pauses** remote calls so you stay
    in control of cost.
  - **Memory export / import:** export your memory to a file and import it on a new device — used for
    **switching devices**.

## 10. Voice control — one context-aware mic

- **What it does:** The single **center mic** is a universal command bar. Speak any command and LUCY
  does it — schedule, capture, add a task, log mood, save a link, create a project, navigate, or just
  ask a question. It is **context-aware**: it biases ambiguous commands toward the screen you're on
  (a bare phrase on Calendar leans toward scheduling).
- **Where:** Phone — the **center Voice mic** in the bottom bar. Website — the **Hey Lucy** command
  bar.
- **How:** tap the mic and say things like:
  - "Schedule a 15-minute walk this evening at 6:30."
  - "Remember that my passport expires in March."
  - "Add a task to call the landlord."
  - "I feel a bit stressed today."
  - "Save this link …"
  - "Start a project called kitchen remodel."
  - "Open my calendar." / "Show me my documents."
  - "How much did I spend on coffee this week?"

## 11. Developer tools — AI call log

- **What it does:** Shows every AI call LUCY has made — the call type (EXTRACTION, ASK, REFLECTION,
  etc.), which model was used, how long it took, and the full prompt + response. Useful for debugging
  unexpected answers or checking what LUCY actually sent to the LLM.
- **Where:** Phone — **Settings** (scroll to the very bottom, under the "DEVELOPER" section) → tap
  **"AI call log"** → opens the **Dev Log** screen.
- The last 100 calls are shown. Tap any row to expand and read the full request + response.
- **Clear** button wipes the log; **Done** closes the screen.

## 12. Privacy & AI provider

- **On-device transcription:** all voice is transcribed **on the device** — audio is never uploaded.
- **Privacy shield:** before anything is sent to a **remote** LLM, sensitive items (passwords and
  names) are **tokenized** on-device, then restored in the answer and highlighted — so secrets don't
  leave the device.
- **Choose your model:** in **Settings** pick the **on-device LLM** (fully private) or a **remote**
  provider by adding your own **OpenAI** or **Claude** API key.
- **Where:** Phone — **Settings** (privacy + provider) and **About You** (cost guard). Website —
  **About You / Settings**.

## 12. LAN web companion

- **What it does:** Turns a laptop into a big-screen control surface for LUCY over your home WiFi.
- **Where:** open **http://<phone-ip>:8088** in a laptop browser on the **same WiFi** as the phone.
- **How:** find the address under **About You / Settings → Laptop access**, open it on the laptop,
  and use the sidebar to reach every section. The web app mirrors the phone in real time, including
  Ask Lucy, the Hey-Lucy command bar, Calendar drag-to-reschedule, Documents, and more.

---

## Quick answers

- **"How do I capture something?"** → Capture (+) screen or the Voice mic; type, speak, or share.
- **"Where are my files?"** → Workspace → Documents (the vault).
- **"How do I schedule something?"** → Ask the Voice mic / Calendar, or use Plan my day.
- **"How do I see what I spent?"** → Ask Lucy ("how much did I spend on …") or open Money.
- **"How do I use LUCY on my laptop?"** → Open http://<phone-ip>:8088 on the same WiFi.
- **"Is my data private?"** → Yes: on-device transcription, privacy shield before any remote call,
  and an optional fully on-device LLM.
- **"How do I move to a new phone?"** → About You → Memory export, then import on the new device.
- **"Where are the AI/LLM logs?"** → Settings → scroll to the bottom → DEVELOPER → "AI call log".
- **"Where do I see what LUCY sent to the AI?"** → Settings → AI call log (bottom of Settings).
`;

export function manualSections(): Array<{ title: string; body: string }> {
  return [
    {
      title: 'What is LUCY?',
      body:
        'LUCY is your personal AI second brain. You capture life as it happens — type a note, speak ' +
        'to the mic (transcribed on-device, never uploaded), or share an image, PDF, or text from any ' +
        'app — and LUCY structures it into private memory on your device. Later you simply ask it ' +
        'anything in plain language and it recalls, synthesizes, totals your spending, plans your day, ' +
        'and schedules for you.\n\n' +
        'Most processing is on-device and private: voice is transcribed locally, a privacy shield ' +
        'tokenizes passwords and names before anything reaches a remote LLM, and you can run a fully ' +
        'on-device model if you prefer. You can drive LUCY from your phone, or from a laptop on the ' +
        'same WiFi via the web companion at http://<phone-ip>:8088.',
    },
    {
      title: 'What can LUCY do?',
      body:
        'Capture: text, voice (on-device transcription), and share-to-LUCY for images, PDFs, and ' +
        'text — with automatic extraction into structured memory.\n' +
        'Timeline: a feed of everything you have captured.\n' +
        'Ask Lucy: natural-language Q&A over your memory — recall, synthesis ("what do you know about ' +
        'X"), spending totals, "what should I focus on today", and scheduling ("when should I do X").\n' +
        'Tasks: to-dos with urgency and categories; complete or delete them.\n' +
        'Workspace (command center): Calendar, Documents, Resources, Projects, Bookmarks (coming ' +
        'soon), plus Lucy Suggested, Plan my day, and Quick actions.\n' +
        '  - Calendar: LUCY’s own on-device, conflict-free calendar (resource-based scheduling), ' +
        'find time for X, Plan my day, Agenda/Day/Week/Month views, drag-to-reschedule on web, fixed ' +
        'commitments, recurring events, healthy-habit windows, weekday work hours, availability ' +
        'settings (sleep, buffer, learned peak focus), and color-coded categories.\n' +
        '  - Documents: a private vault for images and PDFs — auto-organized, smart keyword search, ' +
        'duplicate detection, view and download originals, all on-device.\n' +
        '  - Resources: saved online links. Projects: a dedicated space per personal project.\n' +
        'Brain: Glossary (knowledge graph of entities and connections), People, Ideas, Meetings, and ' +
        'Listen data.\n' +
        'Health: mood logging and distribution. Money: expense tracking by category.\n' +
        'About You: profile, learned profile, give feedback, Reflect now, cost guard (daily AI-call ' +
        'limit with pause), and memory export/import for switching devices.\n' +
        'Voice control: one context-aware mic that schedules, captures, adds tasks, logs mood, saves ' +
        'links, creates projects, navigates, or answers — biased by the screen you are on.\n' +
        'Privacy: on-device transcription, a privacy shield, and a choice of on-device or remote ' +
        '(OpenAI/Claude) model.\n' +
        'LAN web companion: a full premium web mirror at http://<phone-ip>:8088 for your laptop.',
    },
    {
      title: 'Detailed manual',
      body: LUCY_MANUAL,
    },
  ];
}
