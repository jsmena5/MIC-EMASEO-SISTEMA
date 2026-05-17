import { Platform } from "react-native"
import * as SecureStore from "expo-secure-store"
import AsyncStorage from "@react-native-async-storage/async-storage"

// Android Keystore (TEE-backed) / iOS Keychain — hardware-encrypted per app bundle.
// Value size limit: 2048 bytes on Android, unlimited on iOS.
// Our JWTs are typically 400–800 bytes — within limit.
// Web: SecureStore is not supported (no TEE); falls back to AsyncStorage.
// Web sessions have a different threat model anyway (no offline rooted-device risk).

export async function saveSecure(key: string, value: string): Promise<void> {
  if (Platform.OS === "web") {
    await AsyncStorage.setItem(key, value)
    return
  }
  await SecureStore.setItemAsync(key, value)
}

export async function getSecure(key: string): Promise<string | null> {
  if (Platform.OS === "web") {
    return AsyncStorage.getItem(key)
  }
  return SecureStore.getItemAsync(key)
}

export async function deleteSecure(key: string): Promise<void> {
  if (Platform.OS === "web") {
    await AsyncStorage.removeItem(key)
    return
  }
  await SecureStore.deleteItemAsync(key)
}
