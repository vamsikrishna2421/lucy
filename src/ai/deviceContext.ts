/**
 * Full device context for LUCY's Ask engine.
 *
 * Everything accessible from a React Native/Expo app without
 * special OS-level permissions. Injected into every Ask query
 * so LUCY can answer device/lifestyle questions accurately.
 */

import * as Device from 'expo-device';
import * as Battery from 'expo-battery';
import * as Network from 'expo-network';
import * as Localization from 'expo-localization';
import { Dimensions, Platform } from 'react-native';
import { getDatabase } from '../db';

export interface DeviceContext {
  // Time & location
  timezone: string;
  locale: string;
  currentTime: string;
  currentDate: string;
  dayOfWeek: string;
  weekNumber: number;

  // Hardware
  deviceModel: string;
  deviceName: string;
  osName: string;
  osVersion: string;
  platform: string;
  totalMemoryGB: number | null;
  screenWidth: number;
  screenHeight: number;

  // Live state
  batteryLevel: number | null;   // 0-100
  isCharging: boolean;
  networkType: string;
  isConnected: boolean;

  // Inferred
  timeOfDay: 'early morning' | 'morning' | 'midday' | 'afternoon' | 'evening' | 'night';
  dayType: 'weekday' | 'weekend';
}

function getWeekNumber(d: Date): number {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

function classifyTimeOfDay(hour: number): DeviceContext['timeOfDay'] {
  if (hour < 5)  return 'early morning';
  if (hour < 12) return 'morning';
  if (hour < 14) return 'midday';
  if (hour < 18) return 'afternoon';
  if (hour < 21) return 'evening';
  return 'night';
}

export async function getDeviceContext(): Promise<DeviceContext> {
  const now = new Date();
  const hour = now.getHours();
  const dow  = now.getDay(); // 0=Sun

  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const locale   = Localization.getLocales()[0]?.languageTag ?? 'en-US';

  const { width, height } = Dimensions.get('window');

  // Async device data (non-blocking, fail gracefully)
  const [batteryLevel, batteryState, networkState] = await Promise.allSettled([
    Battery.getBatteryLevelAsync(),
    Battery.getBatteryStateAsync(),
    Network.getNetworkStateAsync(),
  ]);

  const level    = batteryLevel.status === 'fulfilled' ? Math.round(batteryLevel.value * 100) : null;
  const charging = batteryState.status === 'fulfilled' && batteryState.value === Battery.BatteryState.CHARGING;
  const net      = networkState.status === 'fulfilled' ? networkState.value : null;

  const netType = net?.type === Network.NetworkStateType.WIFI
    ? 'WiFi'
    : net?.type === Network.NetworkStateType.CELLULAR
      ? 'Cellular'
      : net?.isConnected ? 'Connected' : 'Offline';

  const totalMemGB = Device.totalMemory
    ? Math.round(Device.totalMemory / (1024 * 1024 * 1024) * 10) / 10
    : null;

  return {
    timezone,
    locale,
    currentTime:  now.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }),
    currentDate:  now.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }),
    dayOfWeek:    now.toLocaleDateString(undefined, { weekday: 'long' }),
    weekNumber:   getWeekNumber(now),

    deviceModel:  Device.modelName  ?? Device.deviceName ?? 'Unknown',
    deviceName:   Device.deviceName ?? 'My Phone',
    osName:       Device.osName     ?? Platform.OS,
    osVersion:    Device.osVersion  ?? '',
    platform:     Platform.OS,
    totalMemoryGB: totalMemGB,
    screenWidth:  Math.round(width),
    screenHeight: Math.round(height),

    batteryLevel:  level,
    isCharging:    charging,
    networkType:   netType,
    isConnected:   net?.isConnected ?? true,

    timeOfDay: classifyTimeOfDay(hour),
    dayType:   dow === 0 || dow === 6 ? 'weekend' : 'weekday',
  };
}

export function formatDeviceContext(ctx: DeviceContext): string {
  const batteryStr = ctx.batteryLevel !== null
    ? `${ctx.batteryLevel}%${ctx.isCharging ? ' (charging)' : ''}`
    : 'Unknown';

  return [
    `Current time: ${ctx.currentTime}`,
    `Current date: ${ctx.currentDate}`,
    `Time of day: ${ctx.timeOfDay}`,
    `Day type: ${ctx.dayType}`,
    `Week number: Week ${ctx.weekNumber} of the year`,
    `Timezone: ${ctx.timezone}`,
    `Locale/Language: ${ctx.locale}`,
    `Device: ${ctx.deviceModel} (${ctx.osName} ${ctx.osVersion})`,
    `Screen: ${ctx.screenWidth} × ${ctx.screenHeight} px`,
    ctx.totalMemoryGB ? `RAM: ${ctx.totalMemoryGB} GB` : null,
    `Battery: ${batteryStr}`,
    `Network: ${ctx.networkType}`,
  ].filter(Boolean).join('\n');
}

// 5-minute cache for usage patterns (DB query is cheap but called on every Ask)
let _usagePatternsCache: { value: string; expiresAt: number } | null = null;

// Add LUCY usage patterns from DB alongside device context
export async function enrichWithUsagePatterns(ctx: DeviceContext): Promise<string> {
  const base = formatDeviceContext(ctx);

  // Return cached result if still fresh
  if (_usagePatternsCache && Date.now() < _usagePatternsCache.expiresAt) {
    return `${base}\n${_usagePatternsCache.value}`;
  }

  try {
    const db = await getDatabase();
    const [today, week, topHour, pendingTasks, openLoops] = await Promise.all([
      db.getFirstAsync<{ n: number }>(`SELECT COUNT(*) as n FROM captures WHERE date(created_at) = date('now')`),
      db.getFirstAsync<{ n: number }>(`SELECT COUNT(*) as n FROM captures WHERE created_at > datetime('now', '-7 days')`),
      db.getFirstAsync<{ hour: number; cnt: number }>(
        `SELECT strftime('%H', created_at) * 1 as hour, COUNT(*) as cnt
         FROM captures WHERE created_at > datetime('now', '-7 days')
         GROUP BY hour ORDER BY cnt DESC LIMIT 1`,
      ),
      db.getFirstAsync<{ n: number }>(`SELECT COUNT(*) as n FROM todos WHERE status = 'pending'`),
      db.getFirstAsync<{ n: number }>(`SELECT COUNT(*) as n FROM open_loops WHERE status = 'open'`),
    ]);

    const usage = [
      `LUCY captures today: ${today?.n ?? 0}`,
      `LUCY captures this week: ${week?.n ?? 0}`,
      `Pending tasks: ${pendingTasks?.n ?? 0}`,
      `Open loops (things to come back to): ${openLoops?.n ?? 0}`,
    ];

    if (topHour) {
      const h = topHour.hour;
      const label = h < 9 ? 'early morning' : h < 12 ? 'morning' : h < 15 ? 'midday' : h < 18 ? 'afternoon' : 'evening';
      usage.push(`Peak LUCY usage time this week: ${label} (${h}:00)`);
    }

    // Try step count via Pedometer (expo-sensors, no special permission on iOS)
    try {
      const { Pedometer } = await import('expo-sensors');
      const available = await Pedometer.isAvailableAsync();
      if (available) {
        const start = new Date(); start.setHours(0,0,0,0);
        const { steps } = await Pedometer.getStepCountAsync(start, new Date());
        if (steps > 0) usage.push(`Steps today: ${steps.toLocaleString()}`);
      }
    } catch { /* Pedometer not available */ }

    const usageStr = usage.join('\n');
    _usagePatternsCache = { value: usageStr, expiresAt: Date.now() + 5 * 60 * 1000 };
    return `${base}\n${usageStr}`;
  } catch {
    return base;
  }
}
