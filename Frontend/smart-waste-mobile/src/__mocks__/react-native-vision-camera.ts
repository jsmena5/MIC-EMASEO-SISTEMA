// Mock de react-native-vision-camera para tests Jest
export const Camera = {
  getAvailableCameraDevices: jest.fn().mockResolvedValue([
    { id: 'back', position: 'back', hasFlash: true, hasTorch: true },
  ]),
  requestCameraPermission: jest.fn().mockResolvedValue('granted'),
}

export const useCameraPermission = jest.fn().mockReturnValue({
  hasPermission: true,
  requestPermission: jest.fn().mockResolvedValue(true),
})

export const useFrameProcessor = jest.fn().mockReturnValue(undefined)
