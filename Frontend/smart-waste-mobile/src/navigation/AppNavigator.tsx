// src/navigation/AppNavigator.tsx
import { NavigationContainer } from "@react-navigation/native"
import { createNativeStackNavigator } from "@react-navigation/native-stack"
import React, { lazy, Suspense } from "react"
import { ActivityIndicator, View } from "react-native"

import { useAuth } from "../contexts/AuthContext"
import { AnalysisProvider } from "../contexts/AnalysisContext"
import ErrorBoundary from "../components/ErrorBoundary"
import { navigationRef } from "../utils/navigationService"
import type { AnalysisResult, Incident } from "../services/image.service"

// ─── Pantallas iniciales (importadas directamente) ────────────────────────────
//
// Se cargan con el bundle inicial porque se muestran inmediatamente:
//   • SplashScreen  — visible durante isLoading === true
//   • LoginScreen   — primera pantalla del grupo público
//   • HomeScreen    — primera pantalla del grupo privado
//
import SplashScreen from "../screens/SplashScreen"
import LoginScreen  from "../screens/LoginScreen"
import HomeScreen   from "../screens/HomeScreen"

// ─── Pantallas secundarias (React.lazy) ───────────────────────────────────────
//
// Se cargan de forma diferida: su código no se evalúa hasta que se navega a
// ellas por primera vez.  Esto reduce el trabajo JS en el arranque y mejora
// el tiempo hasta que HomeScreen / LoginScreen son interactivas.
//
// En React 19 + Metro, el import() dinámico hace code-splitting a nivel de
// módulo: cada pantalla se evalúa solo cuando se necesita.
//
const _RegisterScreen           = lazy(() => import("../screens/RegisterScreen"))
const _OtpVerificationScreen    = lazy(() => import("../screens/OtpVerificationScreen"))
const _SetPasswordScreen        = lazy(() => import("../screens/SetPasswordScreen"))
const _ForgotPasswordScreen     = lazy(() => import("../screens/ForgotPasswordScreen"))
const _ForgotPasswordOtpScreen  = lazy(() => import("../screens/ForgotPasswordOtpScreen"))
const _ResetPasswordScreen      = lazy(() => import("../screens/ResetPasswordScreen"))
const _ScanScreen               = lazy(() => import("../screens/ScanScreen"))
const _ScanResultScreen         = lazy(() => import("../screens/ScanResultScreen"))
const _HistorialScreen          = lazy(() => import("../screens/HistorialScreen"))
const _ReportDetailScreen       = lazy(() => import("../screens/ReportDetailScreen"))
const _EnvironmentalAwarenessScreen = lazy(() => import("../screens/EnvironmentalAwarenessScreen"))
const _ManualScreen             = lazy(() => import("../screens/ManualScreen"))
const _AlertsScreen             = lazy(() => import("../screens/AlertsScreen"))
const _HelpScreen               = lazy(() => import("../screens/HelpScreen"))

// ─── Fallback de carga ────────────────────────────────────────────────────────
//
// Se muestra brevemente mientras el módulo lazy se evalúa (solo en la primera
// navegación a cada pantalla; las siguientes son instantáneas).
//
function ScreenFallback() {
  return (
    <View style={{ flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: "#F0F4F8" }}>
      <ActivityIndicator size="large" color="#005BAC" />
    </View>
  )
}

// ─── HOC de suspense ─────────────────────────────────────────────────────────
//
// Envuelve cada pantalla lazy con su propio Suspense para que el fallback sea
// local a esa pantalla (no bloquea el resto del navigator).
// Las referencias son estables porque se definen a nivel de módulo.
//
function ws(LazyComp: React.LazyExoticComponent<React.ComponentType<any>>) {
  return function LazyScreenWrapper(props: any) {
    return (
      <Suspense fallback={<ScreenFallback />}>
        <LazyComp {...props} />
      </Suspense>
    )
  }
}

// Referencias estables a nivel de módulo — React Navigation las registra una
// sola vez y no las desmonta/remonta en re-renders del componente padre.
const RegisterScreen            = ws(_RegisterScreen)
const OtpVerificationScreen     = ws(_OtpVerificationScreen)
const SetPasswordScreen         = ws(_SetPasswordScreen)
const ForgotPasswordScreen      = ws(_ForgotPasswordScreen)
const ForgotPasswordOtpScreen   = ws(_ForgotPasswordOtpScreen)
const ResetPasswordScreen       = ws(_ResetPasswordScreen)
const ScanScreen                = ws(_ScanScreen)
const ScanResultScreen          = ws(_ScanResultScreen)
const HistorialScreen           = ws(_HistorialScreen)
const ReportDetailScreen        = ws(_ReportDetailScreen)
const EnvironmentalAwarenessScreen = ws(_EnvironmentalAwarenessScreen)
const ManualScreen              = ws(_ManualScreen)
const AlertsScreen              = ws(_AlertsScreen)
const HelpScreen                = ws(_HelpScreen)

// ─── Tipos de navegación ──────────────────────────────────────────────────────

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
  ScanResult: { result: AnalysisResult; latitude: number; longitude: number; imageUri?: string }
  ForgotPassword: undefined
  ForgotPasswordOtp: { email: string }
  ResetPassword: { email: string; otp: string }
  Historial: undefined
  ReportDetail: { incident: Incident }
  EnvironmentalAwareness: undefined
  Manual: undefined
  Alerts: undefined
  Help: undefined
}

const Stack = createNativeStackNavigator<RootStackParamList>()

export default function AppNavigator() {
  const { token, isLoading } = useAuth()

  return (
    <AnalysisProvider>
    <ErrorBoundary>
    <NavigationContainer ref={navigationRef}>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        {isLoading ? (
          // ── Grupo de carga ────────────────────────────────────────────────
          // SplashScreen se importa directamente: se necesita inmediatamente.
          <Stack.Group navigationKey="loading">
            <Stack.Screen name="Splash" component={SplashScreen} />
          </Stack.Group>
        ) : token ? (
          // ── Grupo privado (usuario autenticado) ───────────────────────────
          // HomeScreen es directa; el resto son lazy (primera navegación solo).
          <Stack.Group navigationKey="private">
            <Stack.Screen name="Home"               component={HomeScreen} />
            <Stack.Screen name="Scan"               component={ScanScreen} />
            <Stack.Screen name="ScanResult"         component={ScanResultScreen} />
            <Stack.Screen name="Historial"          component={HistorialScreen} />
            <Stack.Screen name="ReportDetail"       component={ReportDetailScreen} />
            <Stack.Screen name="EnvironmentalAwareness" component={EnvironmentalAwarenessScreen} />
            <Stack.Screen name="Manual"             component={ManualScreen} />
            <Stack.Screen name="Alerts"             component={AlertsScreen} />
            <Stack.Screen name="Help"               component={HelpScreen} />
          </Stack.Group>
        ) : (
          // ── Grupo público (no autenticado) ────────────────────────────────
          // LoginScreen es directa; el flujo de registro/recuperación es lazy.
          <Stack.Group navigationKey="public">
            <Stack.Screen name="Login"              component={LoginScreen} />
            <Stack.Screen name="Register"           component={RegisterScreen} />
            <Stack.Screen name="OtpVerification"    component={OtpVerificationScreen} />
            <Stack.Screen name="SetPassword"        component={SetPasswordScreen} />
            <Stack.Screen name="ForgotPassword"     component={ForgotPasswordScreen} />
            <Stack.Screen name="ForgotPasswordOtp"  component={ForgotPasswordOtpScreen} />
            <Stack.Screen name="ResetPassword"      component={ResetPasswordScreen} />
          </Stack.Group>
        )}
      </Stack.Navigator>
    </NavigationContainer>
    </ErrorBoundary>
    </AnalysisProvider>
  )
}
