// src/screens/RegisterScreen.tsx
import { NativeStackScreenProps } from "@react-navigation/native-stack"
import React, { useRef, useState, useCallback, memo } from "react"
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
} from "react-native-reanimated"
import BackButton from "../components/BackButton"
import ProgressBar from "../components/ProgressBar"
import { RootStackParamList } from "../navigation/AppNavigator"
import { registerUser } from "../services/user.service"
import { colors } from "../theme/colors"

type Props = NativeStackScreenProps<RootStackParamList, "Register">

// FIX 1: Objeto de animación estable fuera del componente.
// Si se crea inline (dentro del render), Reanimated recibe una referencia nueva
// en cada re-render y puede re-disparar la animación de entrada → flickering.
const CARD_ENTERING = FadeInDown.duration(400).springify()

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
  // FIX 2: El tipo correcto para useRef<TextInput>(null) en React 18+ es
  // RefObject<TextInput | null>, no RefObject<TextInput>.
  inputRef?: React.RefObject<TextInput | null>
  autoCorrect?: boolean
  accessibilityHint?: string
}

// FIX 3: memo() evita que AnimatedInput se re-renderice cuando el padre
// (RegisterScreen) re-renderiza pero sus props no han cambiado.
// Sin esto, los 4 inputs se re-renderizan en cada pulsación de tecla.
const AnimatedInput = memo(function AnimatedInput({
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
  accessibilityHint,
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
            submitBehavior="submit"
            accessibilityLabel={label}
            accessibilityRole="none"
            accessibilityHint={accessibilityHint}
          />
        </Animated.View>
      </Reanimated.View>
      {error ? <Text style={styles.errorText}>{error}</Text> : null}
    </View>
  )
})

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

  // FIX 4: handleChange ya no depende de `errors`.
  // Antes: [errors] en el array de deps → handleChange se recreaba cada vez que
  // cambiaba errors → todos los AnimatedInput recibían onChangeText nuevo → re-render
  // en cascada de los 4 inputs en cada pulsación cuando había un error activo.
  // Solución: usar el patrón de actualización funcional de setErrors para leer el
  // valor previo sin cerrarse sobre la variable `errors` del render.
  const handleChange = useCallback((key: FormField, value: string) => {
    setForm(prev => ({ ...prev, [key]: value }))
    setErrors(prev => {
      if (!prev[key]) return prev           // sin error → misma referencia, sin re-render
      return { ...prev, [key]: undefined }  // limpia el error del campo al escribir
    })
  }, [])

  // FIX 5: Handlers estables por campo (deps vacías porque handleChange es estable).
  // Sin esto, las arrow functions inline `v => handleChange("nombre", v)` son objetos
  // nuevos en cada render, haciendo inútil el memo() de AnimatedInput.
  const handleNombreChange   = useCallback((v: string) => handleChange("nombre",   v), [handleChange])
  const handleApellidoChange = useCallback((v: string) => handleChange("apellido", v), [handleChange])
  const handleCedulaChange   = useCallback((v: string) => handleChange("cedula",   v), [handleChange])
  const handleEmailChange    = useCallback((v: string) => handleChange("email",    v), [handleChange])

  const validate = (): ErrorType | null => {
    const newErrors: ErrorType = {}
    if (!form.nombre.trim())         newErrors.nombre   = "Ingresa tu nombre"
    if (!form.apellido.trim())       newErrors.apellido = "Ingresa tu apellido"
    if (!validarCedula(form.cedula)) newErrors.cedula   = "Cédula inválida (10 dígitos, provincia 01-24)"
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
        console.warn("[Register] Email no enviado — revisar servidor SMTP")
      }

      navigation.navigate("OtpVerification", { email, registrationData: form })
    } catch (err: any) {
      const msg = err?.response?.data?.message || "No se pudo iniciar el registro"
      setErrors({ email: msg })
    } finally {
      setLoading(false)
    }
  }

  return (
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
        {/* Card con animación de entrada estable (CARD_ENTERING es constante) */}
        <Reanimated.View
          entering={CARD_ENTERING}
          style={styles.card}
        >
          {/* Cabecera */}
          <View style={styles.header}>
            <BackButton onPress={() => navigation.goBack()} />
            <Text style={styles.title}>Crear Cuenta</Text>
            <ProgressBar currentStep={1} totalSteps={3} />
          </View>

          {/* Campos — onChangeText recibe handlers estables para que memo() funcione */}
          <AnimatedInput
            label="Nombre"
            value={form.nombre}
            error={errors.nombre}
            placeholder="Ej: Juan Carlos"
            onChangeText={handleNombreChange}
            returnKeyType="next"
            onSubmitEditing={() => apellidoRef.current?.focus()}
            accessibilityHint="Ingresa tu nombre como aparece en tu cédula"
          />

          <AnimatedInput
            label="Apellido"
            value={form.apellido}
            error={errors.apellido}
            placeholder="Ej: Pérez Torres"
            onChangeText={handleApellidoChange}
            inputRef={apellidoRef}
            returnKeyType="next"
            onSubmitEditing={() => cedulaRef.current?.focus()}
            accessibilityHint="Ingresa tu apellido como aparece en tu cédula"
          />

          <AnimatedInput
            label="Cédula de identidad"
            value={form.cedula}
            error={errors.cedula}
            placeholder="10 dígitos"
            keyboardType="number-pad"
            maxLength={10}
            autoCapitalize="none"
            onChangeText={handleCedulaChange}
            inputRef={cedulaRef}
            returnKeyType="next"
            onSubmitEditing={() => emailRef.current?.focus()}
            accessibilityHint="10 dígitos, debe ser una cédula ecuatoriana válida"
          />

          <AnimatedInput
            label="Correo electrónico"
            value={form.email}
            error={errors.email}
            placeholder="ejemplo@correo.com"
            keyboardType="email-address"
            autoCapitalize="none"
            onChangeText={handleEmailChange}
            inputRef={emailRef}
            returnKeyType="done"
            onSubmitEditing={handleContinuar}
            accessibilityHint="Recibirás un código de verificación en este correo"
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
              accessibilityRole="button"
              accessibilityLabel="Continuar al siguiente paso"
              accessibilityHint="Valida tus datos y avanza al paso 2 de 3"
              accessibilityState={{ disabled: loading, busy: loading }}
            >
              {loading
                ? <ActivityIndicator color={colors.white} />
                : <Text style={styles.buttonText}>Continuar →</Text>
              }
            </Pressable>
          </Reanimated.View>

          <TouchableOpacity
            onPress={() => navigation.goBack()}
            hitSlop={{ top: 12, bottom: 12, left: 0, right: 0 }}
            accessibilityRole="button"
            accessibilityLabel="Iniciar sesión en cuenta existente"
            accessibilityHint="Navega a la pantalla de inicio de sesión"
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
