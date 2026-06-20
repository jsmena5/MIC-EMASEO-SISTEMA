// src/screens/LoginScreen.tsx
import { Ionicons } from "@expo/vector-icons"
import { NativeStackScreenProps } from "@react-navigation/native-stack"
import React, { useEffect, useRef, useState } from "react"
import {
  Animated,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native"
import BrandLogo from "../components/BrandLogo"
import ButtonPrimary from "../components/ButtonPrimary"
import { useAuth } from "../contexts/AuthContext"
import { useConnectivity } from "../hooks/useConnectivity"
import { RootStackParamList } from "../navigation/AppNavigator"
import { loginUser } from "../services/auth.service"
import { colors } from "../theme/colors"

type Props = Readonly<NativeStackScreenProps<RootStackParamList, "Login">>

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// ─── types ───────────────────────────────────────────────────────────────────
interface FieldError {
  email: string
  password: string
}

// ─── component ───────────────────────────────────────────────────────────────
export default function LoginScreen({ navigation }: Props) {
  const { login } = useAuth()
  const { isConnected } = useConnectivity()

  // form state
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [secureText, setSecureText] = useState(true)
  const [loading, setLoading] = useState(false)
  const [serverError, setServerError] = useState("")
  const [errors, setErrors] = useState<FieldError>({ email: "", password: "" })
  const [touched, setTouched] = useState({ email: false, password: false })

  // focus state for border highlight
  const [focusedField, setFocusedField] = useState<"email" | "password" | null>(null)

  // fade-in animation
  const fadeAnim = useRef(new Animated.Value(0)).current
  const slideAnim = useRef(new Animated.Value(24)).current

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 500,
        useNativeDriver: true,
      }),
      Animated.timing(slideAnim, {
        toValue: 0,
        duration: 500,
        useNativeDriver: true,
      }),
    ]).start()
  }, [fadeAnim, slideAnim])

  // ─── validation ─────────────────────────────────────────────────────────
  const validate = (field: "email" | "password", value: string): string => {
    if (field === "email") {
      if (!value.trim()) return "El correo es obligatorio."
      if (!EMAIL_REGEX.test(value)) return "Ingresa un correo válido."
      return ""
    }
    if (field === "password") {
      if (!value) return "La contraseña es obligatoria."
      return ""
    }
    return ""
  }

  const handleEmailChange = (value: string) => {
    setEmail(value)
    setServerError("")
    if (touched.email) setErrors((e) => ({ ...e, email: validate("email", value) }))
  }

  const handlePasswordChange = (value: string) => {
    setPassword(value)
    setServerError("")
    if (touched.password) setErrors((e) => ({ ...e, password: validate("password", value) }))
  }

  const handleBlur = (field: "email" | "password") => {
    setFocusedField(null)
    setTouched((t) => ({ ...t, [field]: true }))
    const value = field === "email" ? email : password
    setErrors((e) => ({ ...e, [field]: validate(field, value) }))
  }

  // ─── submit ─────────────────────────────────────────────────────────────
  const handleLogin = async () => {
    // mark all fields as touched and validate
    const emailErr = validate("email", email)
    const passwordErr = validate("password", password)
    setTouched({ email: true, password: true })
    setErrors({ email: emailErr, password: passwordErr })

    if (emailErr || passwordErr) return

    setServerError("")
    setLoading(true)
    try {
      const res = await loginUser({ email, password })
      await login(res.data.token)
    } catch (err: any) {
      const status = err?.response?.status
      if (err?.code === "ROL_NO_PERMITIDO") {
        // Credenciales válidas pero el rol no es ciudadano → la app es solo para ciudadanos
        setServerError(err.message)
      } else if (!err?.response) {
        setServerError("Sin conexión. Verifica tu internet e inténtalo de nuevo.")
      } else if (status === 429) {
        setServerError("Demasiados intentos fallidos. Espera unos minutos e inténtalo de nuevo.")
      } else if (status === 401 || status === 403) {
        setServerError("El correo o la contraseña no son válidos.")
      } else {
        setServerError("Ocurrió un error inesperado. Por favor inténtalo de nuevo.")
      }
    } finally {
      setLoading(false)
    }
  }

  // ─── helpers ────────────────────────────────────────────────────────────
  const inputBorderColor = (field: "email" | "password") => {
    if (errors[field] && touched[field]) return colors.error
    if (focusedField === field) return colors.primary
    return colors.gray200
  }

  // ─── render ─────────────────────────────────────────────────────────────
  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* ── animated card ─────────────────────────────────────────────── */}
        <Animated.View
          style={[
            styles.card,
            { opacity: fadeAnim, transform: [{ translateY: slideAnim }] },
          ]}
        >
          {/* ── logo / brand ──────────────────────────────────────────── */}
          <View style={styles.brandRow}>
            <View style={styles.logoWrap}>
              <BrandLogo size={48} background={colors.primary} showIA={false} />
            </View>
            <View style={styles.brandText}>
              <Text style={styles.brandName}>EMASEO EP IA</Text>
              <Text style={styles.brandSub}>Sistema Inteligente de Residuos</Text>
            </View>
          </View>

          <Text style={styles.title}>Bienvenido</Text>
          <Text style={styles.subtitle}>Inicia sesion para continuar</Text>

          {/* ── banner sin conexion (proactivo) ───────────────────────── */}
          {isConnected ? null : (
            <View style={styles.offlineBanner}>
              <Ionicons name="cloud-offline-outline" size={16} color={colors.warning} />
              <Text style={styles.offlineBannerText}>
                Sin conexion a internet. Conectate para iniciar sesion.
              </Text>
            </View>
          )}

          {/* ── server-level error banner ─────────────────────────────── */}
          {serverError ? (
            <View style={styles.errorBanner}>
              <Ionicons name="alert-circle-outline" size={16} color={colors.error} />
              <Text style={styles.errorBannerText}>{serverError}</Text>
            </View>
          ) : null}

          {/* ── email ────────────────────────────────────────────────── */}
          <Text style={styles.label}>Correo electrónico</Text>
          <View
            style={[
              styles.inputWrapper,
              { borderColor: inputBorderColor("email") },
            ]}
          >
            <Ionicons
              name="mail-outline"
              size={20}
              color={focusedField === "email" ? colors.primary : colors.gray400}
              style={styles.inputIcon}
            />
            <TextInput
              style={styles.input}
              placeholder="ejemplo@correo.com"
              placeholderTextColor={colors.gray400}
              value={email}
              onChangeText={handleEmailChange}
              onFocus={() => setFocusedField("email")}
              onBlur={() => handleBlur("email")}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              editable={!loading}
              returnKeyType="next"
              accessibilityLabel="Campo de correo electrónico"
              accessibilityHint="Ingresa tu dirección de correo registrada en EMASEO"
            />
          </View>
          {touched.email && errors.email ? (
            <View style={styles.fieldErrorRow}>
              <Ionicons name="warning-outline" size={13} color={colors.error} />
              <Text style={styles.fieldError}>{errors.email}</Text>
            </View>
          ) : null}

          {/* ── password ─────────────────────────────────────────────── */}
          <Text style={[styles.label, { marginTop: 14 }]}>Contraseña</Text>
          <View
            style={[
              styles.inputWrapper,
              { borderColor: inputBorderColor("password") },
            ]}
          >
            <Ionicons
              name="lock-closed-outline"
              size={20}
              color={focusedField === "password" ? colors.primary : colors.gray400}
              style={styles.inputIcon}
            />
            <TextInput
              style={[styles.input, styles.inputPassword]}
              placeholder="Ingresa tu contraseña"
              placeholderTextColor={colors.gray400}
              value={password}
              onChangeText={handlePasswordChange}
              onFocus={() => setFocusedField("password")}
              onBlur={() => handleBlur("password")}
              secureTextEntry={secureText}
              editable={!loading}
              returnKeyType="done"
              onSubmitEditing={handleLogin}
              accessibilityLabel="Campo de contraseña"
              accessibilityHint="Ingresa tu contraseña de acceso"
            />
            <TouchableOpacity
              onPress={() => setSecureText((s) => !s)}
              style={styles.eyeButton}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              accessibilityRole="button"
              accessibilityLabel={secureText ? "Mostrar contraseña" : "Ocultar contraseña"}
            >
              <Ionicons
                name={secureText ? "eye-off-outline" : "eye-outline"}
                size={22}
                color={colors.gray500}
              />
            </TouchableOpacity>
          </View>
          {touched.password && errors.password ? (
            <View style={styles.fieldErrorRow}>
              <Ionicons name="warning-outline" size={13} color={colors.error} />
              <Text style={styles.fieldError}>{errors.password}</Text>
            </View>
          ) : null}

          {/* ── forgot password link ─────────────────────────────────── */}
          <TouchableOpacity
            onPress={() => navigation.navigate("ForgotPassword")}
            disabled={loading}
            style={styles.forgotRow}
            accessibilityRole="button"
            accessibilityLabel="Recuperar contraseña olvidada"
          >
            <Text style={styles.forgotText}>¿Olvidaste tu contraseña?</Text>
          </TouchableOpacity>

          {/* ── submit ───────────────────────────────────────────────── */}
          <ButtonPrimary
            label={isConnected ? "Ingresar" : "Se requiere conexion"}
            onPress={handleLogin}
            loading={loading}
            disabled={!isConnected}
            accessibilityLabel="Iniciar sesion en EMASEO"
          />

          {/* ── register link ────────────────────────────────────────── */}
          <View style={styles.registerRow}>
            <Text style={styles.registerPrompt}>¿Aún no tienes cuenta? </Text>
            <TouchableOpacity
              onPress={() => navigation.navigate("Register")}
              disabled={loading}
              accessibilityRole="button"
              accessibilityLabel="Crear una cuenta nueva"
            >
              <Text style={styles.registerLink}>Crear cuenta</Text>
            </TouchableOpacity>
          </View>
        </Animated.View>
      </ScrollView>
    </KeyboardAvoidingView>
  )
}

// ─── styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: "center",
    paddingHorizontal: 20,
    paddingVertical: 32,
  },

  // ── card
  card: {
    backgroundColor: colors.white,
    borderRadius: 16,
    padding: 24,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 4,
  },

  // ── brand
  brandRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 24,
  },
  logoWrap: {
    marginRight: 12,
  },
  brandText: {
    flex: 1,
  },
  brandName: {
    fontSize: 18,
    fontWeight: "700",
    color: colors.primary,
    letterSpacing: 1.5,
  },
  brandSub: {
    fontSize: 11,
    color: colors.textTertiary,
    marginTop: 1,
  },

  // ── headings
  title: {
    fontSize: 26,
    fontWeight: "700",
    color: colors.textPrimary,
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 14,
    color: colors.textSecondary,
    marginBottom: 24,
  },

  // ── offline banner
  offlineBanner: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FFF7ED",
    borderWidth: 1,
    borderColor: "#FDE68A",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 16,
    gap: 8,
  },
  offlineBannerText: {
    flex: 1,
    fontSize: 13,
    color: colors.warning,
    lineHeight: 18,
  },

  // ── error banner
  errorBanner: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FEF2F2",
    borderWidth: 1,
    borderColor: "#FECACA",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 16,
    gap: 8,
  },
  errorBannerText: {
    flex: 1,
    fontSize: 13,
    color: colors.error,
    lineHeight: 18,
  },

  // ── labels
  label: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.textSecondary,
    marginBottom: 6,
  },

  // ── input wrapper
  inputWrapper: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1.5,
    borderRadius: 10,
    backgroundColor: colors.gray50,
    paddingHorizontal: 12,
    height: 52,
  },
  inputIcon: {
    marginRight: 10,
  },
  input: {
    flex: 1,
    fontSize: 15,
    color: colors.textPrimary,
    height: "100%",
  },
  inputPassword: {
    paddingRight: 4,
  },
  eyeButton: {
    padding: 4,
    marginLeft: 4,
  },

  // ── field-level error
  fieldErrorRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 4,
    marginBottom: 2,
    gap: 4,
  },
  fieldError: {
    fontSize: 12,
    color: colors.error,
    flex: 1,
  },

  // ── forgot
  forgotRow: {
    alignSelf: "flex-end",
    marginTop: 10,
    marginBottom: 20,
  },
  forgotText: {
    fontSize: 13,
    color: colors.primary,
    fontWeight: "500",
  },

  // ── register
  registerRow: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    marginTop: 20,
  },
  registerPrompt: {
    fontSize: 14,
    color: colors.textSecondary,
  },
  registerLink: {
    fontSize: 14,
    color: colors.primary,
    fontWeight: "600",
  },
})
