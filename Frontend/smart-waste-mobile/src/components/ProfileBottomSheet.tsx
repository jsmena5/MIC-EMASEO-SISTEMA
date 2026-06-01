import React, { useEffect, useMemo, useRef, useState } from "react"
import {
  Alert,
  Animated,
  Dimensions,
  Keyboard,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native"
import { Picker } from "@react-native-picker/picker"
import { Ionicons } from "@expo/vector-icons"
import AsyncStorage from "@react-native-async-storage/async-storage"

import { useAuth } from "../contexts/AuthContext"
import { changePassword as changePasswordApi } from "../services/auth.service"
import { colors } from "../theme/colors"

const { height: SCREEN_H } = Dimensions.get("window")
const SHEET_MAX_H = SCREEN_H * 0.87

const MONTH_LABELS = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
]
const MONTH_SHORT = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"]

const CURRENT_YEAR = new Date().getFullYear()
const BIRTH_YEARS = Array.from({ length: 90 }, (_, i) => CURRENT_YEAR - 13 - i)

const EMASEO_PHONE     = "+593 2 395-2800"
const EMASEO_PHONE_URI = "tel:+59223952800"
const EMASEO_EMAIL     = "contacto@emaseo.gob.ec"
const EMASEO_WEB       = "https://www.emaseo.gob.ec"

type Sexo = "Masculino" | "Femenino" | "Prefiero no decir"
const SEXO_OPTS: Sexo[] = ["Masculino", "Femenino", "Prefiero no decir"]

function calcAge(day: number, month: number, year: number): number | null {
  const birth = new Date(year, month - 1, day)
  if (isNaN(birth.getTime())) return null
  const today = new Date()
  let age = today.getFullYear() - birth.getFullYear()
  if (
    today.getMonth() < birth.getMonth() ||
    (today.getMonth() === birth.getMonth() && today.getDate() < birth.getDate())
  ) age--
  return age >= 0 && age <= 120 ? age : null
}

function daysInMonth(month: number, year: number): number {
  return new Date(year, month, 0).getDate()
}

interface Props {
  visible: boolean
  onClose: () => void
  onLogout: () => void
}

export default function ProfileBottomSheet({ visible, onClose, onLogout }: Props) {
  const { user } = useAuth()
  const anim = useRef(new Animated.Value(0)).current
  const [localVisible, setLocalVisible] = useState(false)

  // Profile state
  const [birthDay,   setBirthDay]   = useState(1)
  const [birthMonth, setBirthMonth] = useState(6)
  const [birthYear,  setBirthYear]  = useState(1990)
  const [sexo,       setSexo]       = useState<Sexo>("Prefiero no decir")
  const [showDatePicker, setShowDatePicker] = useState(false)
  const [profileSaving, setProfileSaving]   = useState(false)
  const [profileSaved,  setProfileSaved]    = useState(false)

  // Change-password state
  const [showChangePw,  setShowChangePw]  = useState(false)
  const [currentPw,     setCurrentPw]     = useState("")
  const [newPw,         setNewPw]         = useState("")
  const [confirmPw,     setConfirmPw]     = useState("")
  const [showCurrentPw, setShowCurrentPw] = useState(false)
  const [showNewPw,     setShowNewPw]     = useState(false)
  const [showConfirmPw, setShowConfirmPw] = useState(false)
  const [pwSaving,      setPwSaving]      = useState(false)

  const profileKey = `emaseo_profile_${user?.id ?? "guest"}`

  // Load persisted profile when sheet opens
  useEffect(() => {
    if (!visible) return
    AsyncStorage.getItem(profileKey).then(raw => {
      if (!raw) return
      try {
        const d = JSON.parse(raw)
        if (d.birthDay)   setBirthDay(d.birthDay)
        if (d.birthMonth) setBirthMonth(d.birthMonth)
        if (d.birthYear)  setBirthYear(d.birthYear)
        if (d.sexo)       setSexo(d.sexo)
      } catch {}
    })
  }, [visible])

  // Animate sheet in/out
  useEffect(() => {
    if (visible) {
      setLocalVisible(true)
      Animated.spring(anim, {
        toValue: 1,
        useNativeDriver: true,
        friction: 9,
        tension: 90,
      }).start()
    } else {
      Animated.timing(anim, {
        toValue: 0,
        duration: 250,
        useNativeDriver: true,
      }).start(() => {
        setLocalVisible(false)
        setShowDatePicker(false)
        setShowChangePw(false)
        setCurrentPw(""); setNewPw(""); setConfirmPw("")
      })
    }
  }, [visible])

  const maxDay = daysInMonth(birthMonth, birthYear)
  const days   = useMemo(() => Array.from({ length: maxDay }, (_, i) => i + 1), [maxDay])

  // Clamp day when month/year changes
  useEffect(() => {
    if (birthDay > maxDay) setBirthDay(maxDay)
  }, [birthMonth, birthYear])

  const translateY     = anim.interpolate({ inputRange: [0, 1], outputRange: [SHEET_MAX_H, 0] })
  const backdropOpacity = anim.interpolate({ inputRange: [0, 1], outputRange: [0, 0.55] })

  const age = calcAge(birthDay, birthMonth, birthYear)

  const saveProfile = async () => {
    setProfileSaving(true)
    try {
      await AsyncStorage.setItem(profileKey, JSON.stringify({ birthDay, birthMonth, birthYear, sexo }))
      setProfileSaved(true)
      setTimeout(() => setProfileSaved(false), 2000)
    } finally {
      setProfileSaving(false)
    }
  }

  const handleChangePw = async () => {
    Keyboard.dismiss()
    if (!currentPw || !newPw || !confirmPw) {
      Alert.alert("Campos incompletos", "Completa todos los campos.")
      return
    }
    if (newPw !== confirmPw) {
      Alert.alert("Error", "La nueva contraseña y su confirmación no coinciden.")
      return
    }
    setPwSaving(true)
    try {
      await changePasswordApi(currentPw, newPw)
      Alert.alert(
        "Contraseña actualizada",
        "Tu contraseña fue cambiada exitosamente. Por seguridad, inicia sesión nuevamente.",
        [{ text: "OK", onPress: () => { onClose(); onLogout() } }],
      )
    } catch (e: any) {
      Alert.alert("Error", e?.response?.data?.message ?? "No se pudo cambiar la contraseña.")
    } finally {
      setPwSaving(false)
    }
  }

  const confirmLogout = () => {
    Alert.alert("Cerrar sesión", "¿Estás seguro que deseas salir?", [
      { text: "Cancelar", style: "cancel" },
      {
        text: "Salir",
        style: "destructive",
        onPress: () => { onClose(); setTimeout(onLogout, 260) },
      },
    ])
  }

  const initial     = (user?.nombre?.[0] ?? "U").toUpperCase()
  const displayName = user?.nombre ?? "Usuario"
  const username    = user?.username ?? ""
  const role        = user?.rol ?? "ciudadano"

  return (
    <Modal
      visible={localVisible}
      transparent
      animationType="none"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={StyleSheet.absoluteFill} pointerEvents="box-none">

        {/* ── Backdrop ── */}
        <Animated.View
          style={[StyleSheet.absoluteFill, { backgroundColor: "#000", opacity: backdropOpacity }]}
          pointerEvents={localVisible ? "auto" : "none"}
        >
          <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        </Animated.View>

        {/* ── Sheet ── */}
        <Animated.View style={[styles.sheet, { transform: [{ translateY }] }]}>

          {/* Drag handle */}
          <View style={styles.dragHandle} />

          <ScrollView
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ paddingBottom: 48 }}
          >

            {/* ── User header ── */}
            <View style={styles.userHeader}>
              <View style={styles.avatarLarge}>
                <Text style={styles.avatarLargeText}>{initial}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.userName}>{displayName}</Text>
                {username ? <Text style={styles.userUsername}>@{username}</Text> : null}
                <View style={styles.roleBadge}>
                  <Ionicons name="shield-checkmark" size={11} color={colors.secondary} />
                  <Text style={styles.roleBadgeText}>{role}</Text>
                </View>
              </View>
              <TouchableOpacity style={styles.closeBtn} onPress={onClose}>
                <Ionicons name="close" size={20} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>

            {/* ════════════════════ MI INFORMACIÓN ════════════════════ */}
            <SectionLabel text="Mi información" />

            {/* Date of birth */}
            <TouchableOpacity
              style={styles.fieldRow}
              onPress={() => setShowDatePicker(v => !v)}
              activeOpacity={0.7}
            >
              <FieldIcon icon="calendar-outline" bg={colors.primaryLight} color={colors.primary} />
              <View style={styles.fieldBody}>
                <Text style={styles.fieldLabel}>Fecha de nacimiento</Text>
                <Text style={styles.fieldValue}>
                  {`${String(birthDay).padStart(2, "0")} ${MONTH_SHORT[birthMonth - 1]} ${birthYear}`}
                  {age !== null ? `   ·   ${age} años` : ""}
                </Text>
              </View>
              <Ionicons
                name={showDatePicker ? "chevron-up" : "chevron-down"}
                size={18}
                color={colors.textTertiary}
              />
            </TouchableOpacity>

            {showDatePicker && (
              <View style={styles.dateGrid}>
                <View style={styles.dateCol}>
                  <Text style={styles.dateColLabel}>Día</Text>
                  <Picker
                    selectedValue={birthDay}
                    onValueChange={v => setBirthDay(Number(v))}
                    style={styles.picker}
                    itemStyle={styles.pickerItem}
                    mode="dropdown"
                  >
                    {days.map(d => (
                      <Picker.Item key={d} label={String(d).padStart(2, "0")} value={d} />
                    ))}
                  </Picker>
                </View>

                <View style={[styles.dateCol, { flex: 1.8 }]}>
                  <Text style={styles.dateColLabel}>Mes</Text>
                  <Picker
                    selectedValue={birthMonth}
                    onValueChange={v => setBirthMonth(Number(v))}
                    style={styles.picker}
                    itemStyle={styles.pickerItem}
                    mode="dropdown"
                  >
                    {MONTH_LABELS.map((m, i) => (
                      <Picker.Item key={i} label={m} value={i + 1} />
                    ))}
                  </Picker>
                </View>

                <View style={[styles.dateCol, { flex: 1.4 }]}>
                  <Text style={styles.dateColLabel}>Año</Text>
                  <Picker
                    selectedValue={birthYear}
                    onValueChange={v => setBirthYear(Number(v))}
                    style={styles.picker}
                    itemStyle={styles.pickerItem}
                    mode="dropdown"
                  >
                    {BIRTH_YEARS.map(y => (
                      <Picker.Item key={y} label={String(y)} value={y} />
                    ))}
                  </Picker>
                </View>
              </View>
            )}

            {/* Sex */}
            <View style={[styles.fieldRow, styles.fieldRowColumn]}>
              <View style={styles.sexoHeaderRow}>
                <FieldIcon icon="person-outline" bg={colors.secondaryLight} color={colors.secondary} />
                <Text style={styles.fieldLabel}>Sexo</Text>
              </View>
              <View style={styles.radioGroup}>
                {SEXO_OPTS.map(opt => (
                  <TouchableOpacity
                    key={opt}
                    style={[styles.radioChip, sexo === opt && styles.radioChipOn]}
                    onPress={() => setSexo(opt)}
                    activeOpacity={0.7}
                  >
                    <Text style={[styles.radioChipText, sexo === opt && styles.radioChipTextOn]}>
                      {opt}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            <TouchableOpacity
              style={[styles.primaryBtn, profileSaving && styles.btnDisabled]}
              onPress={saveProfile}
              disabled={profileSaving}
              activeOpacity={0.8}
            >
              <Ionicons name={profileSaved ? "checkmark-circle" : "save-outline"} size={18} color="#fff" />
              <Text style={styles.primaryBtnText}>
                {profileSaved ? "¡Información guardada!" : profileSaving ? "Guardando..." : "Guardar información"}
              </Text>
            </TouchableOpacity>

            {/* ════════════════════ SEGURIDAD ════════════════════ */}
            <SectionLabel text="Seguridad" />

            <TouchableOpacity
              style={styles.fieldRow}
              onPress={() => setShowChangePw(v => !v)}
              activeOpacity={0.7}
            >
              <FieldIcon icon="lock-closed-outline" bg="#FEF3C7" color="#D97706" />
              <View style={styles.fieldBody}>
                <Text style={styles.fieldLabel}>Cambiar contraseña</Text>
                <Text style={styles.fieldValue}>Actualiza tu clave de acceso</Text>
              </View>
              <Ionicons
                name={showChangePw ? "chevron-up" : "chevron-forward"}
                size={18}
                color={colors.textTertiary}
              />
            </TouchableOpacity>

            {showChangePw && (
              <View style={styles.changePwBox}>
                <PwField
                  label="Contraseña actual"
                  value={currentPw}
                  onChange={setCurrentPw}
                  show={showCurrentPw}
                  onToggle={() => setShowCurrentPw(v => !v)}
                />
                <PwField
                  label="Nueva contraseña"
                  value={newPw}
                  onChange={setNewPw}
                  show={showNewPw}
                  onToggle={() => setShowNewPw(v => !v)}
                />
                <PwField
                  label="Confirmar nueva contraseña"
                  value={confirmPw}
                  onChange={setConfirmPw}
                  show={showConfirmPw}
                  onToggle={() => setShowConfirmPw(v => !v)}
                />
                <TouchableOpacity
                  style={[styles.primaryBtn, { backgroundColor: "#D97706", marginTop: 4 }, pwSaving && styles.btnDisabled]}
                  onPress={handleChangePw}
                  disabled={pwSaving}
                  activeOpacity={0.8}
                >
                  <Ionicons name="lock-open-outline" size={18} color="#fff" />
                  <Text style={styles.primaryBtnText}>
                    {pwSaving ? "Actualizando..." : "Actualizar contraseña"}
                  </Text>
                </TouchableOpacity>
              </View>
            )}

            {/* ════════════════════ CONTACTO EMASEO EP ════════════════════ */}
            <SectionLabel text="Contacto EMASEO EP" />

            <ContactRow
              icon="call-outline"
              bg="#ECFDF5"
              color="#059669"
              label="Atención ciudadana"
              value={EMASEO_PHONE}
              onPress={() => Linking.openURL(EMASEO_PHONE_URI)}
            />
            <ContactRow
              icon="mail-outline"
              bg={colors.primaryLight}
              color={colors.primary}
              label="Correo electrónico"
              value={EMASEO_EMAIL}
              onPress={() => Linking.openURL(`mailto:${EMASEO_EMAIL}`)}
            />
            <ContactRow
              icon="globe-outline"
              bg="#F5F3FF"
              color="#7C3AED"
              label="Sitio web oficial"
              value="www.emaseo.gob.ec"
              onPress={() => Linking.openURL(EMASEO_WEB)}
            />
            <View style={[styles.fieldRow, { marginBottom: 4 }]}>
              <FieldIcon icon="time-outline" bg={colors.gray100} color={colors.textSecondary} />
              <View style={styles.fieldBody}>
                <Text style={styles.fieldLabel}>Horario de atención</Text>
                <Text style={styles.fieldValue}>Lunes a Viernes  ·  08:00 – 17:00</Text>
              </View>
            </View>

            {/* ════════════════════ CERRAR SESIÓN ════════════════════ */}
            <View style={styles.divider} />
            <TouchableOpacity style={styles.logoutRow} onPress={confirmLogout} activeOpacity={0.7}>
              <Ionicons name="log-out-outline" size={20} color={colors.error} />
              <Text style={styles.logoutText}>Cerrar sesión</Text>
            </TouchableOpacity>

          </ScrollView>
        </Animated.View>
      </View>
    </Modal>
  )
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function SectionLabel({ text }: { text: string }) {
  return (
    <View style={s.sectionRow}>
      <Text style={s.sectionText}>{text.toUpperCase()}</Text>
      <View style={s.sectionLine} />
    </View>
  )
}

function FieldIcon({
  icon, bg, color,
}: {
  icon: React.ComponentProps<typeof Ionicons>["name"]
  bg: string
  color: string
}) {
  return (
    <View style={[s.fieldIcon, { backgroundColor: bg }]}>
      <Ionicons name={icon} size={20} color={color} />
    </View>
  )
}

function ContactRow({
  icon, bg, color, label, value, onPress,
}: {
  icon: React.ComponentProps<typeof Ionicons>["name"]
  bg: string
  color: string
  label: string
  value: string
  onPress: () => void
}) {
  return (
    <TouchableOpacity style={styles.fieldRow} onPress={onPress} activeOpacity={0.7}>
      <FieldIcon icon={icon} bg={bg} color={color} />
      <View style={styles.fieldBody}>
        <Text style={styles.fieldLabel}>{label}</Text>
        <Text style={[styles.fieldValue, { color }]}>{value}</Text>
      </View>
      <Ionicons name="open-outline" size={16} color={colors.textTertiary} />
    </TouchableOpacity>
  )
}

function PwField({
  label, value, onChange, show, onToggle,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  show: boolean
  onToggle: () => void
}) {
  return (
    <View style={s.pwField}>
      <Text style={s.pwLabel}>{label}</Text>
      <View style={s.pwInputRow}>
        <TextInput
          style={s.pwInput}
          value={value}
          onChangeText={onChange}
          secureTextEntry={!show}
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="••••••••"
          placeholderTextColor={colors.textTertiary}
        />
        <TouchableOpacity onPress={onToggle} style={s.pwEye} hitSlop={8}>
          <Ionicons
            name={show ? "eye-off-outline" : "eye-outline"}
            size={18}
            color={colors.textSecondary}
          />
        </TouchableOpacity>
      </View>
    </View>
  )
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  sheet: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    maxHeight: SHEET_MAX_H,
    backgroundColor: colors.surface,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    overflow: "hidden",
    elevation: 24,
    shadowColor: "#000",
    shadowOpacity: 0.28,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: -6 },
    paddingHorizontal: 20,
    paddingTop: 8,
  },
  dragHandle: {
    alignSelf: "center",
    width: 44,
    height: 5,
    borderRadius: 3,
    backgroundColor: colors.gray200,
    marginVertical: 10,
  },
  userHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    paddingBottom: 18,
    borderBottomWidth: 1,
    borderBottomColor: colors.gray100,
    marginBottom: 4,
  },
  avatarLarge: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: colors.secondary,
    justifyContent: "center",
    alignItems: "center",
    elevation: 4,
    shadowColor: colors.secondary,
    shadowOpacity: 0.4,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
  },
  avatarLargeText: {
    color: "#fff",
    fontWeight: "800",
    fontSize: 26,
  },
  userName: {
    fontSize: 18,
    fontWeight: "800",
    color: colors.textPrimary,
  },
  userUsername: {
    fontSize: 13,
    color: colors.textSecondary,
    marginTop: 2,
  },
  roleBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginTop: 6,
    backgroundColor: colors.secondaryLight,
    paddingVertical: 3,
    paddingHorizontal: 9,
    borderRadius: 10,
    alignSelf: "flex-start",
  },
  roleBadgeText: {
    color: colors.secondary,
    fontSize: 11,
    fontWeight: "700",
    textTransform: "capitalize",
  },
  closeBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.gray100,
    justifyContent: "center",
    alignItems: "center",
  },
  fieldRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.gray100,
  },
  fieldRowColumn: {
    flexDirection: "column",
    alignItems: "flex-start",
  },
  sexoHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    width: "100%",
  },
  fieldBody: {
    flex: 1,
  },
  fieldLabel: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.textPrimary,
  },
  fieldValue: {
    fontSize: 13,
    color: colors.textSecondary,
    marginTop: 2,
  },
  dateGrid: {
    flexDirection: "row",
    gap: 8,
    backgroundColor: colors.gray50,
    borderRadius: 16,
    paddingHorizontal: 8,
    paddingTop: 8,
    marginBottom: 4,
  },
  dateCol: {
    flex: 1,
    alignItems: "center",
  },
  dateColLabel: {
    fontSize: 11,
    fontWeight: "700",
    color: colors.textTertiary,
    letterSpacing: 0.8,
    textTransform: "uppercase",
    marginBottom: 2,
  },
  picker: {
    width: "100%",
    ...Platform.select({ ios: { height: 160 }, android: {} }),
  },
  pickerItem: {
    fontSize: 15,
    color: colors.textPrimary,
  },
  radioGroup: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 10,
  },
  radioChip: {
    paddingVertical: 7,
    paddingHorizontal: 16,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: colors.gray200,
    backgroundColor: colors.gray50,
  },
  radioChipOn: {
    backgroundColor: colors.primaryLight,
    borderColor: colors.primary,
  },
  radioChipText: {
    fontSize: 13,
    color: colors.textSecondary,
    fontWeight: "500",
  },
  radioChipTextOn: {
    color: colors.primary,
    fontWeight: "700",
  },
  primaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: colors.primary,
    paddingVertical: 13,
    borderRadius: 14,
    marginVertical: 14,
  },
  btnDisabled: {
    opacity: 0.55,
  },
  primaryBtnText: {
    color: "#fff",
    fontWeight: "700",
    fontSize: 15,
  },
  changePwBox: {
    backgroundColor: colors.gray50,
    borderRadius: 16,
    padding: 16,
    marginBottom: 4,
    gap: 4,
  },
  divider: {
    height: 1,
    backgroundColor: colors.gray100,
    marginVertical: 20,
  },
  logoutRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    paddingVertical: 14,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: "#FECACA",
    backgroundColor: "#FFF5F5",
  },
  logoutText: {
    color: colors.error,
    fontWeight: "700",
    fontSize: 15,
  },
})

const s = StyleSheet.create({
  sectionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginTop: 22,
    marginBottom: 2,
  },
  sectionText: {
    fontSize: 11,
    fontWeight: "800",
    color: colors.textTertiary,
    letterSpacing: 1.2,
  },
  sectionLine: {
    flex: 1,
    height: 1,
    backgroundColor: colors.gray100,
  },
  fieldIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    justifyContent: "center",
    alignItems: "center",
  },
  pwField: {
    marginBottom: 10,
  },
  pwLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: colors.textSecondary,
    marginBottom: 6,
  },
  pwInputRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.gray200,
    paddingHorizontal: 12,
  },
  pwInput: {
    flex: 1,
    paddingVertical: Platform.OS === "ios" ? 12 : 9,
    fontSize: 15,
    color: colors.textPrimary,
  },
  pwEye: {
    padding: 6,
  },
})
