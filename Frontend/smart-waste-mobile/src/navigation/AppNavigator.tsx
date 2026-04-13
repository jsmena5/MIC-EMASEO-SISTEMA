// src/navigation/AppNavigator.tsx
import { NavigationContainer } from "@react-navigation/native"
import { createNativeStackNavigator } from "@react-navigation/native-stack"

import HomeScreen from "../screens/HomeScreen"
import LoginScreen from "../screens/LoginScreen"
import OtpVerificationScreen from "../screens/OtpVerificationScreen"
import RegisterScreen from "../screens/RegisterScreen"
import ScanScreen from "../screens/ScanScreen"
import SetPasswordScreen from "../screens/SetPasswordScreen"
import SplashScreen from "../screens/SplashScreen"

export type RootStackParamList = {
  Splash: undefined
  Login: undefined
  Register: undefined
  OtpVerification: { email: string }
  SetPassword: { email: string }
  Home: undefined
  Scan: undefined
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

      </Stack.Navigator>
    </NavigationContainer>
  )
}
