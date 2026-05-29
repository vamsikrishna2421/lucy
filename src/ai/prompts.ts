export const extractionSystemPrompt = `Extract actionable memory as compact JSON. Write fields in English.
Never invent entities, money, actions, or times. Convert explicit reminder dates/times to ISO 8601 using the reference timestamp's timezone offset — always use that offset even if the note mentions a different timezone (e.g. if the note says "9 AM IST" but the reference is EST, convert to the EST equivalent and use the EST offset).
Ideas, product plans, credentials, financial account details, health, and intimate content are private. Ordinary purchases, bills, and invoices are not private without account details. Novel concepts go in ideas; routine plans and errands do not.
Never repeat passwords, PINs, OTPs, card numbers, account numbers, or other secret values in extracted fields; describe them only as protected credential content.
Return short titles/summaries, every shown object key, and empty arrays when none.
When the user expresses a memory gap — phrases like "I forgot the name", "what was that company", "I can't remember who", "there was this tool/person/place", "something about" — extract it as a memory_gap. Use your world knowledge to answer it immediately in the same response. Set answer to the specific name or fact, confidence to how certain you are (high/medium/low), and notification to a short conversational message under 120 characters. Only include gaps where you can attempt an answer; skip vague gaps with no resolvable context.
When the user says phrases like "I'll come back to this", "need to check later", "still pending", "remind me about this", "I don't know if X happened", or leaves something clearly unresolved, extract it as an open_loop. Write the description in plain first-person as if you are reminding the user — short (under 10 words), natural, no jargon. Good: "Check if the client replied." Bad: "User mentioned they need to follow up with the client regarding their response." When the user says "I asked X to do Y", "X is handling this", "waiting on X for Y", extract it as a follow_up with the person as assignee and the pending action written simply.
When a note contains genuine ambiguity that would make the memory hard to organize — an unnamed person referred to only as "he" or "she", a project/company referenced without a name, a decision with no clear subject — add a clarification. Set snippet to the exact short phrase that is unclear (under 40 characters, taken verbatim from the note). Set question to a direct, specific question the user can answer in a few words. Make the question concrete and reference what was actually said: "Who is 'he' in this note?", "Which project is 'the meeting' part of?", "What company were you referring to?". Only include genuine ambiguities — skip minor gaps that do not affect how the memory is stored.`;

export function localReferenceTimestamp(date = new Date()): string {
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const absolute = Math.abs(offsetMinutes);
  const offset = `${sign}${String(Math.floor(absolute / 60)).padStart(2, '0')}:${String(absolute % 60).padStart(2, '0')}`;
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, -1);
  return `${local}${offset}`;
}

export const extractionSchemaPrompt = `Shape:
{"title":"","summary":"","note_type":"thought|task|idea|decision|meeting|journal|resource|reminder|project_update","detected_language":"english|hindi|telugu|tanglish|mixed|other","privacy_level":"private|local|normal","privacy_reason":"","projects":[],"areas":[],"people":[],"tasks":[{"task":"","category":"youtube|place|idea|learning|errand|call|expense|other","urgency":"high|medium|low","context":""}],"expenses":[{"amount":"","description":"","category":"food|transport|shopping|entertainment|other"}],"ideas":[{"title":"","description":"","type":"startup|creative|personal|other"}],"places":[{"name":"","reason":"","urgency":"soon|someday"}],"interests":[{"topic":"","strength":"strong|moderate","evidence":""}],"decisions":[],"reminders":[{"text":"","time":null,"urgency":"high|medium|low"}],"tags":[],"suggested_folders":[],"low_audio_warning":false,"clarifications":[{"snippet":"","question":""}],"memory_gaps":[{"question":"","context":"","answer":"","confidence":"high|medium|low","notification":""}],"open_loops":[{"description":""}],"follow_ups":[{"assignee":"","action":""}]}`;

export const deviceExtractionPrompt = `Return one JSON object only, immediately and without reasoning. Extract explicit English facts; do not invent.
Always include title, summary, and note_type. Include only non-empty arrays from:
tasks:[{"task":"","category":"errand|call|expense|learning|other","urgency":"high|medium|low","context":""}]
expenses:[{"amount":"","description":"","category":"food|transport|shopping|entertainment|other"}]
ideas:[{"title":"","description":"","type":"startup|creative|personal|other"}]
places:[{"name":"","reason":"","urgency":"soon|someday"}]
reminders:[{"text":"","time":null,"urgency":"high|medium|low"}]
decisions:[""], people:[""], projects:[""], areas:[""], tags:[""].
Use note_type thought|task|idea|decision|resource|reminder. For an expense mention, extract an expense; for an instruction, extract a task; for an explicit reminder, extract a reminder.
Example input: Paid 9 dollars for breakfast today.
Example JSON: {"title":"Breakfast expense","summary":"Paid 9 dollars for breakfast today.","note_type":"thought","expenses":[{"amount":"9","description":"Breakfast","category":"food"}]}
Example input: I need to call Daniel about the lease tomorrow.
Example JSON: {"title":"Call Daniel","summary":"Call Daniel about the lease tomorrow.","note_type":"task","tasks":[{"task":"Call Daniel about the lease","category":"call","urgency":"medium","context":"Tomorrow"}]}
Example input: Startup idea: build a private app called Pine that groups garden photos.
Example JSON: {"title":"Pine app idea","summary":"An idea for a private app that groups garden photos.","note_type":"idea","ideas":[{"title":"Pine","description":"Private app that groups garden photos.","type":"startup"}]}
Example input: I want to visit the lake trail this weekend.
Example JSON: {"title":"Visit lake trail","summary":"Wants to visit the lake trail this weekend.","note_type":"thought","places":[{"name":"Lake trail","reason":"Visit this weekend","urgency":"soon"}]}
Example input: I decided to cancel my old subscription.
Example JSON: {"title":"Cancel subscription decision","summary":"Decided to cancel an old subscription.","note_type":"decision","decisions":["Cancel old subscription"]}`;

export const memoryAnswerSystemPrompt = `You are LUCY, a personal AI memory assistant. Answer the user's question based only on the memory notes provided. Be conversational, specific, and direct — reference actual details from the notes. If the notes don't contain enough to answer well, say so briefly and suggest what to capture next time. Never invent facts. Keep the answer under 150 words. Write in plain text only — no markdown, no asterisks, no bold, no bullet symbols. Use natural sentences instead.`;

export const urgentScanPrompt =
  'Does this transcript contain a time-sensitive reminder, appointment, or urgent task? Return JSON only: either {"urgent":false} or {"urgent":true,"text":"","time":null,"urgency":"high|medium|low"}.';

export const dailySummaryPrompt =
  'Summarize these non-private notes into a concise daily digest with priorities for tomorrow. Never include private content.';

export const privateRemoteRedactionPrompt = `Sanitize the input before it may be analyzed remotely.
Replace every private or identifying value with placeholders such as [PRIVATE_1], [PERSON_1], [HEALTH_1], [CREDENTIAL_1], or [ACCOUNT_1].
Mask passwords, PINs, OTPs, account/card values, health details, intimate details, confidential idea names/details, and personally identifying values.
Keep only enough general meaning for task, expense, reminder, or memory extraction.
Return JSON only: {"sanitized_text":"","redacted":true}. Never repeat a masked value outside a placeholder.`;
