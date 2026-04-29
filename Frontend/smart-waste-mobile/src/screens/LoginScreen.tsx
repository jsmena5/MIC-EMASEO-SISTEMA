// src/screens/LoginScreen.tsx
import { NativeStackScreenProps } from "@react-navigation/native-stack"
import React, { useState } from "react"
import { Alert, Text, TextInput, TouchableOpacity, View } from "react-native"
import { RootStackParamList } from "../navigation/AppNavigator"
import { loginUser } from "../services/auth.service"
import { globalStyles } from "../theme/styles"

type Props = NativeStackScreenProps<RootStackParamList, "Login">


export default function LoginScreen({ navigation }: Props) {
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")

  const handleLogin = async () => {
    if (!email || !password) {
      return Alert.alert("Error", "Campos requeridos")
    }

    try {
      await loginUser({ email, password })
      navigation.navigate("Home")
    } catch (err: any) {
      const status  = err?.response?.status
      const message = err?.response?.data?.message

      if (!err?.response) {
        Alert.alert("Error de red", `No se pudo conectar al servidor.\n\n${err?.message ?? ""}`)
      } else if (status === 401 || status === 403) {
        Alert.alert("Acceso denegado", message ?? "Credenciales incorrectas")
      } else {
        Alert.alert("Error", `(${status}) ${message ?? err?.message}`)
      }
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
        />

        <TextInput
          style={globalStyles.input}
          placeholder="Password"
          secureTextEntry
          value={password}
          onChangeText={setPassword}
        />

        <TouchableOpacity style={globalStyles.button} onPress={handleLogin}>
          <Text style={globalStyles.buttonText}>Ingresar</Text>
        </TouchableOpacity>

        <TouchableOpacity onPress={() => navigation.navigate("Register")}>
          <Text style={{ marginTop: 15, textAlign: "center" }}>
            Crear cuenta
          </Text>
        </TouchableOpacity>

        <TouchableOpacity onPress={() => navigation.navigate("ForgotPassword")}>
          <Text style={{ marginTop: 10, textAlign: "center", color: "#005BAC" }}>
            ¿Olvidaste tu contraseña?
          </Text>
        </TouchableOpacity>

      </View>
    </View>
  )
}