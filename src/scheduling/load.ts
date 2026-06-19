/**
 * Effort LOAD model for the scheduler (user's model). Every task draws on three efforts, each 0..1:
 *   - brain     : cognitive effort (thinking/problem-solving)
 *   - muscle    : physical effort (the body)
 *   - attention : focus/vigilance the task demands moment-to-moment
 *
 * Two ideas drive scheduling from this:
 *  1) SUSTAINABILITY — you can't hold a high *average* of an effort over a rolling ~3h window
 *     (back-to-back deep focus fries the brain; back-to-back lifting wrecks the body). So we score a
 *     candidate slot by the rolling time-weighted average it would create together with nearby blocks
 *     (gaps = recovery), and steer the task toward a slot that keeps each effort under its cap — i.e.
 *     INTERLEAVE brain-heavy and body-heavy work instead of stacking the same kind.
 *  2) PARALLELISM — a low-ATTENTION task (laundry running, a download, a podcast) can overlap another
 *     task. Attention is exactly the calendar's exclusive "focus" axis, so attention level decides
 *     whether something needs a slot to itself or can ride alongside (see canParallelize).
 *
 * Pure + deterministic (see tests/load.ts). Wired into findSlots (scheduler.ts).
 */
import type { TaskResources } from './types';

export interface TaskLoad { brain: number; muscle: number; attention: number }

export const LOAD_WINDOW_MS = 3 * 60 * 60 * 1000; // rolling window the average is taken over
export const BRAIN_CAP = 0.6;       // sustainable avg brain effort over the window
export const MUSCLE_CAP = 0.6;      // sustainable avg muscle effort over the window
export const ATTENTION_CAP = 0.7;   // you can pay attention a bit longer than you can think hard
export const ATTENTION_PARALLEL = 0.3; // at/below this, a task is light enough to run alongside another
const STEP_MS = 15 * 60 * 1000;

const BODY_RE = /\b(gym|work ?out|workout|exercise|run|running|jog|jogging|yoga|lift|lifting|weights?|sport|swim|swimming|cycl(e|ing)|bike|biking|hike|hiking|walk|pilates|cardio|stretch|basketball|soccer|football|tennis|climb|dance)\b/i;
const DEEP_RE = /\b(code|coding|program|write|writing|draft|design|study|learn|research|analy[sz]e|architect|debug|plan|planning|read|review|prepare|practice|deep work|model|spec|outline)\b/i;
const VOICE_RE = /\b(call|meeting|standup|stand-up|sync|interview|1:1|one on one|discuss|present|presentation|pitch)\b/i;
const CHORE_RE = /\b(cook|bake|clean|tidy|repair|fix|build|assemble|paint|wash|chop|iron|garden|move|moving|carry|haul|pack|unpack|grocer|shop|shopping|errand|drop ?off|pick ?up|pickup|deliver|return|drive|driving|laundry|chore)\b/i;
const PASSIVE_RE = /\b(laundry|dishwasher|wash(ing)? machine|download|backup|upload|charg(e|ing)|soak|marinate|defrost|boil|render|sync(ing)?|podcast|listen)\b/i;

/** Brain/muscle/attention composition for a task or block, from its title + resources (+ energy). */
export function loadOf(title: string, resources?: TaskResources | null, energy?: string | null): TaskLoad {
  const t = title || '';
  const axes = resources?.axes ?? [];
  const loc = resources?.location ?? null;

  // 1) Passive background (runs itself) → near-zero everything, parallelizable.
  if (energy === 'passive' || (PASSIVE_RE.test(t) && !DEEP_RE.test(t))) return { brain: 0.1, muscle: 0.1, attention: 0.1 };
  // 2) Physical/exercise → muscle-dominant, moderate attention.
  if (BODY_RE.test(t) || loc === 'gym') return { brain: 0.15, muscle: 0.85, attention: 0.4 };
  // 3) Deep cognitive → brain + high attention.
  if (energy === 'deep' || DEEP_RE.test(t)) return { brain: 0.9, muscle: 0.1, attention: 0.85 };
  // 4) Voice / meetings → brain-ish, very high attention (you must be present), light body.
  if (axes.includes('voice') || VOICE_RE.test(t)) return { brain: 0.55, muscle: 0.15, attention: 0.8 };
  // 5) Hands-on chores / errands / driving / out-and-about → muscle-leaning, real attention.
  if (axes.includes('hands') || CHORE_RE.test(t) || (loc && loc !== 'office')) return { brain: 0.3, muscle: 0.6, attention: 0.55 };
  // 6) Shallow/admin default → moderate brain + moderate attention.
  return { brain: 0.4, muscle: 0.15, attention: 0.5 };
}

/** A task light enough on attention to run in parallel with something else. */
export function canParallelize(load: TaskLoad): boolean {
  return load.attention <= ATTENTION_PARALLEL;
}

export interface BlockLoad { start: number; end: number; brain: number; muscle: number; attention: number }

/**
 * The MAX time-weighted average of each effort over any ~3h window that includes part of the candidate
 * span — the worst concentration the candidate would create together with nearby blocks. Gaps count as
 * 0 (recovery), so a half-empty window averages low.
 */
export function rollingExtremes(
  candStart: number, candEnd: number, cand: TaskLoad, blocks: BlockLoad[],
  windowMs = LOAD_WINDOW_MS, stepMs = STEP_MS,
): TaskLoad {
  const spans: BlockLoad[] = [...blocks, { brain: cand.brain, muscle: cand.muscle, attention: cand.attention, start: candStart, end: candEnd }];
  let maxBrain = 0, maxMuscle = 0, maxAttention = 0;
  for (let ws = candStart - windowMs; ws <= candEnd; ws += stepMs) {
    const we = ws + windowMs;
    if (we <= candStart || ws >= candEnd) continue; // window must overlap the candidate
    let brainMin = 0, muscleMin = 0, attnMin = 0;
    for (const sp of spans) {
      const ov = Math.min(we, sp.end) - Math.max(ws, sp.start);
      if (ov <= 0) continue;
      brainMin += sp.brain * ov; muscleMin += sp.muscle * ov; attnMin += sp.attention * ov;
    }
    if (brainMin / windowMs > maxBrain) maxBrain = brainMin / windowMs;
    if (muscleMin / windowMs > maxMuscle) maxMuscle = muscleMin / windowMs;
    if (attnMin / windowMs > maxAttention) maxAttention = attnMin / windowMs;
  }
  return { brain: maxBrain, muscle: maxMuscle, attention: maxAttention };
}

export interface LoadScore { delta: number; reasons: string[]; rolling: TaskLoad }

/**
 * Score a candidate slot for effort sustainability. Negative `delta` = it would over-concentrate an
 * effort in some 3h window (penalty scales with how far over cap). Small positive reward + a human
 * reason when a demanding task lands somewhere genuinely sustainable.
 */
export function scoreLoad(cand: TaskLoad, candStart: number, candEnd: number, blocks: BlockLoad[]): LoadScore {
  const rolling = rollingExtremes(candStart, candEnd, cand, blocks);
  let delta = 0;
  const reasons: string[] = [];

  if (rolling.brain > BRAIN_CAP) delta -= Math.round((rolling.brain - BRAIN_CAP) * 180);
  if (rolling.muscle > MUSCLE_CAP) delta -= Math.round((rolling.muscle - MUSCLE_CAP) * 180);
  if (rolling.attention > ATTENTION_CAP) delta -= Math.round((rolling.attention - ATTENTION_CAP) * 120);

  // Reward + explain only when a demanding task sits somewhere it stays sustainable.
  if (delta === 0) {
    if (cand.brain >= 0.6 && rolling.brain <= BRAIN_CAP) { delta += 8; reasons.push('keeps your focus load sustainable'); }
    else if (cand.muscle >= 0.6 && rolling.muscle <= MUSCLE_CAP) { delta += 8; reasons.push('balances your physical effort'); }
  }
  return { delta, reasons, rolling };
}
