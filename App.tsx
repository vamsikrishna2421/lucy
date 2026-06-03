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
import { dedupePendingTodos, enqueueTranscript, processQueue } from './src/processing/extract';
import { autoRestoreDeviceModel, initializeDeviceModelSelection } from './src/ai/device';
import { archiveUnmatchedCompletionRetries } from './src/processing/followUp';
import { initializeNotifications, updatePersistentStatusNotification } from './src/processing/notifications';
import { NotificationCenter } from './src/components/NotificationCenter';
import { getTotalUnreadCount } from './src/db/notificationLog';
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
  const [screen, setScreen] = useState<'capture' | 'dashboard' | 'ask' | 'settings'>('dashboard');
  const [refreshToken, setRefreshToken] = useState(0);
  const [ready, setReady] = useState(false);
  const [startupError, setStartupError] = useState('');
  const [backgroundEnabled, setBackgroundEnabled] = useState(false);
  const [notificationDetail, setNotificationDetail] = useState<NotificationDetailPayload | null>(null);
  const [passiveState, setPassiveState] = useState<PassiveListenerState>(passiveListener.getState());
  const [meetingVisible, setMeetingVisible] = useState(false);
  const [notifCenterVisible, setNotifCenterVisible] = useState(false);
  const [unreadNotifCount, setUnreadNotifCount] = useState(0);
  const [onboardingVisible, setOnboardingVisible] = useState(false);
  const [showSplash, setShowSplash] = useState(true);
  const splashFade = useRef(new Animated.Value(1)).current;
  const processing = useRef(false);
  const queueRequested = useRef(false);
  const receivingShare = useRef(false);
  const recentShare = useRef<{ text: string; receivedAt: number } | null>(null);
  const { sharedPayloads, resolvedSharedPayloads, isResolving, clearSharedPayloads } = useIncomingShare();
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
        // One-time cleanup of duplicate pending todos from the pre-1.0.53 dedup gap.
        if (await getSetting(db, 'todo_dedup_v1_done') !== 'true') {
          try { await dedupePendingTodos(db); } catch { /* non-critical */ }
          await setSetting(db, 'todo_dedup_v1_done', 'true');
        }
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
    // Wait for file URIs to resolve (a shared .md/.txt file arrives as a file payload,
    // not text — its contents live behind contentUri and must be read).
    if (isResolving) {
      return;
    }
    if (resolvedSharedPayloads.length === 0 && sharedPayloads.length === 0) {
      return;
    }
    receivingShare.current = true;
    void (async () => {
      try {
        const parts: string[] = [];
        // Prefer resolved payloads (they expose contentUri + mime); fall back to raw.
        const payloads: Array<Record<string, unknown>> = resolvedSharedPayloads.length
          ? (resolvedSharedPayloads as unknown as Array<Record<string, unknown>>)
          : (sharedPayloads as unknown as Array<Record<string, unknown>>);
        for (const p of payloads) {
          const shareType = (p.shareType as string) ?? 'text';
          const contentType = p.contentType as string | undefined;
          const value = (p.value as string | undefined)?.trim() ?? '';
          const uri = (p.contentUri as string | null) ?? null;
          const mime = (p.contentMimeType as string | undefined) ?? (p.mimeType as string | undefined) ?? '';
          const name = (p.originalName as string | undefined) ?? '';
          if (shareType === 'text' || shareType === 'url' || contentType === 'text') {
            if (value) parts.push(value);
          } else if (uri && (mime.startsWith('text/') || /\.(md|markdown|txt|text)$/i.test(name || uri))) {
            // Text-like file (e.g. a journal .md): read its contents and capture them.
            try {
              const { readAsStringAsync } = await import('expo-file-system');
              const content = (await readAsStringAsync(uri)).trim();
              if (content) parts.push(content);
            } catch { /* unreadable file — skip */ }
          } else if (uri && (
            mime.startsWith('image/') ||
            /\.(jpg|jpeg|png|gif|webp|heic|heif)$/i.test(name || uri)
          )) {
            // Image share → LUCY Lens: extract visual memory, delete image immediately
            try {
              const { processImageToMemory } = await import('./src/processing/lucyLens');
              const result = await processImageToMemory(uri, name || null);
              if (result?.confidence === 'low') {
                // Low confidence means no remote AI — surface this to user
                parts.push(`[Image shared — ${result.memoryText}]`);
              }
              // High confidence: already enqueued inside processImageToMemory, skip parts
            } catch { /* non-critical */ }
          }
        }
        const sharedText = parts.join('\n').trim();
        if (!sharedText) {
          clearSharedPayloads();
          return;
        }
        const previous = recentShare.current;
        if (previous && previous.text === sharedText && Date.now() - previous.receivedAt < 10_000) {
          clearSharedPayloads();
          return;
        }
        recentShare.current = { text: sharedText, receivedAt: Date.now() };
        await enqueueTranscript(sharedText, Platform.OS === 'ios' ? 'ios' : 'android');
        clearSharedPayloads();
        setScreen('capture');
        setRefreshToken((value) => value + 1);
        void drainQueue();
      } finally {
        receivingShare.current = false;
      }
    })();
  }, [clearSharedPayloads, drainQueue, ready, sharedPayloads, resolvedSharedPayloads, isResolving]);

  useEffect(() => {
    if (!ready) {
      return;
    }
    const interval = setInterval(() => void drainQueue(), 30_000);
    // Record location + health every hour while the app is foregrounded —
    // but only when background location is NOT active (to avoid double-recording).
    // If the user granted "Always" permission, the background task handles hourly
    // location; this interval only handles health (steps/sleep) in that case.
    const lifeContextInterval = setInterval(() => void (async () => {
      try {
        const db = await getDatabase();
        const { isBackgroundLocationActive } = await import('./src/processing/backgroundLocation');
        const bgActive = await isBackgroundLocationActive();
        const { recordLifeContextSnapshot } = await import('./src/processing/recordLifeContext');
        if (bgActive) {
          // Background location is running — only update health, skip location
          const { recordCurrentHealthOnly } = await import('./src/processing/recordLifeContext');
          await recordCurrentHealthOnly(db);
        } else {
          await recordLifeContextSnapshot(db);
        }
      } catch { /* non-critical */ }
    })(), 60 * 60 * 1000); // 1 hour
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        void drainQueue();
        // Refresh notification badge count
        void (async () => {
          try { const db = await getDatabase(); setUnreadNotifCount(await getTotalUnreadCount(db)); } catch { /* non-critical */ }
        })();
        // Record location + health when app comes to foreground.
        // If background location is active, only update health (location is already covered).
        void (async () => {
          try {
            const db = await getDatabase();
            const { isBackgroundLocationActive } = await import('./src/processing/backgroundLocation');
            const bgActive = await isBackgroundLocationActive();
            if (bgActive) {
              const { recordCurrentHealthOnly } = await import('./src/processing/recordLifeContext');
              await recordCurrentHealthOnly(db);
            } else {
              const { recordLifeContextSnapshot } = await import('./src/processing/recordLifeContext');
              await recordLifeContextSnapshot(db);
            }
          } catch { /* non-critical */ }
        })();
        // Also check if a Brain Pulse is due (interval-guarded inside, cheap no-op if not)
        void (async () => {
          try {
            const db = await getDatabase();
            const { runBrainPulseIfDue } = await import('./src/processing/brainPulse');
            await runBrainPulseIfDue(db);
          } catch { /* non-critical */ }
        })();
      }
    });
    return () => {
      clearInterval(interval);
      clearInterval(lifeContextInterval);
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
              {/* Bell icon — opens in-app notification center */}
              <TouchableOpacity
                style={styles.bellBtn}
                onPress={() => setNotifCenterVisible(true)}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <Text style={[styles.bellIcon, unreadNotifCount > 0 && { color: LUCY_COLORS.primary }]}>◌</Text>
                {unreadNotifCount > 0 ? (
                  <View style={styles.bellBadge}>
                    <Text style={styles.bellBadgeText}>{unreadNotifCount > 9 ? '9+' : String(unreadNotifCount)}</Text>
                  </View>
                ) : null}
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.listenPill, meetingVisible && styles.listenPillActive]}
                onPress={() => setMeetingVisible(true)}
              >
                <View style={[styles.listenDot, meetingVisible && styles.listenDotActive]} />
                <Text style={[styles.listenText, meetingVisible && styles.listenTextActive]}>Meeting</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.listenPill, passiveState.status === 'listening' && styles.listenPillActive]} onPress={togglePassiveListening}>
                <View style={[styles.listenDot, passiveState.status === 'listening' && styles.listenDotActive]} />
                <Text style={[styles.listenText, passiveState.status === 'listening' && styles.listenTextActive]}>
                  {passiveState.status === 'listening'
                    ? (passiveState.noApiKey ? 'No key' : passiveState.mode === 'batch'
                        ? (passiveState.wordsHeard > 0
                            ? `${passiveState.wordsHeard}w · ${passiveState.secondsUntilNextBatch}s`
                            : `${passiveState.recordingSeconds}s / ${passiveState.secondsUntilNextBatch ?? 30}s`)
                        : `${passiveState.wordsHeard}w`)
                    : passiveState.status === 'starting' || passiveState.status === 'stopping'
                    ? '...'
                    : 'Listen'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
        {/* No-key warning banner — shows when Listen is active but transcription can't run */}
        {passiveState.status === 'listening' && passiveState.noApiKey ? (
          <View style={{ backgroundColor: 'rgba(245,158,11,0.12)', borderBottomWidth: 1, borderBottomColor: 'rgba(245,158,11,0.25)', paddingHorizontal: 16, paddingVertical: 7 }}>
            <Text style={{ color: '#F59E0B', fontSize: 12, fontWeight: '600', textAlign: 'center' }}>
              ⚠ Listen mode is recording but cannot transcribe — add an OpenAI key in Settings → Remote intelligence.
            </Text>
          </View>
        ) : null}
        <View style={styles.container}>
          {startupError ? <Text style={styles.error}>{startupError}</Text> : null}
          {/* Loading is handled by SplashAnimation overlay */}
          {/* Screens are always mounted once ready so their state (captures, etc.)
              survives tab switches — the Dashboard in particular must not remount from
              scratch on every navigation or it shows a blank Timeline until the async
              fetch completes, making newly-added captures appear to be missing. */}
          {ready ? (
            <>
              <View style={{ flex: 1, display: screen === 'capture' ? 'flex' : 'none' }}>
                <CaptureScreen
                  refreshToken={refreshToken}
                  passiveState={passiveState}
                  onToggleListen={togglePassiveListening}
                  backgroundEnabled={backgroundEnabled}
                  onBackgroundPress={showBackgroundChoice}
                  onMeeting={() => setMeetingVisible(true)}
                  onQueued={() => {
                    setRefreshToken((value) => value + 1);
                    void drainQueue();
                  }}
                />
              </View>
              <View style={{ flex: 1, display: screen === 'dashboard' ? 'flex' : 'none' }}>
                <DashboardScreen refreshToken={refreshToken} />
              </View>
              <View style={{ flex: 1, display: screen === 'ask' ? 'flex' : 'none' }}>
                <AskScreen />
              </View>
              <View style={{ flex: 1, display: screen === 'settings' ? 'flex' : 'none' }}>
                <SettingsScreen
                  refreshToken={refreshToken}
                  backgroundEnabled={backgroundEnabled}
                  onChangeBackground={setBackgroundPreference}
                  onReprocessAll={reprocessAllMemories}
                />
              </View>
            </>
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
      <NotificationCenter
        visible={notifCenterVisible}
        onClose={() => {
          setNotifCenterVisible(false);
          // Refresh badge after user reads/dismisses
          void getDatabase().then((db) => getTotalUnreadCount(db)).then(setUnreadNotifCount).catch(() => {});
        }}
      />
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
  bellBtn: { position: 'relative', width: 36, height: 36, justifyContent: 'center', alignItems: 'center' },
  bellIcon: { fontSize: 22, color: LUCY_COLORS.textMuted },
  bellBadge: { position: 'absolute', top: 2, right: 2, minWidth: 16, height: 16, borderRadius: 8, backgroundColor: LUCY_COLORS.primary, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 3, borderWidth: 1.5, borderColor: LUCY_COLORS.background },
  bellBadgeText: { color: '#fff', fontSize: 9, fontWeight: '800' },
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
