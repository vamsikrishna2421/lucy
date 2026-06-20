import * as ImagePicker from 'expo-image-picker';
import { Alert, Linking } from 'react-native';

function permissionAlert(what: string) {
  Alert.alert(
    `${what} access needed`,
    `LUCY needs ${what.toLowerCase()} access to scan receipts. Open Settings → LUCY and enable it.`,
    [{ text: 'Cancel', style: 'cancel' }, { text: 'Open Settings', onPress: () => Linking.openSettings() }],
  );
}

async function fromCamera(): Promise<string | null> {
  const { status } = await ImagePicker.requestCameraPermissionsAsync();
  if (status !== 'granted') { permissionAlert('Camera'); return null; }
  const r = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.7, allowsEditing: false });
  return r.canceled || !r.assets[0] ? null : r.assets[0].uri;
}

async function fromLibrary(): Promise<string | null> {
  const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (status !== 'granted') { permissionAlert('Photos'); return null; }
  const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.7, allowsEditing: false });
  return r.canceled || !r.assets[0] ? null : r.assets[0].uri;
}

export interface ScannedReceipt { text: string; imagePath: string | null }

/** Lets the user take a photo or pick one, then OCRs the receipt and returns the capture text PLUS a
 *  persisted copy of the receipt image (so the caller can attach it to the capture → expense on send). */
export async function scanReceiptToText(): Promise<ScannedReceipt | null> {
  const uri = await new Promise<string | null>((resolve) => {
    Alert.alert('Scan a receipt', 'Capture an expense from a receipt photo.', [
      { text: 'Take photo', onPress: () => void fromCamera().then(resolve) },
      { text: 'Choose from library', onPress: () => void fromLibrary().then(resolve) },
      { text: 'Cancel', style: 'cancel', onPress: () => resolve(null) },
    ]);
  });
  if (!uri) return null;
  // Keep a durable copy of the receipt photo (the picker URI is temporary) to attach to the expense.
  let imagePath: string | null = null;
  try { const { persistOriginalImage } = await import('./smartPhotoCapture'); imagePath = await persistOriginalImage(uri); } catch { /* image is optional */ }
  try {
    const { processReceiptImage, receiptToCapture } = await import('./receiptOCR');
    const receipt = await processReceiptImage(uri);
    const text = receiptToCapture(receipt);
    if (!receipt.merchant && !receipt.amount) {
      // OCR couldn't read it — usually a missing OpenAI key (vision) or a blurry photo.
      const { resolveRemoteAvailability } = await import('../ai/provider');
      const { available } = await resolveRemoteAvailability();
      Alert.alert(
        available ? "Couldn't read the receipt" : 'OpenAI key needed',
        available
          ? 'I couldn\'t make out the merchant or amount. Try a clearer, well-lit photo — or type the expense.'
          : 'Receipt scanning reads the photo with OpenAI vision. Add an OpenAI key in Settings → Remote intelligence, then try again.',
      );
      return { text, imagePath }; // still return the placeholder so the user can edit
    }
    Alert.alert('Receipt read ✓', `${text}\n\nReview it in the capture box and tap send to save the expense.`);
    return { text, imagePath };
  } catch (e) {
    Alert.alert('Could not read receipt', e instanceof Error ? e.message : 'Try a clearer photo, or type the expense instead.');
    return null;
  }
}
