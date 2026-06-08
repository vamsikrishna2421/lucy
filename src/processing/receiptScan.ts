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

/** Lets the user take a photo or pick one, then OCRs the receipt and returns capture text. */
export async function scanReceiptToText(): Promise<string | null> {
  const uri = await new Promise<string | null>((resolve) => {
    Alert.alert('Scan a receipt', 'Capture an expense from a receipt photo.', [
      { text: 'Take photo', onPress: () => void fromCamera().then(resolve) },
      { text: 'Choose from library', onPress: () => void fromLibrary().then(resolve) },
      { text: 'Cancel', style: 'cancel', onPress: () => resolve(null) },
    ]);
  });
  if (!uri) return null;
  try {
    const { processReceiptImage, receiptToCapture } = await import('./receiptOCR');
    const receipt = await processReceiptImage(uri);
    return receiptToCapture(receipt);
  } catch {
    Alert.alert('Could not read receipt', 'Try a clearer photo, or type the expense instead.');
    return null;
  }
}
