// src/screens/OtpVerificationScreen.tsx
import { NativeStackScreenProps } from "@react-navigation/native-stack"
import React, { useRef, useState } from "react"
import {
  ActivityIndicator,
  Alert,
  Pressable,
  Text,
  TextInput,
  TouchableOpacity,
  View
} from "react-native"
import { RootStackParamList } from "../navigation/AppNavigator"
import { verifyOtp } from "../services/user.service"
import { colors } from "../theme/colors"
import { globalStyles } from "../theme/styles"

type Props = NativeStackScreenProps<RootStackParamList, "OtpVerification">

export default function OtpVerificationScreen({ navigation, route }: Props) {
  const { email } = route.params

  const [digits, setDigits] = useState<string[]>(["", "", "", "", "", ""])
  const [loading, setLoading] = useState(false)
  const inputs = useRef<(TextInput | null)[]>([])

  const handleDigitChange = (value: string, index: number) => {
    // Aceptar solo un dígito numérico
    const digit = value.replace(/[^0-9]/g, "").slice(-1)
    const next  = [...digits]
    next[index] = digit
    setDigits(next)

    // Avanzar foco automáticamente al siguiente campo
    if (digit && index < 5) {
      inputs.current[index + 1]?.focus()
    }
  }

  const handleKeyPress = (key: string, index: number) => {
    // Retroceder foco al borrar en campo vacío
    if (key === "Backspace" && !digits[index] && index > 0) {
      inputs.current[index - 1]?.focus()
    }
  }

  const handleVerify = async () => {
    const otp = digits.join("")

    if (otp.length !== 6) {
      return Alert.alert("Error", "Ingresa los 6 dígitos del código")
    }

    try {
      setLoading(true)
      await verifyOtp({ email, otp })

      // Navegar al paso 3: crear contraseña
      navigation.navigate("SetPassword", { email })
    } catch (err: any) {
      Alert.alert("Error", err?.response?.data?.message || "Código incorrecto")
    } finally {
      setLoading(false)
    }
  }

  return (
    <View style={globalStyles.container}>
      <View style={[globalStyles.card, { borderRadius: 20 }]}>

        <Text style={[globalStyles.title, { textAlign: "center", marginBottom: 4 }]}>
          Verificar Email
        </Text>
        <Text style={{ color: colors.gray, marginBottom: 16, textAlign: "center", fontSize: 13 }}>
          Paso 2 de 3 — Confirma tu correo
        </Text>

        <Text style={{ color: colors.gray, marginBottom: 28, textAlign: "center", lineHeight: 20 }}>
          Ingresa el código de 6 dígitos{"\n"}enviado a{" "}
          <Text style={{ fontWeight: "bold", color: colors.black }}>{email}</Text>
        </Text>

        {/* 6 casillas OTP */}
        <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 32 }}>
          {digits.map((digit, i) => (
            <TextInput
              key={i}
              ref={(ref) => { inputs.current[i] = ref }}
              style={{
                width: 44,
                height: 54,
                borderWidth: 2,
                borderColor: digit ? colors.primary : colors.lightGray,
                borderRadius: 10,
                textAlign: "center",
                fontSize: 22,
                fontWeight: "bold",
                color: colors.black,
                backgroundColor: colors.white
              }}
              keyboardType="number-pad"
              maxLength={1}
              value={digit}
              onChangeText={(v) => handleDigitChange(v, i)}
              onKeyPress={({ nativeEvent }) => handleKeyPress(nativeEvent.key, i)}
            />
          ))}
        </View>

        <Pressable
          onPress={handleVerify}
          disabled={loading}
          style={({ pressed }) => [
            globalStyles.button,
            { borderRadius: 12, opacity: pressed || loading ? 0.7 : 1 }
          ]}
        >
          {loading
            ? <ActivityIndicator color={colors.white} />
            : <Text style={globalStyles.buttonText}>Verificar</Text>
          }
        </Pressable>

        <TouchableOpacity
          onPress={() => navigation.navigate("Login")}
          style={{ marginTop: 18 }}
        >
          <Text style={{ textAlign: "center", color: colors.primary, fontWeight: "600" }}>
            Volver al Login
          </Text>
        </TouchableOpacity>

      </View>
    </View>
  )
}
