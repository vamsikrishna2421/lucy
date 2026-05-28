import { StatusBar } from 'expo-status-bar';
import { useIncomingShare } from 'expo-sharing';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, AppState, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { LUCY_COLORS, LUCY_PILLARS } from './src/config/colors';
import { getDatabase } from './src/db';
import { resetInterruptedCaptures } from './src/db/captures';
import { getSetting, setSetting } from './src/db/settings';
import { disableBackgroundProcessing, enableBackgroundProcessing } from './src/processing/background';
import { enqueueTranscript, processQueue } from './src/processing/extract';
import { autoRestoreDeviceModel, initializeDeviceModelSelection } from './src/ai/device';
import { archiveUnmatchedCompletionRetries } from './src/processing/followUp';
import { initializeNotifications } from './src/processing/notifications';
import { initializeVault } from './src/processing/vault';
import { archiveMisclassifiedArtifacts } from './src/processing/artifactCleanup';
import { organizeMemory } from './src/processing/organizer';
import { queueFullMemoryReprocessing } from './src/processing/reprocess';
import { CaptureScreen } from './src/screens/Capture';
import { DashboardScreen } from './src/screens/Dashboard';
import { AskScreen } from './src/screens/Ask';
import { SettingsScreen } from './src/screens/Settings';

export default function App() {
  const [screen, setScreen] = useState<'capture' | 'dashboard' | 'ask' | 'settings'>('capture');
  const [refreshToken, setRefreshToken] = useState(0);
  const [ready, setReady] = useState(false);
  const [startupError, setStartupError] = useState('');
  const [backgroundEnabled, setBackgroundEnabled] = useState(false);
  const processing = useRef(false);
  const queueRequested = useRef(false);
  const receivingShare = useRef(false);
  const recentShare = useRef<{ text: string; receivedAt: number } | null>(null);
  const { sharedPayloads, clearSharedPayloads } = useIncomingShare();
  const BACKGROUND_SETTING = 'background_processing_enabled';
  const BACKGROUND_PROMPTED_SETTING = 'background_processing_prompted';

  const setBackgroundPreference = useCallback(async (enable: boolean): Promise<boolean> => {
    const db = await getDatabase();
    if (enable) {
      const registered = await enableBackgroundProcessing();
      if (!registered) {
        Alert.alert('Background organizing unavailable', 'This device is currently restricting background work. LUCY will keep organizing when open.');
        return false;
      }
      await setSetting(db, BACKGROUND_SETTING, 'true');
      setBackgroundEnabled(true);
      Alert.alert('Background organizing enabled', 'LUCY may organize queued thoughts when your device grants a battery-friendly background opportunity.');
      return true;
    }
    await disableBackgroundProcessing();
    await setSetting(db, BACKGROUND_SETTING, 'false');
    setBackgroundEnabled(false);
    return true;
  }, []);

  const showBackgroundChoice = useCallback(() => {
    Alert.alert(
      'Let LUCY organize quietly?',
      'Allow background organizing so queued thoughts can be processed when your device chooses a battery-friendly window, often while idle or charging.',
      [
        { text: backgroundEnabled ? 'Turn off' : 'Not now', style: 'cancel', onPress: backgroundEnabled ? () => void setBackgroundPreference(false) : undefined },
        { text: 'Allow', onPress: () => void setBackgroundPreference(true) },
      ],
    );
  }, [backgroundEnabled, setBackgroundPreference]);

  const drainQueue = useCallback(async () => {
    queueRequested.current = true;
    if (processing.current) {
      return;
    }
    processing.current = true;
    try {
      while (queueRequested.current) {
        queueRequested.current = false;
        const processed = await processQueue(() => setRefreshToken((value) => value + 1));
        if (processed) {
          const db = await getDatabase();
          await organizeMemory(db, 'foreground');
          setRefreshToken((value) => value + 1);
        }
      }
    } finally {
      processing.current = false;
    }
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const db = await getDatabase();
        await initializeDeviceModelSelection();
        void autoRestoreDeviceModel();
        await resetInterruptedCaptures(db);
        await archiveUnmatchedCompletionRetries(db);
        await archiveMisclassifiedArtifacts(db);
        await organizeMemory(db, 'startup');
        initializeVault();
        await initializeNotifications();
        const backgroundPreference = await getSetting(db, BACKGROUND_SETTING);
        if (backgroundPreference === 'true') {
          setBackgroundEnabled(await enableBackgroundProcessing());
        }
        setReady(true);
        void drainQueue();
        if (!await getSetting(db, BACKGROUND_PROMPTED_SETTING)) {
          await setSetting(db, BACKGROUND_PROMPTED_SETTING, 'true');
          setTimeout(showBackgroundChoice, 400);
        }
      } catch (error) {
        setStartupError(error instanceof Error ? error.message : 'Storage initialization failed.');
      }
    })();
  }, [drainQueue]);

  useEffect(() => {
    if (!ready || receivingShare.current) {
      return;
    }
    const sharedText = sharedPayloads
      .filter((payload) => (payload.shareType ?? 'text') === 'text' || payload.shareType === 'url')
      .map((payload) => payload.value?.trim() ?? '')
      .filter(Boolean)
      .join('\n');
    if (!sharedText) {
      return;
    }
    const previous = recentShare.current;
    if (previous && previous.text === sharedText && Date.now() - previous.receivedAt < 10_000) {
      clearSharedPayloads();
      return;
    }
    recentShare.current = { text: sharedText, receivedAt: Date.now() };
    receivingShare.current = true;
    void (async () => {
      try {
        await enqueueTranscript(sharedText, Platform.OS === 'ios' ? 'ios' : 'android');
        clearSharedPayloads();
        setScreen('capture');
        setRefreshToken((value) => value + 1);
        void drainQueue();
      } finally {
        receivingShare.current = false;
      }
    })();
  }, [clearSharedPayloads, drainQueue, ready, sharedPayloads]);

  useEffect(() => {
    if (!ready) {
      return;
    }
    const interval = setInterval(() => void drainQueue(), 30_000);
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        void drainQueue();
      }
    });
    return () => {
      clearInterval(interval);
      subscription.remove();
    };
  }, [drainQueue, ready]);

  const reprocessAllMemories = useCallback(async (): Promise<number> => {
    const count = await queueFullMemoryReprocessing();
    setRefreshToken((value) => value + 1);
    void drainQueue();
    return count;
  }, [drainQueue]);

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.safe}>
        <StatusBar style="light" />
        <View style={styles.brand}>
          <View style={styles.brandRow}>
            <Text style={styles.brandName}>LUCY</Text>
            <TouchableOpacity style={styles.localPill} onPress={showBackgroundChoice}>
              <View style={styles.localDot} />
              <Text style={styles.localText}>{backgroundEnabled ? 'Background on' : 'Local-first'}</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.pillarsContainer}>
            {LUCY_PILLARS.map((pillar, index) => (
              <View key={pillar.label} style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Text style={[styles.pillarText, { color: pillar.color }]}>
                  {pillar.label}
                </Text>
                {index < LUCY_PILLARS.length - 1 && <Text style={styles.bulletSeparator}>{'\u2022'}</Text>}
              </View>
            ))}
          </View>
        </View>
        <View style={styles.nav}>
          <TouchableOpacity style={[styles.navButton, screen === 'capture' && styles.navSelected]} onPress={() => setScreen('capture')}>
            <Text style={[styles.navLabel, screen === 'capture' && styles.navLabelSelected]}>Capture</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.navButton, screen === 'dashboard' && styles.navSelected]} onPress={() => setScreen('dashboard')}>
            <Text style={[styles.navLabel, screen === 'dashboard' && styles.navLabelSelected]}>Today</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.navButton, screen === 'ask' && styles.navSelected]} onPress={() => setScreen('ask')}>
            <Text style={[styles.navLabel, screen === 'ask' && styles.navLabelSelected]}>Ask</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.navButton, screen === 'settings' && styles.navSelected]} onPress={() => setScreen('settings')}>
            <Text style={[styles.navLabel, screen === 'settings' && styles.navLabelSelected]}>Settings</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.container}>
          {startupError ? <Text style={styles.error}>{startupError}</Text> : null}
          {!ready && !startupError ? <Text style={styles.loading}>Opening your private memory...</Text> : null}
          {ready && screen === 'capture' ? (
            <CaptureScreen
              refreshToken={refreshToken}
              onQueued={() => {
                setRefreshToken((value) => value + 1);
                void drainQueue();
              }}
            />
          ) : null}
          {ready && screen === 'dashboard' ? <DashboardScreen refreshToken={refreshToken} /> : null}
          {ready && screen === 'ask' ? <AskScreen /> : null}
          {ready && screen === 'settings' ? (
            <SettingsScreen
              refreshToken={refreshToken}
              backgroundEnabled={backgroundEnabled}
              onChangeBackground={setBackgroundPreference}
              onReprocessAll={reprocessAllMemories}
            />
          ) : null}
        </View>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: LUCY_COLORS.background },
  brand: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 14 },
  brandRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  brandName: { color: LUCY_COLORS.textDark, fontSize: 24, fontWeight: '800', letterSpacing: 1.3 },
  pillarsContainer: { marginTop: 8, flexDirection: 'row', alignItems: 'center', gap: 3 },
  pillarText: { fontSize: 13, fontWeight: '600', letterSpacing: -0.2 },
  bulletSeparator: { marginHorizontal: 6, color: LUCY_COLORS.textSubtle, fontSize: 13 },
  localPill: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 18, backgroundColor: LUCY_COLORS.primarySoft, flexDirection: 'row', alignItems: 'center', gap: 6 },
  localDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: LUCY_COLORS.primary },
  localText: { color: LUCY_COLORS.primaryGlow, fontWeight: '700', fontSize: 12 },
  nav: { marginHorizontal: 20, padding: 4, borderRadius: 16, flexDirection: 'row', backgroundColor: LUCY_COLORS.surface, borderWidth: 1, borderColor: LUCY_COLORS.border, marginBottom: 14 },
  navButton: { flex: 1, alignItems: 'center', padding: 11, borderRadius: 11 },
  navSelected: { backgroundColor: LUCY_COLORS.surfaceRaised },
  navLabel: { color: LUCY_COLORS.textMuted, fontWeight: '700' },
  navLabelSelected: { color: LUCY_COLORS.primaryGlow },
  container: { flex: 1, paddingHorizontal: 20, paddingBottom: 12 },
  loading: { color: LUCY_COLORS.textMuted, textAlign: 'center', marginTop: 50 },
  error: { color: '#FDA4AF', backgroundColor: '#3B1722', borderRadius: 12, padding: 15 },
});
