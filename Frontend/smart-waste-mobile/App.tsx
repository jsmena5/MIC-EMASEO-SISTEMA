import React from "react"
import { NetworkProvider } from "./src/contexts/NetworkContext"
import AppNavigator from "./src/navigation/AppNavigator"

export default function App() {
  return (
    <NetworkProvider>
      <AppNavigator />
    </NetworkProvider>
  )
}