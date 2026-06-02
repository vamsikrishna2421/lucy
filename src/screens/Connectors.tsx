/**
 * LUCY Connectors Screen
 *
 * Central place for all device integrations and permissions.
 * Each connector explains exactly what it accesses, why, and what LUCY does with it.
 * User controls every permission with a clear toggle.
 */

import { useEffect, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Switch, Text, TouchableOpacity, View } from 'react-native';
import { LUCY_COLORS } from '../config/colors';
import { getDatabase } from '../db';
import { getSetting, setSetting } from '../db/settings';
import { requestCalendarPermission, hasCalendarPermission } from '../processing/calendarConnector';
import { passiveListener } from '../audio/PassiveListener';
import { scheduleProgressCheckIn, cancelProgressCheckIn } from '../processing/notifications';
import * as Battery from 'expo-battery';
import * as Location from 'expo-location';

interface ConnectorConfig {
  id: string;
  name: string;
  icon: string;
  description: string;
  whatLucyDoes: string;
  permissionNeeded: string;
  enabled: boolean;
  loading: boolean;
  onToggle: (enabled: boolean) => Promise<void>;
}

export function ConnectorsScreen() {
  const [connectors, setConnectors] = useState<Record<string, boolean>>({
    calendar: false,
    location: false,
    battery_tracking: true,  // already running
    progress_checkins: false,
    passive_listening: false,
    meeting_mode: true,       // always available
  });
  const [loading, setLoading] = useState<Record<string, boolean>>({});

  useEffect(() => {
    void (async () => {
      const db = await getDatabase();
      const [calPerm, checkinId, locationPerm] = await Promise.all([
        hasCalendarPermission(),
        getSetting(db, 'progress_checkin_notification_id'),
        Location.getForegroundPermissionsAsync().catch(() => ({ status: 'denied' })),
      ]);
      setConnectors((prev) => ({
        ...prev,
        calendar: calPerm,
        progress_checkins: !!checkinId,
        location: locationPerm.status === 'granted',
      }));
    })();
  }, []);

  const setLoaderFor = (id: string, val: boolean) =>
    setLoading((prev) => ({ ...prev, [id]: val }));

  const setEnabled = (id: string, val: boolean) =>
    setConnectors((prev) => ({ ...prev, [id]: val }));

  const CONFIGS = [
    {
      id: 'calendar',
      name: 'Calendar',
      icon: '📅',
      description: 'Your device calendar events (read-only)',
      whatLucyDoes: '• Pre-meeting brief 30 min before meetings\n• Post-meeting prompt to capture notes\n• Answer "What meetings do I have today?"',
      permissionNeeded: 'Calendar read access',
      onToggle: async (enable: boolean) => {
        if (enable) {
          const granted = await requestCalendarPermission();
          if (!granted) {
            Alert.alert('Permission needed', 'Go to Settings → LUCY → Calendars to grant access.');
            return;
          }
          setEnabled('calendar', true);
          Alert.alert('Calendar connected', 'LUCY will send pre-meeting briefs and help you prepare for meetings.');
        } else {
          setEnabled('calendar', false);
          Alert.alert('Calendar disconnected', 'LUCY will no longer read your calendar. Re-enable anytime.');
        }
      },
    },
    {
      id: 'location',
      name: 'Location context',
      icon: '📍',
      description: 'City-level travel timeline, recorded ~1 mile precision',
      whatLucyDoes: '• Build your weekly travel timeline (city-level, ~1 mile precision)\n• Answer "Where am I?" in Ask\n• Add location context to daily briefs\n• Records every hour + when you move ~1 mile — even when app is closed\n• Coordinates never leave your device',
      permissionNeeded: 'Location — Always for background tracking, or "When in use" for app-open only',
      onToggle: async (enable: boolean) => {
        if (enable) {
          // Try to get "Always" permission first (best experience — records in background every ~1h).
          // If the user only grants "When in use", fall back gracefully — records whenever the app is open.
          const { startBackgroundLocationTracking } = await import('../processing/backgroundLocation');
          const started = await startBackgroundLocationTracking();
          if (started) {
            // Full background mode
            setEnabled('location', true);
          } else {
            // Foreground-only fallback: request at least "when in use"
            const { status } = await Location.requestForegroundPermissionsAsync();
            if (status !== 'granted') {
              Alert.alert('Permission needed', 'Go to Settings → LUCY → Location to grant access.');
              return;
            }
            Alert.alert(
              'Location enabled (app-open only)',
              'LUCY will record your location when you open the app. For travel tracking while the phone is in your pocket, grant "Always" location access in Settings → LUCY → Location.',
              [{ text: 'OK' }],
            );
            setEnabled('location', true);
          }
        } else {
          const { stopBackgroundLocationTracking } = await import('../processing/backgroundLocation');
          await stopBackgroundLocationTracking();
          setEnabled('location', false);
        }
      },
    },
    {
      id: 'battery_tracking',
      name: 'Battery patterns',
      icon: '🔋',
      description: 'Battery level recorded every few hours',
      whatLucyDoes: '• Answer "What is my battery level?"\n• Detect your heaviest usage days\n• Pattern: "Your battery drains fastest on Tuesdays"',
      permissionNeeded: 'No special permission needed',
      onToggle: async (enable: boolean) => {
        setEnabled('battery_tracking', enable);
        const db = await getDatabase();
        await setSetting(db, 'battery_tracking_enabled', enable ? 'true' : 'false');
      },
    },
    {
      id: 'progress_checkins',
      name: 'Progress check-ins',
      icon: '⏰',
      description: 'Reminders every 2 hours during your day (8am–6pm)',
      whatLucyDoes: '• Nudge you to capture work updates\n• Prevent important moments from slipping\n• Build a richer memory over time',
      permissionNeeded: 'Notification permission',
      onToggle: async (enable: boolean) => {
        const db = await getDatabase();
        if (enable) {
          const id = await scheduleProgressCheckIn();
          if (id) {
            await setSetting(db, 'progress_checkin_notification_id', id);
            setEnabled('progress_checkins', true);
          }
        } else {
          const existingId = await getSetting(db, 'progress_checkin_notification_id');
          if (existingId) await cancelProgressCheckIn(existingId);
          await setSetting(db, 'progress_checkin_notification_id', '');
          setEnabled('progress_checkins', false);
        }
      },
    },
    {
      id: 'passive_listening',
      name: 'Passive listening',
      icon: '🎙️',
      description: 'Continuous background transcription while active',
      whatLucyDoes: '• Capture thoughts, meeting highlights, ideas automatically\n• 10-minute batch processing through LUCY\'s AI\n• Orange indicator visible on your screen (iOS requirement)',
      permissionNeeded: 'Microphone permission',
      onToggle: async (enable: boolean) => {
        if (enable) {
          await passiveListener.start();
          setEnabled('passive_listening', true);
        } else {
          await passiveListener.stop();
          setEnabled('passive_listening', false);
        }
      },
    },
    {
      id: 'meeting_mode',
      name: 'Meeting mode',
      icon: '🤝',
      description: 'Dedicated meeting capture with auto-summary',
      whatLucyDoes: '• Record meetings with duration tracking\n• AI summary: decisions, action items, open questions\n• Post-meeting capture prompt\n• Tap "Meeting" button in the header anytime',
      permissionNeeded: 'Microphone permission (same as passive listening)',
      onToggle: async (enable: boolean) => {
        setEnabled('meeting_mode', enable);
      },
    },
  ] as const;

  return (
    <ScrollView style={styles.container} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>
      <Text style={styles.title}>Connectors</Text>
      <Text style={styles.subtitle}>Control what LUCY can access. Every permission is explained. You decide.</Text>

      {CONFIGS.map((cfg) => (
        <View key={cfg.id} style={styles.card}>
          <View style={styles.cardHeader}>
            <View style={styles.cardLeft}>
              <Text style={styles.cardIcon}>{cfg.icon}</Text>
              <View>
                <Text style={styles.cardName}>{cfg.name}</Text>
                <Text style={styles.cardPerm}>{cfg.permissionNeeded}</Text>
              </View>
            </View>
            <Switch
              value={connectors[cfg.id] ?? false}
              onValueChange={(val) => {
                setLoaderFor(cfg.id, true);
                void cfg.onToggle(val).finally(() => setLoaderFor(cfg.id, false));
              }}
              trackColor={{ false: LUCY_COLORS.border, true: LUCY_COLORS.primary }}
              thumbColor={connectors[cfg.id] ? '#fff' : LUCY_COLORS.textSubtle}
              disabled={loading[cfg.id]}
            />
          </View>
          <Text style={styles.cardDesc}>{cfg.description}</Text>
          <View style={styles.cardDivider} />
          <Text style={styles.cardDoesLabel}>What LUCY does with this</Text>
          <Text style={styles.cardDoes}>{cfg.whatLucyDoes}</Text>
        </View>
      ))}

      <View style={styles.privacyNote}>
        <Text style={styles.privacyTitle}>Your data stays on your device</Text>
        <Text style={styles.privacyText}>
          Every connector reads data locally. Nothing is sent to any server without your explicit action.
          When you use Remote Intelligence (OpenAI), only the specific text you ask about is sent — never raw device data.
        </Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  title: { fontSize: 28, fontWeight: '800', color: LUCY_COLORS.textDark, marginBottom: 6 },
  subtitle: { fontSize: 14, color: LUCY_COLORS.textMuted, lineHeight: 21, marginBottom: 24 },
  card: {
    backgroundColor: LUCY_COLORS.surfaceRaised,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: LUCY_COLORS.border,
    padding: 18,
    marginBottom: 14,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  cardLeft: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
  cardIcon: { fontSize: 26 },
  cardName: { fontSize: 16, fontWeight: '700', color: LUCY_COLORS.textDark },
  cardPerm: { fontSize: 11, color: LUCY_COLORS.textSubtle, marginTop: 1 },
  cardDesc: { color: LUCY_COLORS.textMuted, fontSize: 13, marginBottom: 12 },
  cardDivider: { height: 1, backgroundColor: LUCY_COLORS.divider, marginBottom: 10 },
  cardDoesLabel: { fontSize: 10, fontWeight: '800', color: LUCY_COLORS.primary, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 6 },
  cardDoes: { color: LUCY_COLORS.textDark, fontSize: 13, lineHeight: 21 },
  privacyNote: {
    backgroundColor: LUCY_COLORS.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: LUCY_COLORS.border,
    padding: 18,
    marginTop: 8,
  },
  privacyTitle: { fontSize: 14, fontWeight: '700', color: LUCY_COLORS.textDark, marginBottom: 8 },
  privacyText: { fontSize: 13, color: LUCY_COLORS.textMuted, lineHeight: 20 },
});
