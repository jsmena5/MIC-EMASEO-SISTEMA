// src/screens/ResetPasswordScreen.tsx
import { Ionicons } from "@expo/vector-icons"
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
import { useAuth } from "../contexts/AuthContext"
import { colors } from "../theme/colors"
import { globalStyles } from "../theme/styles"

type Props = NativeStackScreenProps<RootStackParamList, "ResetPassword">

export default function ResetPasswordScreen({ navigation, route }: Props) {
  const { email, otp } = route.params
  const { login } = useAuth()

  const [password, setPassword]   = useState("")
  const [confirm, setConfirm]     = useState("")
  const [showPass, setShowPass]   = useState(false)
  const [showConf, setShowConf]   = useState(false)
  const [loading, setLoading]     = useState(false)

  // Mismas reglas que el backend (passwordValidator.js):
  // 8+ chars, 1 mayúscula, 1 minúscula, 1 dígito
  const validate = (): string | null => {
    if (password.length < 8)         return "La contraseña debe tener al menos 8 caracteres"
    if (!/[A-Z]/.test(password))     return "La contraseña debe contener al menos una mayúscula"
    if (!/[a-z]/.test(password))     return "La contraseña debe contener al menos una minúscula"
    if (!/[0-9]/.test(password))     return "La contraseña debe contener al menos un número"
    if (password !== confirm)        return "Las contraseñas no coinciden"
    return null
  }

  const handleReset = async () => {
    const error = validate()
    if (error) return Alert.alert("Error", error)

    try {
      setLoading(true)
      const res = await resetPassword({ email, otp, newPassword: password })

      // El backend devuelve un JWT listo para usar.
      // Llamar login() actualiza el AuthContext → AppNavigator cambia
      // automáticamente al grupo privado (Home) sin necesidad de navegar
      // manualmente. Intentar navigation.reset("Home") desde el grupo
      // público produce el error "not handled by any navigator".
      await login(res.data.token)
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
            style={[globalStyles.input, { flex: 1, borderRadius: 12, marginBottom: 0, color: colors.black }]}
            placeholder="Mínimo 8 caracteres"
            placeholderTextColor={colors.gray}
            secureTextEntry={!showPass}
            autoCapitalize="none"
            autoCorrect={false}
            onChangeText={setPassword}
            value={password}
          />
          <TouchableOpacity
            onPress={() => setShowPass(!showPass)}
            style={{ marginLeft: 10, padding: 4 }}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityRole="button"
            accessibilityLabel={showPass ? "Ocultar contraseña" : "Mostrar contraseña"}
          >
            <Ionicons
              name={showPass ? "eye-off-outline" : "eye-outline"}
              size={22}
              color={colors.gray500}
            />
          </TouchableOpacity>
        </View>

        <Text style={{ color: colors.black, marginBottom: 4 }}>Confirmar contraseña</Text>
        <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 24 }}>
          <TextInput
            style={[globalStyles.input, { flex: 1, borderRadius: 12, marginBottom: 0, color: colors.black }]}
            placeholder="Repite la contraseña"
            placeholderTextColor={colors.gray}
            secureTextEntry={!showConf}
            autoCapitalize="none"
            autoCorrect={false}
            onChangeText={setConfirm}
            value={confirm}
          />
          <TouchableOpacity
            onPress={() => setShowConf(!showConf)}
            style={{ marginLeft: 10, padding: 4 }}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityRole="button"
            accessibilityLabel={showConf ? "Ocultar confirmación" : "Mostrar confirmación"}
          >
            <Ionicons
              name={showConf ? "eye-off-outline" : "eye-outline"}
              size={22}
              color={colors.gray500}
            />
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
