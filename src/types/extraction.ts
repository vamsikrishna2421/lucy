export type PrivacyLevel = 'private' | 'local' | 'normal';
export type NoteType =
  | 'thought'
  | 'task'
  | 'idea'
  | 'decision'
  | 'meeting'
  | 'journal'
  | 'resource'
  | 'reminder'
  | 'project_update';

export interface ExtractedTask {
  task: string;
  category: 'youtube' | 'place' | 'idea' | 'learning' | 'errand' | 'call' | 'expense' | 'other';
  urgency: 'high' | 'medium' | 'low';
  context: string;
}

export interface ExtractedExpense {
  amount: string;
  description: string;
  category: 'food' | 'transport' | 'shopping' | 'entertainment' | 'other';
}

export interface ExtractedIdea {
  title: string;
  description: string;
  type: 'startup' | 'creative' | 'personal' | 'other';
}

export interface ExtractedPlace {
  name: string;
  reason: string;
  urgency: 'soon' | 'someday';
}

export interface ExtractedInterest {
  topic: string;
  strength: 'strong' | 'moderate';
  evidence: string;
}

export interface ExtractedReminder {
  text: string;
  time: string | null;
  urgency: 'high' | 'medium' | 'low';
}

export interface Clarification {
  snippet: string;
  question: string;
}

export interface MemoryGap {
  question: string;
  context: string;
  answer: string | null;
  confidence: 'high' | 'medium' | 'low' | 'none';
  notification: string | null;
}

export interface MoodEntry {
  tone: 'positive' | 'negative' | 'neutral' | 'stressed' | 'excited' | 'frustrated' | 'calm';
  energy: 'high' | 'medium' | 'low';
}

export interface OpenLoop {
  description: string;
}

export interface FollowUp {
  assignee: string;
  action: string;
}

/** A promise with an obligation between the user and another person — the commitment guardian.
 *  'i-owe' = the user promised it; 'owed-to-me' = someone owes the user. */
export interface ExtractedCommitment {
  /** The concrete thing owed, short + imperative ("send the deck"). */
  action: string;
  /** The other person, or null when unnamed. */
  counterparty: string | null;
  /** Deadline exactly as stated ("Thursday", "by Friday") or null; resolved to a date on-device. */
  due: string | null;
  direction: 'i-owe' | 'owed-to-me';
}

/** An executable action the LLM detected in the capture (imperative commands like
 *  "call Mom", "set a 20-min timer", "navigate to the office"). Mirrors ExtractedAction
 *  from automationEngine so the same confirmation UI can be reused. */
export interface ExtractedLLMAction {
  type: 'timer' | 'call' | 'navigate' | 'play' | 'remind' | 'event' | 'message' | 'shortcut' | 'open_app';
  params: Record<string, string>;
  displayText: string;
  confirmText: string;
}

export interface ExtractionResult {
  title: string;
  summary: string;
  note_type: NoteType;
  detected_language: 'english' | 'hindi' | 'telugu' | 'tanglish' | 'mixed' | 'other';
  privacy_level: PrivacyLevel;
  privacy_reason: string;
  projects: string[];
  areas: string[];
  people: string[];
  tasks: ExtractedTask[];
  expenses: ExtractedExpense[];
  ideas: ExtractedIdea[];
  places: ExtractedPlace[];
  interests: ExtractedInterest[];
  decisions: string[];
  reminders: ExtractedReminder[];
  tags: string[];
  suggested_folders: string[];
  low_audio_warning: boolean;
  clarifications: Clarification[];
  memory_gaps: MemoryGap[];
  open_loops: OpenLoop[];
  follow_ups: FollowUp[];
  commitments: ExtractedCommitment[];
  mood: MoodEntry;
  /** How important this note is to the user's life — drives the "free up space" cleanup
   *  (low = safe to delete later). Defaults to 'normal' when the model omits it. */
  importance: 'low' | 'normal' | 'high';
  /** Optional: an imperative action the LLM detected. Null when the capture is
   *  informational (not a command). Surfaced as a "LUCY can do this" card after
   *  processing — replaces the brittle synchronous regex path for complex phrasings. */
  detected_action: ExtractedLLMAction | null;
}

export type CaptureSource = 'text' | 'voice' | 'android' | 'ios' | 'passive' | 'meeting';
