import * as SplashScreen from "expo-splash-screen"
import React from "react"
import { AuthProvider } from "./src/contexts/AuthContext"
import { NetworkProvider } from "./src/contexts/NetworkContext"
import AppNavigator from "./src/navigation/AppNavigator"

/**
 * Mantener el splash nativo visible mientras el bundle JS carga
 * y mientras se restaura la sesión.  El componente <SplashScreen>
 * (src/screens/SplashScreen.tsx) lo ocultará en cuanto monte, de forma
 * que la transición native → React sea imperceptible (mismo fondo #001828).
 */
SplashScreen.preventAutoHideAsync().catch(() => {
  // Ignorar si el splash ya fue ocultado (p.ej. en recargas de desarrollo)
})

export default function App() {
  return (
    <NetworkProvider>
      <AuthProvider>
        <AppNavigator />
      </AuthProvider>
    </NetworkProvider>
  )
}
