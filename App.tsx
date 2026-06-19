import { StatusBar } from 'expo-status-bar';
import * as Notifications from 'expo-notifications';
import * as SplashScreen from 'expo-splash-screen';
import { splashShownAt } from './src/splashTime';
import { useIncomingShare } from 'expo-sharing';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Animated, AppState, Linking, Modal, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { passiveListener, type PassiveListenerState } from './src/audio/PassiveListener';
import { SplashAnimation } from './src/components/SplashAnimation';
import { ErrorBoundary, installGlobalErrorLogger } from './src/components/ErrorBoundary';
import { MeetingMode } from './src/components/MeetingMode';
import { Onboarding } from './src/components/Onboarding';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
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
import { AnimatedFace } from './src/components/AnimatedFace';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { getTotalUnreadCount } from './src/db/notificationLog';
import { initializeVault } from './src/processing/vault';
import { archiveMisclassifiedArtifacts } from './src/processing/artifactCleanup';
import { organizeMemory } from './src/processing/organizer';
import { queueFullMemoryReprocessing } from './src/processing/reprocess';
import { CaptureScreen } from './src/screens/Capture';
import { DashboardScreen } from './src/screens/Dashboard';
import { SettingsScreen } from './src/screens/Settings';
import { LucyWrapped } from './src/components/LucyWrapped';
import { ConnectorsScreen } from './src/screens/Connectors';
import { NotificationDetailModal, type NotificationDetailPayload } from './src/screens/NotificationDetail';
import ConversationModal from './src/components/ConversationModal';
import { AlarmOverlay } from './src/components/AlarmOverlay';
import { ApprovalInbox } from './src/components/ApprovalInbox';
import { wakeWord, type WakeWordStatus } from './src/voice/wakeWord';
import { conversation, type ConvoState } from './src/voice/conversation';

// Capture non-React JS errors (async/timers/native callbacks) to dev_log from first load.
installGlobalErrorLogger();

export default function App() {
  const [screen, setScreen] = useState<'capture' | 'dashboard' | 'settings'>('dashboard');
  // Drives the Dashboard's internal view from the bottom nav (Home → Timeline, Brain → Brain, Ask Lucy).
  const [dashRequestedView, setDashRequestedView] = useState<'Timeline' | 'Brain' | 'Ask Lucy' | 'Focus Now' | 'Health'>('Timeline');
  const [dashRequestKey, setDashRequestKey] = useState(0);
  const [dashCurrentView, setDashCurrentView] = useState<string>('Timeline');
  const goToDashView = useCallback((v: 'Timeline' | 'Brain' | 'Ask Lucy', q?: string) => {
    setAskInitialQuestion(q);
    setDashRequestedView(v);
    setDashRequestKey((k) => k + 1);
    setScreen('dashboard');
  }, []);

  // The screen the user is on, for the context-aware voice button.
  // NOTE: this must be a STABLE function (deps []) that reads the latest screen via refs — the
  // conversation engine captures this reference once at start, so closing over screen/dashCurrentView
  // directly would freeze the context to whatever screen the conversation was opened on (which made
  // Lucy always claim "you're on Settings"). Refs keep it live across navigation.
  const screenRef = useRef(screen);
  const dashViewRef = useRef(dashCurrentView);
  screenRef.current = screen;
  dashViewRef.current = dashCurrentView;
  const currentVoiceContext = useCallback((): string => {
    const s = screenRef.current;
    if (s === 'capture') return 'tasks';
    if (s === 'settings') return 'settings';
    switch (dashViewRef.current) {
      case 'Brain': return 'workspace';
      case 'Ask Lucy': return 'ask';
      case 'Health': return 'health';
      case 'Focus Now': return 'tasks';
      default: return 'timeline';
    }
  }, []);

  // Where a voice command says to go next.
  const applyVoiceNav = useCallback((section: string) => {
    const s = (section || '').toLowerCase();
    if (['calendar', 'documents', 'resources', 'projects', 'brain', 'people', 'glossary', 'galaxy', 'money', 'health'].includes(s)) goToDashView('Brain');
    else if (s === 'ask') goToDashView('Ask Lucy');
    else if (s === 'tasks') setScreen('capture');
    else goToDashView('Timeline');
  }, [goToDashView]);
  const [refreshToken, setRefreshToken] = useState(0);
  const [ready, setReady] = useState(false);
  const [startupError, setStartupError] = useState('');
  const [backgroundEnabled, setBackgroundEnabled] = useState(false);
  const [notificationDetail, setNotificationDetail] = useState<NotificationDetailPayload | null>(null);
  const [approvalTrigger, setApprovalTrigger] = useState(0);
  const [snapBusy, setSnapBusy] = useState(false);
  const [updateReady, setUpdateReady] = useState(false);
  const [passiveState, setPassiveState] = useState<PassiveListenerState>(passiveListener.getState());
  const [meetingVisible, setMeetingVisible] = useState(false);
  const [meetingRecording, setMeetingRecording] = useState(false);
  const [notifCenterVisible, setNotifCenterVisible] = useState(false);
  const [wrappedVisible, setWrappedVisible] = useState(false);
  const [askInitialQuestion, setAskInitialQuestion] = useState<string | undefined>(undefined);
  const [unreadNotifCount, setUnreadNotifCount] = useState(0);
  const [onboardingVisible, setOnboardingVisible] = useState(false);
  const [showSplash, setShowSplash] = useState(true);
  const [shareToast, setShareToast] = useState<string | null>(null);
  const shareToastAnim = useRef(new Animated.Value(0)).current;
  const [voiceStatus, setVoiceStatus] = useState<'idle' | 'recording' | 'transcribing'>('idle');
  const [convoOpen, setConvoOpen] = useState(false);
  const [convoInitial, setConvoInitial] = useState<string | null>(null);
  const [convoState, setConvoState] = useState<ConvoState>(conversation.getState());
  useEffect(() => conversation.subscribe(() => setConvoState(conversation.getState())), []);
  const [wakeWordEnabled, setWakeWordEnabled] = useState(false);
  const [wakeStatus, setWakeStatus] = useState<WakeWordStatus>(wakeWord.status);
  useEffect(() => wakeWord.onStatusChange(setWakeStatus), []);
  const [processingActive, setProcessingActive] = useState(false);
  const voiceRecording = useRef(false);
  const voicePressStart = useRef(0);
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
    setProcessingActive(true);
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
      setProcessingActive(false);
    }
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const db = await getDatabase();
        // Hydrate the saved AI model preference into memory so extraction routes to the
        // user's chosen provider (Claude/OpenAI) — without this it defaults to OpenAI.
        await import('./src/ai/modelPreference').then(({ loadPreferredModel }) => loadPreferredModel(db)).catch(() => {});
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
        // Collapse any existing duplicate insight notifications (reworded copies of the same topic).
        try { const { dedupInsightNotifications } = await import('./src/db/notificationLog'); await dedupInsightNotifications(db); } catch { /* non-critical */ }
        // Remove duplicate calendar blocks (e.g. "Morning walk" ×N) + cancel their stale alarm bursts,
        // which were flooding the bell with repeated "still waiting" buzzes.
        try { const { dedupScheduledBlocks } = await import('./src/scheduling'); await dedupScheduledBlocks(db); } catch { /* non-critical */ }
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
        // Check if LUCY Wrapped is due (quarterly, ≥30 captures)
        void (async () => {
          try {
            const { isWrappedDue } = await import('./src/processing/lucyWrapped');
            if (await isWrappedDue(db)) setTimeout(() => setWrappedVisible(true), 2000);
          } catch { /* non-critical */ }
        })();
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
        let vaultSaved = 0; let vaultDup = 0;
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
            mime.startsWith('image/') || mime === 'application/pdf' ||
            /\.(jpg|jpeg|png|gif|webp|heic|heif|pdf)$/i.test(name || uri)
          )) {
            // Image/PDF share → save into the Documents vault (classified + deduped).
            try {
              const { saveImageToVault } = await import('./src/processing/documentVault');
              const r = await saveImageToVault(uri, name || null, null, true, null);
              if (r.duplicate) vaultDup += 1;
              else if (r.item) vaultSaved += 1;
            } catch { /* non-critical */ }
          }
        }
        // Documents shared into the vault don't become captures — confirm + go to Brain.
        if (vaultSaved > 0 || vaultDup > 0) {
          clearSharedPayloads();
          setScreen('dashboard');
          setRefreshToken((value) => value + 1);
          let msg = vaultSaved > 0 ? `Saved ${vaultSaved} to Documents` : '';
          if (vaultDup > 0) msg += `${msg ? ' · ' : ''}${vaultDup} already in vault`;
          setShareToast(msg || 'Added to Documents');
          shareToastAnim.setValue(0);
          Animated.sequence([
            Animated.timing(shareToastAnim, { toValue: 1, duration: 220, useNativeDriver: true }),
            Animated.delay(2400),
            Animated.timing(shareToastAnim, { toValue: 0, duration: 220, useNativeDriver: true }),
          ]).start(() => setShareToast(null));
          return;
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
        // A shared reel/short/article link → save as an Online Resource (Brain), not a normal capture.
        let toastMsg = '';
        const { isResourceShare, saveOnlineResource } = await import('./src/processing/onlineResource');
        if (isResourceShare(sharedText)) {
          try {
            const db = await getDatabase();
            const res = await saveOnlineResource(db, sharedText);
            toastMsg = res ? `Saved to Online Resources · ${res.topic}` : 'Link saved';
          } catch { toastMsg = 'Link saved'; }
        } else {
          await enqueueTranscript(sharedText, Platform.OS === 'ios' ? 'ios' : 'android');
        }
        clearSharedPayloads();
        // Navigate to Timeline so the user can see their capture appear
        setScreen('dashboard');
        setRefreshToken((value) => value + 1);
        void drainQueue();
        // Show a brief confirmation banner
        const label = payloads[0] ? ((payloads[0] as Record<string, unknown>).originalName as string | undefined) ?? null : null;
        if (!toastMsg) toastMsg = label ? `"${label}" captured` : 'Shared content captured';
        setShareToast(toastMsg);
        shareToastAnim.setValue(0);
        Animated.sequence([
          Animated.timing(shareToastAnim, { toValue: 1, duration: 220, useNativeDriver: true }),
          Animated.delay(2400),
          Animated.timing(shareToastAnim, { toValue: 0, duration: 300, useNativeDriver: true }),
        ]).start(() => setShareToast(null));
      } finally {
        receivingShare.current = false;
      }
    })();
  }, [clearSharedPayloads, drainQueue, ready, sharedPayloads, resolvedSharedPayloads, isResolving]);

  useEffect(() => {
    if (!ready) {
      return;
    }
    // Cold-start: reconcile any notifications that fired while the app was closed
    // into the in-app bell, then sync the badge (AppState 'active' may not fire on launch).
    void (async () => {
      try {
        const { reconcileDeliveredNotifications } = await import('./src/processing/notifications');
        await reconcileDeliveredNotifications();
        const db = await getDatabase();
        setUnreadNotifCount(await getTotalUnreadCount(db));
      } catch { /* non-critical */ }
    })();
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
    // Deep link: "Hey Siri → LUCY" (a Shortcut opens lucy://voice?text=... or lucy://capture?text=...).
    // Routes dictated text through the command brain so you can drive LUCY hands-free via Siri.
    const handleDeepLink = async (url: string | null) => {
      if (!url || url.indexOf('lucy://') !== 0) return;
      const mm = url.match(/^lucy:\/\/([^?]*)\??(.*)$/);
      const kind = (mm && mm[1] ? mm[1] : 'voice').replace(/\/+$/, '');
      const qs = (mm && mm[2]) || '';
      const tm = qs.match(/(?:^|&)text=([^&]*)/);
      const rawText = tm ? decodeURIComponent(tm[1].replace(/\+/g, ' ')) : '';
      // Strip leading "Lucy" / "Hey Lucy" / "Tell Lucy to" prefix so a Siri Shortcut can
      // pass the full dictated phrase (e.g. "Lucy buy milk and eggs") and the app cleans it.
      const text = rawText.replace(/^\s*(?:hey\s+)?(?:hi\s+)?(?:ok\s+)?(?:tell\s+)?(?:ask\s+)?lucy[,!:.]*\s*(?:to\s+)?/i, '').trim();
      if (!text) return;
      try {
        if (kind === 'capture') {
          await enqueueTranscript(text, Platform.OS === 'ios' ? 'ios' : 'android');
          setRefreshToken((v) => v + 1); void drainQueue();
        } else {
          const { runVoiceCommand } = await import('./src/voice/commandRouter');
          const r = await runVoiceCommand(text, undefined, 'siri');
          if (r?.speak) Alert.alert('LUCY', r.speak);
          if (r?.navigate) applyVoiceNav(r.navigate);
          setRefreshToken((v) => v + 1);
        }
      } catch { /* ignore malformed links */ }
    };
    const linkSub = Linking.addEventListener('url', (e) => { void handleDeepLink(e.url); });
    void Linking.getInitialURL().then(handleDeepLink).catch(() => {});

    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        void drainQueue();
        // Refresh the Dynamic Island countdown for the next event (foreground-only per iOS).
        void import('./src/audio/liveActivity').then(({ syncNextEventLiveActivity }) => syncNextEventLiveActivity()).catch(() => {});
        // Reconcile OS-delivered notifications into the in-app bell, then refresh badge.
        void (async () => {
          try {
            const { reconcileDeliveredNotifications } = await import('./src/processing/notifications');
            await reconcileDeliveredNotifications();
            const db = await getDatabase();
            setUnreadNotifCount(await getTotalUnreadCount(db));
          } catch { /* non-critical */ }
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
        // Auto listen digest: runs once after midnight if yesterday had ≥5 listen clips
        void (async () => {
          try {
            const h = new Date().getHours();
            if (h >= 0 && h < 6) { // midnight → 6 AM window
              const db = await getDatabase();
              const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
              const digestKey = `listen_digest_done_${yesterday}`;
              const { getSetting, setSetting } = await import('./src/db/settings');
              if (await getSetting(db, digestKey) !== 'true') {
                const { hasUnsummarizedListenCaptures, generateListenDigest } = await import('./src/processing/listenDigest');
                const count = await hasUnsummarizedListenCaptures(db, yesterday);
                if (count >= 5) {
                  await generateListenDigest(db, yesterday);
                  await setSetting(db, digestKey, 'true');
                }
              }
            }
          } catch { /* non-critical */ }
        })();
      }
    });
    return () => {
      clearInterval(interval);
      clearInterval(lifeContextInterval);
      subscription.remove();
      linkSub.remove();
    };
  }, [drainQueue, ready, applyVoiceNav]);

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
        'LUCY will use the Voice transcription engine selected in Settings. On-device mode keeps recognition local; OpenAI Whisper uploads each audio batch for transcription.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Start', onPress: () => void passiveListener.start() },
        ],
      );
    } else if (passiveState.status === 'listening') {
      void passiveListener.stop();
    }
  }, [passiveState.status]);

  // Auto OTA check on launch: silently fetch any new update; only surface a "Restart now" banner when
  // one is actually ready. No manual "check for updates" needed; nothing shown when up to date.
  useEffect(() => {
    void (async () => {
      try {
        const Updates = await import('expo-updates');
        if (!Updates.isEnabled || __DEV__) return;
        const res = await Updates.checkForUpdateAsync();
        if (res.isAvailable) { await Updates.fetchUpdateAsync(); setUpdateReady(true); }
      } catch { /* offline or no update — stay quiet */ }
    })();
  }, []);

  // Once the app is ready (past splash + not onboarding), surface the approval-cards inbox a beat
  // after Home renders, so pending review items greet the user when they open the app.
  useEffect(() => {
    if (!ready || showSplash || onboardingVisible || approvalTrigger > 0) return;
    const t = setTimeout(() => setApprovalTrigger(Date.now()), 1800);
    return () => clearTimeout(t);
  }, [ready, showSplash, onboardingVisible, approvalTrigger]);

  useEffect(() => {
    // Tapped a notification → open its detail AND ensure it's logged in the bell.
    const responseSub = Notifications.addNotificationResponseReceivedListener((response) => {
      const req = response.notification.request;
      const data = req.content.data as Record<string, unknown> | undefined;
      // Tapping any buzz of a persistent reminder/event silences the rest of its burst.
      // Tapping a notification silences any remaining alarm burst, then opens a detailed popup so
      // the user can read the FULL note and dismiss it. Rich kinds (guardian/digest/…) get their
      // tailored explanation; anything else (incl. reminder/calendar alarms) shows its title+body.
      const content = req.content;
      void import('./src/processing/persistentReminders')
        .then(({ acknowledgeNagFromResponse }) => acknowledgeNagFromResponse(data))
        .catch(() => {});
      void import('./src/processing/notifications')
        .then(({ logDeliveredNotification }) => logDeliveredNotification(req))
        .then(() => getDatabase())
        .then((db) => getTotalUnreadCount(db))
        .then(setUnreadNotifCount)
        .catch(() => {});
      // Tapping a meal nudge jumps straight to the camera (the friction-free logging action).
      if (data?.kind === 'meal-nudge') { void quickSnap(); return; }
      const RICH_KINDS = new Set(['guardian', 'digest', 'open-loop', 'captured-reminder', 'pre-meeting', 'post-meeting', 'on-this-day', 'morning-brief', 'weekly-insight']);
      if (data?.kind && typeof data.kind === 'string' && RICH_KINDS.has(data.kind)) {
        setNotificationDetail(data as unknown as NotificationDetailPayload);
      } else {
        setNotificationDetail({ kind: 'raw', title: content.title ?? undefined, body: content.body ?? undefined });
      }
    });
    // Notification fired while app is foregrounded → log it + raise the in-app alarm if it's a nag.
    const receivedSub = Notifications.addNotificationReceivedListener((notification) => {
      const content = notification.request.content;
      const data = content.data as Record<string, unknown> | undefined;
      void import('./src/audio/alarmManager')
        .then(({ ringFromNotificationData }) => ringFromNotificationData(data, content.title ?? '', content.body ?? ''))
        .catch(() => {});
      void import('./src/processing/notifications')
        .then(({ logDeliveredNotification }) => logDeliveredNotification(notification.request))
        .then(() => getDatabase())
        .then((db) => getTotalUnreadCount(db))
        .then(setUnreadNotifCount)
        .catch(() => {});
    });
    return () => { responseSub.remove(); receivedSub.remove(); };
  }, []);

  // Hold-to-talk uses the SAME proven engine as Meeting mode (PassiveListener):
  // it records from press, stops on release, and transcribes the whole utterance —
  // a meeting with no title. We drive voiceStatus manually around the calls.
  const finishVoiceCapture = useCallback(async () => {
    setVoiceStatus('transcribing');
    try {
      // stop() transcribes the final clip; grab the accumulated transcript AFTER.
      await passiveListener.stop();
      const text = passiveListener.getAccumulatedTranscript().trim();
      passiveListener.clearTranscript();
      if (text) {
        // Context-aware single mic: route the utterance through LUCY's command brain, biased by the
        // screen you're on. It schedules / captures / adds / navigates — whatever you asked for.
        try {
          const ctx = currentVoiceContext();
          const { runVoiceCommand } = await import('./src/voice/commandRouter');
          const r = await runVoiceCommand(text, undefined, ctx);
          if (r?.speak) Alert.alert('LUCY', r.speak);
          if (r?.navigate) applyVoiceNav(r.navigate);
          setRefreshToken((v) => v + 1);
          void drainQueue();
        } catch {
          // Fall back to plain capture if the command brain is unavailable.
          await enqueueTranscript(text, 'voice', false);
          setRefreshToken((v) => v + 1);
          void drainQueue();
        }
      } else {
        Alert.alert('Nothing captured', 'I didn\'t catch any speech — hold the mic and speak for a couple of seconds, then release.');
      }
    } catch { /* non-critical */ } finally {
      setVoiceStatus('idle');
    }
  }, [drainQueue, currentVoiceContext, applyVoiceNav]);

  const onVoicePressIn = useCallback(() => {
    if (voiceRecording.current) {
      // Already recording (started by a previous tap) → this tap stops it.
      voiceRecording.current = false;
      void finishVoiceCapture();
      return;
    }
    voiceRecording.current = true;
    voicePressStart.current = Date.now();
    setVoiceStatus('recording');
    void passiveListener.start({ quickCapture: true }).then(() => {
      // If the session didn't actually start (mic denied), reset.
      if (passiveListener.getState().status === 'off') { voiceRecording.current = false; setVoiceStatus('idle'); }
    });
  }, [finishVoiceCapture]);

  const onVoicePressOut = useCallback(() => {
    if (!voiceRecording.current) return;
    const held = Date.now() - voicePressStart.current;
    if (held >= 500) {
      // Press-and-hold → release stops and saves.
      voiceRecording.current = false;
      void finishVoiceCapture();
    }
    // Quick tap (<500ms) → stay in recording; the next tap will stop it.
  }, [finishVoiceCapture]);

  // "Hey Lucy" wake word → open the conversation loop (hands-free). Trailing words spoken in the
  // same breath (e.g. "Hey Lucy add milk to my list") are passed as initialText so the command
  // is processed immediately without waiting for another utterance.
  const onWake = useCallback((trailing: string | null) => {
    setConvoInitial(trailing || null);
    setConvoOpen(true);
  }, []);

  // Live guided tour: Lucy walks through the app out loud while the user tries each feature. The
  // conversation card is non-blocking, so they can navigate as she explains. `offer` shows a prompt
  // first (used on first install); pass false to start immediately (e.g. a "Replay tour" button).
  const startGuidedTour = useCallback((offer: boolean) => {
    const begin = (): void => {
      setConvoInitial(
        'Give me a guided tour of the app. Walk me through the main features one at a time, tell me ' +
        'exactly which tab or tile to tap next, and wait for me to say "next" before moving on. ' +
        'Start with a warm one-line welcome, then the first step.',
      );
      setConvoOpen(true);
    };
    if (!offer) { begin(); return; }
    Alert.alert(
      'Take a tour with Lucy?',
      'Lucy can walk you through the app out loud — you try each feature live as she explains. You can stop anytime.',
      [
        { text: 'Maybe later', style: 'cancel' },
        { text: 'Start tour', onPress: begin },
      ],
    );
  }, []);

  // Persist + apply the wake-word toggle (also called from Settings).
  const setWakeWordPreference = useCallback(async (on: boolean) => {
    setWakeWordEnabled(on);
    try { const db = await getDatabase(); await setSetting(db, 'wake_word_enabled', on ? '1' : '0'); } catch { /* non-critical */ }
  }, []);

  // Load the saved wake-word preference once the app is ready.
  useEffect(() => {
    if (!ready) return;
    void (async () => {
      try { const db = await getDatabase(); setWakeWordEnabled((await getSetting(db, 'wake_word_enabled')) === '1'); } catch { /* default off */ }
    })();
  }, [ready]);

  // Run the wake-word listener while enabled + foreground; stop it otherwise (battery/iOS suspends
  // recognition in the background anyway). It yields the mic to Listen mode / conversations on its own.
  useEffect(() => {
    if (!ready || !wakeWordEnabled) { wakeWord.disable(); return undefined; }
    void wakeWord.enable(onWake);
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') void wakeWord.enable(onWake);
      else wakeWord.disable();
    });
    return () => { sub.remove(); wakeWord.disable(); };
  }, [ready, wakeWordEnabled, onWake]);

  // When LUCY applies task reorganizations from the Ask chat, refresh the Tasks board.
  useEffect(() => {
    let cancelled = false;
    void import('./src/processing/lucyActions').then(({ setActionsAppliedListener }) => {
      if (cancelled) return;
      setActionsAppliedListener(() => setRefreshToken((v) => v + 1));
    });
    return () => { cancelled = true; void import('./src/processing/lucyActions').then(({ setActionsAppliedListener }) => setActionsAppliedListener(null)); };
  }, []);

  // Listen mode is "active" only for real Listen sessions — a quickCapture
  // (hold-to-talk) session also reports status 'listening' but must NOT light
  // up the Listen pill or trigger the no-key banner.
  const listenActive = passiveState.status === 'listening' && !passiveState.quickCapture;

  // One-tap photo capture from Home (camera FAB): just take the pic — LUCY classifies it herself
  // (meal → calories, receipt → expense, note → memory). No menu. Respects the selected-model key.
  const quickSnap = useCallback(async () => {
    try {
      const { getModelKeyStatus, modelKeyMissingMessage } = await import('./src/ai/provider');
      const status = await getModelKeyStatus();
      if (status.remote && !status.keyPresent) { Alert.alert('Add your API key', modelKeyMissingMessage(status)); return; }
    } catch { /* allow through */ }
    const { pickImage } = await import('./src/processing/imageCapture');
    const uri = await pickImage('Snap it', 'Meal, receipt, or a note — I’ll figure out what it is.');
    if (!uri) return;
    setSnapBusy(true);
    try {
      const db = await getDatabase();
      const { smartCapturePhoto } = await import('./src/processing/smartPhotoCapture');
      const r = await smartCapturePhoto(db, uri);
      goToDashView('Timeline');
      // For meals, nudge completeness if the day's logs are still sparse (0/1/2 → likely incomplete).
      let extra = '';
      if (r.type === 'meal') {
        try {
          const { listFoodLog } = await import('./src/db/healthNutrition');
          const distinct = new Set((await listFoodLog(db)).map((f) => f.meal_type ?? f.name)).size;
          if (distinct < 3) extra = ' Did you miss any other meals or snacks today? Tap the camera to add them.';
        } catch { /* optional */ }
      }
      Alert.alert(r.type === 'meal' ? 'Meal logged ✓' : r.type === 'receipt' ? 'Receipt logged ✓' : 'Saved ✓', r.message + extra);
    } catch { Alert.alert('Could not read that', 'Please try again with a clearer photo.'); } finally { setSnapBusy(false); }
  }, [goToDashView]);

  // LUCY's animated face + live "Hey Lucy" status pill. Rendered fresh per call (a function, not a
  // shared element, since both the header and the always-mounted dashboard may render it). It's placed
  // either in the global header (non-dashboard screens) or inside the Home hero card (dashboard) — so
  // on Home it sits in the greeting card and the Meeting/Listen pills stay clear.
  const renderLucyFace = () => (
    <View style={styles.faceRow}>
      {wakeWordEnabled && wakeStatus !== 'disabled' ? (
        <View style={styles.wakePill}>
          <View style={[styles.wakeDot, {
            backgroundColor: wakeStatus === 'listening' ? '#4ADE80'
              : wakeStatus === 'unavailable' ? '#EF4444'
              : '#F59E0B',
          }]} />
          <Text style={styles.wakePillText}>
            {wakeStatus === 'listening' ? 'Listening'
              : wakeStatus === 'unavailable' ? 'Unavailable'
              : 'Starting…'}
          </Text>
        </View>
      ) : null}
      <AnimatedFace
        unreadCount={0}
        celebrateKey={refreshToken}
        status={
          voiceStatus === 'transcribing' ? 'saving'
          : (meetingVisible || meetingRecording) ? 'reading'
          : (voiceStatus === 'recording' || passiveState.status === 'listening') ? 'listening'
          : convoOpen && convoState === 'speaking' ? 'speaking'
          : convoOpen && convoState === 'listening' ? 'listening'
          : convoOpen && convoState === 'thinking' ? 'thinking'
          : processingActive ? 'organizing'
          : (screen === 'dashboard' && dashCurrentView === 'Ask Lucy') ? 'thinking'
          : 'idle'
        }
        onPress={() => { void import('./src/config/haptics').then(({ haptic }) => haptic.tab()).catch(() => {}); setConvoOpen(true); }}
      />
    </View>
  );

  return (
   <ErrorBoundary>
    <GestureHandlerRootView style={{ flex: 1 }}>
    <SafeAreaProvider>
      <SafeAreaView style={styles.safe}>
        <StatusBar style="light" />
        {/* Unified header shown on all screens — consistent controls everywhere */}
        <View style={styles.brand}>
          <View style={styles.brandRow}>
            {/* Logo with star above the Y */}
            <View style={styles.logoWrap}>
              <Text style={styles.brandName}>LUC<Text style={styles.brandNameAccent}>Y</Text></Text>
              <Text style={styles.logoStar}>✦</Text>
            </View>
            <View style={styles.headerActions}>
              {/* Meeting + Listen pills on top */}
              <View style={styles.headerPillRow}>
                <TouchableOpacity
                  style={[styles.listenPill, (meetingVisible || meetingRecording) && styles.listenPillActive]}
                  onPress={() => setMeetingVisible(true)}
                >
                  <MaterialCommunityIcons
                    name={meetingRecording ? 'record-circle' : 'microphone'}
                    size={13}
                    color={(meetingVisible || meetingRecording) ? LUCY_COLORS.primary : LUCY_COLORS.textMuted}
                  />
                  <Text style={[styles.listenText, (meetingVisible || meetingRecording) && styles.listenTextActive]}>
                    {meetingRecording ? '● Rec' : 'Meeting'}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.listenPill, listenActive && styles.listenPillActive]} onPress={togglePassiveListening}>
                  <MaterialCommunityIcons name="ear-hearing" size={13} color={listenActive ? LUCY_COLORS.primary : LUCY_COLORS.textMuted} />
                  <Text style={[styles.listenText, listenActive && styles.listenTextActive]}>
                    {listenActive
                      ? (passiveState.noApiKey ? 'No key' : passiveState.mode === 'batch'
                          ? (passiveState.wordsHeard > 0
                              ? `${passiveState.wordsHeard}w · ${passiveState.secondsUntilNextBatch}s`
                              : passiveState.secondsUntilNextBatch === 0
                                ? '⟳'
                                : `${passiveState.recordingSeconds}s / ${passiveState.secondsUntilNextBatch}s`)
                          : `${passiveState.wordsHeard}w`)
                      : passiveState.status === 'starting' || passiveState.status === 'stopping'
                      ? '...'
                      : 'Listen'}
                  </Text>
                </TouchableOpacity>
              </View>
              {/* The face is a single global overlay (see styles.globalFace) pinned below the header,
                  so it stays in the same fixed spot on every screen and the pills stay clear. */}
            </View>
          </View>
          {/* Notifications + insights live behind this bell, pinned top-right. Tapping Lucy's face
              opens the conversation instead; the two entry points are now distinct. */}
          <TouchableOpacity
            style={styles.bellBtn}
            activeOpacity={0.7}
            onPress={() => { void import('./src/config/haptics').then(({ haptic }) => haptic.tab()).catch(() => {}); setNotifCenterVisible(true); }}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            accessibilityLabel={unreadNotifCount > 0 ? `Notifications, ${unreadNotifCount} unread` : 'Notifications'}
          >
            <Ionicons
              name={unreadNotifCount > 0 ? 'notifications' : 'notifications-outline'}
              size={22}
              color={unreadNotifCount > 0 ? LUCY_COLORS.primary : LUCY_COLORS.textMuted}
            />
            {unreadNotifCount > 0 ? (
              <View style={styles.bellBadge}>
                <Text style={styles.bellBadgeText}>{unreadNotifCount > 9 ? '9+' : String(unreadNotifCount)}</Text>
              </View>
            ) : null}
          </TouchableOpacity>
        </View>
        {/* No-key warning banner — shows when Listen is active but transcription can't run */}
        {listenActive && passiveState.noApiKey ? (
          <View style={{ backgroundColor: 'rgba(245,158,11,0.12)', borderBottomWidth: 1, borderBottomColor: 'rgba(245,158,11,0.25)', paddingHorizontal: 16, paddingVertical: 7 }}>
            <Text style={{ color: '#F59E0B', fontSize: 12, fontWeight: '600', textAlign: 'center' }}>
              ⚠ Listen mode is recording but cannot transcribe — add an OpenAI key in Settings → Remote intelligence.
            </Text>
          </View>
        ) : null}
        {shareToast ? (
          <Animated.View style={{ opacity: shareToastAnim, transform: [{ translateY: shareToastAnim.interpolate({ inputRange: [0, 1], outputRange: [-12, 0] }) }], backgroundColor: 'rgba(110,231,183,0.14)', borderBottomWidth: 1, borderBottomColor: 'rgba(110,231,183,0.3)', paddingHorizontal: 16, paddingVertical: 8 }}>
            <Text style={{ color: '#6EE7B7', fontSize: 12, fontWeight: '700', textAlign: 'center' }}>
              ✓ {shareToast} — organizing…
            </Text>
          </Animated.View>
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
                <DashboardScreen
                  refreshToken={refreshToken}
                  onAskAbout={(q) => goToDashView('Ask Lucy', q)}
                  requestedView={dashRequestedView}
                  requestKey={dashRequestKey}
                  onViewChange={setDashCurrentView}
                  initialAskQuestion={askInitialQuestion}
                />
              </View>
              <View style={{ flex: 1, display: screen === 'settings' ? 'flex' : 'none' }}>
                <SettingsScreen
                  refreshToken={refreshToken}
                  backgroundEnabled={backgroundEnabled}
                  onChangeBackground={setBackgroundPreference}
                  onReprocessAll={reprocessAllMemories}
                  onOpenWrapped={() => setWrappedVisible(true)}
                  wakeWordEnabled={wakeWordEnabled}
                  onChangeWakeWord={setWakeWordPreference}
                  onStartTour={() => { setScreen('dashboard'); startGuidedTour(false); }}
                />
              </View>
            </>
          ) : null}
        </View>
        <View style={styles.bottomNav}>
          {/* Home */}
          <TouchableOpacity
            style={styles.bottomTab}
            onPress={() => { void import('./src/config/haptics').then(({ haptic }) => haptic.tab()).catch(() => {}); goToDashView('Timeline'); }}
          >
            {(() => { const a = screen === 'dashboard' && dashCurrentView !== 'Brain'; return (<>
            <View style={[styles.tabActivePill, a && styles.tabActivePillVisible]} />
            <Ionicons name={a ? 'home' : 'home-outline'} size={22} color={a ? LUCY_COLORS.primary : LUCY_COLORS.textSubtle} />
            <Text style={[styles.bottomTabLabel, a && styles.bottomTabLabelActive]}>Home</Text></>); })()}
          </TouchableOpacity>
          {/* Workspace (Calendar · Documents · Resources · memory views) */}
          <TouchableOpacity
            style={styles.bottomTab}
            onPress={() => { void import('./src/config/haptics').then(({ haptic }) => haptic.tab()).catch(() => {}); goToDashView('Brain'); }}
          >
            {(() => { const a = screen === 'dashboard' && dashCurrentView === 'Brain'; return (<>
            <View style={[styles.tabActivePill, a && styles.tabActivePillVisible]} />
            <MaterialCommunityIcons name={a ? 'view-grid' : 'view-grid-outline'} size={22} color={a ? LUCY_COLORS.primary : LUCY_COLORS.textSubtle} />
            <Text style={[styles.bottomTabLabel, a && styles.bottomTabLabelActive]}>Workspace</Text></>); })()}
          </TouchableOpacity>

          {/* Center voice button \u2014 hold to talk, or tap to start / tap again to stop */}
          <View style={styles.voiceTabSlot}>
            <TouchableOpacity
              activeOpacity={0.85}
              onPressIn={onVoicePressIn}
              onPressOut={onVoicePressOut}
              style={[
                styles.voiceButton,
                voiceStatus === 'recording' && styles.voiceButtonRecording,
                voiceStatus === 'transcribing' && styles.voiceButtonBusy,
              ]}
            >
              {voiceStatus === 'recording' ? (
                <Ionicons name="stop" size={24} color="#fff" />
              ) : voiceStatus === 'transcribing' ? (
                <Ionicons name="ellipsis-horizontal" size={24} color="#fff" />
              ) : (
                <Ionicons name="mic" size={26} color="#fff" />
              )}
            </TouchableOpacity>
            <Text style={styles.voiceButtonLabel}>
              {voiceStatus === 'recording' ? 'Tap / release' : voiceStatus === 'transcribing' ? 'Saving\u2026' : 'Hold to talk'}
            </Text>
          </View>

          {/* Tasks */}
          <TouchableOpacity
            style={styles.bottomTab}
            onPress={() => { if (screen !== 'capture') { void import('./src/config/haptics').then(({ haptic }) => haptic.tab()).catch(() => {}); setScreen('capture'); } }}
          >
            {(() => { const a = screen === 'capture'; return (<>
            <View style={[styles.tabActivePill, a && styles.tabActivePillVisible]} />
            <Ionicons name={a ? 'checkbox' : 'checkbox-outline'} size={21} color={a ? LUCY_COLORS.primary : LUCY_COLORS.textSubtle} />
            <Text style={[styles.bottomTabLabel, a && styles.bottomTabLabelActive]}>Tasks</Text></>); })()}
          </TouchableOpacity>
          {/* Settings */}
          <TouchableOpacity
            style={styles.bottomTab}
            onPress={() => { if (screen !== 'settings') { void import('./src/config/haptics').then(({ haptic }) => haptic.tab()).catch(() => {}); setScreen('settings'); } }}
          >
            {(() => { const a = screen === 'settings'; return (<>
            <View style={[styles.tabActivePill, a && styles.tabActivePillVisible]} />
            <Ionicons name={a ? 'settings' : 'settings-outline'} size={21} color={a ? LUCY_COLORS.primary : LUCY_COLORS.textSubtle} />
            <Text style={[styles.bottomTabLabel, a && styles.bottomTabLabelActive]}>Settings</Text></>); })()}
          </TouchableOpacity>
        </View>
        {/* The conversation entry point now lives on Lucy's face itself (tap the face to talk).
            The old floating chat FAB was removed — face = talk to Lucy, bell = notifications. */}
        {/* LUCY's animated face — a single global overlay pinned just below the header so it sits in
            the same fixed spot on every screen (over the Home greeting card on the dashboard). */}
        <View style={styles.globalFace} pointerEvents="box-none">
          {renderLucyFace()}
        </View>
        {/* Auto-update banner — only when a new bundle is fetched and ready to apply. */}
        {updateReady ? (
          <TouchableOpacity style={styles.updateBanner} activeOpacity={0.9} onPress={() => { void import('expo-updates').then((U) => U.reloadAsync()).catch(() => {}); }}>
            <Ionicons name="sparkles" size={15} color="#0B0B0F" />
            <Text style={styles.updateBannerText}>Update ready — tap to restart</Text>
          </TouchableOpacity>
        ) : null}
        {/* Camera FAB (bottom-right, where the old chat bubble was) — one-tap meal/note photo. */}
        {screen === 'dashboard' ? (
          <TouchableOpacity style={styles.cameraFab} activeOpacity={0.85} onPress={quickSnap} accessibilityLabel="Snap a photo">
            <Ionicons name="camera" size={24} color="#fff" />
          </TouchableOpacity>
        ) : null}
      </SafeAreaView>
      <Modal visible={snapBusy} transparent animationType="fade" onRequestClose={() => {}}>
        <View style={styles.snapBusyOverlay}>
          <View style={styles.snapBusyCard}>
            <ActivityIndicator size="large" color={LUCY_COLORS.primary} />
            <Text style={styles.snapBusyText}>Reading your photo…</Text>
          </View>
        </View>
      </Modal>
      <NotificationDetailModal
        payload={notificationDetail}
        onDismiss={() => setNotificationDetail(null)}
      />
      <SplashAnimation fadeAnim={splashFade} visible={showSplash} />
      <MeetingMode
        visible={meetingVisible}
        onClose={() => setMeetingVisible(false)}
        onRecordingStarted={() => { setMeetingRecording(true); setMeetingVisible(false); }}
        onSummaryReady={() => setMeetingVisible(true)}
        onDone={() => { setMeetingRecording(false); setMeetingVisible(false); }}
      />
      <LucyWrapped visible={wrappedVisible} onClose={() => setWrappedVisible(false)} />
      <AlarmOverlay />
      <ApprovalInbox trigger={approvalTrigger} />
      <NotificationCenter
        visible={notifCenterVisible}
        onCountChange={setUnreadNotifCount}
        onClose={() => {
          setNotifCenterVisible(false);
          // Refresh badge after user reads/dismisses
          void getDatabase().then((db) => getTotalUnreadCount(db)).then(setUnreadNotifCount).catch(() => {});
        }}
      />
      <ConversationModal
        visible={convoOpen}
        context={currentVoiceContext()}
        getContext={currentVoiceContext}
        onNavigate={applyVoiceNav}
        onClose={() => { setConvoOpen(false); setConvoInitial(null); }}
        initialText={convoInitial ?? undefined}
      />
      <Onboarding visible={onboardingVisible} onComplete={async (startTour) => {
        setOnboardingVisible(false);
        const db = await getDatabase();
        await setSetting(db, 'onboarding_complete', 'true');
        // Seed demo captures so the board isn't empty on first open
        try {
          const { seedDemoDataIfNeeded } = await import('./src/processing/seedDemoData');
          const seeded = await seedDemoDataIfNeeded(db);
          if (seeded) {
            setRefreshToken((v) => v + 1);
            void drainQueue();
          }
        } catch { /* non-critical */ }
        // The last onboarding screen lets the user choose; start the live tour only if they opted in.
        // Otherwise it's always available later from Settings → "Guided tour with Lucy".
        if (startTour) startGuidedTour(false);
      }} />
    </SafeAreaProvider>
    </GestureHandlerRootView>
   </ErrorBoundary>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: LUCY_COLORS.background },
  brand: { paddingHorizontal: 18, paddingTop: 10, paddingBottom: 8, borderBottomWidth: 1, borderBottomColor: LUCY_COLORS.borderSoft, zIndex: 5 },
  brandRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 42, position: 'relative' },
  logoWrap: { position: 'relative', alignSelf: 'flex-start', marginTop: 8, paddingLeft: 2 },
  logoStar: { position: 'absolute', top: -8, right: -14, color: LUCY_COLORS.primary, fontSize: 14, fontWeight: '800', textShadowColor: 'rgba(255,139,61,0.7)', textShadowRadius: 12, textShadowOffset: { width: 0, height: 0 } },
  headerPillRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingRight: 48 },
  globalFace: { position: 'absolute', right: 16, top: 118, zIndex: 30, elevation: 30, alignItems: 'flex-end' },
  cameraFab: { position: 'absolute', right: 18, bottom: 104, width: 52, height: 52, borderRadius: 26, backgroundColor: LUCY_COLORS.primary, alignItems: 'center', justifyContent: 'center', zIndex: 40, elevation: 8, shadowColor: '#000', shadowOpacity: 0.35, shadowRadius: 8, shadowOffset: { width: 0, height: 3 } },
  updateBanner: { position: 'absolute', left: 16, right: 16, bottom: 92, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, backgroundColor: LUCY_COLORS.primaryGlow, borderRadius: 14, paddingVertical: 11, zIndex: 45, elevation: 9, shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 8, shadowOffset: { width: 0, height: 3 } },
  updateBannerText: { color: '#0B0B0F', fontWeight: '800', fontSize: 13.5 },
  snapBusyOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center' },
  snapBusyCard: { backgroundColor: LUCY_COLORS.surface, borderRadius: 18, padding: 26, alignItems: 'center', gap: 12, borderWidth: 1, borderColor: LUCY_COLORS.border },
  snapBusyText: { color: LUCY_COLORS.textDark, fontSize: 15, fontWeight: '600' },
  faceRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  wakePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 2,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 9,
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  wakeDot: { width: 6, height: 6, borderRadius: 3 },
  wakePillText: { color: '#E5E7EB', fontSize: 9, fontWeight: '600', letterSpacing: 0.2 },
  brandLogo: { height: 32, width: 160 },
  brandName: { color: LUCY_COLORS.textDark, fontSize: 25, fontWeight: '900', letterSpacing: 1.2 },
  brandNameAccent: { color: LUCY_COLORS.primary },
  headerActions: { flexDirection: 'row', alignItems: 'center' },
  meetingPill: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 18, backgroundColor: 'rgba(239,68,68,0.1)', borderWidth: 1, borderColor: 'rgba(239,68,68,0.3)', flexDirection: 'row', alignItems: 'center', gap: 5 },
  // Notifications bell — pinned to the top-right of the header, sitting in the reserved gap
  // (headerPillRow has paddingRight: 48) so it never overlaps the Meeting/Listen pills.
  bellBtn: { position: 'absolute', top: 8, right: 0, width: 44, height: 44, borderRadius: 22, justifyContent: 'center', alignItems: 'center' },
  bellBadge: { position: 'absolute', top: 6, right: 4, minWidth: 16, height: 16, borderRadius: 8, backgroundColor: LUCY_COLORS.primary, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 3, borderWidth: 1.5, borderColor: LUCY_COLORS.background },
  bellBadgeText: { color: LUCY_COLORS.white, fontSize: 9, fontWeight: '800' },
  listenPill: { minHeight: 34, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 17, backgroundColor: LUCY_COLORS.surfaceRaised, borderWidth: 1, borderColor: LUCY_COLORS.border, flexDirection: 'row', alignItems: 'center', gap: 6 },
  listenPillActive: { backgroundColor: LUCY_COLORS.primaryMist, borderColor: LUCY_COLORS.primaryLine },
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
  container: { flex: 1, paddingHorizontal: 16, paddingTop: 0 },
  bottomNav: {
    flexDirection: 'row',
    backgroundColor: LUCY_COLORS.surfaceSheet,
    borderTopWidth: 1,
    borderTopColor: LUCY_COLORS.borderSoft,
    paddingTop: 4,
    paddingBottom: 6,
    paddingHorizontal: 4,
  },
  bottomTab: { flex: 1, alignItems: 'center', paddingVertical: 9, gap: 3, position: 'relative', borderRadius: 16 },
  voiceTabSlot: { flex: 1, alignItems: 'center', justifyContent: 'flex-start' },
  voiceButton: {
    width: 60, height: 60, borderRadius: 30, backgroundColor: LUCY_COLORS.primary,
    alignItems: 'center', justifyContent: 'center', marginTop: -22,
    shadowColor: LUCY_COLORS.primary, shadowOffset: { width: 0, height: 5 }, shadowOpacity: 0.42, shadowRadius: 14, elevation: 8,
    borderWidth: 4, borderColor: LUCY_COLORS.surfaceSheet,
  },
  voiceButtonRecording: { backgroundColor: '#ef4444', shadowColor: '#ef4444' },
  voiceButtonBusy: { backgroundColor: LUCY_COLORS.primaryGlow },
  voiceButtonIcon: { color: '#fff', fontSize: 22, fontWeight: '800' },
  voiceStopSquare: { width: 16, height: 16, borderRadius: 3, backgroundColor: '#fff' },
  micHead: { width: 11, height: 16, borderRadius: 5.5, backgroundColor: '#fff' },
  micCradle: { width: 17, height: 9, borderBottomLeftRadius: 9, borderBottomRightRadius: 9, borderColor: '#fff', borderWidth: 2, borderTopWidth: 0, marginTop: -5 },
  micStem: { width: 2, height: 3, backgroundColor: '#fff', marginTop: 1 },
  voiceButtonLabel: { fontSize: 10, fontWeight: '700', color: LUCY_COLORS.textSubtle, marginTop: 2 },
  tabActivePill: { position: 'absolute', top: 0, width: 30, height: 3, borderRadius: 2, backgroundColor: 'transparent' },
  tabActivePillVisible: { backgroundColor: LUCY_COLORS.primary },
  bottomTabIcon: { fontSize: 20, color: LUCY_COLORS.textSubtle },
  bottomTabIconActive: { color: LUCY_COLORS.primary },
  bottomTabLabel: { fontSize: 11, fontWeight: '600', color: LUCY_COLORS.textSubtle },
  bottomTabLabelActive: { color: LUCY_COLORS.primary, fontWeight: '700' },
  loading: { color: LUCY_COLORS.textMuted, textAlign: 'center', marginTop: 50 },
  error: { color: '#FDA4AF', backgroundColor: '#3B1722', borderRadius: 12, padding: 15 },
});
