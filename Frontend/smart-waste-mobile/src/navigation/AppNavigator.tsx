// src/navigation/AppNavigator.tsx
import { NavigationContainer } from "@react-navigation/native"
import { createNativeStackNavigator } from "@react-navigation/native-stack"

import HomeScreen from "../screens/HomeScreen"
import LoginScreen from "../screens/LoginScreen"
import OtpVerificationScreen from "../screens/OtpVerificationScreen"
import RegisterScreen from "../screens/RegisterScreen"
import ScanScreen from "../screens/ScanScreen"
import ScanResultScreen from "../screens/ScanResultScreen"
import SetPasswordScreen from "../screens/SetPasswordScreen"
import SplashScreen from "../screens/SplashScreen"
import type { AnalysisResult } from "../services/image.service"

export type RootStackParamList = {
  Splash: undefined
  Login: undefined
  Register: undefined
  OtpVerification: {
    email: string
    registrationData: { nombre: string; apellido: string; cedula: string; email: string }
  }
  SetPassword: { email: string }
  Home: undefined
  Scan: undefined
  ScanResult: { result: AnalysisResult }
}

const Stack = createNativeStackNavigator<RootStackParamList>()

export default function AppNavigator() {
  return (
    <NavigationContainer>
      <Stack.Navigator screenOptions={{ headerShown: false }}>

        <Stack.Screen name="Splash"           component={SplashScreen} />
        <Stack.Screen name="Login"            component={LoginScreen} />
        <Stack.Screen name="Register"         component={RegisterScreen} />
        <Stack.Screen name="OtpVerification"  component={OtpVerificationScreen} />
        <Stack.Screen name="SetPassword"      component={SetPasswordScreen} />
        <Stack.Screen name="Home"             component={HomeScreen} />
        <Stack.Screen name="Scan"             component={ScanScreen} />
        <Stack.Screen name="ScanResult"       component={ScanResultScreen} />

      </Stack.Navigator>
    </NavigationContainer>
  )
}
