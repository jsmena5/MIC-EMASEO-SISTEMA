// src/screens/RegisterScreen.tsx
import { NativeStackScreenProps } from "@react-navigation/native-stack"
import React, { useState } from "react"
import {
  Alert,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View
} from "react-native"
import { RootStackParamList } from "../navigation/AppNavigator"
import { registerUser } from "../services/user.service"
import { globalStyles } from "../theme/styles"

type FormType = {
  nombre: string
  apellido: string
  cedula: string
  username: string
  email: string
  password: string
  confirmPassword: string
  ciudad: string
}

type Props = NativeStackScreenProps<RootStackParamList, "Register">

export default function RegisterScreen({ navigation }: Props) {

  const [form, setForm] = useState<FormType>({
    nombre: "",
    apellido: "",
    cedula: "",
    username: "",
    email: "",
    password: "",
    confirmPassword: "",
    ciudad: ""
  })

  const [showPassword, setShowPassword] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)

  const handleChange = (name: keyof FormType, value: string) => {
    setForm({ ...form, [name]: value })
  }

  // ✅ VALIDACIÓN MEJORADA
  const validate = () => {
    if (!form.nombre) return "Ingrese su nombre"
    if (!form.apellido) return "Ingrese su apellido"

    if (!/^\d{10}$/.test(form.cedula))
      return "La cédula debe tener 10 dígitos"

    if (form.username.includes(" "))
      return "El username no debe tener espacios"

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(form.email))
      return "Email inválido"

    if (form.password.length < 6)
      return "La contraseña debe tener al menos 6 caracteres"

    if (form.password !== form.confirmPassword)
      return "Las contraseñas no coinciden"

    return null
  }

  const handleRegister = async () => {
    const error = validate()
    if (error) return Alert.alert("Error", error)

    try {
      const { confirmPassword, ...data } = form
      await registerUser(data)

      Alert.alert("Éxito", "Registrado correctamente")
      navigation.navigate("Login")

    } catch {
      Alert.alert("Error", "No se pudo registrar")
    }
  }

  return (
    <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{
         flexGrow: 1,
         padding: 20
        }}
         showsVerticalScrollIndicator={false}
         keyboardShouldPersistTaps="handled"
          >
      <View style={globalStyles.card}>

        <Text style={globalStyles.title}>Registro</Text>

        {/* NOMBRE */}
        <Text>Nombre</Text>
        <TextInput
          style={globalStyles.input}
          onChangeText={(v) => handleChange("nombre", v)}
        />

        {/* APELLIDO */}
        <Text>Apellido</Text>
        <TextInput
          style={globalStyles.input}
          onChangeText={(v) => handleChange("apellido", v)}
        />

        {/* CEDULA */}
        <Text>Cédula</Text>
        <TextInput
          style={globalStyles.input}
          keyboardType="numeric"
          onChangeText={(v) => handleChange("cedula", v)}
        />
        <Text style={{ fontSize: 12, color: "gray", marginBottom: 10 }}>
          Debe contener 10 dígitos
        </Text>

        {/* USERNAME */}
        <Text>Username</Text>
        <TextInput
          style={globalStyles.input}
          onChangeText={(v) => handleChange("username", v)}
        />
        <Text style={{ fontSize: 12, color: "gray", marginBottom: 10 }}>
          Este será tu usuario para iniciar sesión (sin espacios)
        </Text>

        {/* EMAIL */}
        <Text>Email</Text>
        <TextInput
          style={globalStyles.input}
          keyboardType="email-address"
          onChangeText={(v) => handleChange("email", v)}
        />
        <Text style={{ fontSize: 12, color: "gray", marginBottom: 10 }}>
          Debe contener @ y un dominio válido
        </Text>

        {/* PASSWORD */}
        <Text>Contraseña</Text>
        <View style={{ flexDirection: "row", alignItems: "center" }}>
          <TextInput
            style={[globalStyles.input, { flex: 1 }]}
            secureTextEntry={!showPassword}
            onChangeText={(v) => handleChange("password", v)}
          />
          <TouchableOpacity onPress={() => setShowPassword(!showPassword)}>
            <Text style={{ marginLeft: 10 }}>
              {showPassword ? "🙈" : "👁"}
            </Text>
          </TouchableOpacity>
        </View>

        {/* CONFIRM PASSWORD */}
        <Text>Confirmar Contraseña</Text>
        <View style={{ flexDirection: "row", alignItems: "center" }}>
          <TextInput
            style={[globalStyles.input, { flex: 1 }]}
            secureTextEntry={!showConfirm}
            onChangeText={(v) => handleChange("confirmPassword", v)}
          />
          <TouchableOpacity onPress={() => setShowConfirm(!showConfirm)}>
            <Text style={{ marginLeft: 10 }}>
              {showConfirm ? "🙈" : "👁"}
            </Text>
          </TouchableOpacity>
        </View>

        {/* CIUDAD */}
        <Text>Ciudad</Text>
        <TextInput
          style={globalStyles.input}
          placeholder="Ej: Quito, Guayaquil..."
          onChangeText={(v) => handleChange("ciudad", v)}
        />

        {/* BOTÓN */}
        <TouchableOpacity style={globalStyles.button} onPress={handleRegister}>
          <Text style={globalStyles.buttonText}>Registrar</Text>
        </TouchableOpacity>

        {/* VOLVER */}
        <TouchableOpacity onPress={() => navigation.navigate("Login")}>
          <Text style={{
            marginTop: 15,
            textAlign: "center",
            color: "#3b82f6"
          }}>
            ¿Ya tienes cuenta? Inicia sesión
          </Text>
        </TouchableOpacity>

      </View>
    </ScrollView>
  )
}