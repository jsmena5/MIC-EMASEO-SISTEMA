import { NativeStackScreenProps } from "@react-navigation/native-stack"
import React, { useRef, useState, useCallback, memo } from "react"
import {
  Alert,
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
import type { PreRegisterUser } from "../types/user.types"
import { colors } from "../theme/colors"

type Props = NativeStackScreenProps<RootStackParamList, "Register">

const CARD_ENTERING = FadeInDown.duration(400).springify()

// ─── Validaciones ─────────────────────────────────────────────────────────────

// Apellidos: una sola palabra, letras + guiones (sin espacios — en Ecuador nunca llevan)
const RE_APELLIDO = /^[a-zA-ZáéíóúÁÉÍÓÚñÑüÜ][a-zA-ZáéíóúÁÉÍÓÚñÑüÜ\-]*$/
// Nombres: una o dos palabras (nombre compuesto), sin números ni símbolos
const RE_PALABRA  = /^[a-zA-ZáéíóúÁÉÍÓÚñÑüÜ]+$/
const RE_EMAIL    = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const RE_TELEFONO = /^(?:\+?5939[0-9]{8}|09[0-9]{8})$/
const SEXO_OPCIONES = ["Masculino", "Femenino", "Otro", "Prefiero no decir"] as const

const validarCedula = (cedula: string): boolean => {
  if (!/^\d{10}$/.test(cedula)) return false
  const provincia = parseInt(cedula.substring(0, 2))
  if (provincia < 1 || provincia > 24) return false
  if (parseInt(cedula[2]) >= 6) return false
  const coefs = [2, 1, 2, 1, 2, 1, 2, 1, 2]
  let suma = 0
  for (let i = 0; i < 9; i++) {
    let val = parseInt(cedula[i]) * coefs[i]
    if (val >= 10) val -= 9
    suma += val
  }
  const dig = suma % 10 === 0 ? 0 : 10 - (suma % 10)
  return dig === parseInt(cedula[9])
}

function validarNombreField(v: string, label: string, required = true): string | undefined {
  const trimmed = v.trim()
  if (!trimmed) return required ? `El ${label} es requerido` : undefined
  if (trimmed.length > 30) return `El ${label} no puede superar 30 caracteres`
  const words = trimmed.split(/\s+/)
  if (words.length > 2) return `El ${label} no puede tener más de 2 palabras`
  for (const word of words) {
    if (word.length < 2)          return `Cada palabra del ${label} debe tener al menos 2 letras`
    if (!RE_PALABRA.test(word))   return `El ${label} solo puede contener letras`
  }
}

function validarApellidoField(v: string, label: string, required = true): string | undefined {
  const trimmed = v.trim()
  if (!trimmed) return required ? `El ${label} es requerido` : undefined
  if (trimmed.length < 2)  return `El ${label} debe tener al menos 2 caracteres`
  if (trimmed.length > 30) return `El ${label} no puede superar 30 caracteres`
  if (!RE_APELLIDO.test(trimmed)) return `El ${label} debe ser una sola palabra (sin espacios)`
}

function validarTelefonoField(v: string, label: string): string | undefined {
  const trimmed = v.trim()
  if (!trimmed) return `El ${label} es requerido`
  if (!RE_TELEFONO.test(trimmed)) return `El ${label} debe tener formato 09XXXXXXXX o +5939XXXXXXXX`
}

function validarFechaNacimientoField(v: string, label: string): string | undefined {
  const trimmed = v.trim()
  if (!trimmed) return `El ${label} es requerido`
  const date = new Date(trimmed)
  if (Number.isNaN(date.getTime())) return `El ${label} no es válida`
  const ageYears = (Date.now() - date.getTime()) / (365.25 * 24 * 3600 * 1000)
  if (ageYears < 13 || ageYears > 120) return `El ${label} debe estar entre 13 y 120 años`
}

// ─── Campos del formulario ────────────────────────────────────────────────────

type FormField = "primer_nombre" | "segundo_nombre" | "primer_apellido" | "segundo_apellido" | "fecha_nacimiento" | "sexo" | "telefono" | "cedula" | "email"
type FormType  = Record<FormField, string>
type ErrorType = Partial<Record<FormField, string>>

// ─── AnimatedInput (memoizado) ────────────────────────────────────────────────

interface AnimatedInputProps {
  label:           string
  value:           string
  error?:          string
  onChangeText:    (v: string) => void
  placeholder:     string
  keyboardType?:   TextInput["props"]["keyboardType"]
  autoCapitalize?: TextInput["props"]["autoCapitalize"]
  maxLength?:      number
  returnKeyType?:  TextInput["props"]["returnKeyType"]
  onSubmitEditing?: () => void
  inputRef?:       React.RefObject<TextInput | null>
  autoCorrect?:    boolean
  hint?:           string
  optional?:       boolean
}

const AnimatedInput = memo(function AnimatedInput({
  label, value, error, onChangeText, placeholder, keyboardType = "default",
  autoCapitalize = "words", maxLength, returnKeyType = "next", onSubmitEditing,
  inputRef, autoCorrect = false, hint, optional,
}: AnimatedInputProps) {
  const borderColor = useRef(new Animated.Value(0)).current
  const shakeX      = useSharedValue(0)

  const animatedBorder = borderColor.interpolate({
    inputRange: [0, 1],
    outputRange: [colors.lightGray, colors.primary],
  })
  const shakeStyle = useAnimatedStyle(() => ({ transform: [{ translateX: shakeX.value }] }))

  return (
    <View style={styles.fieldWrapper}>
      <View style={styles.labelRow}>
        <Text style={styles.label}>{label}</Text>
        {optional && <Text style={styles.optionalBadge}>opcional</Text>}
      </View>
      <Reanimated.View style={shakeStyle}>
        <Animated.View
          style={[styles.inputWrapper, { borderColor: error ? "#EF4444" : animatedBorder }]}
        >
          <TextInput
            ref={inputRef}
            style={styles.input}
            placeholder={placeholder}
            placeholderTextColor={colors.gray}
            value={value}
            onChangeText={onChangeText}
            onFocus={() =>
              Animated.timing(borderColor, { toValue: 1, duration: 200, useNativeDriver: false }).start()
            }
            onBlur={() =>
              Animated.timing(borderColor, {
                toValue: error ? 1 : 0, duration: 200, useNativeDriver: false,
              }).start()
            }
            keyboardType={keyboardType}
            autoCapitalize={autoCapitalize}
            autoCorrect={autoCorrect}
            maxLength={maxLength}
            returnKeyType={returnKeyType}
            onSubmitEditing={onSubmitEditing}
            submitBehavior="submit"
          />
        </Animated.View>
      </Reanimated.View>
      {error ? (
        <Text style={styles.errorText}>{error}</Text>
      ) : hint ? (
        <Text style={styles.hintText}>{hint}</Text>
      ) : null}
    </View>
  )
})

interface SexoSelectorProps {
  value: string
  error?: string
  onChange: (value: string) => void
}

function SexoSelector({ value, error, onChange }: SexoSelectorProps) {
  return (
    <View style={styles.fieldWrapper}>
      <View style={styles.labelRow}>
        <Text style={styles.label}>Sexo</Text>
        <Text style={styles.requiredBadge}>requerido</Text>
      </View>
      <View style={styles.optionGrid}>
        {SEXO_OPCIONES.map((option) => {
          const active = value === option
          return (
            <Pressable
              key={option}
              onPress={() => onChange(option)}
              style={({ pressed }) => [
                styles.optionChip,
                active && styles.optionChipActive,
                pressed && styles.optionChipPressed,
              ]}
              accessibilityRole="button"
              accessibilityLabel={`Seleccionar sexo ${option}`}
              accessibilityState={{ selected: active }}
            >
              <Text style={[styles.optionChipText, active && styles.optionChipTextActive]}>
                {option}
              </Text>
            </Pressable>
          )
        })}
      </View>
      {error ? <Text style={styles.errorText}>{error}</Text> : <Text style={styles.hintText}>Selecciona una opción</Text>}
    </View>
  )
}

// ─── Pantalla Principal ───────────────────────────────────────────────────────

export default function RegisterScreen({ navigation }: Props) {
  const [form, setForm] = useState<FormType>({
    primer_nombre: "", segundo_nombre: "",
    primer_apellido: "", segundo_apellido: "",
    fecha_nacimiento: "", sexo: "", telefono: "",
    cedula: "", email: "",
  })
  const [errors,  setErrors]  = useState<ErrorType>({})
  const [loading, setLoading] = useState(false)

  const segundoNombreRef   = useRef<TextInput>(null)
  const primerApellidoRef  = useRef<TextInput>(null)
  const segundoApellidoRef = useRef<TextInput>(null)
  const fechaNacimientoRef = useRef<TextInput>(null)
  const telefonoRef        = useRef<TextInput>(null)
  const cedulaRef          = useRef<TextInput>(null)
  const emailRef           = useRef<TextInput>(null)

  const buttonScale = useSharedValue(1)
  const buttonStyle = useAnimatedStyle(() => ({ transform: [{ scale: buttonScale.value }] }))

  const handleChange = useCallback((key: FormField, value: string) => {
    setForm(prev => ({ ...prev, [key]: value }))
    setErrors(prev => (prev[key] ? { ...prev, [key]: undefined } : prev))
  }, [])

  // Handlers estables (memo funciona)
  const hPrimerNombre    = useCallback((v: string) => handleChange("primer_nombre",    v), [handleChange])
  const hSegundoNombre   = useCallback((v: string) => handleChange("segundo_nombre",   v), [handleChange])
  const hPrimerApellido  = useCallback((v: string) => handleChange("primer_apellido",  v), [handleChange])
  const hSegundoApellido = useCallback((v: string) => handleChange("segundo_apellido", v), [handleChange])
  const hFechaNacimiento = useCallback((v: string) => handleChange("fecha_nacimiento", v), [handleChange])
  const hSexo            = useCallback((v: string) => handleChange("sexo", v), [handleChange])
  const hTelefono        = useCallback((v: string) => handleChange("telefono", v), [handleChange])
  const hCedula          = useCallback((v: string) => handleChange("cedula",           v), [handleChange])
  const hEmail           = useCallback((v: string) => handleChange("email",            v), [handleChange])

  const validate = (): ErrorType | null => {
    const e: ErrorType = {}

    const ep1 = validarNombreField(form.primer_nombre,   "primer nombre")
    const es2 = validarNombreField(form.segundo_nombre, "segundo nombre")
    const ep2 = validarApellidoField(form.primer_apellido,  "primer apellido")
    const ep3 = validarApellidoField(form.segundo_apellido, "segundo apellido")
    const efn = validarFechaNacimientoField(form.fecha_nacimiento, "fecha de nacimiento")
    const esx = form.sexo ? undefined : "El sexo es requerido"
    const etl = validarTelefonoField(form.telefono, "celular")

    if (ep1) e.primer_nombre    = ep1
    if (es2) e.segundo_nombre   = es2
    if (ep2) e.primer_apellido  = ep2
    if (ep3) e.segundo_apellido = ep3
    if (efn) e.fecha_nacimiento = efn
    if (esx) e.sexo = esx
    if (etl) e.telefono = etl

    if (!validarCedula(form.cedula))
      e.cedula = "Cédula inválida (10 dígitos, provincia 01–24)"
    if (!RE_EMAIL.test(form.email))
      e.email  = "Formato de correo inválido"

    return Object.keys(e).length > 0 ? e : null
  }

  const handleContinuar = async () => {
    const validationErrors = validate()
    if (validationErrors) {
      setErrors(validationErrors)
      return
    }
    buttonScale.value = withSequence(withSpring(0.96), withSpring(1))
    try {
      setLoading(true)
      const payload: PreRegisterUser = {
        primer_nombre:    form.primer_nombre.trim(),
        segundo_nombre:   form.segundo_nombre.trim(),
        primer_apellido:  form.primer_apellido.trim(),
        segundo_apellido: form.segundo_apellido.trim(),
        fecha_nacimiento: form.fecha_nacimiento.trim(),
        sexo:             form.sexo as PreRegisterUser["sexo"],
        telefono:         form.telefono.trim(),
        cedula:           form.cedula,
        email:            form.email.trim().toLowerCase(),
      }
      const res = await registerUser(payload)
      const { email, emailSent } = res.data
      if (!emailSent && __DEV__) console.warn("[Register] SMTP no envió el correo")
      navigation.navigate("OtpVerification", { email, registrationData: payload })
    } catch (err: any) {
      const serverMsg = err?.response?.data?.message
      // Email/cédula ya registrado → mostrarlo en el campo email para guiar al usuario
      if (serverMsg?.toLowerCase().includes("registrado") || serverMsg?.toLowerCase().includes("email")) {
        setErrors({ email: serverMsg })
      } else {
        // Cualquier otro error del servidor → Alert para no confundir con validación
        Alert.alert(
          "No se pudo continuar",
          serverMsg || "Verifica tu conexión a internet e intenta de nuevo.",
          [{ text: "Entendido" }]
        )
      }
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
        <Reanimated.View entering={CARD_ENTERING} style={styles.card}>

          <View style={styles.header}>
            <BackButton onPress={() => navigation.goBack()} />
            <Text style={styles.title}>Crear Cuenta</Text>
            <Text style={styles.subtitle}>Ingresa tus datos tal como aparecen en tu cédula</Text>
            <ProgressBar currentStep={1} totalSteps={3} />
          </View>

          {/* ── Nombres ── */}
          <Text style={styles.groupLabel}>Nombres</Text>
          <AnimatedInput
            label="Primer nombre"
            value={form.primer_nombre}
            error={errors.primer_nombre}
            placeholder="Ej: Juan o María José"
            onChangeText={hPrimerNombre}
            returnKeyType="next"
            onSubmitEditing={() => segundoNombreRef.current?.focus()}
            hint="Solo letras, máx. 2 palabras"
          />
          <AnimatedInput
            label="Segundo nombre"
            value={form.segundo_nombre}
            error={errors.segundo_nombre}
            placeholder="Ej: Carlos"
            onChangeText={hSegundoNombre}
            inputRef={segundoNombreRef}
            returnKeyType="next"
            onSubmitEditing={() => primerApellidoRef.current?.focus()}
            optional
          />

          {/* ── Apellidos ── */}
          <Text style={styles.groupLabel}>Apellidos</Text>
          <AnimatedInput
            label="Primer apellido"
            value={form.primer_apellido}
            error={errors.primer_apellido}
            placeholder="Ej: Pérez"
            onChangeText={hPrimerApellido}
            inputRef={primerApellidoRef}
            returnKeyType="next"
            onSubmitEditing={() => segundoApellidoRef.current?.focus()}
            hint="Apellido paterno, una sola palabra"
          />
          <AnimatedInput
            label="Segundo apellido"
            value={form.segundo_apellido}
            error={errors.segundo_apellido}
            placeholder="Ej: Torres"
            onChangeText={hSegundoApellido}
            inputRef={segundoApellidoRef}
            returnKeyType="next"
            onSubmitEditing={() => fechaNacimientoRef.current?.focus()}
            hint="Apellido materno, una sola palabra"
          />

          {/* ── Información personal ── */}
          <Text style={styles.groupLabel}>Información personal</Text>
          <AnimatedInput
            label="Fecha de nacimiento"
            value={form.fecha_nacimiento}
            error={errors.fecha_nacimiento}
            placeholder="AAAA-MM-DD"
            onChangeText={hFechaNacimiento}
            inputRef={fechaNacimientoRef}
            returnKeyType="next"
            onSubmitEditing={() => telefonoRef.current?.focus()}
            keyboardType="numbers-and-punctuation"
            hint="Formato recomendado: 1995-08-24"
          />
          <SexoSelector value={form.sexo} error={errors.sexo} onChange={hSexo} />
          <AnimatedInput
            label="Celular"
            value={form.telefono}
            error={errors.telefono}
            placeholder="09XXXXXXXX"
            keyboardType="phone-pad"
            autoCapitalize="none"
            onChangeText={hTelefono}
            inputRef={telefonoRef}
            returnKeyType="next"
            onSubmitEditing={() => cedulaRef.current?.focus()}
            hint="Usa 09XXXXXXXX o +5939XXXXXXXX"
          />

          {/* ── Identificación ── */}
          <Text style={styles.groupLabel}>Identificación</Text>
          <AnimatedInput
            label="Cédula de identidad"
            value={form.cedula}
            error={errors.cedula}
            placeholder="10 dígitos"
            keyboardType="number-pad"
            maxLength={10}
            autoCapitalize="none"
            onChangeText={hCedula}
            inputRef={cedulaRef}
            returnKeyType="next"
            onSubmitEditing={() => emailRef.current?.focus()}
            hint="Cédula ecuatoriana válida (módulo 10)"
          />
          <AnimatedInput
            label="Correo electrónico"
            value={form.email}
            error={errors.email}
            placeholder="ejemplo@correo.com"
            keyboardType="email-address"
            autoCapitalize="none"
            onChangeText={hEmail}
            inputRef={emailRef}
            returnKeyType="done"
            onSubmitEditing={handleContinuar}
            hint="Recibirás un código de verificación aquí"
          />

          <Reanimated.View style={buttonStyle}>
            <Pressable
              onPress={handleContinuar}
              disabled={loading}
              style={({ pressed }) => [styles.button, (pressed || loading) && styles.buttonPressed]}
              accessibilityRole="button"
              accessibilityLabel="Continuar al siguiente paso"
            >
              {loading
                ? <ActivityIndicator color={colors.white} />
                : <Text style={styles.buttonText}>Continuar →</Text>
              }
            </Pressable>
          </Reanimated.View>

          <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={12}>
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
    marginBottom: 20,
  },
  title: {
    fontSize: 26,
    fontWeight: "700",
    color: colors.primary,
    marginBottom: 4,
    marginTop: 8,
  },
  subtitle: {
    fontSize: 13,
    color: colors.gray,
    marginBottom: 12,
  },
  groupLabel: {
    fontSize: 11,
    fontWeight: "800",
    color: colors.gray,
    letterSpacing: 1.2,
    textTransform: "uppercase",
    marginTop: 12,
    marginBottom: 4,
    marginLeft: 2,
  },
  fieldWrapper: {
    marginBottom: 12,
  },
  labelRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 6,
  },
  label: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.black,
  },
  optionalBadge: {
    fontSize: 11,
    color: colors.gray,
    backgroundColor: colors.background,
    paddingHorizontal: 7,
    paddingVertical: 1,
    borderRadius: 8,
  },
  requiredBadge: {
    fontSize: 11,
    color: colors.primary,
    backgroundColor: "rgba(0, 91, 172, 0.08)",
    paddingHorizontal: 7,
    paddingVertical: 1,
    borderRadius: 8,
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
  hintText: {
    marginTop: 3,
    fontSize: 11,
    color: colors.gray,
    marginLeft: 2,
  },
  optionGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  optionChip: {
    minHeight: 44,
    paddingHorizontal: 14,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.lightGray,
    backgroundColor: colors.background,
    alignItems: "center",
    justifyContent: "center",
  },
  optionChipActive: {
    backgroundColor: "rgba(0, 91, 172, 0.12)",
    borderColor: colors.primary,
  },
  optionChipPressed: {
    opacity: 0.88,
  },
  optionChipText: {
    fontSize: 13,
    color: colors.gray500,
    fontWeight: "600",
  },
  optionChipTextActive: {
    color: colors.primary,
  },
  button: {
    backgroundColor: colors.secondary,
    paddingVertical: 16,
    borderRadius: 14,
    alignItems: "center",
    marginTop: 16,
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
