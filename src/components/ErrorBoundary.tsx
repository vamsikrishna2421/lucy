/**
 * App-wide crash safety net. Catches uncaught React render errors (and, via a global
 * handler set in App, non-React JS errors), logs them to dev_log for later diagnosis,
 * and shows a recoverable fallback instead of a hard white-screen crash. Critical for
 * diagnosing field crashes we can't reproduce locally.
 */
import React from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { LUCY_COLORS } from '../config/colors';

async function logCrash(message: string, stack: string): Promise<void> {
  try {
    const { getDatabase } = await import('../db');
    const { insertDevLog } = await import('../db/devLog');
    const db = await getDatabase();
    await insertDevLog(db, {
      category: 'crash',
      model: '',
      input_preview: stack.slice(0, 600),
      output_preview: '',
      duration_ms: 0,
      error: message.slice(0, 400),
    });
  } catch { /* logging must never throw */ }
}

/** Install a global handler for errors thrown outside the React tree (async, timers, etc). */
export function installGlobalErrorLogger(): void {
  try {
    const g = (global as unknown as { ErrorUtils?: { getGlobalHandler: () => (e: Error, fatal?: boolean) => void; setGlobalHandler: (h: (e: Error, fatal?: boolean) => void) => void } }).ErrorUtils;
    if (!g) return;
    const prev = g.getGlobalHandler();
    g.setGlobalHandler((error: Error, isFatal?: boolean) => {
      void logCrash(`[global${isFatal ? ':fatal' : ''}] ${error?.message ?? error}`, error?.stack ?? '');
      prev?.(error, isFatal);
    });
  } catch { /* ignore */ }
}

interface State { error: Error | null; }

export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State { return { error }; }

  componentDidCatch(error: Error, info: { componentStack?: string }): void {
    void logCrash(error?.message ?? String(error), `${error?.stack ?? ''}\n--- component stack ---\n${info?.componentStack ?? ''}`);
  }

  render(): React.ReactNode {
    if (!this.state.error) return this.props.children;
    return (
      <View style={styles.bg}>
        <Text style={styles.emoji}>😞</Text>
        <Text style={styles.title}>LUCY hit a snag</Text>
        <Text style={styles.sub}>The error was saved so it can be fixed. You can try again.</Text>
        <ScrollView style={styles.box}><Text style={styles.err}>{this.state.error.message}</Text></ScrollView>
        <TouchableOpacity style={styles.btn} onPress={() => this.setState({ error: null })}>
          <Text style={styles.btnText}>Try again</Text>
        </TouchableOpacity>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  bg: { flex: 1, backgroundColor: LUCY_COLORS.background, alignItems: 'center', justifyContent: 'center', padding: 28 },
  emoji: { fontSize: 44, marginBottom: 14 },
  title: { color: LUCY_COLORS.textDark, fontSize: 22, fontWeight: '700' },
  sub: { color: LUCY_COLORS.textMuted, fontSize: 14, textAlign: 'center', marginTop: 8, lineHeight: 20 },
  box: { maxHeight: 140, backgroundColor: LUCY_COLORS.surfaceRaised, borderRadius: 12, padding: 14, marginTop: 20, alignSelf: 'stretch', borderWidth: 1, borderColor: LUCY_COLORS.border },
  err: { color: LUCY_COLORS.error, fontSize: 12.5, fontFamily: 'monospace' },
  btn: { backgroundColor: LUCY_COLORS.primary, borderRadius: 24, paddingHorizontal: 30, paddingVertical: 13, marginTop: 22 },
  btnText: { color: LUCY_COLORS.white, fontWeight: '700', fontSize: 15 },
});
