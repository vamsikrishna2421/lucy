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
 *  - Phone bottom bar (5 items, left→right): Home, Workspace, the center Voice mic ("Hold to talk"),
 *    Tasks, Settings. There is ALSO a small chat-bubbles button (bottom-right, above the bar) that
 *    opens "Talk to Lucy". "About You" / profile lives behind the header avatar.
 *  - Home top tabs: Timeline, Focus Now, Ask Lucy, Health.
 *  - Workspace ("command center") top tiles: Calendar, Documents, Resources, Projects, Bookmarks
 *    (coming soon), and Lucy Suggested — plus a "Plan My Day" button and Quick actions. SCROLL DOWN
 *    in Workspace to the "Brain & knowledge" grid for: Glossary, People, Meetings, Ideas, Listen
 *    data, and Expenses. There is NO separate "Brain" tab — those areas live inside Workspace.
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
- **Bottom bar (5 items, left to right):** **Home**, **Workspace**, the center **Voice mic**
  ("Hold to talk"), **Tasks**, **Settings**.
- A small **chat-bubbles button** sits at the **bottom-right** (just above the bar) — tap it to open
  **Talk to Lucy** (the spoken conversation). Saying **"Hey Lucy"** opens the same thing hands-free.
- **Home** has top tabs: **Timeline**, **Focus Now**, **Ask Lucy**, **Health**.
- **Workspace** is the command center. The top tiles are **Calendar**, **Documents**, **Resources**,
  **Projects**, **Bookmarks** (coming soon), and **Lucy Suggested**, plus a **Plan My Day** button and
  **Quick actions**. **Scroll down** in Workspace to the **"Brain & knowledge"** grid for **Glossary**,
  **People**, **Meetings**, **Ideas**, **Listen data**, and **Expenses**. There is **no separate Brain
  tab** — those areas live inside Workspace.
- **Tasks** is its own bottom tab (your to-dos + a quick capture box).
- **Settings** is a bottom tab. **About You** / your profile is behind the **header avatar** (top-right).

### On the laptop (website / LAN companion)
- LUCY's phone hosts a live web mirror at **http://<phone-ip>:8088**. Put the laptop on the SAME
  WiFi, open that address, and you get a full premium web app with a left sidebar for every section.
- Find the exact address in **About You / Settings → Laptop access (LAN companion)**.

---

## 1. Capture — get things into LUCY

- **What it does:** Records anything you want LUCY to remember and auto-extracts the structured bits
  (tasks, people, places, expenses, ideas, dates) into your memory.
- **Where:** Phone — the **"Capture a thought" box** at the top of **Home** (the Timeline view), the
  center **Voice mic** ("Hold to talk"), or **share-to-LUCY** from another app. Website — the
  **Capture** section in the sidebar.
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
- **Where:** Phone — the **Tasks** bottom tab (also surfaced in **Home → Focus Now** and in
  Workspace's **Lucy Suggested**). Website — **Tasks**.
- **How:** add a task (type it, or say "add a task to …"), set urgency/category, then **complete** or
  **delete** it. Open todos can be auto-scheduled by the Calendar's "Plan my day".

## 4a. Reminders

- **What it does:** Scheduled reminders that fire as **notifications** at a set date and time. Unlike
  calendar blocks they do not occupy a slot — they just interrupt you at the right moment.
  LUCY nags you every 3 minutes for up to 30 minutes until you acknowledge the reminder.
- **Where:** Phone — **Settings → Scheduled reminders** (manage/view/delete). Website — **Reminders**
  section.
- **How:** capture a reminder ("remind me to call the dentist on Friday at 10am"), or manage them in
  Settings → Scheduled reminders. Tap the notification to acknowledge and stop the nag.
- Reminders can also be managed (view / delete / mark done) from the Reminders list.

## 4b. Focus Now — what to do right now

- **What it does:** A "right now" view of today's highest-priority items: urgent tasks, reminders
  due soon, and Lucy's suggestions for what to focus on.
- **Where:** Phone — **Home → Focus Now** (second tab after Timeline).
- **How:** open it when you want LUCY to tell you what matters most right now. It combines urgency,
  due dates, and learned patterns.

## 5. Workspace — the command center

- **What it does:** The top-level command center that gathers your productivity surfaces in one place.
- **Where:** Phone — the **Workspace** bottom tab. Website — the **Workspace** section.
- **Contains (top of the screen):** tiles for **Calendar**, **Documents**, **Resources**, **Projects**,
  **Bookmarks** (coming soon), and **Lucy Suggested**, plus a **Plan My Day** button and **Quick
  actions** (Find time, Upload doc, Add link, New project).
- **Contains (scroll down — "Brain & knowledge"):** **Glossary**, **People**, **Meetings**, **Ideas**,
  **Listen data**, and **Expenses**. These are the Brain areas; there is no separate Brain tab.

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

## 6. Brain & knowledge — your knowledge graph and entities

- **What it does:** The structured side of your memory, broken into:
  - **Glossary:** a knowledge graph of entities and the connections between them.
  - **People:** the people LUCY knows about from your captures.
  - **Ideas:** captured ideas.
  - **Meetings:** meeting captures and summaries.
  - **Listen data:** what LUCY has gathered from listening sessions.
  - **Expenses:** your tracked spending (see Money below).
- **Where:** Phone — open the **Workspace** tab and **scroll down** to the **"Brain & knowledge"**
  grid, then tap **Glossary / People / Meetings / Ideas / Listen data / Expenses**. There is NO
  separate "Brain" tab in the bottom bar. Website — the corresponding sidebar sections.
- **How:** browse entities, open a person or term to see connected memories, review ideas/meetings.

## 7. Health — nutrition, activity, mood & Dr. Lucy

- **What it does:** A two-sided health companion. **Nutrition (calorie intake):** log meals by photo,
  voice, or text and see calories remaining + protein/carbs/fat against your goal, with a meal timeline.
  **Activity & energy (calorie spend):** steps, sleep, resting heart rate, and your estimated BMR/TDEE.
  **Mood:** log how you feel and see the trend (peak-focus calendar windows are learned from this).
  **Dr. Lucy:** a caring guardian that gently flags patterns (short sleep, low movement, very-low intake)
  — never a doctor, never a diet score.
- **Where:** Phone — **Home → Health**. Website — **Health** (Dr. Lucy persona on this page).
- **Log food:** say or type "I ate two rotis and a katori of dal", or tap **Snap a meal** to photograph
  it — LUCY estimates the calories and macros (Indian portions like katori/roti/idli are supported).
- **Set up:** add a quick body profile (sex, age, height, weight, activity, goal) so LUCY can compute
  your calorie + macro targets. Targets are kept safe (never an unhealthy crash deficit).
- **Mood:** "I feel great", or pick a mood; review the distribution.
- **Safety:** LUCY is a companion, not a doctor — it won't diagnose or prescribe. If you mention an
  emergency symptom it will urge you to get real medical help right away.

## 8. Money — expenses

- **What it does:** Tracks expenses **by category** so you can ask spending questions in Ask Lucy.
- **Where:** Phone — **Workspace → scroll down → Brain & knowledge → Expenses**. Website — **Money**.
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

## 9a. Settings — full list of what's in Settings

Settings is the **Settings bottom tab** (far right of the bottom bar). Key sections:

- **Laptop access (local network):** toggle to start the LAN web server; shows the URL + PIN.
- **LUCY Wrapped:** your quarterly story — captures, tasks, people, mood summary. Tap **View**.
- **Export as JSON:** exports all your memories, tasks, expenses as a structured data file.
- **Export as Markdown:** exports your memory in human-readable Markdown you can use anywhere.
- **Import memory:** restore from a previously exported JSON file (e.g. when switching devices).
- **Check for updates:** fetches the latest LUCY improvements over-the-air and restarts.
- **Delete all memories (Danger zone):** permanently erases everything LUCY knows.
- **AI call log (Developer):** at the very bottom — shows the last 100 AI requests, responses, and
  errors. Tap any row to expand. Useful for debugging unexpected answers.
- **Hey Lucy wake word:** toggle to enable the foreground "Hey Lucy" voice trigger.
- **Remote Intelligence:** add your OpenAI or Claude API key; choose your AI model.

## 9b. LUCY Wrapped

- **What it does:** A quarterly summary of your life in LUCY — top captures, tasks completed, people
  you mentioned, mood trends, and highlights from the past 3 months.
- **Where:** Phone — **Settings → LUCY Wrapped → View**.
- Refreshes each quarter; gives you a "year in review" style look at your memory.

## 9c. Passive Listening (Listen mode)

- **What it does:** Keeps the mic open in the background and transcribes ambient speech on-device.
  Useful for capturing meeting audio, thoughts while walking, or any voice without tapping anything.
- **Where:** Phone — **Listen** pill in the header (top of the Home screen). Tap to start/stop.
- Audio is transcribed on-device and **deleted immediately** — never stored, never uploaded.
- An orange indicator shows on screen while active (iOS visual consent signal).
- Transcribed text is batched and captured automatically.

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

## 10a. Talk to Lucy — full conversational voice mode

- **What it does:** A hands-free multi-turn spoken conversation with LUCY (like ChatGPT voice mode).
  LUCY listens, thinks, and speaks replies aloud. You can ask questions, give commands, and have
  back-and-forth without touching the phone.
- **Where:** Phone — the **chat-bubbles button** (bottom-right corner, just above the nav bar). Tap it,
  or say **"Hey Lucy"** if the wake word is on.
- **How:** a small **floating card slides up at the bottom** — it does NOT take over the screen, so you
  can keep using and navigating the app while you talk (great for live demos). LUCY greets you, then
  it's a continuous loop: you speak → she replies aloud → she listens again. The card shows the state
  (Listening / Thinking / Speaking) and her last reply. **Tap her message while she's speaking to take
  over (barge-in)** instead of waiting for her to finish. Say **"stop listening"**, **"that's all"**, or
  **"goodbye"** to end, or tap **End conversation**.
- LUCY is **aware of the screen you're on** during the conversation, so she can guide you live — e.g.
  ask "walk me through a demo of your features" and she'll give one step at a time and tell you exactly
  which tab/tile to open next.

## 10b. Hey Lucy — foreground wake word

- **What it does:** While the app is open, LUCY listens for the phrase **"Hey Lucy"** in the
  foreground and automatically opens the conversation loop when she hears it — hands-free.
- **Where / how to enable:** Phone — **Settings → Hey Lucy wake word** toggle. Off by default
  (continuous recognition has a battery cost). Turn it on; from then on say "Hey Lucy" while the
  app is in the foreground and she wakes up.
- You can say a command right after the trigger ("Hey Lucy, schedule a gym session at 7am") and
  she'll handle it without the full conversation modal.
- On iOS, this is foreground-only (Apple restricts always-on custom wake words to Siri). Android
  may be more permissive. Keep the app open for it to work.

## 10c. Hey Siri shortcut

- **What it does:** Opens LUCY via Siri voice command.
- **How:** say **"Hey Siri, open Lucy"** and iOS will launch the app via the lucy:// deep-link.
  This is a Siri shortcut, not a custom Siri integration — Siri opens the app; LUCY takes over
  from there.

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
- **"How do I move to a new phone?"** → Settings → Export as JSON, then import on the new device.
- **"Where are the AI/LLM logs?"** → Settings → scroll to the bottom → DEVELOPER → "AI call log".
- **"Where do I see what LUCY sent to the AI?"** → Settings → AI call log (bottom of Settings).
- **"How do I talk to Lucy hands-free?"** → Tap the chat-bubbles FAB (bottom-right); or say "Hey Lucy" if the wake word is enabled in Settings.
- **"How do I enable Hey Lucy?"** → Settings → Hey Lucy wake word → toggle on.
- **"Where are my reminders?"** → Settings → Scheduled reminders.
- **"Where is Brain / People / Glossary?"** → Open the Workspace tab and scroll down to "Brain & knowledge".
- **"What should I do right now?"** → Home → Focus Now tab.
- **"What is LUCY Wrapped?"** → Settings → LUCY Wrapped → View — your quarterly life summary.
- **"How do I export my data?"** → Settings → Export as JSON (structured) or Export as Markdown (readable).
- **"How do I start listening in a meeting?"** → Tap the "Listen" pill in the Home screen header.
- **"Can I use Siri to open LUCY?"** → Yes — say "Hey Siri, open Lucy".
- **"How do I end a conversation with Lucy?"** → Say "stop listening", "that's all", or "goodbye", or tap End conversation.
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
