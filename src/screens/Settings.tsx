import { useEffect, useRef, useState, type ReactNode } from 'react';
import { DevLogViewer } from '../components/DevLogViewer';
import { shareAsync } from 'expo-sharing';
import * as Clipboard from 'expo-clipboard';
import { Alert, Animated, Linking, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { clearDownloadedDeviceModels, getDeviceModelState, prepareDeviceModel, selectDeviceModel, subscribeToDeviceModel, type DeviceModelState } from '../ai/device';
import { localModelOptions, type LocalModelId } from '../ai/modelCatalog';
import { getRemoteAccessState, removeRemoteOpenAIKey, setRemoteEnabled, storeRemoteOpenAIKey, type RemoteAccessState } from '../ai/remoteAccess';
import { config } from '../config';
import { LUCY_COLORS } from '../config/colors';
import { THEME_KEYS, THEME_META, THEME_SETTING_KEY, type ThemeKey } from '../config/themes';
import { getDatabase } from '../db';
import { getCaptureQueueSummary, type CaptureQueueSummary } from '../db/captures';
import { getLatestOrganizationRun, type OrganizationRunRow } from '../db/knowledge';
import { getSetting, setSetting } from '../db/settings';
import { getBackgroundProcessingState, type BackgroundProcessingState } from '../processing/background';
import { wakeWord, type WakeWordStatus } from '../voice/wakeWord';
import { listVoices, setVoice, getSelectedVoiceId, loadVoicePrefs, speak, type TtsVoice } from '../voice/tts';
import { runEnglishDeviceBenchmark, type BenchmarkResult } from '../processing/benchmark';
import { organizeMemory } from '../processing/organizer';
import { CheckInScheduler } from '../components/CheckInScheduler';
import { DayShaper } from '../components/DayShaper';
import { ScheduledRemindersManager } from '../components/ScheduledRemindersManager';
import { LearnedProfilePanel } from '../components/LearnedProfilePanel';
import { LaptopAccessPanel } from '../components/LaptopAccessPanel';
import { getUserProfile, saveUserProfile, type UserProfile } from '../db/userProfile';

interface SettingsScreenProps {
  backgroundEnabled: boolean;
  refreshToken: number;
  onChangeBackground: (enabled: boolean) => Promise<boolean>;
  onReprocessAll: () => Promise<number>;
  onOpenWrapped?: () => void;
  wakeWordEnabled: boolean;
  onChangeWakeWord: (enabled: boolean) => Promise<void>;
  onStartTour?: () => void;
}

type SettingsPanel = 'intelligence' | 'remote' | 'background' | 'organization' | 'queue' | 'privacy' | 'profile' | 'connectors' | null;

const emptyQueue: CaptureQueueSummary = { queued: 0, processing: 0, retrying: 0, complete: 0, archived: 0 };
const emptyRemote: RemoteAccessState = { enabled: false, hasKey: false, usingDevelopmentKey: false, modelName: 'claude-sonnet-4-6' };

interface ModelOption { id: string; label: string; desc: string; provider: 'openai' | 'anthropic'; }
const OPENAI_MODELS: ModelOption[] = [
  { id: 'gpt-4o-mini',   label: 'gpt-4o-mini',   desc: 'Fast · affordable',     provider: 'openai' },
  { id: 'gpt-4o',        label: 'gpt-4o',         desc: 'Smarter · higher cost', provider: 'openai' },
  { id: 'gpt-4.1-mini',  label: 'gpt-4.1-mini',  desc: 'Fast · latest mini',    provider: 'openai' },
  { id: 'gpt-4.1',       label: 'gpt-4.1',        desc: 'Most capable GPT-4',    provider: 'openai' },
  { id: 'gpt-5-mini',    label: 'gpt-5-mini',     desc: 'Fast GPT-5',            provider: 'openai' },
  { id: 'gpt-5',         label: 'gpt-5',          desc: 'GPT-5 full',            provider: 'openai' },
  { id: 'gpt-5.4',       label: 'gpt-5.4',        desc: 'GPT-5.4',               provider: 'openai' },
  { id: 'gpt-5.5',       label: 'gpt-5.5',        desc: 'GPT-5.5 latest',        provider: 'openai' },
];
const CLAUDE_MODELS: ModelOption[] = [
  { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5',  desc: 'Fastest · cheapest Claude', provider: 'anthropic' },
  { id: 'claude-sonnet-4-6',          label: 'Claude Sonnet 4.6', desc: 'Balanced · recommended',    provider: 'anthropic' },
  { id: 'claude-opus-4-7',            label: 'Claude Opus 4.7',   desc: 'Most capable Claude',       provider: 'anthropic' },
];
const ALL_MODELS: ModelOption[] = [...OPENAI_MODELS, ...CLAUDE_MODELS];
function findModel(id: string): ModelOption | undefined {
  return ALL_MODELS.find((m) => m.id === id);
}

export function SettingsScreen({ backgroundEnabled, refreshToken, onChangeBackground, onReprocessAll, onOpenWrapped, wakeWordEnabled, onChangeWakeWord, onStartTour }: SettingsScreenProps) {
  const [activePanel, setActivePanel] = useState<SettingsPanel>(null);
  const [devLogVisible, setDevLogVisible] = useState(false);
  const [checkInSchedulerVisible, setCheckInSchedulerVisible] = useState(false);
  const [remindersManagerVisible, setRemindersManagerVisible] = useState(false);
  const [queue, setQueue] = useState(emptyQueue);
  const [background, setBackground] = useState<BackgroundProcessingState>();
  const [changingBackground, setChangingBackground] = useState(false);
  const [localRefresh, setLocalRefresh] = useState(0);
  const [deviceModel, setDeviceModel] = useState<DeviceModelState>(getDeviceModelState());
  const [shieldLlm, setShieldLlm] = useState(false);
  const [preparingModel, setPreparingModel] = useState(false);
  const [clearingModel, setClearingModel] = useState(false);
  const [selectingModel, setSelectingModel] = useState(false);
  const [remote, setRemote] = useState<RemoteAccessState>(emptyRemote);
  const [remoteKey, setRemoteKey] = useState('');
  const [themeKey, setThemeKey] = useState<ThemeKey>('lucy');
  const [changingRemote, setChangingRemote] = useState(false);
  const [benchmarkRunning, setBenchmarkRunning] = useState(false);
  const [benchmarkProgress, setBenchmarkProgress] = useState('');
  const [benchmarkResults, setBenchmarkResults] = useState<BenchmarkResult[]>([]);
  const [organizationRun, setOrganizationRun] = useState<OrganizationRunRow | null>(null);
  const [organizingNow, setOrganizingNow] = useState(false);
  const [reprocessing, setReprocessing] = useState(false);
  const [profile, setProfile] = useState<UserProfile>({ name: '', about: '', languages: [] });
  const [profileDraft, setProfileDraft] = useState<UserProfile>({ name: '', about: '', languages: [] });
  const [savingProfile, setSavingProfile] = useState(false);
  const [checkInEnabled, setCheckInEnabled] = useState(false);
  const [alarmStyle, setAlarmStyle] = useState(false);
  const [semanticRouter, setSemanticRouter] = useState(false);
  const [mealReminders, setMealReminders] = useState(false);
  const [aiModel, setAiModel] = useState('claude-sonnet-4-6');
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [claudeKey, setClaudeKey] = useState('');
  const [hasClaudeKey, setHasClaudeKey] = useState(false);
  const [savingClaudeKey, setSavingClaudeKey] = useState(false);
  const [siriGuideVisible, setSiriGuideVisible] = useState(false);
  const [wakeStatus, setWakeStatus] = useState<WakeWordStatus>(wakeWord.status);
  const [voicePickerVisible, setVoicePickerVisible] = useState(false);
  const [selectedVoiceName, setSelectedVoiceName] = useState('System default');
  const [dayShaperVisible, setDayShaperVisible] = useState(false);
  const [dayShaped, setDayShaped] = useState(false);

  useEffect(() => wakeWord.onStatusChange(setWakeStatus), []);

  // Resolve the saved voice id to a friendly name for the row's value.
  useEffect(() => {
    void (async () => {
      await loadVoicePrefs();
      const id = getSelectedVoiceId();
      if (!id) { setSelectedVoiceName('System default'); return; }
      const voices = await listVoices();
      setSelectedVoiceName(voices.find((v) => v.identifier === id)?.name ?? 'System default');
    })();
  }, [voicePickerVisible]);

  useEffect(() => {
    void (async () => {
      const db = await getDatabase();
      const [queueSummary, state, latestRun, remoteState, userProfile] = await Promise.all([
        getCaptureQueueSummary(db),
        getBackgroundProcessingState(),
        getLatestOrganizationRun(db),
        getRemoteAccessState(),
        getUserProfile(db),
      ]);
      const { getSetting: gs } = await import('../db/settings');
      const storedModel = await gs(db, 'ai_model_override');
      if (storedModel) setAiModel(storedModel);

      const { getClaudeApiKey } = await import('../ai/remoteAccess');
      const ck = await getClaudeApiKey();
      setHasClaudeKey(!!ck);

      setQueue(queueSummary);
      setBackground(state);
      setOrganizationRun(latestRun);
      setRemote(remoteState);
      setProfile(userProfile);
      setProfileDraft(userProfile);
      setCheckInEnabled(!!(await getSetting(db, 'progress_checkin_notification_id')));
      try {
        const { getAvailability } = await import('../scheduling/availability');
        const av = await getAvailability(db);
        setDayShaped(!av.inferred && !!av.energyCurves);
      } catch { /* non-critical */ }
      setShieldLlm((await getSetting(db, 'shield_use_local_llm')) === 'true');
      setAlarmStyle((await getSetting(db, 'alarm_style_enabled')) === 'on');
      setSemanticRouter((await getSetting(db, 'semantic_router_enabled')) !== 'off');
      setMealReminders((await getSetting(db, 'meal_reminders_enabled')) === 'on');
      try {
        const SecureStore = await import('expo-secure-store');
        const savedTheme = SecureStore.getItem(THEME_SETTING_KEY);
        if (savedTheme && (THEME_KEYS as string[]).includes(savedTheme)) setThemeKey(savedTheme as ThemeKey);
      } catch { /* default */ }
    })();
  }, [backgroundEnabled, localRefresh, refreshToken]);

  // Accent theme picker — swaps just the accent color, then restarts so every styled surface re-themes.
  // Stored in SecureStore (read synchronously at boot in colors.ts; the app DB is encrypted).
  const pickTheme = (k: ThemeKey) => {
    if (k === themeKey) return;
    Alert.alert(
      `Switch to ${THEME_META[k].label} accent?`,
      'Lucy will restart to apply the new color. You can switch back anytime.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Apply & restart',
          onPress: () => void (async () => {
            try {
              const SecureStore = await import('expo-secure-store');
              await SecureStore.setItemAsync(THEME_SETTING_KEY, k);
              setThemeKey(k);
              const U = await import('expo-updates');
              await U.reloadAsync();
            } catch { Alert.alert('Could not switch', 'Please try again.'); }
          })(),
        },
      ],
    );
  };

  useEffect(() => subscribeToDeviceModel(setDeviceModel), []);

  const toggleAlarmStyle = async () => {
    const next = !alarmStyle;
    setAlarmStyle(next);
    const db = await getDatabase();
    await setSetting(db, 'alarm_style_enabled', next ? 'on' : 'off');
  };

  const toggleMealReminders = async () => {
    const next = !mealReminders;
    setMealReminders(next);
    const db = await getDatabase();
    await setSetting(db, 'meal_reminders_enabled', next ? 'on' : 'off');
    try {
      const { scheduleMealReminders, cancelMealReminders } = await import('../processing/mealReminders');
      if (next) await scheduleMealReminders(); else await cancelMealReminders();
    } catch { /* non-critical */ }
  };

  const toggleSemanticRouter = async () => {
    const next = !semanticRouter;
    setSemanticRouter(next);
    const db = await getDatabase();
    await setSetting(db, 'semantic_router_enabled', next ? 'on' : 'off');
  };

  const changeBackground = async () => {
    setChangingBackground(true);
    try {
      await onChangeBackground(!backgroundEnabled);
      setLocalRefresh((value) => value + 1);
    } finally {
      setChangingBackground(false);
    }
  };

  const prepareModel = async () => {
    setPreparingModel(true);
    try {
      await prepareDeviceModel();
    } catch {
      // The model service publishes its actionable setup error for display below.
    } finally {
      setPreparingModel(false);
    }
  };

  const clearModel = async () => {
    setClearingModel(true);
    try {
      await clearDownloadedDeviceModels();
    } catch {
      // Retaining an already downloaded model is recoverable.
    } finally {
      setClearingModel(false);
    }
  };

  const chooseModel = async (modelId: LocalModelId) => {
    if (modelId === deviceModel.modelId || selectingModel) {
      return;
    }
    setSelectingModel(true);
    try {
      await selectDeviceModel(modelId);
    } finally {
      setSelectingModel(false);
    }
  };

  const toggleShieldLlm = async () => {
    const db = await getDatabase();
    const next = !shieldLlm;
    await setSetting(db, 'shield_use_local_llm', next ? 'true' : 'false');
    setShieldLlm(next);
  };

  const chooseAiModel = async (m: ModelOption) => {
    if (m.provider === 'anthropic' && !hasClaudeKey) {
      Alert.alert('Claude API key required', 'Add your Anthropic API key below first, then pick a Claude model.');
      return;
    }
    setAiModel(m.id);
    setModelMenuOpen(false);
    const db = await getDatabase();
    await setSetting(db, 'ai_model_override', m.id);
    const { setPreferredModel } = await import('../ai/modelPreference');
    setPreferredModel(m.id);
  };

  const runBenchmark = async () => {
    setBenchmarkRunning(true);
    setBenchmarkProgress('Starting local checks...');
    setBenchmarkResults([]);
    try {
      const results = await runEnglishDeviceBenchmark((complete, total) => {
        setBenchmarkProgress(`Running check ${Math.min(complete + 1, total)} of ${total}...`);
      });
      setBenchmarkResults(results);
      setBenchmarkProgress(`${results.filter((result) => result.passed).length} of ${results.length} checks passed`);
    } finally {
      setBenchmarkRunning(false);
    }
  };

  const saveRemoteKey = async () => {
    setChangingRemote(true);
    try {
      // Test the key before saving
      const testRes = await fetch('https://api.openai.com/v1/models', {
        headers: { Authorization: `Bearer ${remoteKey.trim()}` },
      });
      if (!testRes.ok) {
        const err = await testRes.json().catch(() => ({})) as { error?: { message?: string } };
        throw new Error(err.error?.message ?? `OpenAI returned status ${testRes.status}`);
      }
      await storeRemoteOpenAIKey(remoteKey);
      await setRemoteEnabled(true);
      setRemoteKey('');
      setRemote(await getRemoteAccessState());
      Alert.alert('✓ OpenAI key verified', 'Key is valid and saved. LUCY will now use OpenAI for extraction.');
    } catch (error) {
      Alert.alert('Key invalid', error instanceof Error ? error.message : 'Could not verify key.');
    } finally {
      setChangingRemote(false);
    }
  };

  const toggleRemote = async () => {
    if (!remote.hasKey && !remote.enabled) {
      Alert.alert('Add an API key first', 'Enter your OpenAI API key in this panel before turning on remote intelligence.');
      return;
    }
    setChangingRemote(true);
    try {
      await setRemoteEnabled(!remote.enabled);
      setRemote(await getRemoteAccessState());
    } finally {
      setChangingRemote(false);
    }
  };

  const removeRemoteKey = async () => {
    setChangingRemote(true);
    try {
      await removeRemoteOpenAIKey();
      setRemote(await getRemoteAccessState());
    } finally {
      setChangingRemote(false);
    }
  };

  const organizeNow = async () => {
    setOrganizingNow(true);
    const startedAt = Date.now();
    try {
      const db = await getDatabase();
      await organizeMemory(db, 'manual');
      const run = await getLatestOrganizationRun(db);
      setOrganizationRun(run);
      setLocalRefresh((value) => value + 1);
      // Ensure the "Working..." state is visible for at least 600ms
      const elapsed = Date.now() - startedAt;
      if (elapsed < 600) await new Promise((resolve) => setTimeout(resolve, 600 - elapsed));
      if (run) {
        Alert.alert(
          'Memory organized',
          run.summary || `Found ${run.entity_count ?? 0} entities and ${run.connection_count ?? 0} connections.`,
        );
      } else {
        Alert.alert('Memory organized', 'Nothing new to reorganize — your memory map is already up to date.');
      }
    } finally {
      setOrganizingNow(false);
    }
  };

  const deleteAllData = () => {
    Alert.alert(
      'Delete all memories?',
      'This permanently deletes all your captures, tasks, reminders, expenses, ideas, and organized memory. Your app settings are kept. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete everything',
          style: 'destructive',
          onPress: async () => {
            try {
              const db = await getDatabase();
              const tables = [
                'todos', 'reminders', 'expenses', 'ideas', 'places',
                'people', 'interests', 'open_loops', 'follow_ups', 'context_requests',
                'knowledge_entities', 'knowledge_connections', 'knowledge_insights',
                'organization_runs', 'extractions', 'capture_embeddings',
                'person_contexts', 'mood_entries', 'questions', 'ask_threads',
                'ask_messages', 'battery_snapshots', 'music_captures',
                // captures last — child tables (and its own parent_capture_id self-reference)
                // reference it; with foreign_keys = ON, deleting it first would fail.
                'captures',
              ];
              // FK is enabled (PRAGMA foreign_keys = ON). Disable it for the bulk wipe so
              // table order / self-references can't trigger constraint failures that the
              // per-statement catch would silently swallow (left captures undeleted before).
              await db.execAsync('PRAGMA foreign_keys = OFF;');
              try {
                await db.withTransactionAsync(async () => {
                  for (const table of tables) {
                    await db.runAsync(`DELETE FROM ${table}`).catch(() => { /* table may not exist */ });
                  }
                });
              } finally {
                await db.execAsync('PRAGMA foreign_keys = ON;');
              }
              Alert.alert('Done', 'All memories have been deleted. LUCY starts fresh.');
              setLocalRefresh((v) => v + 1);
            } catch (e) {
              Alert.alert('Error', 'Could not delete all data. Please try again.');
            }
          },
        },
      ],
    );
  };

  const exportAllData = async () => {
    try {
      const db = await getDatabase();
      const { buildMemoryExport } = await import('../processing/memoryExport');
      // Full backup → keep archived/soft-deleted rows so a restore is lossless.
      const exportData = await buildMemoryExport(db, { includeArchived: true });
      const json = JSON.stringify(exportData, null, 2);
      // Write to a temp file and share. SDK 56: cacheDirectory/writeAsStringAsync
      // live in expo-file-system/legacy — the bare module returns undefined.
      const { cacheDirectory, writeAsStringAsync } = require('expo-file-system/legacy') as { cacheDirectory: string; writeAsStringAsync: (path: string, content: string) => Promise<void> };
      const exportPath = `${cacheDirectory}lucy-export-${Date.now()}.json`;
      await writeAsStringAsync(exportPath, json);
      await shareAsync(exportPath, { mimeType: 'application/json', dialogTitle: 'Export LUCY data' });
    } catch (e) {
      Alert.alert('Export failed', 'Could not export data. Please try again.');
    }
  };

  const confirmFullReprocess = () => {
    Alert.alert(
      'Reprocess ALL memories?',
      'This re-runs AI extraction on EVERY memory from scratch. With a remote model (OpenAI/Claude) that means one API call per memory — it can use a lot of credits and take a while. Your raw thoughts are kept; only the derived interpretation is rebuilt. Use this only after changing models or schema — not to retry one item (use the ⋯ menu on a single memory for that).',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reprocess everything',
          style: 'destructive',
          onPress: () => void (async () => {
            setReprocessing(true);
            try {
              const count = await onReprocessAll();
              Alert.alert('Reprocessing started', `${count} original memories are queued for fresh interpretation.`);
              setLocalRefresh((value) => value + 1);
            } catch (error) {
              Alert.alert(
                'Could not start reprocessing',
                error instanceof Error ? error.message : 'Try again after current organizing completes.',
              );
            } finally {
              setReprocessing(false);
            }
          })(),
        },
      ],
    );
  };

  const waiting = queue.queued + queue.processing + queue.retrying;
  const usesDeviceModel = config.localInference === 'device';
  const modelStatus = deviceModel.status === 'ready'
    ? 'Ready on this device'
    : deviceModel.status === 'downloading'
      ? `Preparing ${Math.round(deviceModel.progress * 100)}%`
      : deviceModel.status === 'unavailable'
        ? 'Unavailable on this device'
        : deviceModel.status === 'error'
          ? 'Setup needs attention'
          : 'Not prepared';
  const benchmarkStatus = benchmarkResults.length
    ? `${benchmarkResults.filter((result) => result.passed).length}/${benchmarkResults.length} passed`
    : 'Quality check';
  const runSummary = organizationRun
    ? `Last run ${new Date(`${organizationRun.created_at.replace(' ', 'T')}Z`).toLocaleString()}`
    : 'Not run yet';

  return (
    <View style={{ flex: 1 }}>
    <ScrollView style={styles.container} contentContainerStyle={styles.listContent} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
      <Text style={styles.title}>Settings</Text>
      <Text style={styles.subtitle}>Quiet controls for your memory.</Text>

      {/* ─── Appearance — accent theme ─────────────────────────────────── */}
      <SettingsGroup icon="🎨" title="Appearance" summary="Pick an accent color" pill={THEME_META[themeKey].label}>
        <Text style={styles.themeHint}>Swap Lucy's accent to a familiar app's color. Restarts to apply.</Text>
        <View style={styles.themeRow}>
          {THEME_KEYS.map((k) => {
            const active = k === themeKey;
            return (
              <TouchableOpacity key={k} activeOpacity={0.85} onPress={() => pickTheme(k)} style={styles.themeChip}>
                <View style={[styles.themeSwatch, { backgroundColor: THEME_META[k].swatch }, active && styles.themeSwatchActive]}>
                  {active ? <Text style={styles.themeCheck}>✓</Text> : null}
                </View>
                <Text style={[styles.themeLabel, active && styles.themeLabelActive]} numberOfLines={1}>{THEME_META[k].label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </SettingsGroup>

      {/* ─── You & profile ─────────────────────────────────────────────── */}
      <SettingsGroup
        icon="🪞"
        title="You & profile"
        summary="Who you are, learned profile, check-ins & reminders"
        pill={profile.name ? 'Set' : 'Set up'}
      >
        <SettingsRow
          title="About you"
          value={profile.name ? `${profile.name}${profile.about ? ' · ' + profile.about.slice(0, 30) + (profile.about.length > 30 ? '…' : '') : ''}` : 'Tell LUCY who you are'}
          badge={profile.name ? '✓' : 'Set up'}
          active={!!profile.name}
          onInfo={() => { setProfileDraft({ ...profile }); setActivePanel('profile'); }}
        />
        <SettingsRow
          title="Progress check-ins"
          value={checkInEnabled ? 'Reminders on — tap to edit your times' : 'Off — set your own reminder times'}
          badge={checkInEnabled ? 'On' : 'Off'}
          active={checkInEnabled}
          onInfo={() => setCheckInSchedulerVisible(true)}
        />
        <SettingsRow
          title="Ring like an alarm"
          value={alarmStyle ? 'On — reminders buzz and re-ring until you react' : 'Off — reminders give one gentle notification'}
          badge={alarmStyle ? 'On' : 'Off'}
          active={alarmStyle}
          onInfo={() => void toggleAlarmStyle()}
        />
        <SettingsRow
          title="Meal photo reminders"
          value={mealReminders ? 'On — gentle nudges at meal times to snap your food' : 'Off — no meal reminders'}
          badge={mealReminders ? 'On' : 'Off'}
          active={mealReminders}
          onInfo={() => void toggleMealReminders()}
        />
        <SettingsRow
          title="Smarter answers"
          value={semanticRouter ? 'On — LUCY routes questions through focused tools' : 'Off — using the standard answer engine'}
          badge={semanticRouter ? 'On' : 'Off'}
          active={semanticRouter}
          onInfo={() => void toggleSemanticRouter()}
        />
        <SettingsRow
          title="Scheduled reminders"
          value="Browse and cancel every reminder LUCY has scheduled"
          actionLabel="Manage"
          onAction={() => setRemindersManagerVisible(true)}
          onInfo={() => setRemindersManagerVisible(true)}
        />
        {onStartTour ? (
          <SettingsRow
            title="Guided tour with Lucy"
            value="Lucy walks you through the app out loud — try each feature live as she explains"
            actionLabel="Start"
            onAction={onStartTour}
          />
        ) : null}
      </SettingsGroup>

      {/* ─── Your day & energy ─────────────────────────────────────────── */}
      <SettingsGroup
        icon="🌤️"
        title="Your day & energy"
        summary="Office hours, sleep & when you're at your best"
        pill={dayShaped ? 'Shaped' : undefined}
      >
        <SettingsRow
          title="Shape your day"
          value={dayShaped
            ? 'Custom hours & energy — tap to fine-tune when Lucy schedules'
            : 'Set your work hours and how your energy moves through the day'}
          badge={dayShaped ? 'Custom' : 'Set up'}
          active={dayShaped}
          actionLabel={dayShaped ? 'Edit' : 'Shape'}
          onAction={() => setDayShaperVisible(true)}
          onInfo={() => setDayShaperVisible(true)}
        />
      </SettingsGroup>

      {/* ─── AI & intelligence ─────────────────────────────────────────── */}
      <SettingsGroup
        icon="✨"
        title="AI & intelligence"
        summary="Model, remote & on-device intelligence, organizing"
        pill={remote.enabled ? 'On' : undefined}
      >
        {/* AI Model Picker */}
        <View style={{ paddingHorizontal: 16, paddingVertical: 12 }}>
          <Text style={{ color: LUCY_COLORS.textDark, fontSize: 15, fontWeight: '700', marginBottom: 4 }}>AI extraction model</Text>
          <Text style={{ color: LUCY_COLORS.textSubtle, fontSize: 12, marginBottom: 6 }}>
            Select which model LUCY uses to understand your captures. Claude models require an Anthropic API key.
          </Text>
          <Text style={{ color: LUCY_COLORS.textSubtle, fontSize: 11, marginBottom: 12, fontStyle: 'italic' }}>
            Note: semantic search and voice transcription always use OpenAI (Anthropic has no embeddings or speech API), so an OpenAI key is still recommended even when extracting with Claude.
          </Text>

          {/* Dropdown trigger — shows the currently selected model */}
          {(() => {
            const current = findModel(aiModel);
            const accent = current?.provider === 'anthropic' ? '#60A5FA' : LUCY_COLORS.primary;
            return (
              <TouchableOpacity
                onPress={() => setModelMenuOpen(true)}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12, paddingHorizontal: 14, backgroundColor: LUCY_COLORS.surface, borderRadius: 12, borderWidth: 1, borderColor: accent }}
              >
                <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: accent }} />
                <View style={{ flex: 1 }}>
                  <Text style={{ color: LUCY_COLORS.textDark, fontSize: 14, fontWeight: '700' }}>{current?.label ?? aiModel}</Text>
                  <Text style={{ color: LUCY_COLORS.textSubtle, fontSize: 11 }}>
                    {current ? `${current.provider === 'anthropic' ? 'Anthropic' : 'OpenAI'} · ${current.desc}` : 'Tap to choose a model'}
                  </Text>
                </View>
                <Text style={{ color: LUCY_COLORS.textSubtle, fontSize: 16, fontWeight: '700' }}>⌄</Text>
              </TouchableOpacity>
            );
          })()}

          {/* Model dropdown menu */}
          <Modal transparent animationType="fade" visible={modelMenuOpen} onRequestClose={() => setModelMenuOpen(false)}>
            <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.72)', justifyContent: 'center', alignItems: 'center', padding: 24 }} onPress={() => setModelMenuOpen(false)}>
              <Pressable style={{ backgroundColor: LUCY_COLORS.surface, borderRadius: 18, padding: 16, width: '100%', maxHeight: '80%', borderWidth: 1, borderColor: LUCY_COLORS.border }}>
                <Text style={{ color: LUCY_COLORS.textDark, fontSize: 16, fontWeight: '800', marginBottom: 10 }}>Choose AI model</Text>
                <ScrollView showsVerticalScrollIndicator={false}>
                  <Text style={{ color: LUCY_COLORS.textSubtle, fontSize: 10, fontWeight: '800', letterSpacing: 1.2, marginBottom: 6 }}>OPENAI</Text>
                  {OPENAI_MODELS.map((m) => (
                    <ModelRow key={m.id} m={m} selected={aiModel === m.id} color={LUCY_COLORS.primary} onSelect={() => void chooseAiModel(m)} />
                  ))}
                  <Text style={{ color: '#60A5FA', fontSize: 10, fontWeight: '800', letterSpacing: 1.2, marginTop: 14, marginBottom: 6 }}>
                    ANTHROPIC {hasClaudeKey ? '' : '(add Claude API key below first)'}
                  </Text>
                  {CLAUDE_MODELS.map((m) => (
                    <ModelRow key={m.id} m={m} selected={aiModel === m.id} color="#60A5FA" onSelect={() => void chooseAiModel(m)} />
                  ))}
                </ScrollView>
              </Pressable>
            </Pressable>
          </Modal>

          {/* Claude API key */}
          <View style={{ marginTop: 14, gap: 8 }}>
            <Text style={{ color: '#60A5FA', fontSize: 12, fontWeight: '700' }}>
              Anthropic API key {hasClaudeKey ? '· saved ✓' : '· not set'}
            </Text>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <TextInput
                style={[styles.keyInput, { flex: 1, fontSize: 12 }]}
                placeholder={hasClaudeKey ? '••••••••••••••••' : 'sk-ant-...'}
                placeholderTextColor={LUCY_COLORS.textSubtle}
                value={claudeKey}
                onChangeText={setClaudeKey}
                secureTextEntry
                autoCapitalize="none"
                autoCorrect={false}
              />
              <TouchableOpacity
                style={{ backgroundColor: '#60A5FA', borderRadius: 10, paddingHorizontal: 14, justifyContent: 'center', opacity: (!claudeKey.trim() && !hasClaudeKey) ? 0.4 : 1 }}
                onPress={async () => {
                  setSavingClaudeKey(true);
                  try {
                    if (!claudeKey.trim() && hasClaudeKey) {
                      const { removeClaudeApiKey } = await import('../ai/remoteAccess');
                      await removeClaudeApiKey();
                      setHasClaudeKey(false);
                      Alert.alert('Removed', 'Claude API key cleared.');
                    } else if (claudeKey.trim()) {
                      // Test the Claude key before saving
                      const testRes = await fetch('https://api.anthropic.com/v1/messages', {
                        method: 'POST',
                        headers: {
                          'Content-Type': 'application/json',
                          'anthropic-version': '2023-06-01',
                          'x-api-key': claudeKey.trim(),
                        },
                        body: JSON.stringify({
                          model: 'claude-haiku-4-5-20251001',
                          max_tokens: 10,
                          messages: [{ role: 'user', content: 'hi' }],
                        }),
                      });
                      if (!testRes.ok) {
                        const err = await testRes.json().catch(() => ({})) as { error?: { message?: string } };
                        throw new Error(err.error?.message ?? `Anthropic returned status ${testRes.status}`);
                      }
                      const { storeClaudeApiKey } = await import('../ai/remoteAccess');
                      await storeClaudeApiKey(claudeKey.trim());
                      setHasClaudeKey(true);
                      setClaudeKey('');
                      Alert.alert('✓ Claude key verified', 'Key is valid and saved. Select a Claude model above to use it.');
                    }
                  } catch (e) { Alert.alert('Error', String(e)); }
                  finally { setSavingClaudeKey(false); }
                }}
              >
                <Text style={{ color: '#fff', fontWeight: '700', fontSize: 13 }}>
                  {savingClaudeKey ? '...' : hasClaudeKey && !claudeKey.trim() ? 'Remove' : 'Save'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>

        <SettingsRow
          title="On-device intelligence"
          value={modelStatus}
          badge={usesDeviceModel && deviceModel.status === 'ready' ? 'Local' : usesDeviceModel ? 'Setup' : 'Dev'}
          active={usesDeviceModel && deviceModel.status === 'ready'}
          onInfo={() => setActivePanel('intelligence')}
        />
        <SettingsRow
          title="Remote intelligence"
          value={remote.enabled ? 'OpenAI key saved · active' : remote.hasKey ? 'OpenAI key saved · tap to manage' : 'No key — required for voice & search'}
          badge={remote.enabled ? 'On' : 'Off'}
          active={remote.enabled}
          onInfo={() => setActivePanel('remote')}
        />
        <SettingsRow
          title="Background organizing"
          value={backgroundEnabled ? 'Allowed' : 'Off'}
          badge={backgroundEnabled ? 'On' : 'Off'}
          active={backgroundEnabled}
          onInfo={() => setActivePanel('background')}
        />
        <SettingsRow
          title="Re-organize now"
          value={runSummary}
          actionLabel={organizingNow ? 'Working...' : 'Run'}
          actionDisabled={organizingNow}
          onAction={() => void organizeNow()}
          onInfo={() => setActivePanel('organization')}
        />
        <SettingsRow
          title="Processing queue"
          value={waiting ? `${waiting} waiting for attention` : 'All caught up'}
          badge={waiting ? `${waiting}` : undefined}
          active={waiting === 0}
          onInfo={() => setActivePanel('queue')}
        />
      </SettingsGroup>

      {/* ─── Voice ─────────────────────────────────────────────────────── */}
      <SettingsGroup
        icon="🎙️"
        title="Voice"
        summary="Hey Lucy wake word, Lucy's voice, hands-free"
        pill={wakeWordEnabled && wakeStatus === 'listening' ? 'Listening' : undefined}
      >
        <SettingsRow
          title="Hey Lucy wake word"
          value={
            !wakeWordEnabled ? 'Off — say “Hey Lucy” hands-free (uses more battery)'
            : wakeStatus === 'listening' ? 'Active — say “Hey Lucy” anytime'
            : wakeStatus === 'unavailable' ? 'Unavailable — speech recognition failed to start'
            : 'Starting up…'
          }
          badge={wakeWordEnabled ? (wakeStatus === 'listening' ? 'Listening' : wakeStatus === 'unavailable' ? 'Error' : 'Starting') : 'Off'}
          active={wakeWordEnabled && wakeStatus === 'listening'}
          actionLabel={wakeWordEnabled ? 'Turn off' : 'Turn on'}
          onAction={() => void onChangeWakeWord(!wakeWordEnabled)}
        />
        <SettingsRow
          title="Lucy's voice"
          value={selectedVoiceName === 'System default' ? 'System default — tap to pick a voice & preview' : selectedVoiceName}
          badge={selectedVoiceName === 'System default' ? undefined : 'Custom'}
          active={selectedVoiceName !== 'System default'}
          actionLabel="Choose"
          onAction={() => setVoicePickerVisible(true)}
          onInfo={() => setVoicePickerVisible(true)}
        />
        {Platform.OS === 'ios' && (
          <SettingsRow
            title="Set up Siri Shortcut"
            value={'Say "Hey Siri, [your phrase]" to send notes to LUCY hands-free'}
            onAction={() => setSiriGuideVisible(true)}
            actionLabel="Set up"
          />
        )}
      </SettingsGroup>

      {/* ─── Connections ───────────────────────────────────────────────── */}
      <SettingsGroup
        icon="🔗"
        title="Connections"
        summary="Permissions, calendar & laptop access"
      >
        <SettingsRow
          title="Connectors & permissions"
          value="Calendar, location, passive listening, meeting mode"
          badge="Manage"
          active
          onInfo={() => setActivePanel('connectors')}
        />
        <SettingsRow
          title="Calendar integration"
          value="Pre-meeting briefs + post-meeting capture prompts"
          badge="Connect"
          onAction={async () => {
            const { requestCalendarPermission } = await import('../processing/calendarConnector');
            const granted = await requestCalendarPermission();
            Alert.alert(
              granted ? 'Calendar connected' : 'Permission denied',
              granted
                ? 'LUCY will send a brief 30 minutes before meetings, and prompt you to capture notes afterward.'
                : 'Go to Settings → LUCY → Calendars to grant access.',
            );
          }}
          actionLabel="Grant access"
        />
        <View style={{ paddingHorizontal: 16, paddingVertical: 12 }}>
          <LaptopAccessPanel />
        </View>
      </SettingsGroup>

      {/* ─── Privacy & data ────────────────────────────────────────────── */}
      <SettingsGroup
        icon="🔒"
        title="Privacy & data"
        summary="Privacy shield, export, import & your story"
      >
        <SettingsRow
          title="Privacy"
          value="Original private thoughts stay local"
          onInfo={() => setActivePanel('privacy')}
        />
        <SettingsRow
          title="🎁 LUCY Wrapped"
          value="Your quarterly story — captures, tasks, people, mood"
          onAction={async () => {
            const db = await getDatabase();
            const { hasEnoughForWrapped, wrappedMemoryCount } = await import('../processing/lucyWrapped');
            if (!(await hasEnoughForWrapped(db))) {
              const n = await wrappedMemoryCount(db);
              Alert.alert('Not ready yet', `LUCY Wrapped needs at least 30 organized memories. You have ${n} so far — keep capturing!`);
              return;
            }
            onOpenWrapped?.();
          }}
          actionLabel="View"
        />
        <SettingsRow
          title="Export as JSON"
          value="All memories, tasks, expenses as structured data"
          onAction={exportAllData}
          actionLabel="Export"
        />
        <SettingsRow
          title="Export as Markdown"
          value="Human-readable notes you can use anywhere"
          onAction={async () => {
            try {
              const db = await getDatabase();
              const captures = await db.getAllAsync<{ extracted_title: string | null; raw_transcript: string | null; created_at: string; privacy_level: string }>(
                `SELECT extracted_title, raw_transcript, created_at, privacy_level FROM captures WHERE privacy_level != 'private' ORDER BY created_at DESC LIMIT 100`,
              );
              const md = [
                '# LUCY Memory Export',
                `*Exported: ${new Date().toLocaleDateString()}*`,
                '',
                ...captures.map((c) => [
                  `## ${c.extracted_title ?? 'Memory'} — ${new Date(c.created_at.includes('T') ? c.created_at : `${c.created_at.replace(' ','T')}Z`).toLocaleDateString()}`,
                  '',
                  c.raw_transcript ?? '',
                  '',
                  '---',
                  '',
                ].join('\n')),
              ].join('\n');

              const { cacheDirectory, writeAsStringAsync } = await import('expo-file-system/legacy') as any;
              const path = `${cacheDirectory}lucy-export-${Date.now()}.md`;
              await writeAsStringAsync(path, md);
              await shareAsync(path, { mimeType: 'text/markdown', dialogTitle: 'Export LUCY as Markdown' });
            } catch { Alert.alert('Export failed', 'Please try again.'); }
          }}
          actionLabel="Export"
        />
        <SettingsRow
          title="Import memory"
          value="Restore from an exported JSON (e.g. switching devices)"
          onAction={async () => {
            try {
              const DocumentPicker = await import('expo-document-picker');
              const res = await DocumentPicker.getDocumentAsync({ type: ['application/json', 'text/plain', '*/*'], copyToCacheDirectory: true });
              if (res.canceled || !res.assets?.length) return;
              const { readAsStringAsync } = await import('expo-file-system/legacy');
              const text = await readAsStringAsync(res.assets[0].uri);
              let data: unknown;
              try { data = JSON.parse(text); } catch { Alert.alert('Import failed', 'That file is not valid JSON.'); return; }
              const db = await getDatabase();
              const { importMemoryExport } = await import('../processing/memoryImport');
              const r = await importMemoryExport(db, data);
              if (!r.ok) { Alert.alert('Import failed', r.error ?? 'Could not import.'); return; }
              const total = Object.values(r.counts).reduce((a, b) => a + b, 0);
              await import('../processing/organizer').then(({ organizeMemory }) => organizeMemory(db, 'manual')).catch(() => {});
              Alert.alert('Imported ✓', `Restored ${total} items. Rebuilding your brain…`);
            } catch (e) { Alert.alert('Import failed', e instanceof Error ? e.message : 'Please try again.'); }
          }}
          actionLabel="Import"
        />
        <SettingsRow
          title="Delete all memories"
          value="Permanently erase everything LUCY knows"
          onAction={deleteAllData}
          actionLabel="Delete"
          actionDestructive
        />
      </SettingsGroup>

      {/* ─── About & updates ───────────────────────────────────────────── */}
      <SettingsGroup
        icon="ℹ️"
        title="About & updates"
        summary="Keep LUCY up to date"
      >
        <SettingsRow
          title="Check for updates"
          value="Fetch the latest LUCY improvements and restart into them"
          onAction={async () => {
            try {
              const Updates = await import('expo-updates');
              if (!Updates.isEnabled) {
                Alert.alert('Updates unavailable', 'Over-the-air updates run only in installed release builds, not in Expo Go / dev.');
                return;
              }
              const res = await Updates.checkForUpdateAsync();
              if (!res.isAvailable) {
                Alert.alert('You’re up to date', 'LUCY already has the latest version.');
                return;
              }
              await Updates.fetchUpdateAsync();
              Alert.alert('Update ready', 'LUCY will restart to apply the latest version.', [
                { text: 'Later', style: 'cancel' },
                { text: 'Restart now', onPress: () => { void Updates.reloadAsync(); } },
              ]);
            } catch (e) {
              Alert.alert('Update check failed', e instanceof Error ? e.message : 'Please try again later.');
            }
          }}
          actionLabel="Check"
        />
      </SettingsGroup>

      {/* ─── Developer ─────────────────────────────────────────────────── */}
      <SettingsGroup
        icon="🛠️"
        title="Developer"
        summary="Diagnostics & AI call log"
      >
        <SettingsRow
          title="AI call log"
          value="View all AI requests, responses, and errors"
          actionLabel="Open"
          onAction={() => setDevLogVisible(true)}
        />
      </SettingsGroup>

      <DevLogViewer visible={devLogVisible} onClose={() => setDevLogVisible(false)} />
      <SiriShortcutGuide visible={siriGuideVisible} onClose={() => setSiriGuideVisible(false)} />
      <VoicePicker visible={voicePickerVisible} onClose={() => setVoicePickerVisible(false)} />
      <CheckInScheduler
        visible={checkInSchedulerVisible}
        onClose={() => setCheckInSchedulerVisible(false)}
        onChange={(en) => setCheckInEnabled(en)}
      />
      <ScheduledRemindersManager
        visible={remindersManagerVisible}
        onClose={() => setRemindersManagerVisible(false)}
      />
      <DayShaper
        visible={dayShaperVisible}
        onClose={() => setDayShaperVisible(false)}
        onSaved={() => { setDayShaped(true); setLocalRefresh((v) => v + 1); }}
      />
      <SettingsSheet title={panelTitle(activePanel)} visible={activePanel !== null} onClose={() => setActivePanel(null)}>
        {activePanel === 'intelligence' ? (
          <>
            <Text style={styles.detail}>
              {usesDeviceModel
                ? 'Private thoughts are analyzed on this phone after its local model is prepared.'
                : 'Developer mode is using laptop Ollama. This is not phone-only private processing.'}
            </Text>
            {usesDeviceModel ? (
              <>
                <Text style={styles.activity}>{modelStatus}</Text>
                <Text style={styles.hint}>
                  {deviceModel.modelName}. Select the depth that fits your phone and journal style; once prepared, thought analysis stays on this device.
                </Text>
                {localModelOptions.map((option) => (
                  <TouchableOpacity
                    disabled={selectingModel}
                    key={option.id}
                    onPress={() => void chooseModel(option.id)}
                    style={[styles.modelOption, deviceModel.modelId === option.id && styles.modelOptionSelected]}
                  >
                    <View style={styles.flex}>
                      <Text style={styles.modelName}>{option.name} / {option.journalFit}</Text>
                      <Text style={styles.hint}>{option.guidance}</Text>
                    </View>
                    <Text style={styles.modelChoice}>{deviceModel.modelId === option.id ? 'Selected' : 'Choose'}</Text>
                  </TouchableOpacity>
                ))}
                <Text style={styles.hint}>After changing model, use Reprocess all memories to rebuild LUCY's understanding from the original journal entries.</Text>
                {config.deviceModelAssetBaseUrl ? (
                  <Text style={styles.hint}>Development asset relay enabled. Processing still runs on this device.</Text>
                ) : null}
                {deviceModel.error ? <Text style={styles.failure}>{deviceModel.error}</Text> : null}
                {deviceModel.status !== 'ready' && deviceModel.status !== 'unavailable' ? (
                  <PrimaryButton
                    disabled={preparingModel || deviceModel.status === 'downloading'}
                    label={deviceModel.status === 'downloading' || preparingModel ? 'Preparing...' : 'Prepare on-device intelligence'}
                    onPress={() => void prepareModel()}
                  />
                ) : null}
                <SecondaryButton
                  disabled={clearingModel || deviceModel.status === 'downloading'}
                  label={clearingModel ? 'Removing...' : 'Remove local model download'}
                  onPress={() => void clearModel()}
                />

                {/* Opt-in: use the on-device model to detect names for the Privacy Shield */}
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 14, gap: 10 }}>
                  <View style={styles.flex}>
                    <Text style={styles.modelName}>Use on-device AI to protect names</Text>
                    <Text style={styles.hint}>When on, the local model also finds people&apos;s names to mask from the cloud — including unfamiliar ones. Needs a prepared model and adds ~20-30s per note. Passwords and known/listed names are always protected either way.</Text>
                  </View>
                  <TouchableOpacity
                    onPress={() => void toggleShieldLlm()}
                    style={{ paddingHorizontal: 14, paddingVertical: 6, borderRadius: 10, backgroundColor: shieldLlm ? LUCY_COLORS.primarySoft : LUCY_COLORS.surfaceRaised, borderWidth: 1, borderColor: shieldLlm ? LUCY_COLORS.primary : LUCY_COLORS.border }}
                  >
                    <Text style={{ color: shieldLlm ? LUCY_COLORS.primary : LUCY_COLORS.textMuted, fontWeight: '800', fontSize: 12 }}>{shieldLlm ? 'On' : 'Off'}</Text>
                  </TouchableOpacity>
                </View>

                <Text style={styles.activity}>Local quality check</Text>
                <Text style={styles.hint}>Test common English memory and privacy cases locally. Test phrases are never remembered.</Text>
                {benchmarkProgress ? <Text style={styles.activity}>{benchmarkProgress}</Text> : null}
                {benchmarkResults.map((result) => (
                  <View key={result.id} style={styles.benchmarkRow}>
                    <View style={styles.flex}>
                      <Text style={styles.benchmarkTitle}>{result.label}</Text>
                      <Text style={styles.hint}>{result.detail}</Text>
                    </View>
                    <Text style={[styles.benchmarkStatus, result.passed ? styles.pass : styles.fail]}>
                      {result.passed ? 'Pass' : 'Fail'} / {(result.durationMs / 1000).toFixed(1)}s
                    </Text>
                  </View>
                ))}
                <PrimaryButton
                  disabled={benchmarkRunning || deviceModel.status !== 'ready'}
                  label={benchmarkRunning ? 'Checking local intelligence...' : `Run local check${benchmarkResults.length ? ` (${benchmarkStatus})` : ''}`}
                  onPress={() => void runBenchmark()}
                />
              </>
            ) : (
              <Text style={styles.hint}>Set `EXPO_PUBLIC_LOCAL_INFERENCE=device` before validating phone-only privacy.</Text>
            )}
          </>
        ) : null}

        {activePanel === 'remote' ? (
          <>
            <Text style={styles.detail}>GPT-5.4 Nano can help organize thoughts quickly. When a thought is marked private or detected as sensitive, on-device intelligence masks details first; only placeholder text may be sent remotely.</Text>
            {remote.hasKey ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: 'rgba(110,231,183,0.12)', borderRadius: 10, padding: 10, marginVertical: 8, borderWidth: 1, borderColor: 'rgba(110,231,183,0.3)' }}>
                <Text style={{ color: '#6EE7B7', fontSize: 16 }}>✓</Text>
                <Text style={{ color: '#6EE7B7', fontWeight: '700', fontSize: 13 }}>OpenAI key saved</Text>
                <Text style={{ color: '#6EE7B7', fontSize: 12, opacity: 0.8 }}>· {remote.enabled ? 'active' : 'key saved, toggle off'}</Text>
              </View>
            ) : (
              <View style={{ backgroundColor: 'rgba(245,158,11,0.10)', borderRadius: 10, padding: 10, marginVertical: 8, borderWidth: 1, borderColor: 'rgba(245,158,11,0.25)' }}>
                <Text style={{ color: '#F59E0B', fontWeight: '700', fontSize: 13 }}>No OpenAI key — add one below</Text>
                <Text style={{ color: '#F59E0B', fontSize: 11, opacity: 0.8, marginTop: 2 }}>Required for voice transcription (Listen/Meeting) and semantic search</Text>
              </View>
            )}
            <Text style={styles.keyLabel}>OpenAI API key</Text>
            <Text style={styles.hint}>LUCY uses your OpenAI key for GPT extraction and summaries. Voice is transcribed on-device — no key needed for that. Do not enter Claude or other provider tokens here.</Text>
            <TextInput
              autoCapitalize="none"
              autoCorrect={false}
              placeholder={remote.hasKey ? '••••••••••••••••  (tap to replace)' : 'Paste OpenAI key (sk-...)'}
              placeholderTextColor={remote.hasKey ? '#6EE7B7' : LUCY_COLORS.textSubtle}
              secureTextEntry
              style={styles.keyInput}
              value={remoteKey}
              onChangeText={setRemoteKey}
            />
            <PrimaryButton
              disabled={changingRemote || !remoteKey.trim()}
              label={changingRemote ? 'Saving...' : 'Save key and turn on'}
              onPress={() => void saveRemoteKey()}
            />
            {remote.hasKey ? (
              <>
                <SecondaryButton
                  disabled={changingRemote}
                  label={remote.enabled ? 'Turn off remote intelligence' : 'Turn on remote intelligence'}
                  onPress={() => void toggleRemote()}
                />
                {!remote.usingDevelopmentKey ? (
                  <SecondaryButton disabled={changingRemote} label="Remove saved key" onPress={() => void removeRemoteKey()} />
                ) : null}
              </>
            ) : null}
            <Text style={styles.hint}>
              Your key is stored using secure device storage. Test builds may use a development key configured during local installation; shared beta builds should ask each tester for their own key.
            </Text>
            <Text style={styles.hint}>
              Protected remote masking is experimental. Use fake sensitive details during this beta while its accuracy is evaluated.
            </Text>
          </>
        ) : null}

        {activePanel === 'background' ? (
          <>
            <Text style={styles.detail}>
              LUCY can organize waiting thoughts when your device grants a battery-friendly background window.
            </Text>
            <Text style={styles.hint}>
              Your phone decides the exact time, commonly while idle or charging. LUCY does not set alarms or keep the processor awake.
            </Text>
            <Text style={styles.activity}>
              {background?.lastRun ? `Last activity: ${new Date(background.lastRun).toLocaleString()}` : 'No background activity recorded yet.'}
            </Text>
            <Text style={styles.hint}>
              {background?.lastResult ?? (background?.registered ? 'Background organizing is ready.' : 'Background organizing is currently off.')}
            </Text>
            <PrimaryButton
              disabled={changingBackground}
              label={changingBackground ? 'Updating...' : backgroundEnabled ? 'Turn off background organizing' : 'Allow background organizing'}
              onPress={() => void changeBackground()}
            />
          </>
        ) : null}

        {activePanel === 'organization' ? (
          <>
            <Text style={styles.detail}>
              Rebuild LUCY's local Memory Map on demand during quiet time, such as a nap or while charging.
            </Text>
            <Text style={styles.hint}>
              Stored evidence is reorganized from remembered material. When remote intelligence is enabled, protected thoughts are locally masked before GPT-5.4 Nano sees placeholder text.
            </Text>
            {organizationRun ? (
              <>
                <Text style={styles.activity}>{organizationRun.summary}</Text>
                <Text style={styles.hint}>
                  Last run: {new Date(`${organizationRun.created_at.replace(' ', 'T')}Z`).toLocaleString()} / {organizationRun.trigger}
                </Text>
              </>
            ) : null}
            <PrimaryButton
              disabled={organizingNow}
              label={organizingNow ? 'Re-organizing memory...' : 'Re-organize now'}
              onPress={() => void organizeNow()}
            />
            <SecondaryButton
              disabled={reprocessing || deviceModel.status !== 'ready'}
              label={reprocessing ? 'Preparing rebuild...' : 'Reprocess all memories'}
              onPress={confirmFullReprocess}
            />
            {deviceModel.status !== 'ready' ? (
              <Text style={styles.hint}>Prepare the selected local model before rebuilding all memories.</Text>
            ) : null}
          </>
        ) : null}

        {activePanel === 'queue' ? (
          <QueuePanel queue={queue} onRetry={async () => {
            const db = await getDatabase();
            const { forceRetryAll } = await import('../db/captures');
            const n = await forceRetryAll(db);
            setQueue(await import('../db/captures').then(m => m.getCaptureQueueSummary(db)));
            await import('../processing/extract').then(m => m.processQueue(() => {})).catch(() => {});
            Alert.alert('Retry started', `${n} capture${n !== 1 ? 's' : ''} queued for processing.`);
          }} />
        ) : null}

        {activePanel === 'privacy' ? (
          <Text style={styles.detail}>
            Original private thoughts stay encrypted on your device and remain visible to you in LUCY. With remote intelligence enabled, a protected thought can be sent for analysis only after the selected on-device model replaces private details with placeholders. This protection path is experimental during beta testing. Credentials and passwords remain masked in previews.
          </Text>
        ) : null}

        {activePanel === 'connectors' ? (
          <ConnectorsPanel />
        ) : null}

        {activePanel === 'profile' ? (
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
            <Text style={styles.hint}>LUCY uses your name and background to personalize every response — no more "the user said" language.</Text>
            <Text style={styles.fieldLabel}>Your name</Text>
            <TextInput
              style={styles.profileInput}
              placeholder="e.g. Vamsy"
              placeholderTextColor={LUCY_COLORS.textSubtle}
              value={profileDraft.name}
              onChangeText={(v) => setProfileDraft((p) => ({ ...p, name: v }))}
            />
            <Text style={styles.fieldLabel}>About you</Text>
            <TextInput
              style={[styles.profileInput, styles.profileInputMulti]}
              placeholder={'e.g. Data engineer, interested in AI, music lover, work at a tech company'}
              placeholderTextColor={LUCY_COLORS.textSubtle}
              multiline
              value={profileDraft.about}
              onChangeText={(v) => setProfileDraft((p) => ({ ...p, about: v }))}
            />

            <Text style={styles.fieldLabel}>Languages you speak</Text>
            <Text style={styles.hint}>LUCY uses these languages as context. With multiple languages selected, Listen uses automatic detection so mixed speech is not forced into one language.</Text>
            {(() => {
              const LANGS = [
                { code: 'en', label: 'English' },
                { code: 'te', label: 'Telugu' },
                { code: 'hi', label: 'Hindi' },
                { code: 'ta', label: 'Tamil' },
                { code: 'kn', label: 'Kannada' },
                { code: 'ml', label: 'Malayalam' },
                { code: 'mr', label: 'Marathi' },
              ];
              return (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
                  {LANGS.map(({ code, label }) => {
                    const selected = profileDraft.languages.includes(code);
                    return (
                      <TouchableOpacity
                        key={code}
                        style={{ paddingHorizontal: 14, paddingVertical: 8, borderRadius: 14, borderWidth: 1, borderColor: selected ? LUCY_COLORS.primary : LUCY_COLORS.border, backgroundColor: selected ? LUCY_COLORS.primarySoft : 'transparent' }}
                        onPress={() => setProfileDraft((p) => ({
                          ...p,
                          languages: selected ? p.languages.filter((l) => l !== code) : [...p.languages, code],
                        }))}
                      >
                        <Text style={{ color: selected ? LUCY_COLORS.primaryGlow : LUCY_COLORS.textMuted, fontWeight: selected ? '700' : '500', fontSize: 13 }}>{label}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              );
            })()}

            <Text style={styles.fieldLabel}>Voice transcription</Text>
            <Text style={styles.hint}>LUCY transcribes your voice entirely on-device — private, free, and offline. Your spoken languages above set the recognition locale.</Text>

            <SecondaryButton
              disabled={savingProfile}
              label={savingProfile ? 'Saving...' : 'Save'}
              onPress={async () => {
                setSavingProfile(true);
                try {
                  const db = await getDatabase();
                  await saveUserProfile(db, profileDraft);
                  setProfile(profileDraft);
                  setActivePanel(null);
                } finally {
                  setSavingProfile(false);
                }
              }}
            />

            <Text style={[styles.fieldLabel, { marginTop: 22 }]}>What LUCY has learned about you</Text>
            <LearnedProfilePanel />
          </KeyboardAvoidingView>
        ) : null}
      </SettingsSheet>

    </ScrollView>

    </View>
  );
}

function ConnectorsPanel() {
  const { ConnectorsScreen } = require('./Connectors') as { ConnectorsScreen: () => React.ReactElement };
  return <ConnectorsScreen />;
}

function panelTitle(panel: SettingsPanel): string {
  switch (panel) {
    case 'connectors': return 'Connectors & permissions';
    case 'profile': return 'About you';
    case 'intelligence': return 'On-device intelligence';
    case 'remote': return 'Remote intelligence';
    case 'background': return 'Background organizing';
    case 'organization': return 'Re-organize now';
    case 'queue': return 'Processing queue';
    case 'privacy': return 'Privacy';
    default: return '';
  }
}

const SIRI_STEPS = [
  { n: '1', title: 'Open Shortcuts', body: 'Tap the button below to open the iOS Shortcuts app.' },
  { n: '2', title: 'Create a new shortcut', body: 'Tap + in the top right.' },
  { n: '3', title: 'Add "Dictate Text" action', body: 'Search for "Dictate Text" and add it. This captures your voice.' },
  { n: '4', title: 'Add "Open URLs" action', body: 'Search for "Open URLs". Paste the LUCY URL (copy below) into the URL field. Insert the "Dictated Text" variable inside it.' },
  { n: '5', title: 'Name & add to Siri', body: 'Tap the shortcut name → rename it (e.g. "Send to Lucy") → tap Add to Siri → record your phrase.' },
  { n: '6', title: 'Use it!', body: 'Say "Hey Siri, Send to Lucy" → dictate "Lucy, buy milk and eggs" → LUCY receives it.' },
];

const LUCY_VOICE_URL = 'lucy://voice?text=[Dictated Text]';
const LUCY_CAPTURE_URL = 'lucy://capture?text=[Dictated Text]';

function SiriShortcutGuide({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const [copied, setCopied] = useState<'voice' | 'capture' | null>(null);

  const copy = async (which: 'voice' | 'capture') => {
    await Clipboard.setStringAsync(which === 'voice' ? LUCY_VOICE_URL : LUCY_CAPTURE_URL);
    setCopied(which);
    setTimeout(() => setCopied(null), 2000);
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: LUCY_COLORS.background }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 20, paddingBottom: 14, borderBottomWidth: 1, borderBottomColor: LUCY_COLORS.border }}>
          <Text style={{ color: LUCY_COLORS.textDark, fontSize: 17, fontWeight: '700' }}>Set up Siri Shortcut</Text>
          <TouchableOpacity onPress={onClose} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
            <Text style={{ color: LUCY_COLORS.primary, fontSize: 15, fontWeight: '600' }}>Done</Text>
          </TouchableOpacity>
        </View>
        <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40 }}>
          <Text style={{ color: LUCY_COLORS.textSubtle, fontSize: 13, lineHeight: 20, marginBottom: 20 }}>
            Once set up, say your Siri phrase then speak to LUCY — e.g. "Lucy, buy milk and eggs" or "Lucy, schedule a meeting at 3pm". The word Lucy at the start is stripped automatically.
          </Text>

          {SIRI_STEPS.map((s) => (
            <View key={s.n} style={{ flexDirection: 'row', marginBottom: 18 }}>
              <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: LUCY_COLORS.primary + '22', alignItems: 'center', justifyContent: 'center', marginRight: 12, marginTop: 1 }}>
                <Text style={{ color: LUCY_COLORS.primary, fontSize: 13, fontWeight: '700' }}>{s.n}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ color: LUCY_COLORS.textDark, fontSize: 14, fontWeight: '600', marginBottom: 2 }}>{s.title}</Text>
                <Text style={{ color: LUCY_COLORS.textSubtle, fontSize: 13, lineHeight: 19 }}>{s.body}</Text>
              </View>
            </View>
          ))}

          <View style={{ backgroundColor: LUCY_COLORS.surface, borderRadius: 12, padding: 14, marginTop: 4, marginBottom: 16, borderWidth: 1, borderColor: LUCY_COLORS.border }}>
            <Text style={{ color: LUCY_COLORS.textSubtle, fontSize: 11, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 10 }}>LUCY URLs to paste into Shortcuts</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 10 }}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: LUCY_COLORS.textDark, fontSize: 12, fontWeight: '600' }}>Smart (commands + notes)</Text>
                <Text style={{ color: LUCY_COLORS.textMuted, fontSize: 11, marginTop: 2 }} numberOfLines={1}>{LUCY_VOICE_URL}</Text>
              </View>
              <TouchableOpacity onPress={() => void copy('voice')} style={{ marginLeft: 10, backgroundColor: copied === 'voice' ? '#22C55E22' : LUCY_COLORS.surfaceRaised, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 }}>
                <Text style={{ color: copied === 'voice' ? '#22C55E' : LUCY_COLORS.primary, fontSize: 12, fontWeight: '600' }}>{copied === 'voice' ? 'Copied!' : 'Copy'}</Text>
              </TouchableOpacity>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: LUCY_COLORS.textDark, fontSize: 12, fontWeight: '600' }}>Direct capture (save verbatim)</Text>
                <Text style={{ color: LUCY_COLORS.textMuted, fontSize: 11, marginTop: 2 }} numberOfLines={1}>{LUCY_CAPTURE_URL}</Text>
              </View>
              <TouchableOpacity onPress={() => void copy('capture')} style={{ marginLeft: 10, backgroundColor: copied === 'capture' ? '#22C55E22' : LUCY_COLORS.surfaceRaised, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 }}>
                <Text style={{ color: copied === 'capture' ? '#22C55E' : LUCY_COLORS.primary, fontSize: 12, fontWeight: '600' }}>{copied === 'capture' ? 'Copied!' : 'Copy'}</Text>
              </TouchableOpacity>
            </View>
          </View>

          <TouchableOpacity
            onPress={() => void Linking.openURL('shortcuts://')}
            style={{ backgroundColor: LUCY_COLORS.primary, borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginBottom: 12 }}
          >
            <Text style={{ color: '#fff', fontSize: 15, fontWeight: '700' }}>Open Shortcuts App →</Text>
          </TouchableOpacity>
          <Text style={{ color: LUCY_COLORS.textSubtle, fontSize: 11, textAlign: 'center', lineHeight: 17 }}>
            Replace [Dictated Text] in the URL with the Shortcuts variable by tapping inside the URL field and inserting the variable from the magic wand menu.
          </Text>
        </ScrollView>
      </View>
    </Modal>
  );
}

function VoicePicker({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const [voices, setVoices] = useState<TtsVoice[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!visible) return;
    void (async () => {
      setLoading(true);
      try {
        await loadVoicePrefs();
        setSelectedId(getSelectedVoiceId());
        setVoices(await listVoices());
      } finally {
        setLoading(false);
      }
    })();
  }, [visible]);

  // Selecting a voice both applies it and previews it.
  const pick = async (voiceId: string | null) => {
    await setVoice(voiceId);
    setSelectedId(voiceId);
    void speak("Hi, I'm Lucy. This is how I sound.");
  };

  const isQuality = (q?: string): boolean => {
    const s = (q ?? '').toLowerCase();
    return s.includes('enhanced') || s.includes('premium');
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: LUCY_COLORS.background }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 20, paddingBottom: 14, borderBottomWidth: 1, borderBottomColor: LUCY_COLORS.border }}>
          <Text style={{ color: LUCY_COLORS.textDark, fontSize: 17, fontWeight: '700' }}>Lucy's voice</Text>
          <TouchableOpacity onPress={onClose} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
            <Text style={{ color: LUCY_COLORS.primary, fontSize: 15, fontWeight: '600' }}>Done</Text>
          </TouchableOpacity>
        </View>
        <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40 }}>
          <Text style={{ color: LUCY_COLORS.textSubtle, fontSize: 13, lineHeight: 20, marginBottom: 16 }}>
            Pick the voice Lucy speaks with. Tap any voice to hear a quick preview and select it.
          </Text>

          {/* System default option */}
          <TouchableOpacity
            onPress={() => void pick(null)}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12, paddingHorizontal: 14, backgroundColor: selectedId === null ? LUCY_COLORS.primarySoft : LUCY_COLORS.surface, borderRadius: 12, marginBottom: 8, borderWidth: 1, borderColor: selectedId === null ? LUCY_COLORS.primary : LUCY_COLORS.border }}
          >
            <View style={{ flex: 1 }}>
              <Text style={{ color: LUCY_COLORS.textDark, fontSize: 14, fontWeight: '700' }}>System default</Text>
              <Text style={{ color: LUCY_COLORS.textSubtle, fontSize: 11 }}>Use your device's default voice</Text>
            </View>
            {selectedId === null ? <Text style={{ color: LUCY_COLORS.primaryGlow, fontSize: 15, fontWeight: '800' }}>✓</Text> : null}
          </TouchableOpacity>

          {loading ? (
            <Text style={{ color: LUCY_COLORS.textSubtle, fontSize: 12, marginTop: 8 }}>Loading voices…</Text>
          ) : voices.length === 0 ? (
            <Text style={{ color: LUCY_COLORS.textSubtle, fontSize: 12, marginTop: 8 }}>No additional voices found on this device.</Text>
          ) : (
            voices.map((v) => {
              const selected = selectedId === v.identifier;
              return (
                <View
                  key={v.identifier}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 11, paddingHorizontal: 14, backgroundColor: selected ? LUCY_COLORS.primarySoft : LUCY_COLORS.surface, borderRadius: 12, marginBottom: 8, borderWidth: 1, borderColor: selected ? LUCY_COLORS.primary : LUCY_COLORS.border }}
                >
                  <TouchableOpacity style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 }} onPress={() => void pick(v.identifier)}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: LUCY_COLORS.textDark, fontSize: 14, fontWeight: '700' }}>{v.name}</Text>
                      <Text style={{ color: LUCY_COLORS.textSubtle, fontSize: 11 }}>{v.language}</Text>
                    </View>
                    {isQuality(v.quality) ? (
                      <View style={{ backgroundColor: LUCY_COLORS.surfaceRaised, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3, borderWidth: 1, borderColor: LUCY_COLORS.border }}>
                        <Text style={{ color: LUCY_COLORS.primaryGlow, fontSize: 10, fontWeight: '800', letterSpacing: 0.5 }}>Enhanced</Text>
                      </View>
                    ) : null}
                    {selected ? <Text style={{ color: LUCY_COLORS.primaryGlow, fontSize: 15, fontWeight: '800' }}>✓</Text> : null}
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => void pick(v.identifier)}
                    style={{ backgroundColor: LUCY_COLORS.surfaceRaised, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 7, borderWidth: 1, borderColor: LUCY_COLORS.border }}
                  >
                    <Text style={{ color: LUCY_COLORS.primary, fontSize: 12, fontWeight: '700' }}>Preview</Text>
                  </TouchableOpacity>
                </View>
              );
            })
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}

function SettingsSectionLabel({ label }: { label: string }) {
  return (
    <View style={{ paddingHorizontal: 16, paddingTop: 22, paddingBottom: 6 }}>
      <Text style={{ color: LUCY_COLORS.textSubtle, fontSize: 10, fontWeight: '800', letterSpacing: 1.4, textTransform: 'uppercase' }}>{label}</Text>
    </View>
  );
}

/**
 * Collapsible settings group — a calm accordion card. Header shows an icon +
 * title + one-line summary + a status pill + a chevron that rotates on expand.
 * Collapsed by default so the screen presents one focal area at a time.
 */
function SettingsGroup({
  icon,
  title,
  summary,
  pill,
  defaultExpanded = false,
  children,
}: {
  icon: string;
  title: string;
  summary: string;
  pill?: string;
  defaultExpanded?: boolean;
  children: ReactNode;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const chevron = useRef(new Animated.Value(defaultExpanded ? 1 : 0)).current;

  const toggle = () => {
    const next = !expanded;
    setExpanded(next);
    Animated.timing(chevron, {
      toValue: next ? 1 : 0,
      duration: 180,
      useNativeDriver: true,
    }).start();
  };

  const rotate = chevron.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '180deg'] });

  return (
    <View style={[styles.group, expanded && styles.groupExpanded]}>
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityLabel={`${title}. ${summary}`}
        activeOpacity={0.78}
        onPress={toggle}
        style={styles.groupHeader}
      >
        <View style={styles.groupIcon}>
          <Text style={styles.groupIconText}>{icon}</Text>
        </View>
        <View style={styles.flex}>
          <Text style={styles.groupTitle}>{title}</Text>
          <Text style={styles.groupSummary} numberOfLines={1}>{summary}</Text>
        </View>
        {pill ? (
          <View style={styles.groupPill}>
            <Text style={styles.groupPillText}>{pill}</Text>
          </View>
        ) : null}
        <Animated.Text style={[styles.groupChevron, { transform: [{ rotate }] }]}>⌄</Animated.Text>
      </TouchableOpacity>
      {expanded ? <View style={styles.groupBody}>{children}</View> : null}
    </View>
  );
}

function SettingsRow({
  title,
  value,
  badge,
  active = false,
  actionLabel,
  actionDisabled,
  actionDestructive,
  onAction,
  onInfo,
}: {
  title: string;
  value: string;
  badge?: string;
  active?: boolean;
  actionLabel?: string;
  actionDisabled?: boolean;
  actionDestructive?: boolean;
  onAction?: () => void;
  onInfo?: () => void;
}) {
  return (
    <View style={styles.settingRow}>
      <TouchableOpacity
        accessibilityLabel={`Open ${title}`}
        activeOpacity={0.74}
        onPress={onInfo}
        style={styles.rowDetails}
      >
        <View style={styles.flex}>
          <Text style={styles.cardTitle}>{title}</Text>
          <Text style={styles.settingValue}>{value}</Text>
        </View>
        {badge ? <StatusPill label={badge} active={active} /> : null}
        <View style={styles.infoButton}>
          <Text style={styles.infoText}>i</Text>
        </View>
      </TouchableOpacity>
      {actionLabel ? (
        <TouchableOpacity disabled={actionDisabled} onPress={onAction} style={[styles.rowAction, actionDisabled && styles.dim, actionDestructive && styles.rowActionDestructive]}>
          <Text style={[styles.rowActionText, actionDestructive && styles.rowActionTextDestructive]}>{actionLabel}</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

function SettingsSheet({ title, visible, children, onClose }: { title: string; visible: boolean; children: ReactNode; onClose: () => void }) {
  return (
    <Modal animationType="fade" transparent visible={visible} onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={0}
        style={styles.modalOverlay}
      >
          <TouchableOpacity accessibilityLabel="Close settings details" activeOpacity={1} onPress={onClose} style={styles.scrim} />
          <View style={styles.sheet}>
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>{title}</Text>
              <TouchableOpacity onPress={onClose} style={styles.closeButton}>
                <Text style={styles.closeText}>Close</Text>
              </TouchableOpacity>
            </View>
            <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} contentContainerStyle={styles.sheetContent}>
              {children}
            </ScrollView>
          </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function StatusPill({ active, label }: { active: boolean; label: string }) {
  return (
    <View style={[styles.statusPill, active && styles.statusPillActive]}>
      <Text style={[styles.statusText, active && styles.statusTextActive]}>{label}</Text>
    </View>
  );
}

function PrimaryButton({ disabled, label, onPress }: { disabled: boolean; label: string; onPress: () => void }) {
  return (
    <TouchableOpacity disabled={disabled} onPress={onPress} style={[styles.button, styles.buttonPrimary, disabled && styles.dim]}>
      <Text style={[styles.buttonLabel, styles.buttonLabelPrimary]}>{label}</Text>
    </TouchableOpacity>
  );
}

function SecondaryButton({ disabled, label, onPress }: { disabled: boolean; label: string; onPress: () => void }) {
  return (
    <TouchableOpacity disabled={disabled} onPress={onPress} style={[styles.button, disabled && styles.dim]}>
      <Text style={styles.buttonLabel}>{label}</Text>
    </TouchableOpacity>
  );
}

function ModelRow({ m, selected, color, onSelect }: { m: { id: string; label: string; desc: string }; selected: boolean; color: string; onSelect: () => void }) {
  return (
    <TouchableOpacity
      style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 9, paddingHorizontal: 12, backgroundColor: selected ? color + '18' : LUCY_COLORS.surface, borderRadius: 10, marginBottom: 5, borderWidth: 1, borderColor: selected ? color : LUCY_COLORS.border }}
      onPress={onSelect}
    >
      <View style={{ width: 13, height: 13, borderRadius: 7, borderWidth: 2, borderColor: color, backgroundColor: selected ? color : 'transparent' }} />
      <View style={{ flex: 1 }}>
        <Text style={{ color: LUCY_COLORS.textDark, fontSize: 13, fontWeight: '700' }}>{m.label}</Text>
        <Text style={{ color: LUCY_COLORS.textSubtle, fontSize: 11 }}>{m.desc}</Text>
      </View>
      {selected ? <Text style={{ color, fontSize: 13, fontWeight: '800' }}>✓</Text> : null}
    </TouchableOpacity>
  );
}

function QueuePanel({ queue, onRetry }: { queue: CaptureQueueSummary; onRetry: () => Promise<void> }) {
  const [retrying, setRetrying] = useState(false);
  const [stuck, setStuck] = useState<Array<{ id: number; raw_transcript: string | null; extracted_title: string | null; processing_error: string | null }>>([]);
  const [queued, setQueued] = useState<Array<{ id: number; raw_transcript: string | null; extracted_title: string | null }>>([]);
  const [diag, setDiag] = useState<{ model: string; available: boolean } | null>(null);
  const [errors, setErrors] = useState<Array<{ id: number; occurred_at: string; context: string; message: string }>>([]);
  const [showErrors, setShowErrors] = useState(false);
  const [guard, setGuard] = useState<{ enabled: boolean; max: number; used: number; snoozedUntil: string | null } | null>(null);
  const [guardRefresh, setGuardRefresh] = useState(0);

  useEffect(() => {
    void (async () => {
      const [{ resolveRemoteAvailability }, { getPreferredModel }, { config }] = await Promise.all([
        import('../ai/provider'), import('../ai/modelPreference'), import('../config'),
      ]);
      const model = getPreferredModel(config.openAIModel);
      const { available } = await resolveRemoteAvailability();
      setDiag({ model, available });
      try {
        const db = await getDatabase();
        const { listRecentErrors } = await import('../db/errorLog');
        setErrors(await listRecentErrors(db, 20));
        const { getCostGuard } = await import('../ai/rateLimit');
        setGuard(await getCostGuard(db));
      } catch { /* non-critical */ }
    })();
  }, [queue.queued, queue.complete, queue.retrying, guardRefresh]);

  const toggleGuard = async () => {
    const db = await getDatabase();
    const { COST_GUARD_ENABLED_KEY } = await import('../ai/rateLimit');
    await setSetting(db, COST_GUARD_ENABLED_KEY, guard?.enabled ? 'false' : 'true');
    setGuardRefresh((v) => v + 1);
  };

  const cycleGuardLimit = async () => {
    const presets = [60, 120, 240, 500];
    const next = presets[(presets.indexOf(guard?.max ?? 120) + 1) % presets.length];
    const db = await getDatabase();
    const { COST_GUARD_MAX_KEY } = await import('../ai/rateLimit');
    await setSetting(db, COST_GUARD_MAX_KEY, String(next));
    setGuardRefresh((v) => v + 1);
  };

  const snoozeGuard = async () => {
    const db = await getDatabase();
    const { snoozeCostGuard } = await import('../ai/rateLimit');
    const isSnoozed = !!guard?.snoozedUntil;
    if (isSnoozed) {
      await snoozeCostGuard(db, 0);
      setGuardRefresh((v) => v + 1);
      return;
    }
    Alert.alert('Pause cost guard', 'Temporarily allow unlimited AI calls (e.g. for a bulk import). It re-enables automatically.', [
      { text: 'Cancel', style: 'cancel' },
      { text: '30 min', onPress: async () => { await snoozeCostGuard(db, 30); setGuardRefresh((v) => v + 1); } },
      { text: '1 hour', onPress: async () => { await snoozeCostGuard(db, 60); setGuardRefresh((v) => v + 1); } },
      { text: '3 hours', onPress: async () => { await snoozeCostGuard(db, 180); setGuardRefresh((v) => v + 1); } },
    ]);
  };

  useEffect(() => {
    void (async () => {
      const db = await getDatabase();
      const { getRetryingCaptures } = await import('../db/captures');
      setStuck(await getRetryingCaptures(db));
      // Also show queued items so user can see what's pending
      const queuedItems = await db.getAllAsync<{ id: number; raw_transcript: string | null; extracted_title: string | null }>(
        `SELECT id, raw_transcript, extracted_title FROM captures WHERE processed = 0 AND archived_at IS NULL ORDER BY created_at DESC LIMIT 5`,
      );
      setQueued(queuedItems);
    })();
  }, [queue.queued, queue.retrying]);

  const deleteQueueItem = async (id: number) => {
    const db = await getDatabase();
    const { archiveCapture } = await import('../db/captures');
    await archiveCapture(db, id, 'deleted from queue by user');
    setQueued((prev) => prev.filter((c) => c.id !== id));
    setStuck((prev) => prev.filter((c) => c.id !== id));
  };

  const renderCapture = (c: { id: number; raw_transcript: string | null; extracted_title: string | null; processing_error?: string | null }, color: string = LUCY_COLORS.surface) => (
    <View key={c.id} style={{ backgroundColor: color, borderRadius: 10, padding: 10, marginTop: 6, gap: 3, flexDirection: 'row', alignItems: 'flex-start' }}>
      <View style={{ flex: 1, gap: 3 }}>
        <Text style={{ color: LUCY_COLORS.textDark, fontSize: 13, fontWeight: '600' }} numberOfLines={1}>
          {c.extracted_title ?? c.raw_transcript?.slice(0, 80) ?? '(no text)'}
        </Text>
        {c.raw_transcript && !c.extracted_title ? (
          <Text style={{ color: LUCY_COLORS.textSubtle, fontSize: 11 }} numberOfLines={1}>
            {c.raw_transcript.slice(0, 100)}
          </Text>
        ) : null}
        {c.processing_error ? (
          <Text style={{ color: '#ef4444', fontSize: 11 }} numberOfLines={1}>Error: {c.processing_error}</Text>
        ) : null}
      </View>
      <TouchableOpacity
        onPress={() => void deleteQueueItem(c.id)}
        style={{ padding: 4, marginLeft: 6 }}
      >
        <Text style={{ color: '#ef4444', fontSize: 16, fontWeight: '700' }}>✕</Text>
      </TouchableOpacity>
    </View>
  );

  return (
    <>
      <View style={styles.metrics}>
        <Metric label="Queued" value={queue.queued} />
        <Metric label="Organizing" value={queue.processing} />
        <Metric label="Will retry" value={queue.retrying} warm />
        <Metric label="Remembered" value={queue.complete} />
        <Metric label="Archived" value={queue.archived} />
      </View>

      {diag ? (
        <View style={{ marginTop: 10, padding: 10, borderRadius: 10, backgroundColor: LUCY_COLORS.surface, borderWidth: 1, borderColor: diag.available ? LUCY_COLORS.border : '#ef4444' }}>
          <Text style={{ color: LUCY_COLORS.textSubtle, fontSize: 10, fontWeight: '800', letterSpacing: 1.2 }}>PROCESSING WITH</Text>
          <Text style={{ color: LUCY_COLORS.textDark, fontSize: 13, fontWeight: '700', marginTop: 3 }}>
            {findModel(diag.model)?.label ?? diag.model}
          </Text>
          <Text style={{ color: diag.available ? '#4ADE80' : '#ef4444', fontSize: 11, fontWeight: '600', marginTop: 2 }}>
            {diag.available
              ? 'Remote ready — captures will process'
              : 'Remote unavailable — captures will stay queued. Check your API key / Remote intelligence toggle.'}
          </Text>
        </View>
      ) : null}

      {guard ? (
        <View style={{ marginTop: 10, padding: 10, borderRadius: 10, backgroundColor: LUCY_COLORS.surface, borderWidth: 1, borderColor: guard.enabled && guard.used >= guard.max ? '#F59E0B' : LUCY_COLORS.border }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Text style={{ color: LUCY_COLORS.textSubtle, fontSize: 10, fontWeight: '800', letterSpacing: 1.2 }}>COST GUARD</Text>
            <TouchableOpacity onPress={() => void toggleGuard()} style={{ paddingHorizontal: 10, paddingVertical: 3, borderRadius: 8, backgroundColor: guard.enabled ? LUCY_COLORS.primarySoft : LUCY_COLORS.surfaceRaised, borderWidth: 1, borderColor: guard.enabled ? LUCY_COLORS.primary : LUCY_COLORS.border }}>
              <Text style={{ color: guard.enabled ? LUCY_COLORS.primary : LUCY_COLORS.textSubtle, fontSize: 11, fontWeight: '800' }}>{guard.enabled ? 'ON' : 'OFF'}</Text>
            </TouchableOpacity>
          </View>
          {guard.enabled ? (
            <>
              {guard.snoozedUntil ? (
                <Text style={{ color: '#4ADE80', fontSize: 11, fontWeight: '600', marginTop: 4 }}>
                  Paused (unlimited) until {new Date(guard.snoozedUntil).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                </Text>
              ) : (
                <Text style={{ color: guard.used >= guard.max ? '#F59E0B' : LUCY_COLORS.textMuted, fontSize: 11, fontWeight: '600', marginTop: 4 }}>
                  {guard.used} / {guard.max} AI calls this hour{guard.used >= guard.max ? ' — paused until the hour clears' : ''}
                </Text>
              )}
              <View style={{ flexDirection: 'row', gap: 14, marginTop: 6 }}>
                <TouchableOpacity onPress={() => void cycleGuardLimit()}>
                  <Text style={{ color: LUCY_COLORS.primary, fontSize: 11, fontWeight: '700' }}>Limit: {guard.max}/hr</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => void snoozeGuard()}>
                  <Text style={{ color: guard.snoozedUntil ? '#4ADE80' : LUCY_COLORS.primary, fontSize: 11, fontWeight: '700' }}>{guard.snoozedUntil ? 'Resume now' : 'Pause for a while'}</Text>
                </TouchableOpacity>
              </View>
            </>
          ) : (
            <Text style={{ color: LUCY_COLORS.textSubtle, fontSize: 11, marginTop: 4 }}>No automatic limit on AI calls. Tap ON to cap spend.</Text>
          )}
        </View>
      ) : null}

      {queued.length > 0 ? (
        <>
          <Text style={{ color: LUCY_COLORS.primary, fontSize: 11, fontWeight: '800', letterSpacing: 1.2, marginTop: 12, marginBottom: 2 }}>WAITING TO PROCESS</Text>
          {queued.map((c) => renderCapture(c))}
        </>
      ) : null}

      {stuck.length > 0 ? (
        <>
          <Text style={{ color: '#F59E0B', fontSize: 11, fontWeight: '800', letterSpacing: 1.2, marginTop: 12, marginBottom: 2 }}>STUCK — WILL RETRY</Text>
          {stuck.map((c) => renderCapture(c, 'rgba(245,158,11,0.08)'))}
          <TouchableOpacity
            style={{ marginTop: 10, backgroundColor: LUCY_COLORS.primary, borderRadius: 12, paddingVertical: 12, alignItems: 'center', opacity: retrying ? 0.6 : 1 }}
            disabled={retrying}
            onPress={async () => { setRetrying(true); await onRetry().finally(() => setRetrying(false)); }}
          >
            <Text style={{ color: '#fff', fontWeight: '700', fontSize: 14 }}>{retrying ? 'Retrying...' : `Retry now (${queue.retrying})`}</Text>
          </TouchableOpacity>
        </>
      ) : null}

      <Text style={[styles.detail, { marginTop: 8 }]}>
        Unfinished thoughts retry automatically. Tap "Retry now" to force them immediately.
      </Text>

      {errors.length > 0 ? (
        <View style={{ marginTop: 14 }}>
          <TouchableOpacity
            onPress={() => setShowErrors((v) => !v)}
            style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}
          >
            <Text style={{ color: LUCY_COLORS.textSubtle, fontSize: 11, fontWeight: '800', letterSpacing: 1.2 }}>
              RECENT ERRORS ({errors.length})
            </Text>
            <Text style={{ color: LUCY_COLORS.textSubtle, fontSize: 14 }}>{showErrors ? '▾' : '▸'}</Text>
          </TouchableOpacity>
          {showErrors ? (
            <>
              {errors.map((e) => (
                <View key={e.id} style={{ backgroundColor: LUCY_COLORS.surface, borderRadius: 8, padding: 8, marginTop: 6, borderWidth: 1, borderColor: 'rgba(239,68,68,0.25)' }}>
                  <Text style={{ color: LUCY_COLORS.textSubtle, fontSize: 10 }}>{e.context} · {e.occurred_at}</Text>
                  <Text style={{ color: '#ef4444', fontSize: 11 }} numberOfLines={3}>{e.message}</Text>
                </View>
              ))}
              <TouchableOpacity
                onPress={async () => { const db = await getDatabase(); const { clearErrorLog } = await import('../db/errorLog'); await clearErrorLog(db); setErrors([]); }}
                style={{ marginTop: 8, alignSelf: 'flex-start' }}
              >
                <Text style={{ color: LUCY_COLORS.textMuted, fontSize: 12, fontWeight: '700' }}>Clear errors</Text>
              </TouchableOpacity>
            </>
          ) : null}
        </View>
      ) : null}
    </>
  );
}

function Metric({ label, value, warm }: { label: string; value: number; warm?: boolean }) {
  return (
    <View style={styles.metric}>
      <Text style={[styles.metricValue, warm && value > 0 && styles.warm]}>{value}</Text>
      <Text style={styles.metricLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  listContent: { paddingTop: 18, paddingBottom: 48 },
  title: { fontSize: 30, letterSpacing: -0.8, fontWeight: '700', color: LUCY_COLORS.textDark, marginBottom: 6 },
  subtitle: { color: LUCY_COLORS.textMuted, fontSize: 14, marginTop: 4, marginBottom: 18, lineHeight: 20 },
  themeHint: { color: LUCY_COLORS.textMuted, fontSize: 12.5, lineHeight: 18, marginBottom: 12 },
  themeRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 6 },
  themeChip: { alignItems: 'center', flex: 1, gap: 6 },
  themeSwatch: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: 'transparent' },
  themeSwatchActive: { borderColor: LUCY_COLORS.textDark },
  themeCheck: { color: '#0B0B0F', fontSize: 18, fontWeight: '900' },
  themeLabel: { color: LUCY_COLORS.textSubtle, fontSize: 10.5, fontWeight: '700' },
  themeLabelActive: { color: LUCY_COLORS.textDark },
  list: { backgroundColor: LUCY_COLORS.surfaceRaised, borderRadius: 21, borderWidth: 1, borderColor: LUCY_COLORS.border, overflow: 'hidden' },
  // ─── Collapsible group (accordion) ──────────────────────────────────────
  group: { backgroundColor: LUCY_COLORS.surface, borderRadius: 20, borderWidth: 1, borderColor: LUCY_COLORS.border, marginBottom: 12, overflow: 'hidden' },
  groupExpanded: { borderColor: LUCY_COLORS.primaryLine, backgroundColor: LUCY_COLORS.surfaceRaised },
  groupHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 16, minHeight: 64 },
  groupIcon: { width: 38, height: 38, borderRadius: 12, backgroundColor: LUCY_COLORS.primaryMist, borderWidth: 1, borderColor: LUCY_COLORS.primaryLine, alignItems: 'center', justifyContent: 'center' },
  groupIconText: { fontSize: 18 },
  groupTitle: { color: LUCY_COLORS.textDark, fontSize: 16, fontWeight: '800', letterSpacing: -0.2 },
  groupSummary: { color: LUCY_COLORS.textSubtle, fontSize: 12, marginTop: 3 },
  groupPill: { borderRadius: 999, backgroundColor: LUCY_COLORS.primarySoft, paddingHorizontal: 10, paddingVertical: 5 },
  groupPillText: { color: LUCY_COLORS.primaryGlow, fontWeight: '800', fontSize: 11 },
  groupChevron: { color: LUCY_COLORS.textMuted, fontSize: 18, fontWeight: '800', width: 20, textAlign: 'center' },
  groupBody: { borderTopWidth: 1, borderTopColor: LUCY_COLORS.divider, backgroundColor: LUCY_COLORS.surfaceRaised, overflow: 'hidden' },
  settingRow: { minHeight: 66, paddingLeft: 15, paddingRight: 11, borderBottomWidth: 1, borderBottomColor: LUCY_COLORS.border, flexDirection: 'row', alignItems: 'center', gap: 9 },
  rowDetails: { flex: 1, minHeight: 66, paddingVertical: 11, flexDirection: 'row', alignItems: 'center', gap: 9 },
  flex: { flex: 1 },
  cardTitle: { color: LUCY_COLORS.textDark, fontSize: 15, fontWeight: '700' },
  settingValue: { color: LUCY_COLORS.textMuted, fontSize: 12, marginTop: 4 },
  detail: { color: LUCY_COLORS.textMuted, fontSize: 14, lineHeight: 21 },
  hint: { color: LUCY_COLORS.textSubtle, fontSize: 12, lineHeight: 18, marginBottom: 12 },
  fieldLabel: { color: LUCY_COLORS.textMuted, fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6, marginTop: 12 },
  profileInput: { backgroundColor: LUCY_COLORS.surface, borderWidth: 1, borderColor: LUCY_COLORS.border, borderRadius: 12, padding: 12, color: LUCY_COLORS.textDark, fontSize: 15 },
  profileInputMulti: { minHeight: 80, textAlignVertical: 'top' },
  keyLabel: { color: LUCY_COLORS.textDark, fontSize: 13, fontWeight: '700' },
  activity: { color: LUCY_COLORS.textDark, fontSize: 14, lineHeight: 20, fontWeight: '600' },
  failure: { color: '#FDA4AF', fontSize: 12, lineHeight: 18 },
  statusPill: { borderRadius: 15, backgroundColor: LUCY_COLORS.surface, paddingHorizontal: 9, paddingVertical: 6 },
  statusPillActive: { backgroundColor: LUCY_COLORS.primarySoft },
  statusText: { color: LUCY_COLORS.textMuted, fontWeight: '700', fontSize: 11 },
  statusTextActive: { color: LUCY_COLORS.primaryGlow },
  rowAction: { borderRadius: 14, backgroundColor: LUCY_COLORS.primarySoft, paddingHorizontal: 12, paddingVertical: 8 },
  rowActionText: { color: LUCY_COLORS.primaryGlow, fontWeight: '700', fontSize: 12 },
  rowActionDestructive: { backgroundColor: 'rgba(251,113,133,0.12)' },
  rowActionTextDestructive: { color: '#FB7185' },
  infoButton: { width: 28, height: 28, borderRadius: 14, borderWidth: 1, borderColor: LUCY_COLORS.border, justifyContent: 'center', alignItems: 'center' },
  infoText: { color: LUCY_COLORS.textMuted, fontSize: 15, fontWeight: '700', fontStyle: 'italic' },
  button: { borderRadius: 14, borderWidth: 1, borderColor: LUCY_COLORS.border, alignItems: 'center', paddingVertical: 13 },
  buttonPrimary: { backgroundColor: LUCY_COLORS.primary, borderColor: LUCY_COLORS.primary },
  buttonLabel: { color: LUCY_COLORS.textDark, fontWeight: '700', fontSize: 14 },
  buttonLabelPrimary: { color: LUCY_COLORS.white },
  dim: { opacity: 0.55 },
  modalOverlay: { flex: 1, justifyContent: 'flex-end' },
  scrim: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: 'rgba(3, 8, 10, 0.68)' },
  sheet: { maxHeight: '80%', backgroundColor: LUCY_COLORS.surfaceRaised, borderTopLeftRadius: 25, borderTopRightRadius: 25, borderWidth: 1, borderColor: LUCY_COLORS.border, padding: 19 },
  sheetHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 15, gap: 10 },
  sheetTitle: { flex: 1, color: LUCY_COLORS.textDark, fontSize: 19, fontWeight: '700' },
  closeButton: { paddingVertical: 7, paddingHorizontal: 11, borderRadius: 13, backgroundColor: LUCY_COLORS.surface },
  closeText: { color: LUCY_COLORS.textMuted, fontSize: 12, fontWeight: '700' },
  sheetContent: { gap: 12, paddingBottom: 8 },
  metrics: { flexDirection: 'row', gap: 7 },
  metric: { flex: 1, backgroundColor: LUCY_COLORS.surface, borderRadius: 13, paddingVertical: 11, alignItems: 'center' },
  metricValue: { color: LUCY_COLORS.textDark, fontSize: 18, fontWeight: '700' },
  metricLabel: { color: LUCY_COLORS.textMuted, fontSize: 10, fontWeight: '600', marginTop: 4 },
  warm: { color: LUCY_COLORS.primaryGlow },
  benchmarkRow: { flexDirection: 'row', gap: 10, alignItems: 'flex-start', paddingVertical: 4 },
  benchmarkTitle: { color: LUCY_COLORS.textDark, fontSize: 14, fontWeight: '700', marginBottom: 3 },
  benchmarkStatus: { fontSize: 12, fontWeight: '700', paddingTop: 2 },
  pass: { color: LUCY_COLORS.success },
  fail: { color: LUCY_COLORS.error },
  modelOption: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 11, borderRadius: 13, backgroundColor: LUCY_COLORS.surface, borderWidth: 1, borderColor: LUCY_COLORS.border },
  modelOptionSelected: { borderColor: LUCY_COLORS.primary, backgroundColor: LUCY_COLORS.primarySoft },
  modelName: { color: LUCY_COLORS.textDark, fontSize: 13, fontWeight: '700', marginBottom: 3 },
  modelChoice: { color: LUCY_COLORS.primaryGlow, fontSize: 12, fontWeight: '700' },
  keyInput: { borderRadius: 14, borderWidth: 1, borderColor: LUCY_COLORS.border, color: LUCY_COLORS.textDark, backgroundColor: LUCY_COLORS.surface, paddingHorizontal: 13, paddingVertical: 12, fontSize: 14 },
});
