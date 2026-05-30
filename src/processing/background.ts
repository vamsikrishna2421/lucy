import * as BackgroundTask from 'expo-background-task';
import * as TaskManager from 'expo-task-manager';
import { config } from '../config';
import { getDatabase } from '../db';
import { countOpenLoops } from '../db/openLoops';
import { countFollowUps } from '../db/followUps';
import { getSetting, setSetting } from '../db/settings';
import { sendDigestNotification } from './notifications';
import { processQueue } from './extract';
import { organizeMemory } from './organizer';
import { sendMorningBrief, shouldSendMorningBrief } from './morningBrief';
import { weeklyInsightIfDue } from './weeklyInsight';
import { generateDailyInsights } from './insightEngine';
import { storeEmbedding } from '../ai/embeddings';
import { listRecentCaptures } from '../db/captures';
import { recordBatterySnapshot } from '../db/deviceStats';
import * as Battery from 'expo-battery';

export const BACKGROUND_PROCESSING_TASK = 'lucy-background-organizing';
export const BACKGROUND_LAST_RUN_SETTING = 'background_processing_last_run';
export const BACKGROUND_LAST_RESULT_SETTING = 'background_processing_last_result';

export interface BackgroundProcessingState {
  available: boolean;
  registered: boolean;
  lastRun?: string;
  lastResult?: string;
}

if (!TaskManager.isTaskDefined(BACKGROUND_PROCESSING_TASK)) {
  TaskManager.defineTask(BACKGROUND_PROCESSING_TASK, async () => {
    const db = await getDatabase();
    try {
      // Keep background runs bounded; local inference may already take substantial time.
      const processed = await processQueue(undefined, 1);
      await organizeMemory(db, 'background');
      const lastDigest = await getSetting(db, 'daily_digest_last_sent');
      const today = new Date().toISOString().slice(0, 10);
      if (!lastDigest || !lastDigest.startsWith(today)) {
        const [openCount, followCount] = await Promise.all([countOpenLoops(db), countFollowUps(db)]);
        const parts: string[] = [];
        if (openCount > 0) parts.push(`${openCount} open loop${openCount === 1 ? '' : 's'} still waiting`);
        if (followCount > 0) parts.push(`${followCount} follow-up${followCount === 1 ? '' : 's'} pending`);
        if (parts.length > 0) {
          await sendDigestNotification('psst — quick check-in', parts.join(' · '), openCount, followCount);
          await setSetting(db, 'daily_digest_last_sent', today);
        }
      }
      // Record battery snapshot for device intelligence
      try {
        const [level, state] = await Promise.all([Battery.getBatteryLevelAsync(), Battery.getBatteryStateAsync()]);
        const recentCount = await db.getFirstAsync<{ n: number }>(
          `SELECT COUNT(*) as n FROM captures WHERE created_at > datetime('now', '-2 hours')`,
        );
        await recordBatterySnapshot(db, level, state === Battery.BatteryState.CHARGING, recentCount?.n ?? 0);
      } catch { /* non-critical */ }

      // Backfill embeddings for any captures missing them
      try {
        const recentCaptures = await listRecentCaptures(db, 30);
        for (const capture of recentCaptures) {
          const existing = await db.getFirstAsync<{ id: number }>(
            'SELECT id FROM capture_embeddings WHERE capture_id = ?', capture.id,
          );
          if (!existing && capture.raw_transcript) {
            await storeEmbedding(db, capture.id, capture.raw_transcript);
          }
        }
      } catch { /* non-critical */ }

      // Generate daily AI insights (once per day, any time)
      try { await generateDailyInsights(db); } catch { /* non-critical */ }

      // Morning brief (7-9am, once per day)
      if (await shouldSendMorningBrief()) {
        try { await sendMorningBrief(db); } catch { /* non-critical */ }
      }
      // Weekly insight (Sunday evenings)
      try { await weeklyInsightIfDue(db); } catch { /* non-critical */ }

      await setSetting(db, BACKGROUND_LAST_RUN_SETTING, new Date().toISOString());
      await setSetting(
        db,
        BACKGROUND_LAST_RESULT_SETTING,
        processed ? 'Organized one waiting thought.' : 'Nothing was waiting to be organized.',
      );
      return BackgroundTask.BackgroundTaskResult.Success;
    } catch {
      await setSetting(db, BACKGROUND_LAST_RUN_SETTING, new Date().toISOString());
      await setSetting(db, BACKGROUND_LAST_RESULT_SETTING, 'A background attempt failed. LUCY will retry automatically.');
      return BackgroundTask.BackgroundTaskResult.Failed;
    }
  });
}

export async function enableBackgroundProcessing(): Promise<boolean> {
  const status = await BackgroundTask.getStatusAsync();
  if (status !== BackgroundTask.BackgroundTaskStatus.Available) {
    return false;
  }
  await BackgroundTask.registerTaskAsync(BACKGROUND_PROCESSING_TASK, {
    minimumInterval: config.backgroundProcessingIntervalMinutes,
  });
  return TaskManager.isTaskRegisteredAsync(BACKGROUND_PROCESSING_TASK);
}

export async function disableBackgroundProcessing(): Promise<void> {
  await BackgroundTask.unregisterTaskAsync(BACKGROUND_PROCESSING_TASK);
}

export async function getBackgroundProcessingState(): Promise<BackgroundProcessingState> {
  const [status, registered, db] = await Promise.all([
    BackgroundTask.getStatusAsync(),
    TaskManager.isTaskRegisteredAsync(BACKGROUND_PROCESSING_TASK),
    getDatabase(),
  ]);
  const [lastRun, lastResult] = await Promise.all([
    getSetting(db, BACKGROUND_LAST_RUN_SETTING),
    getSetting(db, BACKGROUND_LAST_RESULT_SETTING),
  ]);
  return {
    available: status === BackgroundTask.BackgroundTaskStatus.Available,
    registered,
    lastRun,
    lastResult,
  };
}
