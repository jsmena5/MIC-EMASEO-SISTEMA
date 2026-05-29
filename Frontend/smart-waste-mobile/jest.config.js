module.exports = {
  preset: 'jest-expo',
  setupFilesAfterFramework: ['./jest.setup.js'],
  transformIgnorePatterns: [
    'node_modules/(?!(' + [
      '(jest-)?react-native',
      '@react-native(-community)?',
      'expo(nent)?',
      '@expo(nent)?(/.*)?',
      '@expo-google-fonts(/.*)?',
      'react-navigation',
      '@react-navigation(/.*)?',
      '@unimodules(/.*)?',
      'unimodules',
      'sentry-expo',
      'native-base',
      'react-native-svg',
      'react-native-vision-camera',
      'react-native-worklets-core',
      'react-native-reanimated',
    ].join('|') + '))',
  ],
  moduleNameMapper: {
    '^react-native-vision-camera$': '<rootDir>/src/__mocks__/react-native-vision-camera.ts',
    '^react-native-worklets-core$': '<rootDir>/src/__mocks__/react-native-worklets-core.ts',
  },
  testEnvironment: 'node',
}
