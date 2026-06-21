import { StyleSheet, View } from 'react-native';
import { LUCY_COLORS } from '../config/colors';
import type { PrivacyLevel } from '../types/extraction';

/**
 * Privacy indicator \u2014 reads as "yours, private, safe" not "locked out".
 *
 * Design intent:
 *   private  \u2192 indigo shield ring (5\u00D75 pt dot inside a 9\u00D79 ring) \u2014 your most
 *              sensitive memories. The ring evokes a soft shield without the alarm of a padlock.
 *   local    \u2192 single 5\u00D75 pt muted dot, no ring \u2014 on-device, nothing sent anywhere.
 *   normal   \u2192 nothing rendered (default; every memory is on-device anyway, so no
 *              badge is needed and absence avoids badge-blindness).
 *
 * Placement: bottom-left of the card footer, 4 pt from left edge.
 * The component is intentionally tiny (9 pt total diameter) so it never
 * dominates the card hierarchy \u2014 it is a reassurance signal, not a warning.
 */
export function PrivacyBadge({ level }: { level: PrivacyLevel }) {
  if (level === 'private') {
    return (
      <View
        accessibilityLabel="Saved privately to your device only"
        style={styles.ring}
      >
        <View style={styles.dot} />
      </View>
    );
  }
  if (level === 'local') {
    return (
      <View
        accessibilityLabel="Stored locally on your device"
        style={styles.localDot}
      />
    );
  }
  return null;
}

// Indigo at ~38% opacity for the ring so it is visible but not alarming.
const RING_COLOR = LUCY_COLORS.primary + '61'; // ≈38% alpha
const DOT_COLOR = LUCY_COLORS.primary; // full-opacity indigo centre

const styles = StyleSheet.create({
  // Private: 9\u00D79 ring with a 5\u00D75 filled centre
  ring: {
    width: 9,
    height: 9,
    borderRadius: 5,
    borderWidth: 1.5,
    borderColor: RING_COLOR,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: DOT_COLOR,
  },
  // Local: plain 5\u00D75 muted dot \u2014 present but visually quieter
  localDot: {
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: LUCY_COLORS.textSubtle,
    opacity: 0.55,
  },
});
