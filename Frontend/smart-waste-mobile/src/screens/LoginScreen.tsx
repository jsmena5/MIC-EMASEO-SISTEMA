// src/screens/LoginScreen.tsx
import { NativeStackScreenProps } from "@react-navigation/native-stack"
import React, { useState } from "react"
import { Alert, Text, TextInput, TouchableOpacity, View } from "react-native"
import { RootStackParamList } from "../navigation/AppNavigator"
import { loginUser } from "../services/auth.service"
import { globalStyles } from "../theme/styles"

type Props = NativeStackScreenProps<RootStackParamList, "Login">


export default function LoginScreen({ navigation }: Props) {
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")

  const handleLogin = async () => {
    if (!username || !password) {
      return Alert.alert("Error", "Campos requeridos")
    }

    try {
      await loginUser({ username, password })
      navigation.navigate("Home")
    } catch {
      Alert.alert("Error", "Credenciales incorrectas")
    }
  }

  return (
    <View style={globalStyles.container}>
      <View style={globalStyles.card}>

        <Text style={globalStyles.title}>Login</Text>

        <TextInput
          style={globalStyles.input}
          placeholder="Username"
          value={username}
          onChangeText={setUsername}
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