// src/screens/SetPasswordScreen.tsx
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
import { RootStackParamList } from "../navigation/AppNavigator"
import { setPassword } from "../services/user.service"
import { colors } from "../theme/colors"
import { globalStyles } from "../theme/styles"

type Props = NativeStackScreenProps<RootStackParamList, "SetPassword">

export default function SetPasswordScreen({ navigation, route }: Props) {
  const { email } = route.params

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
      await setPassword({ email, password })

      // Registro completo — limpiar el stack para que no pueda volver atrás
      navigation.reset({
        index: 0,
        routes: [{ name: "Home" }]
      })
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
            style={[globalStyles.input, { flex: 1, borderRadius: 12, marginBottom: 0 }]}
            placeholder="Mínimo 6 caracteres"
            placeholderTextColor={colors.gray}
            secureTextEntry={!showPass}
            onChangeText={setPasswordValue}
            value={password}
            accessibilityLabel="Campo de nueva contraseña"
            accessibilityRole="none"
            accessibilityHint="Mínimo 6 caracteres"
          />
          <TouchableOpacity
            onPress={() => setShowPass(!showPass)}
            style={{ marginLeft: 10 }}
            accessibilityRole="button"
            accessibilityLabel={showPass ? "Ocultar contraseña" : "Mostrar contraseña"}
            accessibilityHint={showPass ? "Oculta los caracteres de la contraseña" : "Muestra los caracteres de la contraseña"}
          >
            <Text style={{ fontSize: 18 }}>{showPass ? "🙈" : "👁"}</Text>
          </TouchableOpacity>
        </View>

        <Text style={{ color: colors.black, marginBottom: 4 }}>Confirmar contraseña</Text>
        <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 24 }}>
          <TextInput
            style={[globalStyles.input, { flex: 1, borderRadius: 12, marginBottom: 0 }]}
            placeholder="Repite la contraseña"
            placeholderTextColor={colors.gray}
            secureTextEntry={!showConfirm}
            onChangeText={setConfirm}
            value={confirm}
            accessibilityLabel="Campo de confirmación de contraseña"
            accessibilityRole="none"
            accessibilityHint="Repite la contraseña ingresada arriba"
          />
          <TouchableOpacity
            onPress={() => setShowConfirm(!showConfirm)}
            style={{ marginLeft: 10 }}
            accessibilityRole="button"
            accessibilityLabel={showConfirm ? "Ocultar confirmación de contraseña" : "Mostrar confirmación de contraseña"}
            accessibilityHint={showConfirm ? "Oculta los caracteres de confirmación" : "Muestra los caracteres de confirmación"}
          >
            <Text style={{ fontSize: 18 }}>{showConfirm ? "🙈" : "👁"}</Text>
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
