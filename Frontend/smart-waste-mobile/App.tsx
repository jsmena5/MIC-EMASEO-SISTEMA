/**
 * splashSetup debe ser el PRIMER import para que preventAutoHideAsync()
 * se ejecute antes que React, AuthContext y cualquier otro módulo del bundle.
 * Ver splashSetup.ts para la explicación técnica completa.
 */
// eslint-disable-next-line import/first
import "./splashSetup"

import * as ScreenCapture from "expo-screen-capture"
import * as Updates from "expo-updates"
import React, { useEffect } from "react"
import Toast from "react-native-toast-message"
import { AuthProvider } from "./src/contexts/AuthContext"
import { NetworkProvider } from "./src/contexts/NetworkContext"
import AppNavigator from "./src/navigation/AppNavigator"

export default function App() {
  useEffect(() => {
    ScreenCapture.allowScreenCaptureAsync().catch(() => {})
  }, [])

  // Aplicar actualizaciones OTA inmediatamente al arrancar (solo en builds publicados)
  useEffect(() => {
    if (__DEV__ || !Updates.isEnabled) return
    void (async () => {
      try {
        const result = await Updates.checkForUpdateAsync()
        if (result.isAvailable) {
          await Updates.fetchUpdateAsync()
          await Updates.reloadAsync()
        }
      } catch {}
    })()
  }, [])

  return (
    <NetworkProvider>
      <AuthProvider>
        <AppNavigator />
        {/* Toast se monta aquí para quedar siempre por encima de cualquier pantalla */}
        <Toast />
      </AuthProvider>
    </NetworkProvider>
  )
}
