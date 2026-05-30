import * as Device from 'expo-device';
import * as Battery from 'expo-battery';
import { getDatabase } from '../db';

export interface DeviceContext {
  timezone: string;
  currentTime: string;
  currentDate: string;
  dayOfWeek: string;
  deviceModel: string;
  osName: string;
  osVersion: string;
  batteryLevel?: number;
}

export async function getDeviceContext(): Promise<DeviceContext> {
  const now = new Date();
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  const currentTime = now.toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    timeZoneName: 'short',
  });

  const currentDate = now.toLocaleDateString(undefined, {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const dayOfWeek = now.toLocaleDateString(undefined, { weekday: 'long' });

  const deviceModel = Device.modelName ?? Device.deviceName ?? 'Unknown device';
  const osName = Device.osName ?? 'Unknown OS';
  const osVersion = Device.osVersion ?? '';

  let batteryLevel: number | undefined;
  try {
    const bl = await Battery.getBatteryLevelAsync();
    if (bl >= 0) batteryLevel = Math.round(bl * 100);
  } catch { /* non-critical */ }

  return { timezone, currentTime, currentDate, dayOfWeek, deviceModel, osName, osVersion, batteryLevel };
}

export function formatDeviceContext(ctx: DeviceContext): string {
  const lines = [
    `Current time: ${ctx.currentTime}`,
    `Current date: ${ctx.currentDate}`,
    `Timezone: ${ctx.timezone}`,
    `Device: ${ctx.deviceModel} (${ctx.osName} ${ctx.osVersion})`,
  ];
  if (ctx.batteryLevel !== undefined) {
    lines.push(`Battery: ${ctx.batteryLevel}%`);
  }
  return lines.join('\n');
}

// Enrich device context with LUCY usage patterns from DB
export async function enrichWithUsagePatterns(ctx: DeviceContext): Promise<string> {
  const base = formatDeviceContext(ctx);
  try {
    const db = await getDatabase();
    const [captureCountToday, captureCountWeek, topHour] = await Promise.all([
      db.getFirstAsync<{ n: number }>(`SELECT COUNT(*) as n FROM captures WHERE date(created_at) = date('now')`),
      db.getFirstAsync<{ n: number }>(`SELECT COUNT(*) as n FROM captures WHERE created_at > datetime('now', '-7 days')`),
      db.getFirstAsync<{ hour: number; cnt: number }>(
        `SELECT strftime('%H', created_at) * 1 as hour, COUNT(*) as cnt
         FROM captures WHERE created_at > datetime('now', '-7 days')
         GROUP BY hour ORDER BY cnt DESC LIMIT 1`,
      ),
    ]);
    const patterns = [
      `Thoughts captured today: ${captureCountToday?.n ?? 0}`,
      `Thoughts captured this week: ${captureCountWeek?.n ?? 0}`,
    ];
    if (topHour) {
      const h = topHour.hour;
      const label = h < 9 ? 'early morning' : h < 12 ? 'morning' : h < 15 ? 'midday' : h < 18 ? 'afternoon' : 'evening';
      patterns.push(`Most active LUCY usage time: ${label} (${h}:00)`);
    }
    return `${base}\n${patterns.join('\n')}`;
  } catch {
    return base;
  }
}
