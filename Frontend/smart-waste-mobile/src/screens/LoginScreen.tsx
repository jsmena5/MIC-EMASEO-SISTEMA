// src/screens/LoginScreen.tsx
import { NativeStackScreenProps } from "@react-navigation/native-stack"
import React, { useState } from "react"
import { Alert, Text, TextInput, TouchableOpacity, View } from "react-native"
import ButtonPrimary from "../components/ButtonPrimary"
import { RootStackParamList } from "../navigation/AppNavigator"
import { loginUser } from "../services/auth.service"
import { globalStyles } from "../theme/styles"

type Props = NativeStackScreenProps<RootStackParamList, "Login">

export default function LoginScreen({ navigation }: Props) {
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [loading, setLoading] = useState(false)

  const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

  const handleLogin = async () => {
    if (!email || !password) {
      return Alert.alert("Campos requeridos", "Por favor ingresa tu email y contraseña.")
    }

    if (!EMAIL_REGEX.test(email)) {
      return Alert.alert("Correo inválido", "Por favor, ingresa un correo electrónico válido.")
    }

    setLoading(true)
    try {
      await loginUser({ email, password })
      navigation.navigate("Home")
    } catch (err: any) {
      const status = err?.response?.status

      if (!err?.response) {
        Alert.alert(
          "Error de conexión",
          "Verifica tu conexión a internet e inténtalo de nuevo.",
          [{ text: "Reintentar", onPress: handleLogin }],
        )
      } else if (status === 401 || status === 403) {
        Alert.alert(
          "Credenciales incorrectas",
          "El email o la contraseña no son válidos. Revísalos e inténtalo de nuevo.",
        )
      } else {
        Alert.alert(
          "Error de conexión",
          "Ocurrió un problema al iniciar sesión. Por favor inténtalo de nuevo.",
          [{ text: "Reintentar", onPress: handleLogin }],
        )
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <View style={globalStyles.container}>
      <View style={globalStyles.card}>

        <Text style={globalStyles.title}>Login</Text>

        <TextInput
          style={globalStyles.input}
          placeholder="Email"
          value={email}
          onChangeText={setEmail}
          keyboardType="email-address"
          autoCapitalize="none"
          editable={!loading}
          accessibilityLabel="Campo de correo electrónico"
          accessibilityRole="none"
          accessibilityHint="Ingresa tu dirección de correo electrónico registrada en EMASEO"
        />

        <TextInput
          style={globalStyles.input}
          placeholder="Contraseña"
          secureTextEntry
          value={password}
          onChangeText={setPassword}
          editable={!loading}
          accessibilityLabel="Campo de contraseña"
          accessibilityRole="none"
          accessibilityHint="Ingresa tu contraseña de acceso"
        />

        <ButtonPrimary
          label="Ingresar"
          onPress={handleLogin}
          loading={loading}
          accessibilityLabel="Botón de iniciar sesión"
          accessibilityHint="Inicia sesión en tu cuenta de EMASEO"
        />

        <TouchableOpacity
          onPress={() => navigation.navigate("Register")}
          disabled={loading}
          accessibilityRole="button"
          accessibilityLabel="Crear una cuenta nueva"
          accessibilityHint="Navega a la pantalla de registro de EMASEO"
        >
          <Text style={{ marginTop: 15, textAlign: "center" }}>
            Crear cuenta
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          onPress={() => navigation.navigate("ForgotPassword")}
          disabled={loading}
          accessibilityRole="button"
          accessibilityLabel="Recuperar contraseña olvidada"
          accessibilityHint="Navega a la pantalla de recuperación de contraseña"
        >
          <Text style={{ marginTop: 10, textAlign: "center", color: "#005BAC" }}>
            ¿Olvidaste tu contraseña?
          </Text>
        </TouchableOpacity>

      </View>
    </View>
  )
}