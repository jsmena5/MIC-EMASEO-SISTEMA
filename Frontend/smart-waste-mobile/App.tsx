import React from "react"
import { AuthProvider } from "./src/contexts/AuthContext"
import { NetworkProvider } from "./src/contexts/NetworkContext"
import AppNavigator from "./src/navigation/AppNavigator"

export default function App() {
  return (
    <NetworkProvider>
      <AuthProvider>
        <AppNavigator />
      </AuthProvider>
    </NetworkProvider>
  )
}