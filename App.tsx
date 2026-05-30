import { StatusBar } from 'expo-status-bar';
import * as Notifications from 'expo-notifications';
import * as SplashScreen from 'expo-splash-screen';
import { splashShownAt } from './src/splashTime';
import { useIncomingShare } from 'expo-sharing';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Animated, AppState, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { passiveListener, type PassiveListenerState } from './src/audio/PassiveListener';
import { SplashAnimation } from './src/components/SplashAnimation';
import { MeetingMode } from './src/components/MeetingMode';
import { Onboarding } from './src/components/Onboarding';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { LUCY_COLORS } from './src/config/colors';
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
import { ConnectorsScreen } from './src/screens/Connectors';
import { NotificationDetailModal, type NotificationDetailPayload } from './src/screens/NotificationDetail';

export default function App() {
  // appKey increments on brain switch — forces full remount
  const [appKey, setAppKey] = useState(0);
  return <AppInner key={appKey} onBrainSwitch={() => setAppKey((k) => k + 1)} />;
}

function AppInner({ onBrainSwitch }: { onBrainSwitch: () => void }) {
  const [screen, setScreen] = useState<'capture' | 'dashboard' | 'ask' | 'settings'>('dashboard');
  const [refreshToken, setRefreshToken] = useState(0);
  const [ready, setReady] = useState(false);
  const [startupError, setStartupError] = useState('');
  const [backgroundEnabled, setBackgroundEnabled] = useState(false);
  const [notificationDetail, setNotificationDetail] = useState<NotificationDetailPayload | null>(null);
  const [passiveState, setPassiveState] = useState<PassiveListenerState>(passiveListener.getState());
  const [meetingVisible, setMeetingVisible] = useState(false);
  const [onboardingVisible, setOnboardingVisible] = useState(false);
  const [showSplash, setShowSplash] = useState(true);
  const splashFade = useRef(new Animated.Value(1)).current;
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
        // Load active brain — but never auto-restore Demo brain on cold start
        // Demo brain must be switched to explicitly by the user each session
        const { loadActiveUser, getActiveUser, switchUser } = await import('./src/db/userManager');
        await loadActiveUser();
        if (getActiveUser().id === 'demo') {
          await switchUser({ id: 'main', name: 'My Brain' });
        }

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
        // Load user's AI model preference
        try {
          const modelOverride = await getSetting(db, 'ai_model_override');
          if (modelOverride) {
            const { setPreferredModel } = await import('./src/ai/modelPreference');
            setPreferredModel(modelOverride);
          }
        } catch { /* non-critical */ }

        // Eleanor's brain seeds when user explicitly switches to it (with progress screen)

        setReady(true);
        void drainQueue();
        // Show onboarding for first-time users
        const hasOnboarded = await getSetting(db, 'onboarding_complete');
        if (!hasOnboarded) setOnboardingVisible(true);
        if (!await getSetting(db, BACKGROUND_PROMPTED_SETTING)) {
          await setSetting(db, BACKGROUND_PROMPTED_SETTING, 'true');
          setTimeout(showBackgroundChoice, 400);
        }
        // Wait until 1 second has elapsed since launch, then hide splash.
        const elapsed = Date.now() - splashShownAt;
        const remaining = Math.max(0, 2000 - elapsed);
        setTimeout(() => {
          void SplashScreen.hideAsync();
          // Fade out the JS animated splash
          Animated.timing(splashFade, { toValue: 0, duration: 600, useNativeDriver: true }).start(() => setShowSplash(false));
        }, remaining);
      } catch (error) {
        setStartupError(error instanceof Error ? error.message : 'Storage initialization failed.');
        void SplashScreen.hideAsync();
        Animated.timing(splashFade, { toValue: 0, duration: 400, useNativeDriver: true }).start(() => setShowSplash(false));
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

  useEffect(() => passiveListener.subscribe(setPassiveState), []);

  const togglePassiveListening = useCallback(() => {
    if (!passiveListener.isAvailable) {
      Alert.alert(
        'Coming soon',
        'Passive listening is being set up. It will be ready in the next update.',
      );
      return;
    }
    if (passiveState.status === 'off') {
      Alert.alert(
        'Start passive listening?',
        passiveListener.usesOnDeviceSTT
          ? 'LUCY will listen continuously using on-device speech recognition. Transcripts are batched every 10 minutes and stored privately on your device.'
          : 'LUCY will record in 10-minute batches and transcribe using remote AI. Enable Remote Intelligence in Settings for best results.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Start', onPress: () => void passiveListener.start() },
        ],
      );
    } else if (passiveState.status === 'listening') {
      void passiveListener.stop();
    }
  }, [passiveState.status]);

  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response.notification.request.content.data as Record<string, unknown> | undefined;
      if (data?.kind && typeof data.kind === 'string') {
        setNotificationDetail(data as unknown as NotificationDetailPayload);
      }
    });
    return () => sub.remove();
  }, []);

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.safe}>
        <StatusBar style="light" />
        {/* Unified header shown on all screens — consistent controls everywhere */}
        <View style={styles.brand}>
          <View style={styles.brandRow}>
            <Text style={styles.brandName}>LUC<Text style={{ color: '#FF8C42' }}>Y</Text></Text>
            <View style={styles.headerActions}>
              <TouchableOpacity style={styles.meetingHeaderPill} onPress={() => setMeetingVisible(true)}>
                <View style={[styles.listenDot, { backgroundColor: '#ef4444' }]} />
                <Text style={[styles.listenText, { color: '#ef4444' }]}>Meeting</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.listenPill, passiveState.status === 'listening' && styles.listenPillActive]} onPress={togglePassiveListening}>
                <View style={[styles.listenDot, passiveState.status === 'listening' && styles.listenDotActive]} />
                <Text style={[styles.listenText, passiveState.status === 'listening' && styles.listenTextActive]}>
                  {passiveState.status === 'listening'
                    ? (passiveState.noApiKey ? 'No key' : passiveState.mode === 'batch' && passiveState.wordsHeard === 0
                        ? `Rec ${passiveState.recordingSeconds}s`
                        : `${passiveState.wordsHeard}w`)
                    : passiveState.status === 'starting' || passiveState.status === 'stopping'
                    ? '...'
                    : 'Listen'}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.brainHeaderPill} onPress={() => setScreen('settings')}>
                <Text style={styles.brainHeaderText}>◈ Brain</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
        <View style={styles.container}>
          {startupError ? <Text style={styles.error}>{startupError}</Text> : null}
          {/* Loading is handled by SplashAnimation overlay */}
          {ready && screen === 'capture' ? (
            <CaptureScreen
              refreshToken={refreshToken}
              passiveState={passiveState}
              onToggleListen={togglePassiveListening}
              backgroundEnabled={backgroundEnabled}
              onBackgroundPress={showBackgroundChoice}
              onMeeting={() => setMeetingVisible(true)}
              onBrainSwitch={() => setScreen('settings')}
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
              onBrainSwitch={onBrainSwitch}
            />
          ) : null}
        </View>
        <View style={styles.bottomNav}>
          {([
            { key: 'dashboard', label: 'Home', icon: '\u25c8' },
            { key: 'capture', label: 'Tasks', icon: '\u25a6' },
            { key: 'ask', label: 'Ask', icon: '\u25ce' },
            { key: 'settings', label: 'Settings', icon: '\u25c9' },
          ] as const).map((tab) => (
            <TouchableOpacity
              key={tab.key}
              style={styles.bottomTab}
              onPress={() => setScreen(tab.key)}
            >
              <Text style={[styles.bottomTabIcon, screen === tab.key && styles.bottomTabIconActive]}>
                {tab.icon}
              </Text>
              <Text style={[styles.bottomTabLabel, screen === tab.key && styles.bottomTabLabelActive]}>
                {tab.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </SafeAreaView>
      <NotificationDetailModal
        payload={notificationDetail}
        onDismiss={() => setNotificationDetail(null)}
      />
      <SplashAnimation fadeAnim={splashFade} visible={showSplash} />
      <MeetingMode visible={meetingVisible} onClose={() => setMeetingVisible(false)} />
      <Onboarding visible={onboardingVisible} onComplete={async () => {
        setOnboardingVisible(false);
        const db = await getDatabase();
        await setSetting(db, 'onboarding_complete', 'true');
      }} />
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: LUCY_COLORS.background },
  brand: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 14 },
  brandRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  brandLogo: { height: 32, width: 160 },
  brandName: { color: LUCY_COLORS.textDark, fontSize: 24, fontWeight: '800', letterSpacing: 1.3 },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  meetingPill: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 18, backgroundColor: 'rgba(239,68,68,0.1)', borderWidth: 1, borderColor: 'rgba(239,68,68,0.3)', flexDirection: 'row', alignItems: 'center', gap: 5 },
  listenPill: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 18, backgroundColor: LUCY_COLORS.surface, borderWidth: 1, borderColor: LUCY_COLORS.border, flexDirection: 'row', alignItems: 'center', gap: 6 },
  listenPillActive: { backgroundColor: '#1a0a00', borderColor: LUCY_COLORS.primary },
  listenDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: LUCY_COLORS.textSubtle },
  listenDotActive: { backgroundColor: '#ef4444' },
  listenText: { color: LUCY_COLORS.textMuted, fontWeight: '700', fontSize: 12 },
  listenTextActive: { color: LUCY_COLORS.primary },
  localPill: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 18, backgroundColor: LUCY_COLORS.primarySoft, flexDirection: 'row', alignItems: 'center', gap: 5 },
  localDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: LUCY_COLORS.primary },
  localText: { color: LUCY_COLORS.primaryGlow, fontWeight: '700', fontSize: 11 },
  meetingHeaderPill: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 18, backgroundColor: 'rgba(239,68,68,0.1)', borderWidth: 1, borderColor: 'rgba(239,68,68,0.3)', flexDirection: 'row', alignItems: 'center', gap: 5 },
  brainHeaderPill: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 18, backgroundColor: LUCY_COLORS.primarySoft, flexDirection: 'row', alignItems: 'center' },
  brainHeaderText: { color: LUCY_COLORS.primary, fontWeight: '700', fontSize: 11 },
  container: { flex: 1, paddingHorizontal: 20, paddingTop: 4 },
  bottomNav: {
    flexDirection: 'row',
    backgroundColor: LUCY_COLORS.surface,
    borderTopWidth: 1,
    borderTopColor: LUCY_COLORS.border,
    paddingBottom: 4,
  },
  bottomTab: { flex: 1, alignItems: 'center', paddingVertical: 10, gap: 3 },
  bottomTabIcon: { fontSize: 20, color: LUCY_COLORS.textSubtle },
  bottomTabIconActive: { color: LUCY_COLORS.primary },
  bottomTabLabel: { fontSize: 11, fontWeight: '600', color: LUCY_COLORS.textSubtle },
  bottomTabLabelActive: { color: LUCY_COLORS.primary, fontWeight: '700' },
  loading: { color: LUCY_COLORS.textMuted, textAlign: 'center', marginTop: 50 },
  error: { color: '#FDA4AF', backgroundColor: '#3B1722', borderRadius: 12, padding: 15 },
});
