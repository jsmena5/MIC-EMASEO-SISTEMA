// Mock de react-native-worklets-core para tests Jest
export const runOnJS = jest.fn((fn: (...args: unknown[]) => unknown) => fn)
export const useSharedValue = jest.fn((initial: unknown) => ({ value: initial }))
export const useWorkletCallback = jest.fn((fn: unknown) => fn)
