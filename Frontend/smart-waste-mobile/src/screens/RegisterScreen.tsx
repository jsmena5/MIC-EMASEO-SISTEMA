import { NativeStackScreenProps } from "@react-navigation/native-stack"
import React, { useRef, useState, useCallback, useEffect, memo } from "react"
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
import { Picker } from "@react-native-picker/picker"
import Reanimated, {
  FadeInDown,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withSpring,
} from "react-native-reanimated"
import BackButton from "../components/BackButton"
import ProgressBar from "../components/ProgressBar"
import PrivacyConsentModal from "../components/PrivacyConsentModal"
import { RootStackParamList } from "../navigation/AppNavigator"
import { registerUser } from "../services/user.service"
import type { PreRegisterUser } from "../types/user.types"
import { colors } from "../theme/colors"

type Props = NativeStackScreenProps<RootStackParamList, "Register">

const CARD_ENTERING = FadeInDown.duration(400).springify()

// ─── Validaciones ─────────────────────────────────────────────────────────────

// Cada palabra de nombre/apellido: solo letras (con tildes y ñ)
const RE_PALABRA  = /^[a-zA-ZáéíóúÁÉÍÓÚñÑüÜ]+$/
const RE_EMAIL    = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const RE_TELEFONO = /^(?:\+?5939[0-9]{8}|09[0-9]{8})$/
const SEXO_OPCIONES = ["Masculino", "Femenino", "Otro", "Prefiero no decir"] as const

// ─── Helpers y constantes para el picker de fecha ────────────────────────────
const MONTH_LABELS = [
  "Enero","Febrero","Marzo","Abril","Mayo","Junio",
  "Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre",
]
const CURRENT_YEAR = new Date().getFullYear()
// Años disponibles: de 13 a 100 años atrás (rango válido de edad)
const BIRTH_YEARS  = Array.from({ length: 88 }, (_, i) => CURRENT_YEAR - 13 - i)

function daysInMonth(month: number, year: number): number {
  return new Date(year, month, 0).getDate()
}

function isoFromParts(day: number, month: number, year: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`
}

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

// Valida un campo de "nombres" o "apellidos" que admite 1 o 2 palabras.
// Ej: "Juan Carlos" / "Pérez Torres" / "María". Cada palabra ≥2 letras, solo letras.
function validarDosPalabras(v: string, label: string): string | undefined {
  const trimmed = v.trim()
  if (!trimmed) return `${label} es requerido`
  if (trimmed.length > 60) return `${label} no puede superar 60 caracteres`
  const words = trimmed.split(/\s+/)
  if (words.length > 2) return `${label}: máximo dos palabras`
  for (const word of words) {
    if (word.length < 2)        return `Cada palabra de ${label} debe tener al menos 2 letras`
    if (!RE_PALABRA.test(word)) return `${label} solo puede contener letras`
  }
}

function validarTelefonoField(v: string, label: string): string | undefined {
  const trimmed = v.trim()
  if (!trimmed) return `El ${label} es requerido`
  if (!RE_TELEFONO.test(trimmed)) return `El ${label} debe tener formato 09XXXXXXXX o +5939XXXXXXXX`
}

function validarFechaNacimientoField(v: string, label: string): string | undefined {
  const trimmed = v.trim()
  if (!trimmed) return `La ${label} es requerida`
  const date = new Date(trimmed)
  if (Number.isNaN(date.getTime())) return `La ${label} no es válida`
  const ageYears = (Date.now() - date.getTime()) / (365.25 * 24 * 3600 * 1000)
  if (ageYears < 13 || ageYears > 120) return `La ${label} debe estar entre 13 y 120 años`
}

// ─── Campos del formulario ────────────────────────────────────────────────────

type FormField = "nombres" | "apellidos" | "sexo" | "telefono" | "cedula" | "email"
type FormType  = Record<FormField, string>
type ErrorType = Partial<Record<FormField | "fecha_nacimiento", string>>

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
}

const AnimatedInput = memo(function AnimatedInput({
  label, value, error, onChangeText, placeholder, keyboardType = "default",
  autoCapitalize = "words", maxLength, returnKeyType = "next", onSubmitEditing,
  inputRef, autoCorrect = false,
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
      <Text style={styles.label}>{label}</Text>
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
      {error ? <Text style={styles.errorText}>{error}</Text> : null}
    </View>
  )
})

// ─── FechaNacimientoPicker ────────────────────────────────────────────────────

interface FechaPickerProps {
  day:       number | null
  month:     number | null
  year:      number | null
  error?:    string
  onChange:  (day: number, month: number, year: number) => void
}

function FechaNacimientoPicker({ day, month, year, error, onChange }: FechaPickerProps) {
  const safeYear  = year  ?? BIRTH_YEARS[30]
  const safeMonth = month ?? 1
  const maxDay    = daysInMonth(safeMonth, safeYear)
  const safeDay   = day   ? Math.min(day, maxDay) : 1

  const days = Array.from({ length: maxDay }, (_, i) => i + 1)

  return (
    <View style={styles.fieldWrapper}>
      <Text style={styles.label}>Fecha de nacimiento</Text>
      <View style={[styles.dateGrid, error ? styles.dateGridError : undefined]}>
        {/* Día — flex 1.2 para que "01"–"31" quepan en el dropdown de Android */}
        <View style={[styles.dateCol, { flex: 1.2 }]}>
          <Text style={styles.dateColLabel}>Día</Text>
          <Picker
            selectedValue={safeDay}
            onValueChange={(v) => onChange(Number(v), safeMonth, safeYear)}
            style={styles.picker}
            mode="dropdown"
          >
            {days.map(d => (
              <Picker.Item key={d} label={String(d).padStart(2, "0")} value={d} />
            ))}
          </Picker>
        </View>
        {/* Mes */}
        <View style={[styles.dateCol, { flex: 2 }]}>
          <Text style={styles.dateColLabel}>Mes</Text>
          <Picker
            selectedValue={safeMonth}
            onValueChange={(v) => onChange(safeDay, Number(v), safeYear)}
            style={styles.picker}
            mode="dropdown"
          >
            {MONTH_LABELS.map((m, i) => (
              <Picker.Item key={i} label={m} value={i + 1} />
            ))}
          </Picker>
        </View>
        {/* Año */}
        <View style={[styles.dateCol, { flex: 1.5 }]}>
          <Text style={styles.dateColLabel}>Año</Text>
          <Picker
            selectedValue={safeYear}
            onValueChange={(v) => onChange(safeDay, safeMonth, Number(v))}
            style={styles.picker}
            mode="dropdown"
          >
            {BIRTH_YEARS.map(y => (
              <Picker.Item key={y} label={String(y)} value={y} />
            ))}
          </Picker>
        </View>
      </View>
      {error ? <Text style={styles.errorText}>{error}</Text> : null}
    </View>
  )
}

// ─── SexoSelector ─────────────────────────────────────────────────────────────

interface SexoSelectorProps {
  value: string
  error?: string
  onChange: (value: string) => void
}

function SexoSelector({ value, error, onChange }: SexoSelectorProps) {
  return (
    <View style={styles.fieldWrapper}>
      <Text style={styles.label}>Sexo</Text>
      <View style={[styles.inputWrapper, error ? { borderColor: "#EF4444" } : undefined]}>
        <Picker
          selectedValue={value || null}
          onValueChange={(v) => { if (v) onChange(v as string) }}
          style={styles.sexoPicker}
          mode="dropdown"
        >
          <Picker.Item label="Selecciona una opción" value={null} color={colors.gray} />
          {SEXO_OPCIONES.map(opt => (
            <Picker.Item key={opt} label={opt} value={opt} />
          ))}
        </Picker>
      </View>
      {error ? <Text style={styles.errorText}>{error}</Text> : null}
    </View>
  )
}

// ─── Pantalla Principal ───────────────────────────────────────────────────────

export default function RegisterScreen({ navigation }: Props) {
  const [form, setForm] = useState<FormType>({
    nombres: "", apellidos: "",
    sexo: "", telefono: "",
    cedula: "", email: "",
  })
  // Partes del picker de fecha (null = no elegido todavía)
  const [fechaDay,   setFechaDay]   = useState<number | null>(null)
  const [fechaMonth, setFechaMonth] = useState<number | null>(null)
  const [fechaYear,  setFechaYear]  = useState<number | null>(null)

  const [errors,  setErrors]  = useState<ErrorType>({})
  const [loading, setLoading] = useState(false)
  const [showPrivacy, setShowPrivacy] = useState(true)

  // Evita setState tras desmontar (si el usuario cancela durante una petición en vuelo)
  const mountedRef = useRef(true)
  useEffect(() => () => { mountedRef.current = false }, [])

  const apellidosRef = useRef<TextInput>(null)
  const telefonoRef  = useRef<TextInput>(null)
  const cedulaRef    = useRef<TextInput>(null)
  const emailRef     = useRef<TextInput>(null)

  const buttonScale = useSharedValue(1)
  const buttonStyle = useAnimatedStyle(() => ({ transform: [{ scale: buttonScale.value }] }))

  const handleChange = useCallback((key: FormField, value: string) => {
    setForm(prev => ({ ...prev, [key]: value }))
    setErrors(prev => (prev[key] ? { ...prev, [key]: undefined } : prev))
  }, [])

  const handleFechaChange = useCallback((d: number, m: number, y: number) => {
    setFechaDay(d); setFechaMonth(m); setFechaYear(y)
    setErrors(prev => prev.fecha_nacimiento ? { ...prev, fecha_nacimiento: undefined } : prev)
  }, [])

  // Handlers estables (memo funciona)
  const hNombres   = useCallback((v: string) => handleChange("nombres",   v), [handleChange])
  const hApellidos = useCallback((v: string) => handleChange("apellidos", v), [handleChange])
  const hSexo      = useCallback((v: string) => handleChange("sexo",      v), [handleChange])
  const hTelefono  = useCallback((v: string) => handleChange("telefono",  v), [handleChange])
  const hCedula    = useCallback((v: string) => handleChange("cedula",    v), [handleChange])
  const hEmail     = useCallback((v: string) => handleChange("email",     v), [handleChange])

  const validate = (): ErrorType | null => {
    const e: ErrorType = {}

    const en = validarDosPalabras(form.nombres,   "Los nombres")
    const ea = validarDosPalabras(form.apellidos, "Los apellidos")
    // Validar fecha desde partes del picker
    const fechaIso = (fechaDay && fechaMonth && fechaYear)
      ? isoFromParts(fechaDay, fechaMonth, fechaYear)
      : ""
    const efn = validarFechaNacimientoField(fechaIso, "fecha de nacimiento")
    const esx = form.sexo ? undefined : "El sexo es requerido"
    const etl = validarTelefonoField(form.telefono, "celular")

    if (en) e.nombres   = en
    if (ea) e.apellidos = ea
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
      // Separar "Juan Carlos" → primer/segundo nombre; "Pérez Torres" → primer/segundo apellido
      const [primerNombre, segundoNombre = ""]     = form.nombres.trim().split(/\s+/)
      const [primerApellido, segundoApellido = ""] = form.apellidos.trim().split(/\s+/)
      const payload: PreRegisterUser = {
        primer_nombre:    primerNombre,
        segundo_nombre:   segundoNombre,
        primer_apellido:  primerApellido,
        segundo_apellido: segundoApellido,
        fecha_nacimiento: isoFromParts(fechaDay!, fechaMonth!, fechaYear!),
        sexo:             form.sexo as PreRegisterUser["sexo"],
        telefono:         form.telefono.trim(),
        cedula:           form.cedula,
        email:            form.email.trim().toLowerCase(),
      }
      const res = await registerUser(payload)
      if (!mountedRef.current) return
      const { email, emailSent } = res.data
      if (!emailSent && __DEV__) console.warn("[Register] SMTP no envió el correo")
      navigation.navigate("OtpVerification", { email, registrationData: payload })
    } catch (err: any) {
      if (!mountedRef.current) return
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
      if (mountedRef.current) setLoading(false)
    }
  }

  return (
    <>
    <PrivacyConsentModal
      visible={showPrivacy}
      onAccept={() => setShowPrivacy(false)}
      onDecline={() => navigation.goBack()}
    />
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

          {/* ── Nombres y apellidos ── */}
          <Text style={styles.groupLabel}>Datos personales</Text>
          <AnimatedInput
            label="Nombres"
            value={form.nombres}
            error={errors.nombres}
            placeholder="Ej: Juan Carlos"
            onChangeText={hNombres}
            returnKeyType="next"
            onSubmitEditing={() => apellidosRef.current?.focus()}
          />
          <AnimatedInput
            label="Apellidos"
            value={form.apellidos}
            error={errors.apellidos}
            placeholder="Ej: Pérez Torres"
            onChangeText={hApellidos}
            inputRef={apellidosRef}
            returnKeyType="next"
            onSubmitEditing={() => telefonoRef.current?.focus()}
          />

          {/* ── Información personal ── */}
          <Text style={styles.groupLabel}>Información personal</Text>
          <FechaNacimientoPicker
            day={fechaDay}
            month={fechaMonth}
            year={fechaYear}
            error={errors.fecha_nacimiento}
            onChange={handleFechaChange}
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
    </>
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
    marginBottom: 14,
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
  sexoPicker: {
    height: 50,
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
  // ── Picker de fecha de nacimiento ──
  // Sin overflow:hidden (recortaría el dropdown de Android) ni altura fija en el picker.
  dateGrid: {
    flexDirection: "row",
    borderWidth: 1.5,
    borderColor: colors.lightGray,
    borderRadius: 12,
    backgroundColor: colors.background,
  },
  dateGridError: {
    borderColor: "#EF4444",
  },
  dateCol: {
    flex: 1,
    paddingTop: 6,
  },
  dateColLabel: {
    fontSize: 10,
    fontWeight: "700",
    color: colors.gray,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    textAlign: "center",
  },
  picker: {
    width: "100%",
    color: colors.black,
    ...Platform.select({ ios: { height: 160 }, android: {} }),
  },
})
