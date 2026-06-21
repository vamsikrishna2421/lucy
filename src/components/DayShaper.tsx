/**
 * DayShaper — "Shape your day" editor. Lets the user hand-shape the scheduler's TIME-VARYING capacity:
 * office hours, sleep, and three energy curves (brain / muscle / attention) the scheduler reads from
 * `AvailabilityProfile.energyCurves`. The scheduler's `capacityAt()` indexes each 24-element curve by
 * `getHours()`, so this editor edits exactly those 24 hourly levels (0..1) per effort.
 *
 * Design (docs/LUCY_DESIGN_SYSTEM.md): a full-height premium sheet — grip → context → bold title →
 * sectioned controls → one filled primary + outline secondary. The centerpiece is a DRAW-TO-SHAPE
 * energy graph (react-native-svg + RN PanResponder, OTA-safe — no native gesture libs):
 *   • drag a finger across the graph to raise/lower each hour, painting intermediate hours so it feels
 *     like sketching the curve (snaps to a 10% grid);
 *   • or tap an hour to select it and nudge it precisely with a stepper (one-thumb fallback);
 *   • sleep hours are a locked, visually-distinct band pinned to 0 — obvious, never a mystery.
 *
 * ADDITIVE: this only writes via the existing `setAvailability`; it changes no scheduling logic.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Dimensions,
  Easing,
  LayoutChangeEvent,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import Svg, {
  Circle as SvgCircle,
  ClipPath as SvgClipPath,
  Defs as SvgDefs,
  G as SvgG,
  Line as SvgLine,
  LinearGradient as SvgLinearGradient,
  Path as SvgPath,
  Rect as SvgRect,
  Stop as SvgStop,
} from 'react-native-svg';
import { LUCY_COLORS } from '../config/colors';
import { haptic } from '../config/haptics';
import { getDatabase } from '../db';
import { ActionSheet, Toast } from './ActionSheet';
import { getAvailability, setAvailability } from '../scheduling/availability';
import { suggestedEnergyCurves } from '../scheduling/load';
import type { AvailabilityProfile } from '../scheduling/types';

// ─── Effort metadata ───────────────────────────────────────────────────────
type Effort = 'brain' | 'muscle' | 'attention';
const EFFORTS: Array<{
  key: Effort;
  tab: string;
  noun: string;
  color: string;
  glow: string;
  helper: string;
}> = [
  {
    key: 'brain',
    tab: 'Brain',
    noun: 'focused thinking',
    color: LUCY_COLORS.primary,
    glow: LUCY_COLORS.primaryGlow,
    helper: 'Higher = you can take on more deep, focused work then.',
  },
  {
    key: 'muscle',
    tab: 'Body',
    noun: 'physical effort',
    color: LUCY_COLORS.teal,
    glow: LUCY_COLORS.teal,
    helper: 'Higher = a better time for the gym, chores, anything physical.',
  },
  {
    key: 'attention',
    tab: 'Focus',
    noun: 'sustained attention',
    color: LUCY_COLORS.violet,
    glow: LUCY_COLORS.violet,
    helper: 'Higher = you can stay sharp and present (calls, fiddly tasks).',
  },
];
const effortMeta = (k: Effort) => EFFORTS.find((e) => e.key === k)!;

type Curves = { brain: number[]; muscle: number[]; attention: number[] };

// ─── Time helpers ──────────────────────────────────────────────────────────
const DAY_NAMES = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0]; // Mon-first, matching how people read a work week

function to12h(min: number): string {
  const h = Math.floor(min / 60) % 24;
  const m = min % 60;
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${h12} ${ampm}` : `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
}

/** Same midnight-wrap logic the scheduler uses (isAsleepAt), evaluated for a whole hour bucket. */
function hourIsAsleep(av: Pick<AvailabilityProfile, 'sleepStartMin' | 'sleepEndMin'>, hour: number): boolean {
  const mid = hour * 60 + 30; // hour midpoint, matching suggestedEnergyCurves
  if (av.sleepStartMin > av.sleepEndMin) return mid >= av.sleepStartMin || mid < av.sleepEndMin;
  return mid >= av.sleepStartMin && mid < av.sleepEndMin;
}

/** Re-zero sleep hours so the locked band always reads 0 (mirrors the seed's sleep handling). */
function zeroSleep(curves: Curves, av: Pick<AvailabilityProfile, 'sleepStartMin' | 'sleepEndMin'>): Curves {
  const fix = (arr: number[]) => arr.map((v, h) => (hourIsAsleep(av, h) ? 0 : v));
  return { brain: fix(curves.brain), muscle: fix(curves.muscle), attention: fix(curves.attention) };
}

const LEVEL_STEP = 0.1; // snap grid — friendly, never fiddly
const snap = (v: number) => Math.max(0, Math.min(1, Math.round(v / LEVEL_STEP) * LEVEL_STEP));

/** Human label for a level, so the readout never shows a raw 0.6. */
function levelWord(v: number): string {
  if (v <= 0) return 'Resting';
  if (v < 0.3) return 'Low energy';
  if (v < 0.55) return 'Easing in';
  if (v < 0.78) return 'Steady';
  if (v < 0.92) return 'Strong';
  return 'Peak';
}

/** Human label for a time of day (axis is labelled morning/midday/… not raw hours). */
function partOfDay(hour: number): string {
  if (hour < 5) return 'Late night';
  if (hour < 9) return 'Early morning';
  if (hour < 12) return 'Morning';
  if (hour < 14) return 'Midday';
  if (hour < 17) return 'Afternoon';
  if (hour < 21) return 'Evening';
  return 'Night';
}

// ─── Smooth path (matches the app's MoodChart smoothing for a consistent feel) ──
function smoothLinePath(pts: Array<{ x: number; y: number }>): string {
  if (pts.length === 0) return '';
  if (pts.length === 1) return `M ${pts[0].x} ${pts[0].y} l 0.01 0`;
  let d = `M ${pts[0].x} ${pts[0].y}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? p2;
    const t = 0.16;
    const c1x = p1.x + (p2.x - p0.x) * t;
    const c1y = p1.y + (p2.y - p0.y) * t;
    const c2x = p2.x - (p3.x - p1.x) * t;
    const c2y = p2.y - (p3.y - p1.y) * t;
    d += ` C ${c1x} ${c1y}, ${c2x} ${c2y}, ${p2.x} ${p2.y}`;
  }
  return d;
}

export function DayShaper({
  visible,
  onClose,
  onSaved,
}: {
  visible: boolean;
  onClose: () => void;
  onSaved?: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [baseline, setBaseline] = useState<AvailabilityProfile | null>(null);

  // Editable draft state
  const [workStart, setWorkStart] = useState(9 * 60);
  const [workEnd, setWorkEnd] = useState(18 * 60);
  const [workDays, setWorkDays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [sleepStart, setSleepStart] = useState(23 * 60 + 30);
  const [sleepEnd, setSleepEnd] = useState(7 * 60 + 30);
  const [curves, setCurves] = useState<Curves>({ brain: [], muscle: [], attention: [] });

  const [effort, setEffort] = useState<Effort>('brain');
  const [selectedHour, setSelectedHour] = useState<number | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [timeField, setTimeField] = useState<null | 'workStart' | 'workEnd' | 'sleepStart' | 'sleepEnd'>(null);

  const slide = useRef(new Animated.Value(0)).current;
  const fade = useRef(new Animated.Value(0)).current;
  const tabInk = useRef(new Animated.Value(0)).current;

  // ── Load on open ──
  useEffect(() => {
    if (!visible) return;
    let alive = true;
    setLoading(true);
    setSelectedHour(null);
    setEffort('brain');
    setTimeField(null);
    void (async () => {
      const db = await getDatabase();
      const av = await getAvailability(db);
      if (!alive) return;
      setBaseline(av);
      setWorkStart(av.workStartMin);
      setWorkEnd(av.workEndMin);
      setWorkDays(av.workDays ?? [1, 2, 3, 4, 5]);
      setSleepStart(av.sleepStartMin);
      setSleepEnd(av.sleepEndMin);
      const seeded =
        av.energyCurves &&
        av.energyCurves.brain?.length === 24 &&
        av.energyCurves.muscle?.length === 24 &&
        av.energyCurves.attention?.length === 24
          ? av.energyCurves
          : suggestedEnergyCurves(av);
      setCurves(zeroSleep({ brain: [...seeded.brain], muscle: [...seeded.muscle], attention: [...seeded.attention] }, av));
      setLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, [visible]);

  // ── Sheet entrance ──
  useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.spring(slide, { toValue: 1, tension: 64, friction: 12, useNativeDriver: true }),
        Animated.timing(fade, { toValue: 1, duration: 200, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      ]).start();
    } else {
      slide.setValue(0);
      fade.setValue(0);
    }
  }, [visible, slide, fade]);

  // ── Animate the segmented control ink to the active tab ──
  useEffect(() => {
    const idx = EFFORTS.findIndex((e) => e.key === effort);
    Animated.spring(tabInk, { toValue: idx, tension: 90, friction: 13, useNativeDriver: true }).start();
  }, [effort, tabInk]);

  // ── Keep sleep hours locked to 0 whenever sleep times change ──
  useEffect(() => {
    if (loading) return;
    setCurves((c) => zeroSleep(c, { sleepStartMin: sleepStart, sleepEndMin: sleepEnd }));
    if (selectedHour != null && hourIsAsleep({ sleepStartMin: sleepStart, sleepEndMin: sleepEnd }, selectedHour)) {
      setSelectedHour(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sleepStart, sleepEnd]);

  const dirty = useMemo(() => {
    if (!baseline) return false;
    if (
      baseline.workStartMin !== workStart ||
      baseline.workEndMin !== workEnd ||
      baseline.sleepStartMin !== sleepStart ||
      baseline.sleepEndMin !== sleepEnd
    )
      return true;
    const sameDays =
      baseline.workDays?.length === workDays.length && baseline.workDays.every((d) => workDays.includes(d));
    if (!sameDays) return true;
    // Compare against the same starting curves the editor loaded (sleep zeroed identically), so an
    // untouched session reads as clean and Save stays disabled until a real change.
    const seeded = zeroSleep(baseline.energyCurves ?? suggestedEnergyCurves(baseline), {
      sleepStartMin: sleepStart,
      sleepEndMin: sleepEnd,
    });
    const same = (a: number[] = [], b: number[] = []) =>
      a.length === b.length && a.every((v, i) => Math.abs(v - (b[i] ?? 0)) < 0.001);
    return !(same(seeded.brain, curves.brain) && same(seeded.muscle, curves.muscle) && same(seeded.attention, curves.attention));
  }, [baseline, workStart, workEnd, sleepStart, sleepEnd, workDays, curves]);

  const requestClose = () => {
    if (dirty) setConfirmCancel(true);
    else onClose();
  };

  const setHourLevel = (hour: number, level: number) => {
    if (hourIsAsleep({ sleepStartMin: sleepStart, sleepEndMin: sleepEnd }, hour)) return;
    setCurves((c) => {
      const next = [...c[effort]];
      next[hour] = snap(level);
      return { ...c, [effort]: next };
    });
  };

  const nudgeSelected = (delta: number) => {
    if (selectedHour == null) return;
    const cur = curves[effort][selectedHour] ?? 0;
    setHourLevel(selectedHour, cur + delta);
  };

  const doReset = () => {
    if (!baseline) return;
    const fresh = suggestedEnergyCurves({ ...baseline, sleepStartMin: sleepStart, sleepEndMin: sleepEnd });
    setCurves(zeroSleep({ brain: [...fresh.brain], muscle: [...fresh.muscle], attention: [...fresh.attention] }, { sleepStartMin: sleepStart, sleepEndMin: sleepEnd }));
    setSelectedHour(null);
    setToast("Reset to Lucy's suggestion");
  };

  const doSave = async () => {
    setSaving(true);
    try {
      const db = await getDatabase();
      const energyCurves = zeroSleep(curves, { sleepStartMin: sleepStart, sleepEndMin: sleepEnd });
      await setAvailability(db, {
        workStartMin: workStart,
        workEndMin: workEnd,
        workDays,
        sleepStartMin: sleepStart,
        sleepEndMin: sleepEnd,
        energyCurves,
      });
      onSaved?.();
      setToast('Your day is shaped ✓');
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const meta = effortMeta(effort);
  const sleepArg = { sleepStartMin: sleepStart, sleepEndMin: sleepEnd };
  // First-time setup (profile still inferred) can save the suggestion as-is; afterwards, only when changed.
  const firstTime = !!baseline?.inferred;
  const canSave = dirty || firstTime;

  const translateY = slide.interpolate({ inputRange: [0, 1], outputRange: [600, 0] });

  return (
    <>
    <Modal visible={visible} transparent animationType="none" statusBarTranslucent onRequestClose={requestClose}>
      <Animated.View style={[styles.backdrop, { opacity: fade }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={requestClose} />
      </Animated.View>

      <View style={styles.anchor} pointerEvents="box-none">
        <Animated.View style={[styles.sheet, { transform: [{ translateY }] }]}>
          <View style={styles.grip} />

          {/* Header */}
          <View style={styles.headerRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.eyebrow}>YOUR DAY & ENERGY</Text>
              <Text style={styles.title}>Shape your day</Text>
            </View>
            <TouchableOpacity onPress={requestClose} style={styles.closeBtn} hitSlop={8}>
              <Text style={styles.closeText}>Close</Text>
            </TouchableOpacity>
          </View>

          {loading ? (
            <View style={styles.loadingWrap}>
              <Text style={styles.loadingText}>Loading what Lucy already knows…</Text>
            </View>
          ) : (
            <ScrollView
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.scrollContent}
              keyboardShouldPersistTaps="handled"
            >
              <Text style={styles.lede}>
                Tell Lucy when you work and how your energy moves through the day. She’ll place tasks where
                they fit you — and keep personal things out of work time.
              </Text>

              {/* ─── OFFICE HOURS ─────────────────────────────────────────── */}
              <SectionLabel>Office hours</SectionLabel>
              <View style={styles.card}>
                <View style={styles.timeRow}>
                  <TimeChip
                    label="Work starts"
                    value={to12h(workStart)}
                    active={timeField === 'workStart'}
                    accent={LUCY_COLORS.primary}
                    onPress={() => setTimeField(timeField === 'workStart' ? null : 'workStart')}
                  />
                  <View style={styles.arrow}><Text style={styles.arrowText}>→</Text></View>
                  <TimeChip
                    label="Work ends"
                    value={to12h(workEnd)}
                    active={timeField === 'workEnd'}
                    accent={LUCY_COLORS.primary}
                    onPress={() => setTimeField(timeField === 'workEnd' ? null : 'workEnd')}
                  />
                </View>

                {timeField === 'workStart' || timeField === 'workEnd' ? (
                  <TimeWheel
                    minutes={timeField === 'workStart' ? workStart : workEnd}
                    accent={LUCY_COLORS.primary}
                    onChange={(m) => (timeField === 'workStart' ? setWorkStart(m) : setWorkEnd(m))}
                  />
                ) : null}

                <Text style={styles.miniLabel}>Working days</Text>
                <View style={styles.daysRow}>
                  {DAY_ORDER.map((d, i) => {
                    const on = workDays.includes(d);
                    return (
                      <TouchableOpacity
                        key={`${d}-${i}`}
                        activeOpacity={0.8}
                        onPress={() =>
                          setWorkDays((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]))
                        }
                        style={[styles.dayChip, on && styles.dayChipOn]}
                      >
                        <Text style={[styles.dayChipText, on && styles.dayChipTextOn]}>{DAY_NAMES[d]}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>

              {/* ─── SLEEP ────────────────────────────────────────────────── */}
              <SectionLabel>Sleep</SectionLabel>
              <View style={styles.card}>
                <View style={styles.timeRow}>
                  <TimeChip
                    label="Lights out"
                    value={to12h(sleepStart)}
                    icon="🌙"
                    active={timeField === 'sleepStart'}
                    accent={LUCY_COLORS.info}
                    onPress={() => setTimeField(timeField === 'sleepStart' ? null : 'sleepStart')}
                  />
                  <View style={styles.arrow}><Text style={styles.arrowText}>→</Text></View>
                  <TimeChip
                    label="Wake up"
                    value={to12h(sleepEnd)}
                    icon="☀️"
                    active={timeField === 'sleepEnd'}
                    accent={LUCY_COLORS.info}
                    onPress={() => setTimeField(timeField === 'sleepEnd' ? null : 'sleepEnd')}
                  />
                </View>
                {timeField === 'sleepStart' || timeField === 'sleepEnd' ? (
                  <TimeWheel
                    minutes={timeField === 'sleepStart' ? sleepStart : sleepEnd}
                    accent={LUCY_COLORS.info}
                    onChange={(m) => (timeField === 'sleepStart' ? setSleepStart(m) : setSleepEnd(m))}
                  />
                ) : null}
                <Text style={styles.sleepHint}>Lucy never schedules while you sleep — those hours stay at rest.</Text>
              </View>

              {/* ─── ENERGY CURVES ────────────────────────────────────────── */}
              <SectionLabel>Your energy through the day</SectionLabel>

              {/* Segmented control — which effort is being shaped */}
              <View style={styles.segment}>
                <Animated.View
                  pointerEvents="none"
                  style={[
                    styles.segmentInk,
                    {
                      backgroundColor: meta.color + '26',
                      borderColor: meta.color,
                      transform: [
                        {
                          translateX: tabInk.interpolate({
                            inputRange: [0, EFFORTS.length - 1],
                            outputRange: [0, (EFFORTS.length - 1) * SEG_ITEM_W],
                          }),
                        },
                      ],
                    },
                  ]}
                />
                {EFFORTS.map((e) => {
                  const on = e.key === effort;
                  return (
                    <TouchableOpacity
                      key={e.key}
                      activeOpacity={0.85}
                      style={styles.segmentItem}
                      onPress={() => {
                        setEffort(e.key);
                        setSelectedHour(null);
                      }}
                    >
                      <View style={[styles.segmentDot, { backgroundColor: on ? e.color : LUCY_COLORS.textFaint }]} />
                      <Text style={[styles.segmentText, on && { color: e.glow }]}>{e.tab}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              {/* The graph */}
              <EnergyGraph
                curves={curves}
                effort={effort}
                sleep={sleepArg}
                selectedHour={selectedHour}
                onSelectHour={setSelectedHour}
                onSetHourLevel={setHourLevel}
              />

              {/* Live readout / precise nudge for the selected hour */}
              {selectedHour != null ? (
                <View style={[styles.readout, { borderColor: meta.color + '55' }]}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.readoutTime}>
                      {partOfDay(selectedHour)} · {to12h(selectedHour * 60)}
                    </Text>
                    <Text style={[styles.readoutLevel, { color: meta.glow }]}>
                      {levelWord(curves[effort][selectedHour] ?? 0)}
                      <Text style={styles.readoutPct}>  ·  {Math.round((curves[effort][selectedHour] ?? 0) * 100)}%</Text>
                    </Text>
                  </View>
                  <View style={styles.stepper}>
                    <TouchableOpacity
                      style={[styles.stepBtn, { borderColor: meta.color + '66' }]}
                      onPress={() => nudgeSelected(-LEVEL_STEP)}
                      hitSlop={6}
                    >
                      <Text style={[styles.stepText, { color: meta.glow }]}>−</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.stepBtn, { borderColor: meta.color + '66' }]}
                      onPress={() => nudgeSelected(LEVEL_STEP)}
                      hitSlop={6}
                    >
                      <Text style={[styles.stepText, { color: meta.glow }]}>+</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ) : (
                <View style={styles.hintRow}>
                  <Text style={styles.dragHint}>Drag across the graph to reshape it — or tap a time to fine-tune.</Text>
                </View>
              )}

              <Text style={styles.helperLine}>{meta.helper}</Text>

              <TouchableOpacity style={styles.resetRow} onPress={() => setConfirmReset(true)} activeOpacity={0.7}>
                <Text style={styles.resetText}>↺  Reset to Lucy’s suggestion</Text>
              </TouchableOpacity>

              {/* Actions */}
              <View style={styles.actions}>
                <TouchableOpacity
                  activeOpacity={0.9}
                  style={[styles.primaryBtn, (saving || !canSave) && styles.primaryBtnDim]}
                  disabled={saving || !canSave}
                  onPress={() => void doSave()}
                >
                  <Text style={styles.primaryBtnText}>{saving ? 'Saving…' : !canSave ? 'Saved' : firstTime && !dirty ? 'Use this & save' : 'Save my day'}</Text>
                </TouchableOpacity>
                <TouchableOpacity activeOpacity={0.8} style={styles.secondaryBtn} onPress={requestClose}>
                  <Text style={styles.secondaryBtnText}>Cancel</Text>
                </TouchableOpacity>
              </View>
            </ScrollView>
          )}
        </Animated.View>
      </View>
    </Modal>

      {/* Confirmations — siblings (each renders its own Modal), matching ScheduleTab's pattern */}
      <ActionSheet
        visible={confirmCancel}
        onClose={() => setConfirmCancel(false)}
        context="Unsaved changes"
        title="Discard your changes?"
        message="You’ve reshaped your day but haven’t saved. Leaving now keeps your previous settings."
        accent={LUCY_COLORS.error}
        actions={[
          { label: 'Keep editing', style: 'default' },
          {
            label: 'Discard changes',
            style: 'destructive',
            onPress: () => {
              setConfirmCancel(false);
              onClose();
            },
          },
        ]}
        cancelLabel={null}
      />
      <ActionSheet
        visible={confirmReset}
        onClose={() => setConfirmReset(false)}
        context={`Resetting ${meta.tab.toLowerCase()}, body & focus`}
        title="Use Lucy’s suggestion?"
        message="This replaces all three curves with what Lucy learned from your routine. Your work and sleep times stay as you set them."
        accent={LUCY_COLORS.primary}
        actions={[
          {
            label: 'Reset curves',
            style: 'primary',
            onPress: () => {
              setConfirmReset(false);
              doReset();
            },
          },
        ]}
        cancelLabel="Keep mine"
      />
      <Toast visible={!!toast} message={toast ?? ''} onHide={() => setToast(null)} />
    </>
  );
}

// ─── The draw-to-shape energy graph ────────────────────────────────────────
const GRAPH_H = 188;
const GRAPH_PAD_TOP = 14;
const GRAPH_PAD_BOTTOM = 26;

function EnergyGraph({
  curves,
  effort,
  sleep,
  selectedHour,
  onSelectHour,
  onSetHourLevel,
}: {
  curves: Curves;
  effort: Effort;
  sleep: Pick<AvailabilityProfile, 'sleepStartMin' | 'sleepEndMin'>;
  selectedHour: number | null;
  onSelectHour: (h: number) => void;
  onSetHourLevel: (h: number, level: number) => void;
}) {
  const [width, setWidth] = useState(0);
  const meta = effortMeta(effort);

  // Width in a ref so the PanResponder (created once) always reads the live, measured value.
  const widthRef = useRef(0);
  widthRef.current = width;
  const colW = width > 0 ? width / 24 : 0;
  const plotH = GRAPH_H - GRAPH_PAD_TOP - GRAPH_PAD_BOTTOM;

  const xCenter = (h: number) => colW * h + colW / 2;
  const yForLevel = (v: number) => GRAPH_PAD_TOP + plotH * (1 - v);
  const levelForY = (y: number) => 1 - (y - GRAPH_PAD_TOP) / plotH;

  // Live mirrors for the gesture (avoid stale closures without recreating the responder).
  const liveCurve = useRef(curves[effort]);
  liveCurve.current = curves[effort];
  const liveSleep = useRef(sleep);
  liveSleep.current = sleep;
  const lastHour = useRef<number | null>(null);
  const setLevelRef = useRef(onSetHourLevel);
  setLevelRef.current = onSetHourLevel;
  const selectRef = useRef(onSelectHour);
  selectRef.current = onSelectHour;

  const applyAt = (locX: number, locY: number, isStart: boolean) => {
    const w = widthRef.current;
    if (w <= 0) return;
    const cw = w / 24;
    const hour = Math.max(0, Math.min(23, Math.floor(locX / cw)));
    if (hourIsAsleep(liveSleep.current, hour)) {
      lastHour.current = hour;
      return; // sleep band is locked
    }
    const level = snap(levelForY(locY));
    // Paint intermediate hours when the finger skips across buckets, so a quick stroke fills smoothly.
    const prev = lastHour.current;
    if (!isStart && prev != null && Math.abs(hour - prev) > 1) {
      const step = hour > prev ? 1 : -1;
      const prevLevel = liveCurve.current[prev] ?? level;
      const span = Math.abs(hour - prev);
      for (let h = prev + step, k = 1; h !== hour; h += step, k++) {
        if (hourIsAsleep(liveSleep.current, h)) continue;
        const interp = snap(prevLevel + (level - prevLevel) * (k / span));
        setLevelRef.current(h, interp);
      }
    }
    if (hour !== prev) {
      if (Platform.OS !== 'web') void haptic.tab();
      selectRef.current(hour);
    }
    lastHour.current = hour;
    setLevelRef.current(hour, level);
  };
  // The responder is created once; route through a ref so it always runs the latest applyAt.
  const applyRef = useRef(applyAt);
  applyRef.current = applyAt;

  const responder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (e) => {
        lastHour.current = null;
        applyRef.current(e.nativeEvent.locationX, e.nativeEvent.locationY, true);
      },
      onPanResponderMove: (e) => {
        applyRef.current(e.nativeEvent.locationX, e.nativeEvent.locationY, false);
      },
      onPanResponderRelease: () => {
        lastHour.current = null;
      },
      onPanResponderTerminate: () => {
        lastHour.current = null;
      },
    }),
  ).current;

  const onLayout = (e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width);

  // Build points for the active curve.
  const pts = useMemo(
    () => curves[effort].map((v, h) => ({ x: xCenter(h), y: yForLevel(v) })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [curves, effort, width],
  );
  const linePath = width > 0 ? smoothLinePath(pts) : '';
  const areaPath = width > 0 && pts.length ? `${linePath} L ${pts[pts.length - 1].x} ${GRAPH_PAD_TOP + plotH} L ${pts[0].x} ${GRAPH_PAD_TOP + plotH} Z` : '';

  // Ghost the other two efforts faintly behind, for context.
  const ghostPaths = EFFORTS.filter((e) => e.key !== effort).map((e) => ({
    color: e.color,
    d: width > 0 ? smoothLinePath(curves[e.key].map((v, h) => ({ x: xCenter(h), y: yForLevel(v) }))) : '',
  }));

  // Sleep band rectangles (contiguous runs of asleep hours).
  const sleepRects: Array<{ x: number; w: number }> = [];
  if (width > 0) {
    let runStart: number | null = null;
    for (let h = 0; h <= 24; h++) {
      const asleep = h < 24 && hourIsAsleep(sleep, h);
      if (asleep && runStart == null) runStart = h;
      if (!asleep && runStart != null) {
        sleepRects.push({ x: colW * runStart, w: colW * (h - runStart) });
        runStart = null;
      }
    }
  }

  // Widest sleep band gets a small "Asleep" label so the locked zone is unmistakable.
  const widestSleep = sleepRects.reduce<{ x: number; w: number } | null>(
    (best, r) => (best && best.w >= r.w ? best : r),
    null,
  );

  const gradId = `fill-${effort}`;

  return (
    <View style={styles.graphCard}>
      <View style={styles.graphInner} onLayout={onLayout}>
        {width > 0 ? (
          <>
            <View style={StyleSheet.absoluteFill} {...responder.panHandlers}>
              <Svg width={width} height={GRAPH_H}>
                <SvgDefs>
                  <SvgLinearGradient id={gradId} x1="0" y1={GRAPH_PAD_TOP} x2="0" y2={GRAPH_PAD_TOP + plotH} gradientUnits="userSpaceOnUse">
                    <SvgStop offset="0" stopColor={meta.color} stopOpacity="0.34" />
                    <SvgStop offset="1" stopColor={meta.color} stopOpacity="0.02" />
                  </SvgLinearGradient>
                  {sleepRects.map((r, i) => (
                    <SvgClipPath key={`clip-${i}`} id={`sleepclip-${i}`}>
                      <SvgRect x={r.x} y={GRAPH_PAD_TOP} width={r.w} height={plotH} rx={8} />
                    </SvgClipPath>
                  ))}
                </SvgDefs>

                {/* Sleep bands — distinct (cool blue + diagonal hatch), obviously off-limits */}
                {sleepRects.map((r, i) => {
                  const HATCH = 11;
                  const count = Math.ceil((r.w + plotH) / HATCH);
                  return (
                    <SvgG key={`sleep-${i}`}>
                      <SvgRect x={r.x} y={GRAPH_PAD_TOP} width={r.w} height={plotH} fill={LUCY_COLORS.info} opacity={0.05} rx={8} />
                      <SvgG clipPath={`url(#sleepclip-${i})`}>
                        {Array.from({ length: count }).map((_, k) => {
                          const x0 = r.x - plotH + k * HATCH;
                          return (
                            <SvgLine
                              key={k}
                              x1={x0}
                              y1={GRAPH_PAD_TOP + plotH}
                              x2={x0 + plotH}
                              y2={GRAPH_PAD_TOP}
                              stroke={LUCY_COLORS.info}
                              strokeWidth={1}
                              opacity={0.07}
                            />
                          );
                        })}
                      </SvgG>
                      {/* dashed top edge marks the locked ceiling */}
                      <SvgLine
                        x1={r.x}
                        y1={GRAPH_PAD_TOP + 0.5}
                        x2={r.x + r.w}
                        y2={GRAPH_PAD_TOP + 0.5}
                        stroke={LUCY_COLORS.info}
                        strokeWidth={1}
                        strokeDasharray="3 4"
                        opacity={0.4}
                      />
                    </SvgG>
                  );
                })}

                {/* Horizontal grid lines */}
                {[0.25, 0.5, 0.75].map((g) => (
                  <SvgLine
                    key={g}
                    x1={0}
                    y1={yForLevel(g)}
                    x2={width}
                    y2={yForLevel(g)}
                    stroke={LUCY_COLORS.border}
                    strokeWidth={1}
                    opacity={0.5}
                  />
                ))}
                {/* Baseline */}
                <SvgLine x1={0} y1={GRAPH_PAD_TOP + plotH} x2={width} y2={GRAPH_PAD_TOP + plotH} stroke={LUCY_COLORS.border} strokeWidth={1.4} />

                {/* Ghost curves (context) */}
                {ghostPaths.map((g, i) =>
                  g.d ? <SvgPath key={i} d={g.d} stroke={g.color} strokeWidth={1.6} fill="none" opacity={0.16} /> : null,
                )}

                {/* Active area + line */}
                {areaPath ? <SvgPath d={areaPath} fill={`url(#${gradId})`} /> : null}
                {linePath ? (
                  <SvgPath d={linePath} stroke={meta.color} strokeWidth={3} fill="none" strokeLinejoin="round" strokeLinecap="round" />
                ) : null}

                {/* Handles at each awake hour */}
                {curves[effort].map((v, h) => {
                  if (hourIsAsleep(sleep, h)) return null;
                  const isSel = selectedHour === h;
                  return (
                    <SvgG key={h}>
                      {isSel ? <SvgCircle cx={xCenter(h)} cy={yForLevel(v)} r={9} fill={meta.color} opacity={0.18} /> : null}
                      <SvgCircle
                        cx={xCenter(h)}
                        cy={yForLevel(v)}
                        r={isSel ? 5 : 2.6}
                        fill={isSel ? meta.color : LUCY_COLORS.surface}
                        stroke={meta.color}
                        strokeWidth={isSel ? 2.4 : 1.6}
                      />
                    </SvgG>
                  );
                })}
              </Svg>
            </View>
            {/* Locked-zone label, overlaid (non-interactive) on the widest sleep band */}
            {widestSleep && widestSleep.w > 52 ? (
              <View
                pointerEvents="none"
                style={[styles.sleepTag, { left: widestSleep.x, width: widestSleep.w, top: GRAPH_PAD_TOP }]}
              >
                <Text style={styles.sleepTagText}>🌙 Asleep</Text>
              </View>
            ) : null}
          </>
        ) : null}
      </View>

      {/* Human time axis */}
      <View style={styles.axis}>
        {['Morning', 'Midday', 'Afternoon', 'Evening', 'Night'].map((l) => (
          <Text key={l} style={styles.axisLabel}>
            {l}
          </Text>
        ))}
      </View>
    </View>
  );
}

// ─── Small building blocks ─────────────────────────────────────────────────
function SectionLabel({ children }: { children: string }) {
  return <Text style={styles.sectionLabel}>{children}</Text>;
}

function TimeChip({
  label,
  value,
  active,
  accent,
  icon,
  onPress,
}: {
  label: string;
  value: string;
  active: boolean;
  accent: string;
  icon?: string;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      activeOpacity={0.85}
      onPress={onPress}
      style={[styles.timeChip, active && { borderColor: accent, backgroundColor: accent + '14' }]}
    >
      <Text style={styles.timeChipLabel}>
        {icon ? `${icon} ` : ''}
        {label}
      </Text>
      <Text style={[styles.timeChipValue, active && { color: accent }]}>{value}</Text>
    </TouchableOpacity>
  );
}

/** Compact hour + minute wheel (reuses the app's column-picker idiom, no native deps). */
function TimeWheel({ minutes, accent, onChange }: { minutes: number; accent: string; onChange: (m: number) => void }) {
  const h = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  const h12 = h % 12 === 0 ? 12 : h % 12;
  const isPm = h >= 12;

  const setH12 = (nh12: number) => {
    const base = nh12 % 12;
    onChange((isPm ? base + 12 : base) * 60 + m);
  };
  const setMin = (nm: number) => onChange(h * 60 + nm);
  const setAmPm = (pm: boolean) => onChange(((h % 12) + (pm ? 12 : 0)) * 60 + m);

  return (
    <View style={styles.wheelWrap}>
      <WheelCol label="Hour" value={h12} options={Array.from({ length: 12 }, (_, i) => i + 1)} accent={accent} onSelect={setH12} />
      <WheelCol label="Min" value={m} options={[0, 15, 30, 45]} accent={accent} format={(x) => String(x).padStart(2, '0')} onSelect={setMin} />
      <WheelCol
        label="AM/PM"
        value={isPm ? 1 : 0}
        options={[0, 1]}
        accent={accent}
        format={(x) => (x === 0 ? 'AM' : 'PM')}
        onSelect={(v) => setAmPm(v === 1)}
      />
    </View>
  );
}

function WheelCol({
  label,
  value,
  options,
  accent,
  format,
  onSelect,
}: {
  label: string;
  value: number;
  options: number[];
  accent: string;
  format?: (v: number) => string;
  onSelect: (v: number) => void;
}) {
  return (
    <View style={{ flex: 1 }}>
      <Text style={styles.wheelColLabel}>{label}</Text>
      <ScrollView style={styles.wheelCol} showsVerticalScrollIndicator={false} nestedScrollEnabled>
        {options.map((opt) => {
          const sel = opt === value;
          return (
            <TouchableOpacity
              key={opt}
              style={[styles.wheelItem, sel && { backgroundColor: accent + '22' }]}
              onPress={() => onSelect(opt)}
            >
              <Text style={[styles.wheelItemText, sel && { color: accent, fontWeight: '800' }]}>
                {format ? format(opt) : String(opt)}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );
}

// ─── Layout constants for the segmented control ink ────────────────────────
// Sheet horizontal padding is 20 each side; segment has 4px inset padding.
const SCREEN_W = Dimensions.get('window').width;
const SEG_INNER_W = SCREEN_W - 40 - 8; // sheet padding (40) + segment padding (8)
const SEG_ITEM_W = SEG_INNER_W / EFFORTS.length;

const styles = StyleSheet.create({
  backdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(20,22,40,0.40)' },
  anchor: { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: LUCY_COLORS.surfaceSheet,
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    borderWidth: 1,
    borderColor: LUCY_COLORS.border,
    paddingHorizontal: 20,
    paddingTop: 10,
    maxHeight: '94%',
    shadowColor: '#1A1B2E',
    shadowOffset: { width: 0, height: -6 },
    shadowOpacity: 0.1,
    shadowRadius: 24,
    elevation: 14,
  },
  grip: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: LUCY_COLORS.border, marginBottom: 12 },

  headerRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 4 },
  eyebrow: { color: LUCY_COLORS.primaryGlow, fontSize: 10.5, fontWeight: '900', letterSpacing: 1.4, textTransform: 'uppercase', marginBottom: 4 },
  title: { color: LUCY_COLORS.textDark, fontSize: 25, fontWeight: '900', letterSpacing: -0.4 },
  closeBtn: { paddingVertical: 7, paddingHorizontal: 12, borderRadius: 13, backgroundColor: LUCY_COLORS.surface, marginTop: 6 },
  closeText: { color: LUCY_COLORS.textMuted, fontSize: 12.5, fontWeight: '700' },

  loadingWrap: { paddingVertical: 60, alignItems: 'center', justifyContent: 'center' },
  loadingText: { color: LUCY_COLORS.textSubtle, fontSize: 13 },

  scrollContent: { paddingTop: 8, paddingBottom: 36 },
  lede: { color: LUCY_COLORS.textMuted, fontSize: 13.5, lineHeight: 20, marginBottom: 18 },

  sectionLabel: { color: LUCY_COLORS.primaryGlow, fontSize: 11, fontWeight: '900', letterSpacing: 1.1, textTransform: 'uppercase', marginBottom: 9, marginTop: 6 },

  card: { backgroundColor: LUCY_COLORS.surfaceRaised, borderRadius: 18, borderWidth: 1, borderColor: LUCY_COLORS.border, padding: 14, marginBottom: 18 },
  timeRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  arrow: { width: 18, alignItems: 'center' },
  arrowText: { color: LUCY_COLORS.textSubtle, fontSize: 16, fontWeight: '700' },
  timeChip: { flex: 1, backgroundColor: LUCY_COLORS.surface, borderRadius: 14, borderWidth: 1, borderColor: LUCY_COLORS.border, paddingVertical: 11, paddingHorizontal: 13 },
  timeChipLabel: { color: LUCY_COLORS.textSubtle, fontSize: 11, fontWeight: '700' },
  timeChipValue: { color: LUCY_COLORS.textDark, fontSize: 18, fontWeight: '900', marginTop: 3, letterSpacing: -0.2 },

  miniLabel: { color: LUCY_COLORS.textSubtle, fontSize: 11, fontWeight: '800', letterSpacing: 0.6, textTransform: 'uppercase', marginTop: 16, marginBottom: 9 },
  daysRow: { flexDirection: 'row', gap: 7 },
  dayChip: { flex: 1, aspectRatio: 1, maxHeight: 44, borderRadius: 12, backgroundColor: LUCY_COLORS.surface, borderWidth: 1, borderColor: LUCY_COLORS.border, alignItems: 'center', justifyContent: 'center' },
  dayChipOn: { backgroundColor: LUCY_COLORS.primarySoft, borderColor: LUCY_COLORS.primary },
  dayChipText: { color: LUCY_COLORS.textMuted, fontSize: 14, fontWeight: '800' },
  dayChipTextOn: { color: LUCY_COLORS.primaryGlow },

  sleepHint: { color: LUCY_COLORS.textSubtle, fontSize: 12, lineHeight: 18, marginTop: 13 },

  // Segmented control
  segment: { flexDirection: 'row', backgroundColor: LUCY_COLORS.surface, borderRadius: 15, borderWidth: 1, borderColor: LUCY_COLORS.border, padding: 4, marginBottom: 12, position: 'relative' },
  segmentInk: { position: 'absolute', top: 4, left: 4, bottom: 4, width: SEG_ITEM_W, borderRadius: 11, borderWidth: 1 },
  segmentItem: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, paddingVertical: 10, borderRadius: 11 },
  segmentDot: { width: 8, height: 8, borderRadius: 4 },
  segmentText: { color: LUCY_COLORS.textMuted, fontSize: 13.5, fontWeight: '800' },

  // Graph
  graphCard: { backgroundColor: LUCY_COLORS.surfaceRaised, borderRadius: 18, borderWidth: 1, borderColor: LUCY_COLORS.border, paddingTop: 6, paddingBottom: 10, paddingHorizontal: 8, overflow: 'hidden' },
  graphInner: { height: GRAPH_H, width: '100%' },
  sleepTag: { position: 'absolute', alignItems: 'center', justifyContent: 'center', height: 22 },
  sleepTagText: { color: LUCY_COLORS.info, fontSize: 10.5, fontWeight: '800', letterSpacing: 0.3, opacity: 0.75 },
  axis: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 6, marginTop: 2 },
  axisLabel: { color: LUCY_COLORS.textSubtle, fontSize: 10, fontWeight: '700' },

  // Readout / stepper
  readout: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: LUCY_COLORS.surface, borderRadius: 16, borderWidth: 1, paddingVertical: 12, paddingHorizontal: 15, marginTop: 12 },
  readoutTime: { color: LUCY_COLORS.textMuted, fontSize: 12, fontWeight: '700' },
  readoutLevel: { fontSize: 18, fontWeight: '900', marginTop: 2, letterSpacing: -0.2 },
  readoutPct: { color: LUCY_COLORS.textSubtle, fontSize: 13, fontWeight: '700' },
  stepper: { flexDirection: 'row', gap: 8 },
  stepBtn: { width: 44, height: 44, borderRadius: 12, borderWidth: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: LUCY_COLORS.surfaceRaised },
  stepText: { fontSize: 24, fontWeight: '800', marginTop: -2 },

  hintRow: { marginTop: 12, paddingHorizontal: 2 },
  dragHint: { color: LUCY_COLORS.textSubtle, fontSize: 12.5, lineHeight: 18 },
  helperLine: { color: LUCY_COLORS.textMuted, fontSize: 12.5, lineHeight: 18, marginTop: 12, fontStyle: 'italic' },

  resetRow: { alignSelf: 'flex-start', marginTop: 16, paddingVertical: 6 },
  resetText: { color: LUCY_COLORS.primaryGlow, fontSize: 13.5, fontWeight: '800' },

  actions: { marginTop: 22, gap: 10 },
  primaryBtn: {
    backgroundColor: LUCY_COLORS.primary,
    borderRadius: 16,
    paddingVertical: 16,
    alignItems: 'center',
    shadowColor: LUCY_COLORS.primary,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.35,
    shadowRadius: 12,
    elevation: 6,
  },
  primaryBtnDim: { opacity: 0.5 },
  primaryBtnText: { color: LUCY_COLORS.white, fontSize: 16, fontWeight: '900', letterSpacing: -0.2 },
  secondaryBtn: { borderRadius: 16, paddingVertical: 14, alignItems: 'center', borderWidth: 1, borderColor: LUCY_COLORS.border, backgroundColor: LUCY_COLORS.surfaceRaised },
  secondaryBtnText: { color: LUCY_COLORS.textMuted, fontSize: 14.5, fontWeight: '700' },

  // Time wheel
  wheelWrap: { flexDirection: 'row', gap: 10, marginTop: 12, backgroundColor: LUCY_COLORS.surface, borderRadius: 14, padding: 10 },
  wheelColLabel: { color: LUCY_COLORS.textSubtle, fontSize: 10.5, fontWeight: '800', textAlign: 'center', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 },
  wheelCol: { maxHeight: 124, backgroundColor: LUCY_COLORS.background, borderRadius: 10 },
  wheelItem: { paddingVertical: 9, alignItems: 'center', borderRadius: 8, marginVertical: 1, marginHorizontal: 3 },
  wheelItemText: { color: LUCY_COLORS.textMuted, fontSize: 15 },
});
