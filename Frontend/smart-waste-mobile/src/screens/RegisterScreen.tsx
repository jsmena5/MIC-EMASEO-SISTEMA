// src/screens/RegisterScreen.tsx
import { NativeStackScreenProps } from "@react-navigation/native-stack"
import React, { useRef, useState, useCallback } from "react"
import {
  Animated,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  ActivityIndicator,
} from "react-native"
import Reanimated, {
  FadeInDown,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from "react-native-reanimated"
import { RootStackParamList } from "../navigation/AppNavigator"
import { registerUser } from "../services/user.service"
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

type FormField = "nombre" | "apellido" | "cedula" | "email"
type FormType = Record<FormField, string>
type ErrorType = Partial<Record<FormField, string>>

// --- Componente: Barra de Progreso Animada ---
function ProgressBar({ step, total }: { step: number; total: number }) {
  return (
    <View style={styles.progressContainer}>
      {Array.from({ length: total }).map((_, i) => (
        <View
          key={i}
          style={[
            styles.progressSegment,
            { backgroundColor: i < step ? colors.secondary : colors.lightGray },
            i < total - 1 && { marginRight: 6 },
          ]}
        />
      ))}
    </View>
  )
}

// --- Componente: Input con foco animado y error inline ---
interface AnimatedInputProps {
  label: string
  value: string
  error?: string
  onChangeText: (v: string) => void
  placeholder: string
  keyboardType?: TextInput["props"]["keyboardType"]
  autoCapitalize?: TextInput["props"]["autoCapitalize"]
  maxLength?: number
  returnKeyType?: TextInput["props"]["returnKeyType"]
  onSubmitEditing?: () => void
  inputRef?: React.RefObject<TextInput>
  autoCorrect?: boolean
}

function AnimatedInput({
  label,
  value,
  error,
  onChangeText,
  placeholder,
  keyboardType = "default",
  autoCapitalize = "words",
  maxLength,
  returnKeyType = "next",
  onSubmitEditing,
  inputRef,
  autoCorrect = false,
}: AnimatedInputProps) {
  const borderColor = useRef(new Animated.Value(0)).current
  const shakeX = useSharedValue(0)

  const animatedBorder = borderColor.interpolate({
    inputRange: [0, 1],
    outputRange: [colors.lightGray, colors.primary],
  })

  const shakeStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: shakeX.value }],
  }))

  // Exponer shake para el padre via ref si fuera necesario
  // (lo manejamos desde el padre con una ref al TextInput)

  const handleFocus = () => {
    Animated.timing(borderColor, {
      toValue: 1,
      duration: 200,
      useNativeDriver: false,
    }).start()
  }

  const handleBlur = () => {
    Animated.timing(borderColor, {
      toValue: error ? 1 : 0,
      duration: 200,
      useNativeDriver: false,
    }).start()
  }

  return (
    <View style={styles.fieldWrapper}>
      <Text style={styles.label}>{label}</Text>
      <Reanimated.View style={shakeStyle}>
        <Animated.View
          style={[
            styles.inputWrapper,
            { borderColor: error ? "#EF4444" : animatedBorder },
          ]}
        >
          <TextInput
            ref={inputRef}
            style={styles.input}
            placeholder={placeholder}
            placeholderTextColor={colors.gray}
            value={value}
            onChangeText={onChangeText}
            onFocus={handleFocus}
            onBlur={handleBlur}
            keyboardType={keyboardType}
            autoCapitalize={autoCapitalize}
            autoCorrect={autoCorrect}
            maxLength={maxLength}
            returnKeyType={returnKeyType}
            onSubmitEditing={onSubmitEditing}
            blurOnSubmit={false}
          />
        </Animated.View>
      </Reanimated.View>
      {error ? <Text style={styles.errorText}>{error}</Text> : null}
    </View>
  )
}

// --- Pantalla Principal ---
export default function RegisterScreen({ navigation }: Props) {
  const [form, setForm] = useState<FormType>({
    nombre: "", apellido: "", cedula: "", email: "",
  })
  const [errors, setErrors] = useState<ErrorType>({})
  const [loading, setLoading] = useState(false)

  // Refs para navegar entre inputs con el teclado
  const apellidoRef = useRef<TextInput>(null)
  const cedulaRef   = useRef<TextInput>(null)
  const emailRef    = useRef<TextInput>(null)

  // Animación del botón
  const buttonScale = useSharedValue(1)
  const buttonStyle = useAnimatedStyle(() => ({
    transform: [{ scale: buttonScale.value }],
  }))

  const handleChange = useCallback((key: FormField, value: string) => {
    setForm(prev => ({ ...prev, [key]: value }))
    // Limpiar error del campo al escribir
    if (errors[key]) setErrors(prev => ({ ...prev, [key]: undefined }))
  }, [errors])

  const validate = (): ErrorType | null => {
    const newErrors: ErrorType = {}
    if (!form.nombre.trim())       newErrors.nombre   = "Ingresa tu nombre"
    if (!form.apellido.trim())     newErrors.apellido = "Ingresa tu apellido"
    if (!validarCedula(form.cedula)) newErrors.cedula = "Cédula inválida (10 dígitos, provincia 01-24)"
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) newErrors.email = "Formato de email inválido"
    return Object.keys(newErrors).length > 0 ? newErrors : null
  }

  const handleContinuar = async () => {
    const validationErrors = validate()
    if (validationErrors) {
      setErrors(validationErrors)
      return
    }

    buttonScale.value = withSequence(
      withSpring(0.96),
      withSpring(1)
    )

    try {
      setLoading(true)
      const res = await registerUser(form)
      const { email, emailSent } = res.data

      if (!emailSent) {
        // Sin Alert — el OTP igual llega: se maneja en la siguiente pantalla
        console.warn("[Register] Email no enviado — revisar servidor SMTP")
      }

      navigation.navigate("OtpVerification", { email, registrationData: form })
    } catch (err: any) {
      const msg = err?.response?.data?.message || "No se pudo iniciar el registro"
      setErrors({ email: msg }) // Muestra el error server en el último campo relevante
    } finally {
      setLoading(false)
    }
  }

  return (
    /*
     * SOLUCIÓN AL TECLADO:
     * KeyboardAvoidingView + behavior="padding" en iOS desplaza el contenido
     * hacia arriba cuando aparece el teclado. En Android, el manifest
     * windowSoftInputMode="adjustResize" (por defecto en Expo) ya lo maneja,
     * por eso usamos behavior="height" solo en Android como fallback seguro.
     * El keyboardVerticalOffset compensa la altura del header nativo.
     */
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      keyboardVerticalOffset={Platform.OS === "ios" ? 0 : 20}
    >
      <ScrollView
        style={{ flex: 1, backgroundColor: colors.background }}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Card animada: entra deslizando desde abajo al montar */}
        <Reanimated.View
          entering={FadeInDown.duration(400).springify()}
          style={styles.card}
        >
          {/* Cabecera */}
          <View style={styles.header}>
            <Text style={styles.title}>Crear Cuenta</Text>
            <Text style={styles.subtitle}>Paso 1 de 3 — Datos personales</Text>
            <ProgressBar step={1} total={3} />
          </View>

          {/* Campos */}
          <AnimatedInput
            label="Nombre"
            value={form.nombre}
            error={errors.nombre}
            placeholder="Ej: Juan Carlos"
            onChangeText={v => handleChange("nombre", v)}
            returnKeyType="next"
            onSubmitEditing={() => apellidoRef.current?.focus()}
          />

          <AnimatedInput
            label="Apellido"
            value={form.apellido}
            error={errors.apellido}
            placeholder="Ej: Pérez Torres"
            onChangeText={v => handleChange("apellido", v)}
            inputRef={apellidoRef}
            returnKeyType="next"
            onSubmitEditing={() => cedulaRef.current?.focus()}
          />

          <AnimatedInput
            label="Cédula de identidad"
            value={form.cedula}
            error={errors.cedula}
            placeholder="10 dígitos"
            keyboardType="number-pad"
            maxLength={10}
            autoCapitalize="none"
            onChangeText={v => handleChange("cedula", v)}
            inputRef={cedulaRef}
            returnKeyType="next"
            onSubmitEditing={() => emailRef.current?.focus()}
          />

          <AnimatedInput
            label="Correo electrónico"
            value={form.email}
            error={errors.email}
            placeholder="ejemplo@correo.com"
            keyboardType="email-address"
            autoCapitalize="none"
            onChangeText={v => handleChange("email", v)}
            inputRef={emailRef}
            returnKeyType="done"
            onSubmitEditing={handleContinuar}
          />

          {/* Botón con micro-interacción de escala */}
          <Reanimated.View style={buttonStyle}>
            <Pressable
              onPress={handleContinuar}
              disabled={loading}
              style={({ pressed }) => [
                styles.button,
                (pressed || loading) && styles.buttonPressed,
              ]}
            >
              {loading
                ? <ActivityIndicator color={colors.white} />
                : <Text style={styles.buttonText}>Continuar →</Text>
              }
            </Pressable>
          </Reanimated.View>

          <TouchableOpacity
            onPress={() => navigation.navigate("Login")}
            hitSlop={{ top: 12, bottom: 12, left: 0, right: 0 }}
          >
            <Text style={styles.loginLink}>
              ¿Ya tienes cuenta? <Text style={{ fontWeight: "700" }}>Inicia sesión</Text>
            </Text>
          </TouchableOpacity>
        </Reanimated.View>
      </ScrollView>
    </KeyboardAvoidingView>
  )
}

const styles = StyleSheet.create({
  scrollContent: {
    flexGrow: 1,
    padding: 20,
    justifyContent: "center",
  },
  card: {
    backgroundColor: colors.white,
    borderRadius: 20,
    padding: 24,
    // Sombra correcta para iOS (elevation solo funciona en Android)
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 5,
  },
  header: {
    marginBottom: 24,
  },
  title: {
    fontSize: 26,
    fontWeight: "700",
    color: colors.primary,
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 13,
    color: colors.gray,
    marginBottom: 12,
  },
  progressContainer: {
    flexDirection: "row",
    height: 4,
  },
  progressSegment: {
    flex: 1,
    height: 4,
    borderRadius: 2,
  },
  fieldWrapper: {
    marginBottom: 16,
  },
  label: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.black,
    marginBottom: 6,
  },
  inputWrapper: {
    borderWidth: 1.5,
    borderRadius: 12,
    backgroundColor: colors.background,
    overflow: "hidden",
  },
  input: {
    height: 50,
    paddingHorizontal: 14,
    fontSize: 15,
    color: colors.black,
  },
  errorText: {
    marginTop: 4,
    fontSize: 12,
    color: "#EF4444",
    marginLeft: 2,
  },
  button: {
    backgroundColor: colors.secondary,
    paddingVertical: 16,
    borderRadius: 14,
    alignItems: "center",
    marginTop: 8,
    shadowColor: colors.secondary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  buttonPressed: {
    opacity: 0.85,
  },
  buttonText: {
    color: colors.white,
    fontWeight: "700",
    fontSize: 16,
    letterSpacing: 0.3,
  },
  loginLink: {
    marginTop: 20,
    textAlign: "center",
    color: colors.primary,
    fontSize: 14,
  },
})
