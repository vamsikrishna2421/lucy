/**
 * MoneyGoals — premium savings-goal tracker (Vamsi #2). A goal is a target amount with an optional
 * deadline, tracked by logged contributions; LUCY shows how much is saved, the %, days left, and
 * whether the current pace lands the goal on time.
 *
 * Design (docs/LUCY_DESIGN_SYSTEM.md): a calm, premium surface that matches ProjectsTab's card/sheet
 * vocabulary —
 *   header ("Goals" + ＋ New goal) → goal cards, each reading top→bottom:
 *     accent dot (color = pace state) + label + optional project chip + a quiet ✕ delete · big
 *     saved/target money line + a days-left chip · an animated progress bar that springs to its fill
 *     with a soft leading-edge glow (Wallet/Monzo-pot feel; color = pace, per brief) · the warm
 *     goalGuidance() line verbatim as caption · a filled ＋ Add primary. Completed goals settle into a
 *     calm 🎉 done state with a gentle one-shot celebration spring (Duolingo-style, but restrained).
 *   A confident empty state when there are no goals.
 *
 * Two bottom-sheet Modals (grip → eyebrow → title → fields → primary/secondary), each wrapped in
 * KeyboardAvoidingView so the keyboard never hides their TextInputs:
 *   - New goal: label, target (numeric), optional deadline (plain "YYYY-MM-DD", no new dep), currency.
 *   - Add contribution: "how much did you put aside?" amount (numeric) + optional note.
 *
 * Self-contained + ADDITIVE: it loads its own data and reloads on mount / refreshKey / after every
 * action, then calls onChange?.(). It only READS/WRITES through the pre-built db/moneyGoals +
 * processing/moneyGoals APIs (goalGuidance + formatMoney are shown verbatim — never rebuilt) and
 * changes no data model. RN primitives + Animated (native driver) only — no new deps, OTA-safe.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Easing,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { LUCY_COLORS } from '../config/colors';
import { haptic } from '../config/haptics';
import { getDatabase } from '../db';
import {
  addContribution,
  createMoneyGoal,
  deleteMoneyGoal,
  getGoalsWithProgress,
  type GoalWithProgress,
} from '../db/moneyGoals';
import { formatMoney, goalGuidance, type GoalProgress } from '../processing/moneyGoals';
import {
  createGoalFromSignal,
  dismissGoalSignal,
  getGoalSignal,
  type StoredGoalSignal,
} from '../processing/goalPlanner';
import { FadeInUp, PressableScale, Stagger } from './Motion';

interface MoneyGoalsProps {
  /** Bump to force a reload from a parent (e.g. after a voice command logs a contribution). */
  refreshKey?: number;
  /** Called after any change so a parent can refresh sibling views. */
  onChange?: () => void;
}

// ─── Pace state → color (color = meaning, per the brief + design system) ────────
// done = success green · on track = primary amber · behind = rose · no deadline = calm neutral.
type PaceState = 'done' | 'onTrack' | 'behind' | 'neutral';

function paceState(p: GoalProgress): PaceState {
  if (p.done) return 'done';
  if (p.onTrack === true) return 'onTrack';
  if (p.onTrack === false) return 'behind';
  return 'neutral';
}

const PACE_COLOR: Record<PaceState, string> = {
  done: LUCY_COLORS.success,
  onTrack: LUCY_COLORS.primary,
  behind: LUCY_COLORS.error,
  neutral: LUCY_COLORS.textSubtle,
};

/** Small days-left chip copy. ">N days left" / "due today" / "Nd over"; hidden when no deadline. */
function daysLeftChip(daysLeft: number | null): { text: string; tone: PaceState } | null {
  if (daysLeft == null) return null;
  if (daysLeft < 0) return { text: `${Math.abs(daysLeft)}d over`, tone: 'behind' };
  if (daysLeft === 0) return { text: 'due today', tone: 'behind' };
  return { text: `${daysLeft} days left`, tone: 'neutral' };
}

/** Format a suggested-goal deadline ISO into a short "Mon D" (e.g. "Aug 1"); '' if unparseable. */
function formatSuggestDeadline(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** Parse a forgiving "YYYY-MM-DD" into a midday ISO string (so the date doesn't drift across TZs). */
function parseDeadline(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const dt = new Date(y, mo - 1, d, 12, 0, 0, 0);
  if (Number.isNaN(dt.getTime())) return null;
  return dt.toISOString();
}

// ─── Animated progress bar — springs to its fill with a soft leading-edge glow ──
function ProgressBar({ pct, color }: { pct: number; color: string }) {
  const target = Math.max(0, Math.min(pct, 1));
  const fill = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const anim = Animated.timing(fill, {
      toValue: target,
      duration: 720,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false, // animating width % — layout prop, can't use the native driver
    });
    anim.start();
    return () => anim.stop();
  }, [target, fill]);

  const width = fill.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] });

  return (
    <View style={styles.track}>
      <Animated.View style={[styles.fill, { width, backgroundColor: color }]}>
        {/* leading-edge catchlight so the bar reads as alive, not a flat block */}
        {target > 0.04 ? <View style={[styles.fillCap, { backgroundColor: color }]} /> : null}
      </Animated.View>
    </View>
  );
}

// ─── One goal card ──────────────────────────────────────────────────────────────
function GoalCard({
  goal,
  onAdd,
  onDelete,
}: {
  goal: GoalWithProgress;
  onAdd: (g: GoalWithProgress) => void;
  onDelete: (g: GoalWithProgress) => void;
}) {
  const { progress: p, currency } = goal;
  const state = paceState(p);
  const color = PACE_COLOR[state];
  const chip = daysLeftChip(p.daysLeft);
  const pctLabel = `${Math.round(Math.min(p.pct, 1) * 100)}%`;

  // A gentle one-shot "settle" when a goal is complete (calm celebration, not cartoonish).
  const pop = useRef(new Animated.Value(p.done ? 0 : 1)).current;
  useEffect(() => {
    if (!p.done) return;
    pop.setValue(0.92);
    Animated.spring(pop, { toValue: 1, friction: 6, tension: 180, useNativeDriver: true }).start();
  }, [p.done, pop]);

  return (
    <Animated.View
      style={[
        styles.card,
        p.done && styles.cardDone,
        { borderTopColor: color, transform: [{ scale: pop }] },
      ]}
    >
      <View style={styles.cardHead}>
        <View style={[styles.dot, { backgroundColor: color, shadowColor: color }]} />
        <View style={{ flex: 1 }}>
          <View style={styles.titleRow}>
            <Text style={styles.label} numberOfLines={1}>{goal.label}</Text>
            {p.done ? <Text style={styles.party}>🎉</Text> : null}
          </View>
          {goal.project_name ? (
            <View style={styles.projChip}>
              <Text style={styles.projChipT} numberOfLines={1}>◆ {goal.project_name}</Text>
            </View>
          ) : null}
        </View>
        <TouchableOpacity
          onPress={() => onDelete(goal)}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          style={styles.del}
        >
          <Text style={styles.delT}>✕</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.amountRow}>
        <Text style={styles.amount}>
          <Text style={[styles.amountSaved, { color }]}>{formatMoney(p.saved, currency)}</Text>
          <Text style={styles.amountSep}>  /  </Text>
          <Text style={styles.amountTarget}>{formatMoney(p.target, currency)}</Text>
        </Text>
        <View style={styles.chips}>
          <View style={[styles.pctChip, { borderColor: color }]}>
            <Text style={[styles.pctChipT, { color }]}>{pctLabel}</Text>
          </View>
          {chip ? (
            <View style={[styles.metaChip, chip.tone === 'behind' && styles.metaChipWarn]}>
              <Text style={[styles.metaChipT, chip.tone === 'behind' && styles.metaChipWarnT]}>{chip.text}</Text>
            </View>
          ) : null}
        </View>
      </View>

      <ProgressBar pct={p.pct} color={color} />

      <Text style={styles.guidance}>{goalGuidance(goal.label, p, currency)}</Text>

      <View style={styles.cardActions}>
        <PressableScale
          style={[styles.addBtn, p.done && styles.addBtnDone]}
          onPress={() => onAdd(goal)}
          accessibilityLabel={`Add to ${goal.label}`}
        >
          <Text style={[styles.addBtnT, p.done && styles.addBtnDoneT]}>
            {p.done ? 'Add more' : '＋ Add'}
          </Text>
        </PressableScale>
      </View>
    </Animated.View>
  );
}

export function MoneyGoals({ refreshKey, onChange }: MoneyGoalsProps) {
  const [goals, setGoals] = useState<GoalWithProgress[]>([]);
  const [loading, setLoading] = useState(true);

  // Propose-and-confirm: a savings goal LUCY auto-detected from a capture (null = none pending).
  const [suggestion, setSuggestion] = useState<StoredGoalSignal | null>(null);
  const [actingSuggestion, setActingSuggestion] = useState(false);

  // New-goal sheet state
  const [adding, setAdding] = useState(false);
  const [label, setLabel] = useState('');
  const [target, setTarget] = useState('');
  const [deadline, setDeadline] = useState('');
  const [currency, setCurrency] = useState('₹');
  const [saving, setSaving] = useState(false);

  // Add-contribution sheet state
  const [contribFor, setContribFor] = useState<GoalWithProgress | null>(null);
  const [contribAmount, setContribAmount] = useState('');
  const [contribNote, setContribNote] = useState('');
  const [logging, setLogging] = useState(false);

  const load = useCallback(async () => {
    try {
      const db = await getDatabase();
      const [list, sig] = await Promise.all([getGoalsWithProgress(db), getGoalSignal(db)]);
      setGoals(list);
      setSuggestion(sig);
    } catch {
      // never a scary state — just show the empty/loaded surface
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load, refreshKey]);

  const totalActive = useMemo(() => goals.filter((g) => g.status !== 'done').length, [goals]);

  const openNew = () => {
    setLabel(''); setTarget(''); setDeadline(''); setCurrency('₹');
    setAdding(true);
  };

  const canSaveNew = label.trim().length > 0 && Number(target) > 0;

  const saveNew = async () => {
    const amt = Number(target);
    if (!label.trim() || !Number.isFinite(amt) || amt <= 0) return;
    setSaving(true);
    try {
      const db = await getDatabase();
      await createMoneyGoal(db, {
        label: label.trim(),
        target: amt,
        currency: currency.trim() || '₹',
        deadline: parseDeadline(deadline),
      });
      haptic.capture();
      setAdding(false);
      await load();
      onChange?.();
    } catch {
      Alert.alert("Couldn't save", 'That goal didn’t save — give it another try in a moment.');
    } finally {
      setSaving(false);
    }
  };

  const openContrib = (g: GoalWithProgress) => {
    setContribFor(g);
    setContribAmount('');
    setContribNote('');
  };

  const canLog = Number(contribAmount) !== 0 && Number.isFinite(Number(contribAmount));

  const saveContrib = async () => {
    if (!contribFor) return;
    const amt = Number(contribAmount);
    if (!Number.isFinite(amt) || amt === 0) return;
    setLogging(true);
    const wasDone = contribFor.progress.done;
    try {
      const db = await getDatabase();
      await addContribution(db, contribFor.id, amt, contribNote.trim() || null);
      haptic.taskDone();
      setContribFor(null);
      await load();
      onChange?.();
      // Celebrate only the moment a goal newly crosses the line.
      if (!wasDone) {
        const fresh = await getDatabase().then((db2) => getGoalsWithProgress(db2));
        const hit = fresh.find((g) => g.id === contribFor.id);
        if (hit?.progress.done) haptic.capture();
      }
    } catch {
      Alert.alert("Couldn't log that", 'That contribution didn’t save — try again shortly.');
    } finally {
      setLogging(false);
    }
  };

  const confirmDelete = (g: GoalWithProgress) => {
    Alert.alert(
      'Delete goal?',
      `"${g.label}" and its logged contributions will be removed. This can’t be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              const db = await getDatabase();
              await deleteMoneyGoal(db, g.id);
              haptic.destructive();
              await load();
              onChange?.();
            } catch {
              Alert.alert("Couldn't delete", 'Give it another try in a moment.');
            }
          },
        },
      ],
    );
  };

  // ── Suggested-goal banner (propose-and-confirm) ───────────────────────────
  const acceptSuggestion = async () => {
    if (!suggestion || actingSuggestion) return;
    setActingSuggestion(true);
    try {
      const db = await getDatabase();
      await createGoalFromSignal(db, suggestion);
      haptic.capture();
      setSuggestion(null);
      await load();
      onChange?.();
    } catch {
      Alert.alert("Couldn't create that", 'That goal didn’t save — give it another try in a moment.');
    } finally {
      setActingSuggestion(false);
    }
  };

  const declineSuggestion = async () => {
    if (!suggestion || actingSuggestion) return;
    const prev = suggestion;
    setSuggestion(null); // optimistic — feels instant
    try {
      const db = await getDatabase();
      await dismissGoalSignal(db);
      haptic.taskUndo();
    } catch {
      setSuggestion(prev); // restore if the clear failed
    }
  };

  if (loading) {
    return <View style={styles.center}><ActivityIndicator color={LUCY_COLORS.primary} /></View>;
  }

  const empty = goals.length === 0;

  return (
    <View style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={styles.wrap} showsVerticalScrollIndicator={false}>
        <View style={styles.head}>
          <View>
            <Text style={styles.h}>Goals</Text>
            {!empty ? (
              <Text style={styles.headSub}>
                {totalActive > 0
                  ? `${totalActive} goal${totalActive === 1 ? '' : 's'} in progress`
                  : 'All caught up — every goal hit. 🎉'}
              </Text>
            ) : null}
          </View>
          <TouchableOpacity style={styles.newBtn} onPress={openNew} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text style={styles.newBtnT}>＋ New goal</Text>
          </TouchableOpacity>
        </View>

        {/* ── Suggested goal LUCY spotted in a capture — propose & confirm ─────── */}
        {suggestion ? (
          <FadeInUp>
            <View style={styles.suggestBox}>
              <Text style={styles.suggestHead}>✦ TRACK THIS GOAL?</Text>
              <Text style={styles.suggestBody}>
                Save{' '}
                <Text style={styles.suggestStrong}>{formatMoney(suggestion.target, suggestion.currency)}</Text>
                {' '}for{' '}
                <Text style={styles.suggestStrong}>{suggestion.label}</Text>
                {suggestion.deadlineISO ? ` by ${formatSuggestDeadline(suggestion.deadlineISO)}` : ''}?
              </Text>
              <View style={styles.suggestActions}>
                <PressableScale
                  style={[styles.suggestCta, actingSuggestion && styles.suggestCtaBusy]}
                  onPress={() => void acceptSuggestion()}
                  accessibilityLabel={`Create goal: save for ${suggestion.label}`}
                >
                  {actingSuggestion
                    ? <ActivityIndicator color="#fff" size="small" />
                    : <Text style={styles.suggestCtaT}>Create goal</Text>}
                </PressableScale>
                <TouchableOpacity
                  style={styles.suggestDismiss}
                  onPress={() => void declineSuggestion()}
                  disabled={actingSuggestion}
                  hitSlop={{ top: 8, bottom: 8, left: 6, right: 6 }}
                >
                  <Text style={styles.suggestDismissT}>Not now</Text>
                </TouchableOpacity>
              </View>
            </View>
          </FadeInUp>
        ) : null}

        {empty ? (
          <FadeInUp>
            <View style={styles.empty}>
              <Text style={styles.emptyMark}>◎</Text>
              <Text style={styles.emptyTitle}>No savings goals yet</Text>
              <Text style={styles.emptyBody}>
                Set one and I&rsquo;ll track your pace toward it — how much you&rsquo;ve put aside, what&rsquo;s left, and whether you&rsquo;re on time.
              </Text>
              <TouchableOpacity style={styles.emptyCta} onPress={openNew}>
                <Text style={styles.emptyCtaT}>＋ New goal</Text>
              </TouchableOpacity>
            </View>
          </FadeInUp>
        ) : (
          <Stagger>
            {goals.map((g) => (
              <FadeInUp key={g.id}>
                <GoalCard goal={g} onAdd={openContrib} onDelete={confirmDelete} />
              </FadeInUp>
            ))}
          </Stagger>
        )}
      </ScrollView>

      {/* ── New goal ─────────────────────────────────────────────────────────── */}
      <Modal visible={adding} transparent animationType="slide" onRequestClose={() => setAdding(false)}>
        <KeyboardAvoidingView style={styles.modalBg} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={() => setAdding(false)} />
          <View style={styles.sheet}>
            <View style={styles.grip} />
            <Text style={styles.eyebrow}>SET A SAVINGS GOAL</Text>
            <Text style={styles.h}>New goal</Text>
            <Text style={styles.sheetSub}>A target to save toward — add an optional deadline and I&rsquo;ll watch your pace.</Text>

            <Text style={styles.fieldLabel}>WHAT FOR</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. Move fund, New laptop, Trip"
              placeholderTextColor={LUCY_COLORS.textFaint}
              value={label}
              onChangeText={setLabel}
              returnKeyType="next"
            />

            <View style={styles.fieldRow}>
              <View style={styles.fieldCol2}>
                <Text style={styles.fieldLabel}>TARGET AMOUNT</Text>
                <TextInput
                  style={styles.input}
                  placeholder="2000"
                  placeholderTextColor={LUCY_COLORS.textFaint}
                  value={target}
                  onChangeText={(t) => setTarget(t.replace(/[^0-9.]/g, ''))}
                  keyboardType="numeric"
                  inputMode="decimal"
                />
              </View>
              <View style={styles.fieldCol1}>
                <Text style={styles.fieldLabel}>CURRENCY</Text>
                <TextInput
                  style={[styles.input, styles.inputCurrency]}
                  placeholder="₹"
                  placeholderTextColor={LUCY_COLORS.textFaint}
                  value={currency}
                  onChangeText={setCurrency}
                  maxLength={3}
                />
              </View>
            </View>

            <Text style={styles.fieldLabel}>DEADLINE (OPTIONAL)</Text>
            <TextInput
              style={styles.input}
              placeholder="YYYY-MM-DD — leave blank for no deadline"
              placeholderTextColor={LUCY_COLORS.textFaint}
              value={deadline}
              onChangeText={setDeadline}
              keyboardType={Platform.OS === 'ios' ? 'numbers-and-punctuation' : 'default'}
              autoCapitalize="none"
            />

            <View style={styles.rowEnd}>
              <TouchableOpacity style={styles.btnGhost} onPress={() => setAdding(false)}>
                <Text style={styles.btnGhostT}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.btn, (!canSaveNew || saving) && styles.btnDisabled]}
                disabled={!canSaveNew || saving}
                onPress={saveNew}
              >
                {saving ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.btnT}>Set goal</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* ── Add contribution ─────────────────────────────────────────────────── */}
      <Modal visible={!!contribFor} transparent animationType="slide" onRequestClose={() => setContribFor(null)}>
        <KeyboardAvoidingView style={styles.modalBg} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={() => setContribFor(null)} />
          <View style={styles.sheet}>
            <View style={styles.grip} />
            <Text style={styles.eyebrow}>PUT SOME ASIDE</Text>
            <Text style={styles.h} numberOfLines={1}>{contribFor?.label}</Text>
            {contribFor ? (
              <Text style={styles.sheetSub}>
                {formatMoney(contribFor.progress.saved, contribFor.currency)} of {formatMoney(contribFor.progress.target, contribFor.currency)} so far
                {contribFor.progress.remaining > 0
                  ? ` — ${formatMoney(contribFor.progress.remaining, contribFor.currency)} to go.`
                  : ' — target reached.'}
              </Text>
            ) : null}

            <Text style={styles.fieldLabel}>HOW MUCH DID YOU PUT ASIDE?</Text>
            <TextInput
              style={[styles.input, styles.contribInput]}
              placeholder={`${contribFor?.currency ?? '₹'} amount`}
              placeholderTextColor={LUCY_COLORS.textFaint}
              value={contribAmount}
              onChangeText={(t) => setContribAmount(t.replace(/[^0-9.-]/g, ''))}
              keyboardType="numeric"
              inputMode="decimal"
              autoFocus
            />
            <Text style={styles.fieldHint}>Tip: a negative amount logs a withdrawal.</Text>

            <Text style={styles.fieldLabel}>NOTE (OPTIONAL)</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. from this month's salary"
              placeholderTextColor={LUCY_COLORS.textFaint}
              value={contribNote}
              onChangeText={setContribNote}
            />

            <View style={styles.rowEnd}>
              <TouchableOpacity style={styles.btnGhost} onPress={() => setContribFor(null)}>
                <Text style={styles.btnGhostT}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.btn, (!canLog || logging) && styles.btnDisabled]}
                disabled={!canLog || logging}
                onPress={saveContrib}
              >
                {logging ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.btnT}>Log it</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 40 },
  wrap: { padding: 14, paddingBottom: 80 },

  // Header
  head: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 16 },
  h: { color: LUCY_COLORS.textDark, fontWeight: '900', fontSize: 21 },
  headSub: { color: LUCY_COLORS.textMuted, fontSize: 13, marginTop: 4 },
  newBtn: { backgroundColor: LUCY_COLORS.primary, borderRadius: 13, paddingHorizontal: 14, paddingVertical: 9 },
  newBtnT: { color: '#fff', fontWeight: '800', fontSize: 13 },

  // Suggested-goal banner (propose & confirm) — soft primary-tinted, sits above the list
  suggestBox: {
    backgroundColor: 'rgba(255,140,66,0.10)',
    borderWidth: 1,
    borderColor: LUCY_COLORS.primaryLine,
    borderRadius: 16,
    padding: 14,
    marginBottom: 14,
  },
  suggestHead: { color: LUCY_COLORS.primaryGlow, fontWeight: '900', fontSize: 11, letterSpacing: 0.5, marginBottom: 6 },
  suggestBody: { color: LUCY_COLORS.textMuted, fontSize: 13.5, lineHeight: 20 },
  suggestStrong: { color: LUCY_COLORS.textDark, fontWeight: '800' },
  suggestActions: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 12 },
  suggestCta: { backgroundColor: LUCY_COLORS.primary, borderRadius: 12, paddingHorizontal: 16, paddingVertical: 10, minWidth: 112, alignItems: 'center', justifyContent: 'center' },
  suggestCtaBusy: { opacity: 0.8 },
  suggestCtaT: { color: '#fff', fontWeight: '800', fontSize: 13 },
  suggestDismiss: { paddingHorizontal: 10, paddingVertical: 10 },
  suggestDismissT: { color: LUCY_COLORS.textFaint, fontWeight: '700', fontSize: 13 },

  // Goal card
  card: {
    backgroundColor: LUCY_COLORS.surfaceRaised,
    borderWidth: 1,
    borderColor: LUCY_COLORS.border,
    borderTopColor: LUCY_COLORS.primaryLine,
    borderTopWidth: 2,
    borderRadius: 18,
    padding: 16,
    marginBottom: 12,
  },
  cardDone: { backgroundColor: 'rgba(74,222,128,0.06)' },
  cardHead: { flexDirection: 'row', alignItems: 'flex-start', gap: 11 },
  dot: { width: 12, height: 12, borderRadius: 6, marginTop: 3, shadowOpacity: 0.5, shadowRadius: 7, shadowOffset: { width: 0, height: 0 } },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  label: { color: LUCY_COLORS.textDark, fontWeight: '900', fontSize: 16, flexShrink: 1 },
  party: { fontSize: 15 },
  projChip: { alignSelf: 'flex-start', marginTop: 6, backgroundColor: LUCY_COLORS.primaryMist, borderWidth: 1, borderColor: LUCY_COLORS.primaryLine, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 3 },
  projChipT: { color: LUCY_COLORS.primaryGlow, fontWeight: '800', fontSize: 11, maxWidth: 160 },
  del: { paddingHorizontal: 4, paddingVertical: 2 },
  delT: { color: LUCY_COLORS.textFaint, fontSize: 15, fontWeight: '700' },

  // Amounts + chips
  amountRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 14, gap: 10 },
  amount: { flexShrink: 1 },
  amountSaved: { fontWeight: '900', fontSize: 20 },
  amountSep: { color: LUCY_COLORS.textFaint, fontWeight: '700', fontSize: 15 },
  amountTarget: { color: LUCY_COLORS.textMuted, fontWeight: '800', fontSize: 15 },
  chips: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  pctChip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 3 },
  pctChipT: { fontWeight: '900', fontSize: 12 },
  metaChip: { backgroundColor: LUCY_COLORS.surface, borderWidth: 1, borderColor: LUCY_COLORS.border, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 3 },
  metaChipT: { color: LUCY_COLORS.textMuted, fontWeight: '700', fontSize: 11.5 },
  metaChipWarn: { backgroundColor: 'rgba(251,113,133,0.10)', borderColor: 'rgba(251,113,133,0.4)' },
  metaChipWarnT: { color: LUCY_COLORS.error },

  // Progress bar
  track: { height: 9, borderRadius: 999, backgroundColor: LUCY_COLORS.surface, borderWidth: 1, borderColor: LUCY_COLORS.borderSoft, overflow: 'hidden', marginTop: 12 },
  fill: { height: '100%', borderRadius: 999, minWidth: 9, justifyContent: 'center', alignItems: 'flex-end' },
  fillCap: { width: 7, height: 7, borderRadius: 4, marginRight: 1, opacity: 0.95, shadowColor: '#fff', shadowOpacity: 0.6, shadowRadius: 4, shadowOffset: { width: 0, height: 0 } },

  // Guidance caption
  guidance: { color: LUCY_COLORS.textMuted, fontSize: 12.5, lineHeight: 18, marginTop: 11 },

  // Card actions
  cardActions: { flexDirection: 'row', marginTop: 14 },
  addBtn: { flex: 1, backgroundColor: LUCY_COLORS.primary, borderRadius: 13, paddingVertical: 11, alignItems: 'center' },
  addBtnT: { color: '#fff', fontWeight: '800', fontSize: 14 },
  addBtnDone: { backgroundColor: 'transparent', borderWidth: 1, borderColor: LUCY_COLORS.border },
  addBtnDoneT: { color: LUCY_COLORS.textMuted },

  // Empty state
  empty: { backgroundColor: LUCY_COLORS.surfaceRaised, borderWidth: 1, borderColor: LUCY_COLORS.border, borderRadius: 22, padding: 26, alignItems: 'center', marginTop: 8 },
  emptyMark: { color: LUCY_COLORS.primary, fontSize: 40, marginBottom: 8, opacity: 0.85 },
  emptyTitle: { color: LUCY_COLORS.textDark, fontWeight: '900', fontSize: 17, marginBottom: 8 },
  emptyBody: { color: LUCY_COLORS.textMuted, fontSize: 13.5, lineHeight: 20, textAlign: 'center', marginBottom: 18 },
  emptyCta: { backgroundColor: LUCY_COLORS.primary, borderRadius: 13, paddingHorizontal: 22, paddingVertical: 12 },
  emptyCtaT: { color: '#fff', fontWeight: '800', fontSize: 14 },

  // Sheets
  modalBg: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: LUCY_COLORS.surfaceSheet, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: 34, borderTopWidth: 1, borderTopColor: LUCY_COLORS.border },
  grip: { width: 40, height: 4, borderRadius: 2, backgroundColor: LUCY_COLORS.border, alignSelf: 'center', marginBottom: 14 },
  eyebrow: { color: LUCY_COLORS.primaryGlow, fontWeight: '900', fontSize: 11, letterSpacing: 1, marginBottom: 4 },
  sheetSub: { color: LUCY_COLORS.textMuted, fontSize: 13, marginTop: 6, lineHeight: 19 },
  fieldLabel: { color: LUCY_COLORS.primaryGlow, fontWeight: '900', fontSize: 10.5, letterSpacing: 1, marginTop: 16, marginBottom: 2 },
  fieldHint: { color: LUCY_COLORS.textFaint, fontSize: 11.5, marginTop: 6 },
  input: { backgroundColor: LUCY_COLORS.surfaceRaised, borderWidth: 1, borderColor: LUCY_COLORS.border, borderRadius: 14, padding: 12, color: LUCY_COLORS.textDark, marginTop: 8, fontSize: 15 },
  contribInput: { fontSize: 20, fontWeight: '800' },
  inputCurrency: { textAlign: 'center' },
  fieldRow: { flexDirection: 'row', gap: 10 },
  fieldCol2: { flex: 2 },
  fieldCol1: { flex: 1 },
  rowEnd: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: 20 },
  btn: { backgroundColor: LUCY_COLORS.primary, borderRadius: 13, paddingHorizontal: 18, paddingVertical: 11, justifyContent: 'center', minWidth: 96, alignItems: 'center' },
  btnT: { color: '#fff', fontWeight: '800', fontSize: 14 },
  btnGhost: { borderWidth: 1, borderColor: LUCY_COLORS.border, borderRadius: 13, paddingHorizontal: 18, paddingVertical: 11, justifyContent: 'center' },
  btnGhostT: { color: LUCY_COLORS.textDark, fontWeight: '700' },
  btnDisabled: { opacity: 0.4 },
});
