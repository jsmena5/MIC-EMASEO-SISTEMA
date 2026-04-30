// src/screens/OtpVerificationScreen.tsx
import { NativeStackScreenProps } from "@react-navigation/native-stack"
import React, { useEffect, useRef, useState } from "react"
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
import { registerUser, verifyOtp } from "../services/user.service"
import { colors } from "../theme/colors"
import { globalStyles } from "../theme/styles"

type Props = NativeStackScreenProps<RootStackParamList, "OtpVerification">

const RESEND_COOLDOWN = 60 // segundos

export default function OtpVerificationScreen({ navigation, route }: Props) {
  const { email, registrationData } = route.params

  const [digits, setDigits]       = useState<string[]>(["", "", "", "", "", ""])
  const [loading, setLoading]     = useState(false)
  const [resending, setResending] = useState(false)
  const [countdown, setCountdown] = useState(RESEND_COOLDOWN)
  const inputs = useRef<(TextInput | null)[]>([])

  // Temporizador de reenvío
  useEffect(() => {
    if (countdown <= 0) return
    const timer = setTimeout(() => setCountdown((c) => c - 1), 1000)
    return () => clearTimeout(timer)
  }, [countdown])

  const handleDigitChange = (value: string, index: number) => {
    const digit = value.replace(/[^0-9]/g, "").slice(-1)
    const next  = [...digits]
    next[index] = digit
    setDigits(next)
    if (digit && index < 5) {
      inputs.current[index + 1]?.focus()
    }
  }

  const handleKeyPress = (key: string, index: number) => {
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
      navigation.navigate("SetPassword", { email })
    } catch (err: any) {
      Alert.alert("Error", err?.response?.data?.message || "Código incorrecto")
    } finally {
      setLoading(false)
    }
  }

  const handleResend = async () => {
    try {
      setResending(true)
      await registerUser(registrationData)
      setDigits(["", "", "", "", "", ""])
      setCountdown(RESEND_COOLDOWN)
      inputs.current[0]?.focus()
      Alert.alert("Código enviado", `Revisa tu correo: ${email}`)
    } catch (err: any) {
      Alert.alert("Error", err?.response?.data?.message || "No se pudo reenviar el código")
    } finally {
      setResending(false)
    }
  }

  return (
    <View style={globalStyles.container}>
      <View style={[globalStyles.card, { borderRadius: 20 }]}>

        <BackButton onPress={() => navigation.goBack()} />

        <Text style={[globalStyles.title, { textAlign: "center", marginBottom: 12 }]}>
          Verificar Email
        </Text>
        <ProgressBar currentStep={2} totalSteps={3} />

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
              accessibilityLabel={`Dígito ${i + 1} de 6 del código de verificación`}
              accessibilityRole="none"
              accessibilityHint="Ingresa un dígito numérico del 0 al 9"
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
          accessibilityRole="button"
          accessibilityLabel="Verificar código"
          accessibilityHint="Confirma el código de 6 dígitos ingresado"
          accessibilityState={{ disabled: loading, busy: loading }}
        >
          {loading
            ? <ActivityIndicator color={colors.white} />
            : <Text style={globalStyles.buttonText}>Verificar</Text>
          }
        </Pressable>

        {/* Reenviar código */}
        <View style={{ marginTop: 20, alignItems: "center" }}>
          {countdown > 0 ? (
            <Text style={{ color: colors.gray, fontSize: 13 }}>
              ¿No llegó el código? Reenviar en{" "}
              <Text style={{ fontWeight: "bold", color: colors.black }}>{countdown}s</Text>
            </Text>
          ) : (
            <TouchableOpacity
              onPress={handleResend}
              disabled={resending}
              accessibilityRole="button"
              accessibilityLabel="Reenviar código de verificación"
              accessibilityHint="Envía un nuevo código a tu correo electrónico"
              accessibilityState={{ disabled: resending, busy: resending }}
            >
              {resending
                ? <ActivityIndicator color={colors.primary} />
                : (
                  <Text style={{ color: colors.primary, fontWeight: "600", fontSize: 14 }}>
                    Reenviar código
                  </Text>
                )
              }
            </TouchableOpacity>
          )}
        </View>

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
