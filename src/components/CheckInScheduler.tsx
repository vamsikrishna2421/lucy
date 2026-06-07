import { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { LUCY_COLORS } from '../config/colors';
import { getDatabase } from '../db';
import { getSetting, setSetting } from '../db/settings';
import {
  cancelProgressCheckIn,
  DEFAULT_CHECKIN_TIMES,
  scheduleProgressCheckIn,
} from '../processing/notifications';

const TIMES_KEY = 'progress_checkin_times';
const NOTIF_ID_KEY = 'progress_checkin_notification_id';

function to12h(hhmm: string): string {
  const [h, m] = hhmm.split(':').map((n) => Number(n));
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
}

export function CheckInScheduler({
  visible,
  onClose,
  onChange,
}: {
  visible: boolean;
  onClose: () => void;
  onChange?: (enabled: boolean) => void;
}) {
  const [enabled, setEnabled] = useState(false);
  const [times, setTimes] = useState<string[]>(DEFAULT_CHECKIN_TIMES);
  const [picker, setPicker] = useState<{ hour: number; minute: number } | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!visible) return;
    void (async () => {
      const db = await getDatabase();
      const [stored, notifId] = await Promise.all([
        getSetting(db, TIMES_KEY),
        getSetting(db, NOTIF_ID_KEY),
      ]);
      setTimes(stored ? (JSON.parse(stored) as string[]) : DEFAULT_CHECKIN_TIMES);
      setEnabled(!!notifId);
    })();
  }, [visible]);

  const sortedTimes = [...times].sort();

  const removeTime = (t: string) => setTimes((prev) => prev.filter((x) => x !== t));

  const addTime = () => {
    if (!picker) return;
    const hhmm = `${String(picker.hour).padStart(2, '0')}:${String(picker.minute).padStart(2, '0')}`;
    setTimes((prev) => (prev.includes(hhmm) ? prev : [...prev, hhmm]));
    setPicker(null);
  };

  const save = async () => {
    setSaving(true);
    try {
      const db = await getDatabase();
      // Cancel any existing schedule first
      const existing = await getSetting(db, NOTIF_ID_KEY);
      if (existing) await cancelProgressCheckIn(existing);

      if (enabled && times.length > 0) {
        const ids = await scheduleProgressCheckIn(sortedTimes);
        await setSetting(db, NOTIF_ID_KEY, ids);
        await setSetting(db, TIMES_KEY, JSON.stringify(sortedTimes));
        onChange?.(true);
      } else {
        await setSetting(db, NOTIF_ID_KEY, '');
        await setSetting(db, TIMES_KEY, JSON.stringify(sortedTimes));
        onChange?.(false);
      }
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal transparent animationType="fade" visible={visible} onRequestClose={onClose}>
      <View style={s.backdrop}>
        <Pressable style={{ flex: 1 }} onPress={onClose} />
        <View style={s.sheet}>
          <View style={s.header}>
            <Text style={s.title}>Progress check-ins</Text>
            <TouchableOpacity onPress={onClose}><Text style={s.close}>Close</Text></TouchableOpacity>
          </View>
          <Text style={s.subtitle}>LUCY nudges you to capture updates at the times you choose.</Text>

          {/* Enable toggle */}
          <TouchableOpacity style={s.toggleRow} onPress={() => setEnabled((e) => !e)} activeOpacity={0.8}>
            <Text style={s.toggleLabel}>Reminders {enabled ? 'on' : 'off'}</Text>
            <View style={[s.switch, enabled && s.switchOn]}>
              <View style={[s.knob, enabled && s.knobOn]} />
            </View>
          </TouchableOpacity>

          {/* Times list */}
          <ScrollView style={{ maxHeight: 240 }} showsVerticalScrollIndicator={false}>
            {sortedTimes.length === 0 ? (
              <Text style={s.empty}>No times yet. Add one below.</Text>
            ) : sortedTimes.map((t) => (
              <View key={t} style={[s.timeRow, !enabled && { opacity: 0.45 }]}>
                <Text style={s.timeText}>{to12h(t)}</Text>
                <TouchableOpacity onPress={() => removeTime(t)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                  <Text style={s.removeBtn}>✕</Text>
                </TouchableOpacity>
              </View>
            ))}
          </ScrollView>

          {/* Add time */}
          {picker ? (
            <View style={s.pickerWrap}>
              <Text style={s.pickerLabel}>Pick a time</Text>
              <View style={s.pickerRow}>
                <TimeColumn label="Hour" value={((picker.hour % 12) === 0 ? 12 : picker.hour % 12)} options={Array.from({ length: 12 }, (_, i) => i + 1)}
                  onSelect={(h12) => setPicker((p) => p ? { ...p, hour: (p.hour >= 12 ? (h12 % 12) + 12 : (h12 % 12)) } : p)} />
                <TimeColumn label="Min" value={picker.minute} options={[0, 15, 30, 45]}
                  format={(m) => String(m).padStart(2, '0')}
                  onSelect={(m) => setPicker((p) => p ? { ...p, minute: m } : p)} />
                <TimeColumn label="AM/PM" value={picker.hour >= 12 ? 1 : 0} options={[0, 1]}
                  format={(v) => (v === 0 ? 'AM' : 'PM')}
                  onSelect={(v) => setPicker((p) => p ? { ...p, hour: v === 1 ? (p.hour % 12) + 12 : p.hour % 12 } : p)} />
              </View>
              <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
                <TouchableOpacity style={[s.pickerBtn, s.pickerBtnGhost]} onPress={() => setPicker(null)}>
                  <Text style={s.pickerBtnGhostText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[s.pickerBtn, s.pickerBtnPrimary]} onPress={addTime}>
                  <Text style={s.pickerBtnPrimaryText}>Add {to12h(`${String(picker.hour).padStart(2, '0')}:${String(picker.minute).padStart(2, '0')}`)}</Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : (
            <TouchableOpacity style={s.addRow} onPress={() => setPicker({ hour: 9, minute: 0 })}>
              <Text style={s.addText}>+ Add a time</Text>
            </TouchableOpacity>
          )}

          <TouchableOpacity style={[s.saveBtn, saving && { opacity: 0.6 }]} disabled={saving} onPress={() => void save()}>
            <Text style={s.saveText}>{saving ? 'Saving…' : 'Save schedule'}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

function TimeColumn({ label, value, options, format, onSelect }: {
  label: string;
  value: number;
  options: number[];
  format?: (v: number) => string;
  onSelect: (v: number) => void;
}) {
  return (
    <View style={{ flex: 1 }}>
      <Text style={s.colLabel}>{label}</Text>
      <ScrollView style={s.col} showsVerticalScrollIndicator={false}>
        {options.map((opt) => {
          const selected = opt === value;
          return (
            <TouchableOpacity key={opt} style={[s.colItem, selected && s.colItemSel]} onPress={() => onSelect(opt)}>
              <Text style={[s.colItemText, selected && s.colItemTextSel]}>{format ? format(opt) : String(opt)}</Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', flexDirection: 'column' },
  sheet: { backgroundColor: LUCY_COLORS.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, borderTopWidth: 1, borderTopColor: LUCY_COLORS.border, padding: 20, paddingBottom: 32 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { color: LUCY_COLORS.textDark, fontSize: 18, fontWeight: '800' },
  close: { color: LUCY_COLORS.primary, fontSize: 15, fontWeight: '700' },
  subtitle: { color: LUCY_COLORS.textSubtle, fontSize: 13, marginTop: 4, marginBottom: 16, lineHeight: 19 },
  toggleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: LUCY_COLORS.divider, marginBottom: 8 },
  toggleLabel: { color: LUCY_COLORS.textDark, fontSize: 15, fontWeight: '700' },
  switch: { width: 48, height: 28, borderRadius: 14, backgroundColor: LUCY_COLORS.border, padding: 3, justifyContent: 'center' },
  switchOn: { backgroundColor: LUCY_COLORS.primary },
  knob: { width: 22, height: 22, borderRadius: 11, backgroundColor: '#fff' },
  knobOn: { alignSelf: 'flex-end' },
  empty: { color: LUCY_COLORS.textSubtle, fontSize: 13, paddingVertical: 16, textAlign: 'center' },
  timeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 13, paddingHorizontal: 14, backgroundColor: LUCY_COLORS.surfaceRaised, borderRadius: 12, marginBottom: 8 },
  timeText: { color: LUCY_COLORS.textDark, fontSize: 16, fontWeight: '700' },
  removeBtn: { color: '#FB7185', fontSize: 16, fontWeight: '700' },
  addRow: { paddingVertical: 14, alignItems: 'center', marginTop: 4 },
  addText: { color: LUCY_COLORS.primaryGlow, fontSize: 15, fontWeight: '700' },
  pickerWrap: { backgroundColor: LUCY_COLORS.surfaceRaised, borderRadius: 14, padding: 14, marginTop: 8 },
  pickerLabel: { color: LUCY_COLORS.textMuted, fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 },
  pickerRow: { flexDirection: 'row', gap: 10 },
  colLabel: { color: LUCY_COLORS.textSubtle, fontSize: 11, fontWeight: '700', textAlign: 'center', marginBottom: 6 },
  col: { maxHeight: 132, backgroundColor: LUCY_COLORS.background, borderRadius: 10 },
  colItem: { paddingVertical: 10, alignItems: 'center' },
  colItemSel: { backgroundColor: LUCY_COLORS.primarySoft, borderRadius: 8 },
  colItemText: { color: LUCY_COLORS.textMuted, fontSize: 15 },
  colItemTextSel: { color: LUCY_COLORS.primaryGlow, fontWeight: '800' },
  pickerBtn: { flex: 1, paddingVertical: 12, borderRadius: 12, alignItems: 'center' },
  pickerBtnGhost: { backgroundColor: 'transparent', borderWidth: 1, borderColor: LUCY_COLORS.border },
  pickerBtnGhostText: { color: LUCY_COLORS.textMuted, fontSize: 14, fontWeight: '700' },
  pickerBtnPrimary: { backgroundColor: LUCY_COLORS.primary },
  pickerBtnPrimaryText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  saveBtn: { backgroundColor: LUCY_COLORS.primary, borderRadius: 14, paddingVertical: 16, alignItems: 'center', marginTop: 16 },
  saveText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
