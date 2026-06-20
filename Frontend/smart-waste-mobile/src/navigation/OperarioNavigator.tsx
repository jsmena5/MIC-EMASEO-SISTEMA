import React from "react"
import { createNativeStackNavigator } from "@react-navigation/native-stack"
import MisAsignacionesScreen from "../screens/operario/MisAsignacionesScreen"
import AsignacionDetailScreen from "../screens/operario/AsignacionDetailScreen"
import ResolverScreen from "../screens/operario/ResolverScreen"

export type OperarioStackParamList = {
  MisAsignaciones: undefined
  AsignacionDetail: { asignacion_id: string }
  Resolver: {
    asignacion_id: string
    incident_id: string
    incident_lat: number
    incident_lon: number
  }
}

const Stack = createNativeStackNavigator<OperarioStackParamList>()

export default function OperarioNavigator() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="MisAsignaciones"  component={MisAsignacionesScreen} />
      <Stack.Screen name="AsignacionDetail" component={AsignacionDetailScreen} />
      <Stack.Screen name="Resolver"         component={ResolverScreen} />
    </Stack.Navigator>
  )
}
