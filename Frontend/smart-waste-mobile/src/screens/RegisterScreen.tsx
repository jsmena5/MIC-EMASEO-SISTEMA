// src/screens/RegisterScreen.tsx
import { NativeStackScreenProps } from "@react-navigation/native-stack"
import React, { useState } from "react"
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View
} from "react-native"
import { RootStackParamList } from "../navigation/AppNavigator"
import { registerUser } from "../services/user.service"
import { globalStyles } from "../theme/styles"
import { colors } from "../theme/colors"

type Props = NativeStackScreenProps<RootStackParamList, "Register">

// Algoritmo módulo 10 del Registro Civil del Ecuador
const validarCedula = (cedula: string): boolean => {
  if (!/^\d{10}$/.test(cedula)) return false
  const provincia = parseInt(cedula.substring(0, 2))
  if (provincia < 1 || provincia > 24) return false
  if (parseInt(cedula[2]) >= 6) return false

  const coeficientes = [2, 1, 2, 1, 2, 1, 2, 1, 2]
  let suma = 0
  for (let i = 0; i < 9; i++) {
    let val = parseInt(cedula[i]) * coeficientes[i]
    if (val >= 10) val -= 9
    suma += val
  }
  const residuo = suma % 10
  const digitoCalculado = residuo === 0 ? 0 : 10 - residuo
  return digitoCalculado === parseInt(cedula[9])
}

type FormType = {
  nombre: string
  apellido: string
  cedula: string
  email: string
}

export default function RegisterScreen({ navigation }: Props) {
  const [form, setForm] = useState<FormType>({
    nombre: "", apellido: "", cedula: "", email: ""
  })
  const [loading, setLoading] = useState(false)

  const handleChange = (key: keyof FormType, value: string) => {
    setForm({ ...form, [key]: value })
  }

  const validate = (): string | null => {
    if (!form.nombre.trim())   return "Ingresa tu nombre"
    if (!form.apellido.trim()) return "Ingresa tu apellido"
    if (!validarCedula(form.cedula))
      return "Número de cédula inválido"
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email))
      return "Email inválido"
    return null
  }

  const handleContinuar = async () => {
    const error = validate()
    if (error) return Alert.alert("Error", error)

    try {
      setLoading(true)
      const res = await registerUser(form)
      const { email, emailSent } = res.data

      if (!emailSent) {
        Alert.alert(
          "Advertencia",
          "No se pudo enviar el email. Revisa la consola del servidor para ver el código OTP e ingrésalo manualmente."
        )
      }

      navigation.navigate("OtpVerification", { email, registrationData: form })
    } catch (err: any) {
      Alert.alert("Error", err?.response?.data?.message || "No se pudo iniciar el registro")
    } finally {
      setLoading(false)
    }
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={{ flexGrow: 1, padding: 20, justifyContent: "center" }}
      keyboardShouldPersistTaps="always"
    >
      <View style={[globalStyles.card, { borderRadius: 20, elevation: 5 }]}>

        <Text style={[globalStyles.title, { marginBottom: 4 }]}>Crear Cuenta</Text>
        <Text style={{ color: colors.gray, marginBottom: 24, fontSize: 13 }}>
          Paso 1 de 3 — Tus datos personales
        </Text>

        <Text style={{ color: colors.black, marginBottom: 4 }}>Nombre</Text>
        <TextInput
          style={[globalStyles.input, { borderRadius: 12 }]}
          placeholder="Ej: Juan Carlos"
          placeholderTextColor={colors.gray}
          onChangeText={(v) => handleChange("nombre", v)}
          value={form.nombre}
        />

        <Text style={{ color: colors.black, marginBottom: 4 }}>Apellido</Text>
        <TextInput
          style={[globalStyles.input, { borderRadius: 12 }]}
          placeholder="Ej: Pérez Torres"
          placeholderTextColor={colors.gray}
          onChangeText={(v) => handleChange("apellido", v)}
          value={form.apellido}
        />

        <Text style={{ color: colors.black, marginBottom: 4 }}>Cédula de identidad</Text>
        <TextInput
          style={[globalStyles.input, { borderRadius: 12 }]}
          placeholder="10 dígitos"
          placeholderTextColor={colors.gray}
          keyboardType="number-pad"
          maxLength={10}
          onChangeText={(v) => handleChange("cedula", v)}
          value={form.cedula}
        />

        <Text style={{ color: colors.black, marginBottom: 4 }}>Correo electrónico</Text>
        <TextInput
          style={[globalStyles.input, { borderRadius: 12 }]}
          placeholder="ejemplo@correo.com"
          placeholderTextColor={colors.gray}
          keyboardType="email-address"
          autoCapitalize="none"
          onChangeText={(v) => handleChange("email", v)}
          value={form.email}
        />

        <Pressable
          onPress={handleContinuar}
          disabled={loading}
          style={({ pressed }) => [
            globalStyles.button,
            { marginTop: 8, borderRadius: 12, opacity: pressed || loading ? 0.7 : 1 }
          ]}
        >
          {loading
            ? <ActivityIndicator color={colors.white} />
            : <Text style={globalStyles.buttonText}>Continuar</Text>
          }
        </Pressable>

        <TouchableOpacity onPress={() => navigation.navigate("Login")}>
          <Text style={{ marginTop: 16, textAlign: "center", color: colors.primary, fontWeight: "600" }}>
            ¿Ya tienes cuenta? Inicia sesión
          </Text>
        </TouchableOpacity>

      </View>
    </ScrollView>
  )
}
