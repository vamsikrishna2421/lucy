import { Text, StyleSheet, type StyleProp, type TextStyle } from 'react-native';
import { LUCY_COLORS } from '../config/colors';

export interface ProtectedValueLite { value: string; kind: 'secret' | 'person'; }

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Renders `text` with Privacy-Shield-protected values highlighted so the user can see
 * what LUCY kept private from the cloud:
 *  - secret (passwords/cards) → solid green shield pill (🛡)
 *  - person (names)           → lighter cosmetic accent (tinted, dotted underline)
 *
 * `protectedValues` come from the capture's stored `protected_values` JSON.
 */
export function ShieldedText({
  text,
  protectedValues,
  style,
  numberOfLines,
}: {
  text: string;
  protectedValues: ProtectedValueLite[];
  style?: StyleProp<TextStyle>;
  numberOfLines?: number;
}) {
  if (!text) return null;
  const vals = (protectedValues ?? []).filter((p) => p && p.value);
  if (vals.length === 0) return <Text style={style} numberOfLines={numberOfLines}>{text}</Text>;

  // Longest first so a longer value wins over a shorter substring at the same position.
  const sorted = [...vals].sort((a, b) => b.value.length - a.value.length);
  const kindOf = new Map(sorted.map((v) => [v.value.toLowerCase(), v.kind]));
  const re = new RegExp(`(${sorted.map((v) => escapeRegExp(v.value)).join('|')})`, 'gi');
  const parts = text.split(re); // capturing group keeps the matched values in the array

  return (
    <Text style={style} numberOfLines={numberOfLines}>
      {parts.map((part, i) => {
        const kind = part ? kindOf.get(part.toLowerCase()) : undefined;
        if (!kind) return <Text key={i}>{part}</Text>;
        return <Text key={i} style={kind === 'secret' ? s.secret : s.person}>{part}</Text>;
      })}
    </Text>
  );
}

const s = StyleSheet.create({
  // Password / secret — plain green text.
  secret: {
    color: '#2FBF71',
    fontWeight: '700',
  },
  // Person name — plain orange text.
  person: {
    color: LUCY_COLORS.primary,
    fontWeight: '600',
  },
});
