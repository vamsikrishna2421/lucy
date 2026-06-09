import * as ImagePicker from 'expo-image-picker';
import { Alert, Linking } from 'react-native';

function permissionAlert(what: string) {
  Alert.alert(
    `${what} access needed`,
    `LUCY needs ${what.toLowerCase()} access to scan images. Open Settings → LUCY and enable it.`,
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

/** Shared "Take photo / Choose from library" chooser. */
export function pickImage(title = 'Add an image', message = 'Snap it or pick from your library.'): Promise<string | null> {
  return new Promise((resolve) => {
    Alert.alert(title, message, [
      { text: 'Take photo', onPress: () => void fromCamera().then(resolve) },
      { text: 'Choose from library', onPress: () => void fromLibrary().then(resolve) },
      { text: 'Cancel', style: 'cancel', onPress: () => resolve(null) },
    ]);
  });
}

/**
 * Snap (or pick) ANY image — a handwritten note, whiteboard, document, screenshot,
 * menu, etc. — and have LUCY read it with vision, extract the key info, and store it
 * as a memory. The image itself is deleted after extraction (privacy).
 * Returns true if a memory was stored.
 */
export async function snapImageToMemory(): Promise<boolean> {
  const uri = await pickImage('Snap a note or image', 'LUCY reads it, pulls out the key info, and saves it to your memory.');
  if (!uri) return false;
  try {
    const { resolveRemoteAvailability } = await import('../ai/provider');
    const { available } = await resolveRemoteAvailability();
    if (!available) {
      Alert.alert('OpenAI key needed', 'Reading images uses OpenAI vision. Add an OpenAI key in Settings → Remote intelligence, then try again.');
      return false;
    }
    const { processImageToMemory } = await import('./lucyLens');
    const result = await processImageToMemory(uri, null);
    if (result?.memoryText) {
      Alert.alert('Saved to memory ✓', `${result.category.toUpperCase()} — ${result.memoryText.slice(0, 140)}${result.memoryText.length > 140 ? '…' : ''}`);
      return true;
    }
    Alert.alert("Couldn't read it", 'I couldn\'t make out the text. Try a clearer, well-lit photo.');
    return false;
  } catch (e) {
    Alert.alert('Could not read image', e instanceof Error ? e.message : 'Please try again.');
    return false;
  }
}
