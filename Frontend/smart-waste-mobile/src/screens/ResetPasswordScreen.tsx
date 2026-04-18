// src/screens/ResetPasswordScreen.tsx
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
import { resetPassword } from "../services/auth.service"
import { colors } from "../theme/colors"
import { globalStyles } from "../theme/styles"

type Props = NativeStackScreenProps<RootStackParamList, "ResetPassword">

export default function ResetPasswordScreen({ navigation, route }: Props) {
  const { email, otp } = route.params

  const [password, setPassword]   = useState("")
  const [confirm, setConfirm]     = useState("")
  const [showPass, setShowPass]   = useState(false)
  const [showConf, setShowConf]   = useState(false)
  const [loading, setLoading]     = useState(false)

  const validate = (): string | null => {
    if (password.length < 6) return "La contraseña debe tener al menos 6 caracteres"
    if (password !== confirm)  return "Las contraseñas no coinciden"
    return null
  }

  const handleReset = async () => {
    const error = validate()
    if (error) return Alert.alert("Error", error)

    try {
      setLoading(true)
      await resetPassword({ email, otp, newPassword: password })
      // Limpiar el stack para que el usuario no pueda volver atrás
      navigation.reset({ index: 0, routes: [{ name: "Home" }] })
    } catch (err: any) {
      Alert.alert("Error", err?.response?.data?.message || "No se pudo restablecer la contraseña")
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

        <Text style={[globalStyles.title, { marginBottom: 4 }]}>
          Nueva contraseña
        </Text>
        <Text style={{ color: colors.gray, marginBottom: 24, fontSize: 13 }}>
          Paso 3 de 3 — Elige una contraseña segura
        </Text>

        <Text style={{ color: colors.black, marginBottom: 4 }}>Nueva contraseña</Text>
        <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 12 }}>
          <TextInput
            style={[globalStyles.input, { flex: 1, borderRadius: 12, marginBottom: 0 }]}
            placeholder="Mínimo 6 caracteres"
            placeholderTextColor={colors.gray}
            secureTextEntry={!showPass}
            onChangeText={setPassword}
            value={password}
          />
          <TouchableOpacity onPress={() => setShowPass(!showPass)} style={{ marginLeft: 10 }}>
            <Text style={{ fontSize: 18 }}>{showPass ? "🙈" : "👁"}</Text>
          </TouchableOpacity>
        </View>

        <Text style={{ color: colors.black, marginBottom: 4 }}>Confirmar contraseña</Text>
        <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 24 }}>
          <TextInput
            style={[globalStyles.input, { flex: 1, borderRadius: 12, marginBottom: 0 }]}
            placeholder="Repite la contraseña"
            placeholderTextColor={colors.gray}
            secureTextEntry={!showConf}
            onChangeText={setConfirm}
            value={confirm}
          />
          <TouchableOpacity onPress={() => setShowConf(!showConf)} style={{ marginLeft: 10 }}>
            <Text style={{ fontSize: 18 }}>{showConf ? "🙈" : "👁"}</Text>
          </TouchableOpacity>
        </View>

        <Pressable
          onPress={handleReset}
          disabled={loading}
          style={({ pressed }) => [
            globalStyles.button,
            { borderRadius: 12, opacity: pressed || loading ? 0.7 : 1 },
          ]}
        >
          {loading
            ? <ActivityIndicator color={colors.white} />
            : <Text style={globalStyles.buttonText}>Restablecer contraseña</Text>
          }
        </Pressable>

        <TouchableOpacity
          onPress={() => navigation.navigate("Login")}
          style={{ marginTop: 16 }}
        >
          <Text style={{ textAlign: "center", color: colors.gray, fontSize: 13 }}>
            Cancelar recuperación
          </Text>
        </TouchableOpacity>

      </View>
    </View>
  )
}
