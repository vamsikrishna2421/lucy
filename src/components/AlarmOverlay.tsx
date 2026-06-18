/**
 * AlarmOverlay — full-screen ringing alarm shown while the app is open (driven by alarmManager).
 * A pulsing icon, the event title/time, and the two reactions the user needs: Dismiss (stop) and
 * Snooze 10 min. Buzz/haptics are driven by alarmManager; this is the visual + the reaction buttons.
 */
import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { LUCY_COLORS } from '../config/colors';
import { alarmManager, type ActiveAlarm } from '../audio/alarmManager';

export function AlarmOverlay() {
  const [alarm, setAlarm] = useState<ActiveAlarm | null>(null);
  const pulse = useRef(new Animated.Value(1)).current;

  useEffect(() => alarmManager.subscribe(setAlarm), []);

  useEffect(() => {
    if (!alarm) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1.18, duration: 600, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 600, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [alarm, pulse]);

  if (!alarm) return null;

  return (
    <Modal visible transparent animationType="fade" onRequestClose={() => void alarmManager.dismiss()}>
      <View style={styles.backdrop}>
        <Animated.View style={[styles.ring, { transform: [{ scale: pulse }] }]}>
          <Text style={styles.bell}>⏰</Text>
        </Animated.View>
        <Text style={styles.label}>ALARM</Text>
        <Text style={styles.title}>{alarm.body || alarm.title}</Text>
        <Text style={styles.sub}>It's time — tap when you've got it.</Text>
        <View style={styles.actions}>
          <TouchableOpacity style={[styles.btn, styles.snooze]} onPress={() => void alarmManager.snooze(10)}>
            <Text style={styles.snoozeText}>Snooze 10 min</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.btn, styles.dismiss]} onPress={() => void alarmManager.dismiss()}>
            <Text style={styles.dismissText}>I'm on it ✓</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(8,10,14,0.97)', alignItems: 'center', justifyContent: 'center', padding: 32 },
  ring: { width: 132, height: 132, borderRadius: 66, borderWidth: 3, borderColor: LUCY_COLORS.primary, alignItems: 'center', justifyContent: 'center', marginBottom: 28, backgroundColor: LUCY_COLORS.primarySoft },
  bell: { fontSize: 56 },
  label: { color: LUCY_COLORS.primaryGlow, letterSpacing: 3, fontSize: 13, fontWeight: '800', marginBottom: 10 },
  title: { color: LUCY_COLORS.textDark, fontSize: 26, fontWeight: '800', textAlign: 'center', lineHeight: 32 },
  sub: { color: LUCY_COLORS.textMuted, fontSize: 15, marginTop: 12, textAlign: 'center' },
  actions: { flexDirection: 'row', gap: 12, marginTop: 40 },
  btn: { paddingVertical: 16, paddingHorizontal: 22, borderRadius: 18, minWidth: 150, alignItems: 'center' },
  snooze: { backgroundColor: LUCY_COLORS.surfaceRaised, borderWidth: 1, borderColor: LUCY_COLORS.border },
  snoozeText: { color: LUCY_COLORS.textDark, fontWeight: '700', fontSize: 16 },
  dismiss: { backgroundColor: LUCY_COLORS.primary },
  dismissText: { color: '#0B0B0F', fontWeight: '800', fontSize: 16 },
});
