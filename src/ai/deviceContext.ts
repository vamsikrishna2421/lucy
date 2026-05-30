import * as Device from 'expo-device';
import * as Battery from 'expo-battery';

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
