// Mocks globales para módulos nativos que Jest no puede ejecutar directamente.

// env.ts exige EXPO_PUBLIC_API_URL al importarse (sin fallback). En tests no hay
// .env cargado, así que definimos una URL dummy: la red está mockeada (utils/api),
// el valor nunca se usa para peticiones reales.
process.env.EXPO_PUBLIC_API_URL = process.env.EXPO_PUBLIC_API_URL || 'https://test.local/api'

// expo-haptics
jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn(),
  ImpactFeedbackStyle: { Light: 'Light', Medium: 'Medium', Heavy: 'Heavy' },
}))

// expo-file-system
jest.mock('expo-file-system', () => ({
  readAsStringAsync: jest.fn().mockResolvedValue('base64mockdata'),
  EncodingType: { Base64: 'base64' },
}))

// expo-location
jest.mock('expo-location', () => ({
  requestForegroundPermissionsAsync: jest.fn().mockResolvedValue({ status: 'granted' }),
  getCurrentPositionAsync: jest.fn().mockResolvedValue({
    coords: { latitude: -0.1807, longitude: -78.4678, accuracy: 10 },
  }),
  Accuracy: { Balanced: 3, High: 4 },
}))

// @react-native-async-storage/async-storage
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn().mockResolvedValue(null),
  setItem: jest.fn().mockResolvedValue(undefined),
  removeItem: jest.fn().mockResolvedValue(undefined),
  multiGet: jest.fn().mockResolvedValue([]),
}))
