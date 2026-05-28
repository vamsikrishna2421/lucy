import { StyleSheet, Text, View } from 'react-native';
import { LUCY_COLORS } from '../config/colors';
import type { PrivacyLevel } from '../types/extraction';

export function PrivacyBadge({ level }: { level: PrivacyLevel }) {
  if (level !== 'private') {
    return null;
  }
  return (
    <View accessibilityLabel="Private memory" style={styles.badge}>
      <Text style={styles.text}>{'\uD83D\uDD12'}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: { borderRadius: 14, paddingHorizontal: 6, paddingVertical: 4, alignSelf: 'flex-start', backgroundColor: LUCY_COLORS.surface },
  text: { color: LUCY_COLORS.textMuted, fontSize: 12 },
});
