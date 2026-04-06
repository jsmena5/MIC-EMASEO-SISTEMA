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

type FormType = {
  nombre: string
  apellido: string
  cedula: string
  username: string
  email: string
  password: string
  confirmPassword: string
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
    confirmPassword: ""
  })

  const [showPassword, setShowPassword] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [loading, setLoading] = useState(false)

  const handleChange = (name: keyof FormType, value: string) => {
    setForm({ ...form, [name]: value })
  }

  //  VALIDACIÓN
  const validate = () => {
    if (!form.nombre.trim()) return "Ingrese su nombre"
    if (!form.apellido.trim()) return "Ingrese su apellido"

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
      setLoading(true)

      const { confirmPassword, ...data } = form

      await registerUser(data)
      

      Alert.alert("Éxito", "Registrado correctamente")
      navigation.navigate("Login")


    } catch (err: any) {
      console.error("ERROR COMPLETO:", err)
      console.error("ERROR RESPONSE:", err?.response)
      console.error("ERROR DATA:", err?.response?.data)
      Alert.alert("Error", err?.response?.data?.message || "No se pudo registrar")
    } finally {
      setLoading(false)
    }
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: "#f5f7fb" }}
      contentContainerStyle={{
        flexGrow: 1,
        padding: 20,
        justifyContent: "center"
      }}
      keyboardShouldPersistTaps="always"
    >
      <View style={[globalStyles.card, { borderRadius: 20, elevation: 5 }]}>

        <Text style={[globalStyles.title, { marginBottom: 20 }]}>
          Crear Cuenta
        </Text>

        {/* INPUT REUTILIZABLE */}
        {[
          { label: "Nombre", key: "nombre" },
          { label: "Apellido", key: "apellido" },
          { label: "Cédula", key: "cedula", keyboard: "numeric" },
          { label: "Username", key: "username" },
          { label: "Email", key: "email", keyboard: "email-address" }
        ].map((field: any) => (
          <View key={field.key}>
            <Text>{field.label}</Text>
            <TextInput
              style={[globalStyles.input, { borderRadius: 12 }]}
              keyboardType={field.keyboard || "default"}
              onChangeText={(v) => handleChange(field.key, v)}
            />
          </View>
        ))}

        {/* PASSWORD */}
        <Text>Contraseña</Text>
        <View style={{ flexDirection: "row", alignItems: "center" }}>
          <TextInput
            style={[globalStyles.input, { flex: 1, borderRadius: 12 }]}
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
            style={[globalStyles.input, { flex: 1, borderRadius: 12 }]}
            secureTextEntry={!showConfirm}
            onChangeText={(v) => handleChange("confirmPassword", v)}
          />
          <TouchableOpacity onPress={() => setShowConfirm(!showConfirm)}>
            <Text style={{ marginLeft: 10 }}>
              {showConfirm ? "🙈" : "👁"}
            </Text>
          </TouchableOpacity>
        </View>

        {/* BOTÓN */}
        <Pressable
          onPress={() => {
           console.log("CLICK REGISTRAR") // 👈 DEBUG
           

          handleRegister()
          }}
          style={({ pressed }) => [
          globalStyles.button,
             {
               marginTop: 20,
                borderRadius: 12,
                 opacity: pressed ? 0.7 : 1
             }
          ]}
          >
          {loading ? (
            <ActivityIndicator color="#fff" />
           ) : (
            <Text style={globalStyles.buttonText}>Registrar</Text>
        )}
        </Pressable>

        {/* VOLVER */}
        <TouchableOpacity onPress={() => navigation.navigate("Login")}>
          <Text style={{
            marginTop: 15,
            textAlign: "center",
            color: "#3b82f6",
            fontWeight: "600"
          }}>
            ¿Ya tienes cuenta? Inicia sesión
          </Text>
        </TouchableOpacity>

      </View>
    </ScrollView>
  )
}