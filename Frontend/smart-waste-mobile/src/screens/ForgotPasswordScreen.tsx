// src/screens/ForgotPasswordScreen.tsx
import { NativeStackScreenProps } from "@react-navigation/native-stack"
import React, { useState } from "react"
import {
  ActivityIndicator,
  Alert,
  Pressable,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native"
import { RootStackParamList } from "../navigation/AppNavigator"
import { requestPasswordReset } from "../services/auth.service"
import { colors } from "../theme/colors"
import { globalStyles } from "../theme/styles"

type Props = NativeStackScreenProps<RootStackParamList, "ForgotPassword">

export default function ForgotPasswordScreen({ navigation }: Props) {
  const [email, setEmail]     = useState("")
  const [loading, setLoading] = useState(false)

  const handleRequest = async () => {
    const trimmed = email.trim().toLowerCase()
    if (!trimmed) {
      return Alert.alert("Error", "Ingresa tu correo electrónico")
    }

    try {
      setLoading(true)
      await requestPasswordReset(trimmed)
      // El backend responde 200 siempre (no revela si el email existe)
      navigation.navigate("ForgotPasswordOtp", { email: trimmed })
    } catch (err: any) {
      Alert.alert("Error", err?.response?.data?.message || "No se pudo enviar el código")
    } finally {
      setLoading(false)
    }
  }

  return (
    <View style={globalStyles.container}>
      <View style={[globalStyles.card, { borderRadius: 20 }]}>

        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={{ alignSelf: "flex-start", marginBottom: 12 }}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Text style={{ color: colors.primary, fontWeight: "600", fontSize: 14 }}>← Atrás</Text>
        </TouchableOpacity>

        <Text style={[globalStyles.title, { textAlign: "center", marginBottom: 4 }]}>
          Recuperar contraseña
        </Text>
        <Text style={{ color: colors.gray, marginBottom: 24, textAlign: "center", fontSize: 13 }}>
          Paso 1 de 3 — Ingresa tu correo
        </Text>

        <Text style={{ color: colors.textSecondary, marginBottom: 20, textAlign: "center", lineHeight: 20 }}>
          Te enviaremos un código de 6 dígitos para verificar tu identidad.
        </Text>

        <Text style={{ color: colors.black, marginBottom: 4 }}>Correo electrónico</Text>
        <TextInput
          style={[globalStyles.input, { borderRadius: 12 }]}
          placeholder="tu@email.com"
          placeholderTextColor={colors.gray}
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          value={email}
          onChangeText={setEmail}
        />

        <Pressable
          onPress={handleRequest}
          disabled={loading}
          style={({ pressed }) => [
            globalStyles.button,
            { borderRadius: 12, marginTop: 8, opacity: pressed || loading ? 0.7 : 1 },
          ]}
        >
          {loading
            ? <ActivityIndicator color={colors.white} />
            : <Text style={globalStyles.buttonText}>Enviar código</Text>
          }
        </Pressable>

        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={{ marginTop: 16 }}
        >
          <Text style={{ textAlign: "center", color: colors.gray, fontSize: 13 }}>
            Volver al inicio de sesión
          </Text>
        </TouchableOpacity>

      </View>
    </View>
  )
}
