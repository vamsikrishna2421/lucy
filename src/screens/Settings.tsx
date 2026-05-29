import { useEffect, useState, type ReactNode } from 'react';
import { Alert, KeyboardAvoidingView, Modal, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { clearDownloadedDeviceModels, getDeviceModelState, prepareDeviceModel, selectDeviceModel, subscribeToDeviceModel, type DeviceModelState } from '../ai/device';
import { localModelOptions, type LocalModelId } from '../ai/modelCatalog';
import { getRemoteAccessState, removeRemoteOpenAIKey, setRemoteEnabled, storeRemoteOpenAIKey, type RemoteAccessState } from '../ai/remoteAccess';
import { config } from '../config';
import { LUCY_COLORS } from '../config/colors';
import { getDatabase } from '../db';
import { getCaptureQueueSummary, type CaptureQueueSummary } from '../db/captures';
import { getLatestOrganizationRun, type OrganizationRunRow } from '../db/knowledge';
import { getSetting, setSetting } from '../db/settings';
import { getBackgroundProcessingState, type BackgroundProcessingState } from '../processing/background';
import { runEnglishDeviceBenchmark, type BenchmarkResult } from '../processing/benchmark';
import { organizeMemory } from '../processing/organizer';
import { scheduleProgressCheckIn, cancelProgressCheckIn } from '../processing/notifications';
import { getUserProfile, saveUserProfile, type UserProfile } from '../db/userProfile';

interface SettingsScreenProps {
  backgroundEnabled: boolean;
  refreshToken: number;
  onChangeBackground: (enabled: boolean) => Promise<boolean>;
  onReprocessAll: () => Promise<number>;
}

type SettingsPanel = 'intelligence' | 'remote' | 'background' | 'organization' | 'queue' | 'privacy' | 'profile' | null;

const emptyQueue: CaptureQueueSummary = { queued: 0, processing: 0, retrying: 0, complete: 0, archived: 0 };
const emptyRemote: RemoteAccessState = { enabled: false, hasKey: false, usingDevelopmentKey: false, modelName: 'gpt-5.4-nano' };

export function SettingsScreen({ backgroundEnabled, refreshToken, onChangeBackground, onReprocessAll }: SettingsScreenProps) {
  const [activePanel, setActivePanel] = useState<SettingsPanel>(null);
  const [queue, setQueue] = useState(emptyQueue);
  const [background, setBackground] = useState<BackgroundProcessingState>();
  const [changingBackground, setChangingBackground] = useState(false);
  const [localRefresh, setLocalRefresh] = useState(0);
  const [deviceModel, setDeviceModel] = useState<DeviceModelState>(getDeviceModelState());
  const [preparingModel, setPreparingModel] = useState(false);
  const [clearingModel, setClearingModel] = useState(false);
  const [selectingModel, setSelectingModel] = useState(false);
  const [remote, setRemote] = useState<RemoteAccessState>(emptyRemote);
  const [remoteKey, setRemoteKey] = useState('');
  const [changingRemote, setChangingRemote] = useState(false);
  const [benchmarkRunning, setBenchmarkRunning] = useState(false);
  const [benchmarkProgress, setBenchmarkProgress] = useState('');
  const [benchmarkResults, setBenchmarkResults] = useState<BenchmarkResult[]>([]);
  const [organizationRun, setOrganizationRun] = useState<OrganizationRunRow | null>(null);
  const [organizingNow, setOrganizingNow] = useState(false);
  const [reprocessing, setReprocessing] = useState(false);
  const [profile, setProfile] = useState<UserProfile>({ name: '', about: '' });
  const [profileDraft, setProfileDraft] = useState<UserProfile>({ name: '', about: '' });
  const [savingProfile, setSavingProfile] = useState(false);
  const [checkInEnabled, setCheckInEnabled] = useState(false);

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
      setQueue(queueSummary);
      setBackground(state);
      setOrganizationRun(latestRun);
      setRemote(remoteState);
      setProfile(userProfile);
      setProfileDraft(userProfile);
      setCheckInEnabled(!!(await getSetting(db, 'progress_checkin_notification_id')));
    })();
  }, [backgroundEnabled, localRefresh, refreshToken]);

  useEffect(() => subscribeToDeviceModel(setDeviceModel), []);

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
      await storeRemoteOpenAIKey(remoteKey);
      await setRemoteEnabled(true);
      setRemoteKey('');
      setRemote(await getRemoteAccessState());
      Alert.alert('Remote intelligence ready', 'GPT-5.4 Nano can organize ordinary thoughts. Protected thoughts are first masked by on-device intelligence before any remote analysis.');
    } catch (error) {
      Alert.alert('Could not save key', error instanceof Error ? error.message : 'Please try again.');
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
    try {
      const db = await getDatabase();
      await organizeMemory(db, 'manual');
      setOrganizationRun(await getLatestOrganizationRun(db));
      setLocalRefresh((value) => value + 1);
    } finally {
      setOrganizingNow(false);
    }
  };

  const confirmFullReprocess = () => {
    Alert.alert(
      'Reprocess all memories?',
      'LUCY will keep every original thought, clear current derived interpretation, and rebuild it using the selected local model. This may take a long time for a deep model.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reprocess',
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
    <View style={styles.container}>
      <Text style={styles.title}>Settings</Text>
      <Text style={styles.subtitle}>Quiet controls for your memory.</Text>

      <View style={styles.list}>
        <SettingsRow
          title="Progress check-ins"
          value={checkInEnabled ? 'LUCY reminds you every 2 hours to capture updates' : 'Off — tap to turn on'}
          badge={checkInEnabled ? 'On' : 'Off'}
          active={checkInEnabled}
          onInfo={async () => {
            const db = await getDatabase();
            if (checkInEnabled) {
              const existingId = await getSetting(db, 'progress_checkin_notification_id');
              if (existingId) await cancelProgressCheckIn(existingId);
              await setSetting(db, 'progress_checkin_notification_id', '');
              setCheckInEnabled(false);
            } else {
              const id = await scheduleProgressCheckIn();
              if (id) {
                await setSetting(db, 'progress_checkin_notification_id', id);
                setCheckInEnabled(true);
                Alert.alert('Check-ins on', 'LUCY will nudge you every 2 hours to capture your progress.');
              }
            }
          }}
        />
        <SettingsRow
          title="About you"
          value={profile.name ? `${profile.name}${profile.about ? ' · ' + profile.about.slice(0, 30) + (profile.about.length > 30 ? '…' : '') : ''}` : 'Tell LUCY who you are'}
          badge={profile.name ? '✓' : 'Set up'}
          active={!!profile.name}
          onInfo={() => { setProfileDraft({ ...profile }); setActivePanel('profile'); }}
        />
        <SettingsRow
          title="On-device intelligence"
          value={modelStatus}
          badge={usesDeviceModel && deviceModel.status === 'ready' ? 'Local' : usesDeviceModel ? 'Setup' : 'Dev'}
          active={usesDeviceModel && deviceModel.status === 'ready'}
          onInfo={() => setActivePanel('intelligence')}
        />
        <SettingsRow
          title="Remote intelligence"
          value={remote.enabled ? 'GPT Nano with local protection' : remote.hasKey ? 'Ready, currently off' : 'Add your OpenAI key'}
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
        <SettingsRow
          title="Privacy"
          value="Original private thoughts stay local"
          onInfo={() => setActivePanel('privacy')}
        />
      </View>

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
            <Text style={styles.activity}>{remote.enabled ? 'Enabled' : remote.hasKey ? 'Key saved, disabled' : 'Not set up'}</Text>
            <Text style={styles.keyLabel}>OpenAI API key only</Text>
            <Text style={styles.hint}>LUCY currently uses your OpenAI key with GPT-5.4 Nano. Do not enter Claude or other provider tokens here.</Text>
            <TextInput
              autoCapitalize="none"
              autoCorrect={false}
              placeholder="Paste OpenAI key (sk-...)"
              placeholderTextColor={LUCY_COLORS.textSubtle}
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
          <>
            <View style={styles.metrics}>
              <Metric label="Queued" value={queue.queued} />
              <Metric label="Organizing" value={queue.processing} />
              <Metric label="Will retry" value={queue.retrying} warm />
              <Metric label="Remembered" value={queue.complete} />
              <Metric label="Archived" value={queue.archived} />
            </View>
            <Text style={styles.detail}>
              Unfinished thoughts retry automatically. Unmatched short updates are archived locally instead of repeatedly spending processing time.
            </Text>
          </>
        ) : null}

        {activePanel === 'privacy' ? (
          <Text style={styles.detail}>
            Original private thoughts stay encrypted on your device and remain visible to you in LUCY. With remote intelligence enabled, a protected thought can be sent for analysis only after the selected on-device model replaces private details with placeholders. This protection path is experimental during beta testing. Credentials and passwords remain masked in previews.
          </Text>
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
          </KeyboardAvoidingView>
        ) : null}
      </SettingsSheet>
    </View>
  );
}

function panelTitle(panel: SettingsPanel): string {
  switch (panel) {
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

function SettingsRow({
  title,
  value,
  badge,
  active = false,
  actionLabel,
  actionDisabled,
  onAction,
  onInfo,
}: {
  title: string;
  value: string;
  badge?: string;
  active?: boolean;
  actionLabel?: string;
  actionDisabled?: boolean;
  onAction?: () => void;
  onInfo: () => void;
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
        <TouchableOpacity disabled={actionDisabled} onPress={onAction} style={[styles.rowAction, actionDisabled && styles.dim]}>
          <Text style={styles.rowActionText}>{actionLabel}</Text>
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
  title: { fontSize: 30, letterSpacing: -0.8, fontWeight: '700', color: LUCY_COLORS.textDark },
  subtitle: { color: LUCY_COLORS.textMuted, fontSize: 14, marginTop: 4, marginBottom: 18, lineHeight: 20 },
  list: { backgroundColor: LUCY_COLORS.surfaceRaised, borderRadius: 21, borderWidth: 1, borderColor: LUCY_COLORS.border, overflow: 'hidden' },
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
