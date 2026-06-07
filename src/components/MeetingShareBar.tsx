import { useState, type RefObject } from 'react';
import { Alert, Share, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { captureRef } from 'react-native-view-shot';
import { LUCY_COLORS } from '../config/colors';

/**
 * Reusable share bar for meeting summaries — copy text, share text, share card
 * image, and save card image. Used by the post-recording summary and the
 * Brain → Meetings detail view.
 *
 * @param cardRef  ref to the View to capture as an image
 * @param getText  returns the formatted plain-text summary for copy/share
 */
export function MeetingShareBar({ cardRef, getText }: { cardRef: RefObject<View | null>; getText: () => string }) {
  const [busy, setBusy] = useState(false);

  const copyText = async () => {
    try {
      await Clipboard.setStringAsync(getText());
      Alert.alert('Copied', 'Summary copied to clipboard — paste it into WhatsApp, Notes, anywhere.');
    } catch { Alert.alert('Copy failed', 'Could not copy to clipboard.'); }
  };

  const shareText = async () => {
    try { await Share.share({ message: getText() }); } catch { /* cancelled */ }
  };

  const captureImage = async (): Promise<string> => {
    if (!cardRef.current) throw new Error('card not ready');
    try {
      return await captureRef(cardRef, { format: 'png', quality: 1, result: 'tmpfile' });
    } catch {
      await new Promise((r) => setTimeout(r, 250));
      return await captureRef(cardRef, { format: 'png', quality: 0.9, result: 'tmpfile' });
    }
  };

  const shareImage = async () => {
    setBusy(true);
    try {
      const uri = await captureImage();
      const Sharing = await import('expo-sharing');
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, { mimeType: 'image/png', dialogTitle: 'Share meeting summary' });
      } else {
        Alert.alert('Sharing unavailable', 'Image sharing is not available on this device.');
      }
    } catch (e) {
      Alert.alert('Could not create image', e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  };

  const saveImage = async () => {
    setBusy(true);
    try {
      // SDK 56 deprecated saveToLibraryAsync on the main entry; the legacy module
      // keeps the simple, stable save API.
      const MediaLibrary = await import('expo-media-library/legacy');
      const perm = await MediaLibrary.requestPermissionsAsync();
      if (!perm.granted) {
        Alert.alert('Photos permission needed', 'Allow photo library access in Settings → LUCY to save summary cards.');
        return;
      }
      const uri = await captureImage();
      await MediaLibrary.saveToLibraryAsync(uri);
      Alert.alert('Saved', 'Summary card saved to your photos.');
    } catch (e) {
      Alert.alert('Save failed', e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  };

  return (
    <View style={s.row}>
      <Action icon="📋" label="Copy" onPress={() => void copyText()} disabled={busy} />
      <Action icon="↗" label="Share text" onPress={() => void shareText()} disabled={busy} />
      <Action icon="🖼" label="Share card" onPress={() => void shareImage()} disabled={busy} />
      <Action icon="⬇" label="Save image" onPress={() => void saveImage()} disabled={busy} />
    </View>
  );
}

function Action({ icon, label, onPress, disabled }: { icon: string; label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <TouchableOpacity style={[s.action, disabled && { opacity: 0.5 }]} onPress={onPress} disabled={disabled} activeOpacity={0.7}>
      <Text style={s.icon}>{icon}</Text>
      <Text style={s.label}>{label}</Text>
    </TouchableOpacity>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', gap: 8, marginVertical: 12 },
  action: { flex: 1, alignItems: 'center', paddingVertical: 12, backgroundColor: LUCY_COLORS.surfaceRaised, borderRadius: 12, borderWidth: 1, borderColor: LUCY_COLORS.border, gap: 4 },
  icon: { fontSize: 18 },
  label: { color: LUCY_COLORS.textMuted, fontSize: 10, fontWeight: '700' },
});
