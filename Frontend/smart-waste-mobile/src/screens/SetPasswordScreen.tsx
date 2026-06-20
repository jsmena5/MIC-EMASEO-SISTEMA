// src/screens/SetPasswordScreen.tsx
import { MaterialIcons } from "@expo/vector-icons"
import { NativeStackScreenProps } from "@react-navigation/native-stack"
import React, { useState, useRef, useEffect } from "react"
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
import { setPassword as savePassword } from "../services/user.service"
import { colors } from "../theme/colors"
import { globalStyles } from "../theme/styles"

type Props = NativeStackScreenProps<RootStackParamList, "SetPassword">

export default function SetPasswordScreen({ navigation, route }: Readonly<Props>) {
  const { email } = route.params

  const [password, setPassword]   = useState("")
  const [confirm, setConfirm]          = useState("")
  const [showPass, setShowPass]        = useState(false)
  const [showConfirm, setShowConfirm]  = useState(false)
  const [loading, setLoading]          = useState(false)

  // Evita setState tras desmontar (cancelar durante la creación de cuenta)
  const mountedRef = useRef(true)
  useEffect(() => () => { mountedRef.current = false }, [])

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
      await savePassword({ email, password })
      if (!mountedRef.current) return
      // Cuenta creada — navegar a Login para que el usuario inicie sesión.
      // El Alert no cancelable evita que en Android se descarte tocando fuera.
      Alert.alert(
        "¡Cuenta creada!",
        "Tu cuenta fue creada exitosamente. Inicia sesión para continuar.",
        [{
          text: "Ir a iniciar sesión",
          onPress: () => navigation.reset({ index: 0, routes: [{ name: "Login" }] }),
        }],
        { cancelable: false },
      )
    } catch (err: any) {
      if (!mountedRef.current) return
      Alert.alert("Error", err?.response?.data?.message || "No se pudo crear la cuenta. Revisa tu conexión e intenta de nuevo.")
    } finally {
      if (mountedRef.current) setLoading(false)
    }
  }

  const handleCancel = () => {
    if (loading) return  // no cancelar mientras se está creando la cuenta
    Alert.alert(
      "Cancelar registro",
      "¿Seguro que deseas salir? Perderás el progreso del registro.",
      [
        { text: "Seguir registrando", style: "cancel" },
        { text: "Sí, cancelar", style: "destructive", onPress: () => navigation.navigate("Login") },
      ],
    )
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
            textContentType="newPassword"
            importantForAutofill="no"
            onChangeText={setPassword}
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
            <MaterialIcons
              name={showPass ? "visibility-off" : "visibility"}
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
            textContentType="newPassword"
            importantForAutofill="no"
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
            <MaterialIcons
              name={showConfirm ? "visibility-off" : "visibility"}
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
          onPress={handleCancel}
          style={{ marginTop: 16 }}
          accessibilityHint="Abandona el proceso de registro y vuelve al inicio de sesión"
        />

      </View>
    </View>
  )
}
