/**
 * splashSetup debe ser el PRIMER import para que preventAutoHideAsync()
 * se ejecute antes que React, AuthContext y cualquier otro módulo del bundle.
 * Ver splashSetup.ts para la explicación técnica completa.
 */
// eslint-disable-next-line import/first
import "./splashSetup"

import * as ScreenCapture from "expo-screen-capture"
import React, { useEffect } from "react"
import { AuthProvider } from "./src/contexts/AuthContext"
import { NetworkProvider } from "./src/contexts/NetworkContext"
import AppNavigator from "./src/navigation/AppNavigator"

export default function App() {
  useEffect(() => {
    /**
     * expo-camera (v17+) activa FLAG_SECURE en Android al abrir el viewfinder,
     * lo que bloquea las capturas de pantalla en toda la ventana.
     * allowScreenCaptureAsync() anula ese flag globalmente para toda la app.
     */
    ScreenCapture.allowScreenCaptureAsync().catch(() => {
      // No crítico: ignorar si el API no está disponible en esta plataforma.
    })
  }, [])

  return (
    <NetworkProvider>
      <AuthProvider>
        <AppNavigator />
      </AuthProvider>
    </NetworkProvider>
  )
}
