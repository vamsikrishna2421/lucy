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
  mood: MoodEntry;
}

export type CaptureSource = 'text' | 'voice' | 'android' | 'ios' | 'passive';
