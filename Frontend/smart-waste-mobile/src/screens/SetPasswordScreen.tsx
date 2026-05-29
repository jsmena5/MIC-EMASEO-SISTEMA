// src/screens/SetPasswordScreen.tsx
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
  View
} from "react-native"
import BackButton from "../components/BackButton"
import LinkButton from "../components/LinkButton"
import ProgressBar from "../components/ProgressBar"
import { useAuth } from "../contexts/AuthContext"
import { RootStackParamList } from "../navigation/AppNavigator"
import { setPassword } from "../services/user.service"
import { colors } from "../theme/colors"
import { globalStyles } from "../theme/styles"

type Props = NativeStackScreenProps<RootStackParamList, "SetPassword">

export default function SetPasswordScreen({ navigation, route }: Props) {
  const { email } = route.params
  const { login } = useAuth()

  const [password, setPasswordValue]   = useState("")
  const [confirm, setConfirm]          = useState("")
  const [showPass, setShowPass]        = useState(false)
  const [showConfirm, setShowConfirm]  = useState(false)
  const [loading, setLoading]          = useState(false)

  const validate = (): string | null => {
    if (password.length < 6) return "La contraseña debe tener al menos 6 caracteres"
    if (password !== confirm) return "Las contraseñas no coinciden"
    return null
  }

  const handleCrearCuenta = async () => {
    const error = validate()
    if (error) return Alert.alert("Error", error)

    try {
      setLoading(true)
      const res = await setPassword({ email, password })

      // Registro completo — login() actualiza el AuthContext y AppNavigator
      // cambia automáticamente al grupo privado (Home). navigation.reset("Home")
      // desde el stack público produciría "not handled by any navigator".
      Alert.alert(
        "¡Cuenta creada!",
        "Tu cuenta ha sido creada exitosamente. Bienvenido a EMASEO.",
        [{ text: "Continuar", onPress: () => login(res.data.token) }]
      )
    } catch (err: any) {
      Alert.alert("Error", err?.response?.data?.message || "No se pudo crear la cuenta")
    } finally {
      setLoading(false)
    }
  }

  return (
    <View style={globalStyles.container}>
      <View style={[globalStyles.card, { borderRadius: 20 }]}>

        <BackButton onPress={() => navigation.goBack()} />

        <Text style={[globalStyles.title, { marginBottom: 12 }]}>
          Crear Contraseña
        </Text>
        <ProgressBar currentStep={3} totalSteps={3} />

        <Text style={{ color: colors.black, marginBottom: 4 }}>Nueva contraseña</Text>
        <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 12 }}>
          <TextInput
            style={[globalStyles.input, { flex: 1, borderRadius: 12, marginBottom: 0, color: colors.black }]}
            placeholder="Mínimo 6 caracteres"
            placeholderTextColor={colors.gray}
            secureTextEntry={!showPass}
            autoCapitalize="none"
            autoCorrect={false}
            onChangeText={setPasswordValue}
            value={password}
            accessibilityLabel="Campo de nueva contraseña"
            accessibilityRole="none"
            accessibilityHint="Mínimo 6 caracteres"
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
            secureTextEntry={!showConfirm}
            autoCapitalize="none"
            autoCorrect={false}
            onChangeText={setConfirm}
            value={confirm}
            accessibilityLabel="Campo de confirmación de contraseña"
            accessibilityRole="none"
            accessibilityHint="Repite la contraseña ingresada arriba"
          />
          <TouchableOpacity
            onPress={() => setShowConfirm(!showConfirm)}
            style={{ marginLeft: 10, padding: 4 }}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityRole="button"
            accessibilityLabel={showConfirm ? "Ocultar confirmación de contraseña" : "Mostrar confirmación de contraseña"}
          >
            <Ionicons
              name={showConfirm ? "eye-off-outline" : "eye-outline"}
              size={22}
              color={colors.gray500}
            />
          </TouchableOpacity>
        </View>

        <Pressable
          onPress={handleCrearCuenta}
          disabled={loading}
          style={({ pressed }) => [
            globalStyles.button,
            { borderRadius: 12, opacity: pressed || loading ? 0.7 : 1 }
          ]}
          accessibilityRole="button"
          accessibilityLabel="Crear mi cuenta en EMASEO"
          accessibilityHint="Completa el registro con la contraseña ingresada"
          accessibilityState={{ disabled: loading, busy: loading }}
        >
          {loading
            ? <ActivityIndicator color={colors.white} />
            : <Text style={globalStyles.buttonText}>Crear cuenta</Text>
          }
        </Pressable>

        <LinkButton
          label="Cancelar registro"
          onPress={() => navigation.navigate("Login")}
          style={{ marginTop: 16 }}
          accessibilityHint="Abandona el proceso de registro y vuelve al inicio de sesión"
        />

      </View>
    </View>
  )
}
