/**
 * ColorCustomizer — lets the user recolor every parameterized LUCY palette token (the keys of
 * LUCY_COLORS). Edits are staged locally, then persisted via colorPrefs and applied on a clean app
 * reload (colors.ts reads them synchronously at boot). Only the EXISTING tokens are editable — no new
 * surfaces are parameterized here.
 */
import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  DevSettings,
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
import * as Updates from 'expo-updates';
import { DEFAULT_LUCY_COLORS, LUCY_COLORS, type ColorKey } from '../config/colors';
import {
  clearColorOverridesSync,
  isHexColor,
  readColorOverridesSync,
  saveColorOverridesSync,
  type ColorOverrides,
} from '../config/colorPrefs';

const GROUPS: { title: string; hint: string; keys: ColorKey[] }[] = [
  { title: 'Accent', hint: 'Buttons, highlights & active states', keys: ['primary', 'primaryGlow', 'primaryDeep', 'primarySoft', 'primaryMist', 'primaryLine'] },
  { title: 'Surfaces', hint: 'Screen & card backgrounds, by depth', keys: ['background', 'surface', 'surfaceRaised', 'surfaceElevated', 'surfaceSheet', 'surfaceGlass'] },
  { title: 'Text', hint: 'Text hierarchy', keys: ['textDark', 'textMuted', 'textSubtle', 'textFaint'] },
  { title: 'Borders & dividers', hint: 'Hairlines & separators', keys: ['border', 'borderSoft', 'divider'] },
  { title: 'Semantic & categories', hint: 'Status colors & category accents', keys: ['success', 'warning', 'error', 'info', 'violet', 'cyan', 'teal', 'gold', 'rose', 'white'] },
  { title: 'Pillars', hint: "Lucy's four pillar accents", keys: ['listen', 'understand', 'connect', 'yield'] },
];

const LABELS: Record<ColorKey, string> = {
  primary: 'Primary', primaryGlow: 'Primary · glow', primaryDeep: 'Primary · pressed', primarySoft: 'Primary · soft bg', primaryMist: 'Primary · mist', primaryLine: 'Primary · outline',
  background: 'Background', surface: 'Surface', surfaceRaised: 'Surface · raised', surfaceElevated: 'Surface · elevated', surfaceSheet: 'Sheet', surfaceGlass: 'Glass',
  textDark: 'Text', textMuted: 'Text · muted', textSubtle: 'Text · subtle', textFaint: 'Text · faint',
  border: 'Border', borderSoft: 'Border · soft', divider: 'Divider',
  success: 'Success', warning: 'Warning', error: 'Error', info: 'Info', violet: 'Violet', cyan: 'Cyan', teal: 'Teal', gold: 'Gold', rose: 'Rose', white: 'White',
  listen: 'Listen', understand: 'Understand', connect: 'Connect', yield: 'Yield',
};

// A tasteful quick-pick palette spanning accents, surfaces and text shades.
const PRESETS = [
  '#FF8C42', '#F59E0B', '#F5C451', '#FACC15', '#4ADE80', '#34D399', '#22D3EE', '#60A5FA',
  '#818CF8', '#A78BFA', '#F472B6', '#FB7185', '#EF4444', '#10B981', '#0EA5E9', '#8B5CF6',
  '#FFFFFF', '#C4A882', '#8A7560', '#5C4A38', '#2D2218', '#1F1A14', '#161310', '#0C0B09',
];

function normalizeHexInput(raw: string): string {
  let s = raw.trim().replace(/[^0-9a-fA-F#]/g, '');
  if (!s.startsWith('#')) s = '#' + s.replace(/#/g, '');
  return ('#' + s.slice(1).replace(/#/g, '')).slice(0, 9).toUpperCase();
}

/** Pick readable text (dark or light) for a given background hex — quick luminance test. */
function readableOn(hex: string): string {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h.slice(0, 6);
  const r = parseInt(full.slice(0, 2), 16) || 0;
  const g = parseInt(full.slice(2, 4), 16) || 0;
  const b = parseInt(full.slice(4, 6), 16) || 0;
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.6 ? '#15161B' : '#FFFFFF';
}

export function ColorCustomizer({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  // Keys the user has explicitly changed away from default (seeded from what's already saved).
  const [pending, setPending] = useState<ColorOverrides>({});
  const [initial, setInitial] = useState<ColorOverrides>({});
  const [editing, setEditing] = useState<ColorKey | null>(null);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (visible) {
      const saved = readColorOverridesSync();
      setPending({ ...saved });
      setInitial({ ...saved });
      setEditing(null);
    }
  }, [visible]);

  const valueFor = (key: ColorKey): string => pending[key] ?? DEFAULT_LUCY_COLORS[key];
  const isCustom = (key: ColorKey): boolean => !!pending[key] && pending[key] !== DEFAULT_LUCY_COLORS[key];

  const setColor = (key: ColorKey, hex: string) => {
    setPending((prev) => {
      const next = { ...prev };
      if (hex.toUpperCase() === DEFAULT_LUCY_COLORS[key].toUpperCase()) delete next[key];
      else next[key] = hex.toUpperCase();
      return next;
    });
  };

  const resetKey = (key: ColorKey) => {
    setPending((prev) => { const next = { ...prev }; delete next[key]; return next; });
    setDraft(DEFAULT_LUCY_COLORS[key]);
  };

  // Effective overrides = only keys differing from default.
  const effective = useMemo(() => {
    const out: ColorOverrides = {};
    for (const [k, v] of Object.entries(pending)) {
      if (isHexColor(v) && v.toUpperCase() !== DEFAULT_LUCY_COLORS[k as ColorKey]?.toUpperCase()) out[k] = v.toUpperCase();
    }
    return out;
  }, [pending]);

  const changedCount = Object.keys(effective).length;
  const dirty = JSON.stringify(effective) !== JSON.stringify(normalizeMap(initial));

  // Live preview palette (merge pending over the currently-applied palette).
  const pv = (key: ColorKey) => valueFor(key);

  const applyAndReload = async () => {
    setSaving(true);
    try {
      saveColorOverridesSync(effective);
    } catch (e) {
      setSaving(false);
      Alert.alert("Couldn't save", e instanceof Error ? e.message : 'Color storage is unavailable on this device.');
      return;
    }
    // Apply by reloading the JS so colors.ts re-reads the palette at boot.
    try {
      await Updates.reloadAsync();
    } catch {
      try {
        DevSettings.reload();
      } catch {
        setSaving(false);
        Alert.alert('Colors saved', 'Fully close and reopen Lucy to see your new colors.', [{ text: 'OK', onPress: onClose }]);
      }
    }
  };

  const confirmResetAll = () => {
    Alert.alert('Reset all colors?', 'This restores every color to the LUCY default. Applied after a restart.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Reset & restart',
        style: 'destructive',
        onPress: async () => {
          setSaving(true);
          clearColorOverridesSync();
          try { await Updates.reloadAsync(); } catch { try { DevSettings.reload(); } catch { setSaving(false); Alert.alert('Reset saved', 'Reopen Lucy to see the default colors.', [{ text: 'OK', onPress: onClose }]); } }
        },
      },
    ]);
  };

  return (
    <Modal animationType="slide" visible={visible} onRequestClose={onClose} presentationStyle="fullScreen">
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.root}>
        <View style={styles.header}>
          <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Text style={styles.headerClose}>Close</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Customize colors</Text>
          <TouchableOpacity onPress={confirmResetAll} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Text style={styles.headerReset}>Reset all</Text>
          </TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          {/* Live preview */}
          <View style={[styles.preview, { backgroundColor: pv('surface'), borderColor: pv('border') }]}>
            <Text style={[styles.previewEyebrow, { color: pv('primary') }]}>PREVIEW</Text>
            <Text style={[styles.previewTitle, { color: pv('textDark') }]}>A few things to review</Text>
            <Text style={[styles.previewBody, { color: pv('textMuted') }]}>This is how your text and surfaces look together.</Text>
            <View style={styles.previewRow}>
              <View style={[styles.previewBtn, { backgroundColor: pv('primary') }]}>
                <Text style={[styles.previewBtnText, { color: readableOn(pv('primary')) }]}>Primary</Text>
              </View>
              <View style={[styles.previewChip, { backgroundColor: pv('primarySoft'), borderColor: pv('primaryLine') }]}>
                <Text style={{ color: pv('primaryGlow'), fontWeight: '700', fontSize: 12 }}>Chip</Text>
              </View>
              <View style={[styles.previewChip, { backgroundColor: pv('surfaceRaised'), borderColor: pv('border') }]}>
                <Text style={{ color: pv('textSubtle'), fontWeight: '600', fontSize: 12 }}>Muted</Text>
              </View>
            </View>
          </View>

          <Text style={styles.note}>
            Tap any color to change it. Changes apply after a quick restart of Lucy.
          </Text>

          {GROUPS.map((group) => (
            <View key={group.title} style={styles.group}>
              <Text style={styles.groupTitle}>{group.title}</Text>
              <Text style={styles.groupHint}>{group.hint}</Text>
              <View style={styles.groupCard}>
                {group.keys.map((key, i) => {
                  const val = valueFor(key);
                  const open = editing === key;
                  return (
                    <View key={key} style={[styles.tokenWrap, i > 0 && styles.tokenDivider]}>
                      <TouchableOpacity
                        activeOpacity={0.7}
                        style={styles.tokenRow}
                        onPress={() => { setEditing(open ? null : key); setDraft(val); }}
                      >
                        <View style={[styles.swatch, { backgroundColor: val }]} />
                        <View style={styles.tokenText}>
                          <Text style={styles.tokenLabel}>{LABELS[key]}</Text>
                          <Text style={styles.tokenKey}>{key}</Text>
                        </View>
                        {isCustom(key) ? <View style={styles.customDot} /> : null}
                        <Text style={styles.tokenHex}>{val}</Text>
                      </TouchableOpacity>

                      {open ? (
                        <View style={styles.editor}>
                          <View style={styles.editorTop}>
                            <View style={[styles.swatchLg, { backgroundColor: isHexColor(draft) ? draft : val }]} />
                            <TextInput
                              value={draft}
                              onChangeText={(t) => {
                                const n = normalizeHexInput(t);
                                setDraft(n);
                                if (isHexColor(n)) setColor(key, n);
                              }}
                              autoCapitalize="characters"
                              autoCorrect={false}
                              placeholder="#RRGGBB"
                              placeholderTextColor={LUCY_COLORS.textFaint}
                              style={styles.hexInput}
                              maxLength={9}
                            />
                            <TouchableOpacity onPress={() => resetKey(key)} style={styles.defaultBtn}>
                              <Text style={styles.defaultBtnText}>Default</Text>
                            </TouchableOpacity>
                          </View>
                          <View style={styles.presetGrid}>
                            {PRESETS.map((p) => (
                              <TouchableOpacity
                                key={p}
                                onPress={() => { setDraft(p); setColor(key, p); }}
                                style={[styles.preset, { backgroundColor: p }, draft.toUpperCase() === p && styles.presetActive]}
                              />
                            ))}
                          </View>
                        </View>
                      ) : null}
                    </View>
                  );
                })}
              </View>
            </View>
          ))}
          <View style={{ height: 24 }} />
        </ScrollView>

        {/* Sticky apply bar */}
        <View style={styles.footer}>
          <Text style={styles.footerCount}>
            {changedCount === 0 ? 'No changes' : `${changedCount} color${changedCount === 1 ? '' : 's'} changed`}
          </Text>
          <TouchableOpacity
            disabled={!dirty || saving}
            onPress={applyAndReload}
            style={[styles.applyBtn, (!dirty || saving) && styles.applyBtnDisabled]}
          >
            <Text style={[styles.applyBtnText, { color: readableOn(LUCY_COLORS.primary) }]}>{saving ? 'Applying…' : 'Apply & restart'}</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function normalizeMap(map: ColorOverrides): ColorOverrides {
  const out: ColorOverrides = {};
  for (const [k, v] of Object.entries(map)) {
    if (isHexColor(v) && v.toUpperCase() !== DEFAULT_LUCY_COLORS[k as ColorKey]?.toUpperCase()) out[k] = v.toUpperCase();
  }
  return out;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: LUCY_COLORS.background },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 18, paddingTop: Platform.OS === 'ios' ? 56 : 20, paddingBottom: 14,
    borderBottomWidth: 1, borderBottomColor: LUCY_COLORS.border,
  },
  headerClose: { color: LUCY_COLORS.textMuted, fontSize: 15, fontWeight: '600' },
  headerTitle: { color: LUCY_COLORS.textDark, fontSize: 17, fontWeight: '800' },
  headerReset: { color: LUCY_COLORS.error, fontSize: 14, fontWeight: '700' },
  scroll: { padding: 16 },

  preview: { borderRadius: 18, borderWidth: 1, padding: 16, marginBottom: 14 },
  previewEyebrow: { fontSize: 11, fontWeight: '800', letterSpacing: 1.5, marginBottom: 6 },
  previewTitle: { fontSize: 20, fontWeight: '800', marginBottom: 4 },
  previewBody: { fontSize: 13, lineHeight: 19, marginBottom: 14 },
  previewRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  previewBtn: { paddingHorizontal: 18, paddingVertical: 10, borderRadius: 12 },
  previewBtnText: { fontSize: 13, fontWeight: '800' },
  previewChip: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 11, borderWidth: 1 },

  note: { color: LUCY_COLORS.textSubtle, fontSize: 12, lineHeight: 18, marginBottom: 18, paddingHorizontal: 2 },

  group: { marginBottom: 18 },
  groupTitle: { color: LUCY_COLORS.textDark, fontSize: 15, fontWeight: '800', marginBottom: 2 },
  groupHint: { color: LUCY_COLORS.textSubtle, fontSize: 12, marginBottom: 10 },
  groupCard: { backgroundColor: LUCY_COLORS.surface, borderRadius: 16, borderWidth: 1, borderColor: LUCY_COLORS.border, overflow: 'hidden' },

  tokenWrap: {},
  tokenDivider: { borderTopWidth: 1, borderTopColor: LUCY_COLORS.divider },
  tokenRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 13, gap: 12 },
  swatch: { width: 30, height: 30, borderRadius: 8, borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)' },
  tokenText: { flex: 1 },
  tokenLabel: { color: LUCY_COLORS.textDark, fontSize: 14, fontWeight: '700' },
  tokenKey: { color: LUCY_COLORS.textFaint, fontSize: 11, marginTop: 1 },
  customDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: LUCY_COLORS.primary, marginRight: 2 },
  tokenHex: { color: LUCY_COLORS.textMuted, fontSize: 12, fontWeight: '600', fontVariant: ['tabular-nums'] },

  editor: { paddingHorizontal: 14, paddingBottom: 14, paddingTop: 2 },
  editorTop: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 },
  swatchLg: { width: 44, height: 44, borderRadius: 10, borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)' },
  hexInput: {
    flex: 1, color: LUCY_COLORS.textDark, fontSize: 15, fontWeight: '700',
    backgroundColor: LUCY_COLORS.surfaceRaised, borderRadius: 10, borderWidth: 1, borderColor: LUCY_COLORS.border,
    paddingHorizontal: 12, paddingVertical: 10,
  },
  defaultBtn: { paddingHorizontal: 12, paddingVertical: 10, borderRadius: 10, backgroundColor: LUCY_COLORS.surfaceRaised, borderWidth: 1, borderColor: LUCY_COLORS.border },
  defaultBtnText: { color: LUCY_COLORS.textMuted, fontSize: 12, fontWeight: '700' },
  presetGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  preset: { width: 30, height: 30, borderRadius: 8, borderWidth: 1, borderColor: 'rgba(255,255,255,0.14)' },
  presetActive: { borderWidth: 2, borderColor: LUCY_COLORS.textDark },

  footer: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 18, paddingTop: 12, paddingBottom: Platform.OS === 'ios' ? 30 : 16,
    borderTopWidth: 1, borderTopColor: LUCY_COLORS.border, backgroundColor: LUCY_COLORS.surface,
  },
  footerCount: { color: LUCY_COLORS.textMuted, fontSize: 13, fontWeight: '600' },
  applyBtn: { backgroundColor: LUCY_COLORS.primary, paddingHorizontal: 22, paddingVertical: 13, borderRadius: 13 },
  applyBtnDisabled: { opacity: 0.4 },
  applyBtnText: { color: '#15161B', fontSize: 14, fontWeight: '800' },
});
