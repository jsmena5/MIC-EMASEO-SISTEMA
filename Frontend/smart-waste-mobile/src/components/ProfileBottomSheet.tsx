import React, { useEffect, useRef, useState } from "react"
import {
  ActivityIndicator,
  Alert,
  Animated,
  Dimensions,
  Keyboard,
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

import { useAuth } from "../contexts/AuthContext"
import { changePassword as changePasswordApi } from "../services/auth.service"
import { getProfile, updateProfile } from "../services/user.service"
import { colors } from "../theme/colors"
import type { CitizenProfile, Sexo } from "../types/user.types"

const { height: SCREEN_H } = Dimensions.get("window")
const SHEET_MAX_H = SCREEN_H * 0.90

const MONTH_LABELS = [
  "enero","febrero","marzo","abril","mayo","junio",
  "julio","agosto","septiembre","octubre","noviembre","diciembre",
]
const CURRENT_YEAR = new Date().getFullYear()
const BIRTH_YEARS  = Array.from({ length: 90 }, (_, i) => CURRENT_YEAR - 13 - i)
const SEXO_OPTS: Sexo[] = ["Masculino", "Femenino", "Otro", "Prefiero no decir"]


// ─── Helpers de fecha ──────────────────────────────────────────────────────────

function partsFromIso(iso: string | null): { day: number; month: number; year: number } | null {
  if (!iso) return null
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number)
  if (!y || !m || !d) return null
  return { day: d, month: m, year: y }
}

function isoFromParts(day: number, month: number, year: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`
}

function calcAgeFromParts(p: { day: number; month: number; year: number }): number | null {
  const birth = new Date(p.year, p.month - 1, p.day)
  if (Number.isNaN(birth.getTime())) return null
  const today = new Date()
  let age = today.getFullYear() - birth.getFullYear()
  if (today.getMonth() < birth.getMonth() ||
      (today.getMonth() === birth.getMonth() && today.getDate() < birth.getDate())) age--
  return age >= 0 && age <= 120 ? age : null
}

function fechaLarga(iso: string | null): string {
  const p = partsFromIso(iso)
  if (!p) return "No registrada"
  const edad = calcAgeFromParts(p)
  const edadSuffix = edad != null ? `  ·  ${edad} años` : ""
  return `${String(p.day).padStart(2, "0")} de ${MONTH_LABELS[p.month - 1]} de ${p.year}${edadSuffix}`
}

function daysInMonth(month: number, year: number): number {
  return new Date(year, month, 0).getDate()
}

function nombreCompleto(p: CitizenProfile | null, fallback: string): string {
  if (!p) return fallback
  return [p.primer_nombre, p.segundo_nombre, p.primer_apellido, p.segundo_apellido]
    .filter(Boolean).join(" ")
}

function iniciales(p: CitizenProfile | null, fallback: string): string {
  if (!p) return (fallback[0] ?? "U").toUpperCase()
  return ((p.primer_nombre[0] ?? "") + (p.primer_apellido?.[0] ?? "")).toUpperCase()
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  visible:  boolean
  onClose:  () => void
  onLogout: () => void
}

type Tab = "perfil" | "config"

// ─── Componente principal ─────────────────────────────────────────────────────

export default function ProfileBottomSheet({ visible, onClose, onLogout }: Props) {
  const { user } = useAuth()
  const anim = useRef(new Animated.Value(0)).current
  const [localVisible, setLocalVisible] = useState(false)
  const [tab, setTab] = useState<Tab>("perfil")

  // Perfil
  const [profile,        setProfile]        = useState<CitizenProfile | null>(null)
  const [loadingProfile, setLoadingProfile] = useState(false)
  const [profileError,   setProfileError]   = useState<string | null>(null)

  // Edición (completar info faltante o rectificar datos existentes — Art. 17 LOPDP)
  const [telefono,   setTelefono]   = useState("")
  const [sexo,       setSexo]       = useState<Sexo>("Prefiero no decir")
  const [birthDay,   setBirthDay]   = useState(1)
  const [birthMonth, setBirthMonth] = useState(1)
  const [birthYear,  setBirthYear]  = useState(2000)
  const [saving,     setSaving]     = useState(false)
  const [editing,    setEditing]    = useState(false)

  // Cambio de contraseña
  const [showChangePw,  setShowChangePw]  = useState(false)
  const [currentPw,     setCurrentPw]     = useState("")
  const [newPw,         setNewPw]         = useState("")
  const [confirmPw,     setConfirmPw]     = useState("")
  const [showCurrentPw, setShowCurrentPw] = useState(false)
  const [showNewPw,     setShowNewPw]     = useState(false)
  const [showConfirmPw, setShowConfirmPw] = useState(false)
  const [pwSaving,      setPwSaving]      = useState(false)

  const perfilCompleto = !!(profile?.telefono && profile?.fecha_nacimiento && profile?.sexo)

  const loadProfile = () => {
    setLoadingProfile(true)
    setProfileError(null)
    getProfile()
      .then(p => {
        setProfile(p)
        setTelefono(p.telefono ?? "")
        setSexo((p.sexo as Sexo) ?? "Prefiero no decir")
        const parts = partsFromIso(p.fecha_nacimiento)
        if (parts) { setBirthDay(parts.day); setBirthMonth(parts.month); setBirthYear(parts.year) }
      })
      .catch(() => setProfileError("No se pudo cargar el perfil."))
      .finally(() => setLoadingProfile(false))
  }

  useEffect(() => {
    if (!visible) return
    setTab("perfil")
    loadProfile()
  }, [visible])

  // Animación sheet
  useEffect(() => {
    if (visible) {
      setLocalVisible(true)
      Animated.spring(anim, { toValue: 1, useNativeDriver: true, friction: 9, tension: 90 }).start()
    } else {
      Animated.timing(anim, { toValue: 0, duration: 250, useNativeDriver: true }).start(() => {
        setLocalVisible(false)
        setShowChangePw(false)
        setCurrentPw(""); setNewPw(""); setConfirmPw("")
      })
    }
  }, [visible])

  const maxDay = daysInMonth(birthMonth, birthYear)
  useEffect(() => { if (birthDay > maxDay) setBirthDay(maxDay) }, [birthMonth, birthYear])

  const translateY      = anim.interpolate({ inputRange: [0, 1], outputRange: [SHEET_MAX_H, 0] })
  const backdropOpacity = anim.interpolate({ inputRange: [0, 1], outputRange: [0, 0.55] })

  // Guardar: funciona tanto para completar info faltante como para rectificar (Art. 17 LOPDP)
  const handleGuardar = async () => {
    Keyboard.dismiss()
    setSaving(true)
    try {
      const updated = await updateProfile({
        telefono: telefono.trim() || null,
        fecha_nacimiento: isoFromParts(birthDay, birthMonth, birthYear),
        sexo,
      })
      setProfile(updated)
      setEditing(false)
      Alert.alert("Listo", "Tu información fue actualizada correctamente.")
    } catch (e: any) {
      Alert.alert("Error", e?.response?.data?.message ?? "No se pudo guardar la información.")
    } finally {
      setSaving(false)
    }
  }

  const handleChangePw = async () => {
    Keyboard.dismiss()
    if (!currentPw || !newPw || !confirmPw) { Alert.alert("Campos incompletos", "Completa todos los campos."); return }
    if (newPw !== confirmPw) { Alert.alert("Error", "La nueva contraseña y su confirmación no coinciden."); return }
    setPwSaving(true)
    try {
      await changePasswordApi(currentPw, newPw)
      Alert.alert("Contraseña actualizada", "Por seguridad, inicia sesión nuevamente.",
        [{ text: "OK", onPress: () => { onClose(); setTimeout(onLogout, 260) } }])
    } catch (e: any) {
      Alert.alert("Error", e?.response?.data?.message ?? "No se pudo cambiar la contraseña.")
    } finally {
      setPwSaving(false)
    }
  }

  const confirmLogout = () =>
    Alert.alert("Cerrar sesión", "¿Estás seguro que deseas salir?", [
      { text: "Cancelar", style: "cancel" },
      { text: "Salir", style: "destructive", onPress: () => { onClose(); setTimeout(onLogout, 260) } },
    ])

  const displayName = nombreCompleto(profile, user?.nombre ?? "Usuario")
  const avatarText  = iniciales(profile, user?.nombre ?? "U")
  const days        = Array.from({ length: maxDay }, (_, i) => i + 1)

  return (
    <Modal visible={localVisible} transparent animationType="none" onRequestClose={onClose} statusBarTranslucent>
      <View style={StyleSheet.absoluteFill} pointerEvents="box-none">

        <Animated.View
          style={[StyleSheet.absoluteFill, { backgroundColor: "#000", opacity: backdropOpacity }]}
          pointerEvents={localVisible ? "auto" : "none"}
        >
          <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        </Animated.View>

        <Animated.View style={[styles.sheet, { transform: [{ translateY }] }]}>
          <View style={styles.dragHandle} />

          {/* Header */}
          <View style={styles.userHeader}>
            <View style={styles.avatarLarge}>
              <Text style={styles.avatarLargeText}>{avatarText}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.userName} numberOfLines={2}>{displayName}</Text>
              {profile?.username ? <Text style={styles.userUsername}>@{profile.username}</Text> : null}
              <View style={styles.roleBadge}>
                <Ionicons name="shield-checkmark" size={11} color={colors.secondary} />
                <Text style={styles.roleBadgeText}>{user?.rol ?? "ciudadano"}</Text>
              </View>
            </View>
            <TouchableOpacity style={styles.closeBtn} onPress={onClose}>
              <Ionicons name="close" size={20} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>

          {/* Tabs */}
          <View style={styles.tabBar}>
            <TabButton label="Mi perfil"     icon="person-outline"   active={tab === "perfil"} onPress={() => setTab("perfil")} />
            <TabButton label="Configuración" icon="settings-outline" active={tab === "config"} onPress={() => setTab("config")} />
          </View>

          <ScrollView
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ paddingBottom: 28 }}
          >
            {tab === "perfil" ? (
              <PerfilTabContent
                loadingProfile={loadingProfile}
                profileError={profileError}
                profile={profile}
                displayName={displayName}
                perfilCompleto={perfilCompleto}
                editing={editing}
                telefono={telefono}
                sexo={sexo}
                birthDay={birthDay}
                birthMonth={birthMonth}
                birthYear={birthYear}
                days={days}
                saving={saving}
                onReload={loadProfile}
                setEditing={setEditing}
                setTelefono={setTelefono}
                setSexo={setSexo}
                setBirthDay={setBirthDay}
                setBirthMonth={setBirthMonth}
                setBirthYear={setBirthYear}
                onGuardar={handleGuardar}
              />
            ) : (
              <ConfigTabContent
                showChangePw={showChangePw}
                currentPw={currentPw}
                newPw={newPw}
                confirmPw={confirmPw}
                showCurrentPw={showCurrentPw}
                showNewPw={showNewPw}
                showConfirmPw={showConfirmPw}
                pwSaving={pwSaving}
                setShowChangePw={setShowChangePw}
                setCurrentPw={setCurrentPw}
                setNewPw={setNewPw}
                setConfirmPw={setConfirmPw}
                setShowCurrentPw={setShowCurrentPw}
                setShowNewPw={setShowNewPw}
                setShowConfirmPw={setShowConfirmPw}
                onChangePw={handleChangePw}
              />
            )}

            {/* Cerrar sesión — siempre visible */}
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

// ─── Contenido del tab "Mi perfil" ──────────────────────────────────────────
// Extraído de ProfileBottomSheet para bajar la complejidad cognitiva del render.
function PerfilTabContent(p: {
  loadingProfile: boolean
  profileError: string | null
  profile: CitizenProfile | null
  displayName: string
  perfilCompleto: boolean
  editing: boolean
  telefono: string
  sexo: Sexo
  birthDay: number
  birthMonth: number
  birthYear: number
  days: number[]
  saving: boolean
  onReload: () => void
  setEditing: (v: boolean) => void
  setTelefono: (v: string) => void
  setSexo: (v: Sexo) => void
  setBirthDay: (v: number) => void
  setBirthMonth: (v: number) => void
  setBirthYear: (v: number) => void
  onGuardar: () => void
}) {
  if (p.loadingProfile) {
    return (
      <View style={styles.loadingRow}>
        <ActivityIndicator size="small" color={colors.primary} />
        <Text style={styles.loadingText}>Cargando información…</Text>
      </View>
    )
  }
  if (p.profileError) {
    return (
      <TouchableOpacity style={styles.errorRow} onPress={p.onReload}>
        <Ionicons name="alert-circle-outline" size={18} color={colors.error} />
        <Text style={styles.errorRowText}>{p.profileError} Toca para reintentar.</Text>
      </TouchableOpacity>
    )
  }
  if (!p.profile) return null

  return (
    <>
      {/* Datos identitarios — siempre read-only */}
      <InfoRow icon="person-outline" iconBg={colors.primaryLight} iconColor={colors.primary}
        label="Nombre completo" value={p.displayName} />
      <InfoRow icon="card-outline" iconBg="#ECFDF5" iconColor="#059669"
        label="Cédula" value={p.profile.cedula_masked} />
      <InfoRow icon="mail-outline" iconBg="#F5F3FF" iconColor="#7C3AED"
        label="Correo electrónico" value={p.profile.email} />

      {p.perfilCompleto && !p.editing ? (
        /* Perfil completo — vista lectura con opción de rectificar (Art. 17 LOPDP) */
        <>
          <InfoRow icon="call-outline" iconBg="#ECFDF5" iconColor="#059669"
            label="Teléfono" value={p.profile.telefono ?? "—"} />
          <InfoRow icon="calendar-outline" iconBg={colors.primaryLight} iconColor={colors.primary}
            label="Fecha de nacimiento" value={fechaLarga(p.profile.fecha_nacimiento)} />
          <InfoRow icon="male-female-outline" iconBg={colors.secondaryLight} iconColor={colors.secondary}
            label="Sexo" value={p.profile.sexo ?? "—"} />
          <TouchableOpacity style={styles.editBtn} onPress={() => p.setEditing(true)} activeOpacity={0.75}>
            <Ionicons name="create-outline" size={15} color={colors.primary} />
            <Text style={styles.editBtnText}>Rectificar datos (LOPDP Art. 17)</Text>
          </TouchableOpacity>
        </>
      ) : (p.perfilCompleto && p.editing) || !p.perfilCompleto ? (
        /* Formulario de rectificación / completar perfil */
        <View style={styles.completeBox}>
          <View style={styles.completeBanner}>
            <Ionicons name="information-circle-outline" size={18} color="#B45309" />
            <Text style={styles.completeBannerText}>
              Completa tu información para terminar de configurar tu cuenta.
            </Text>
          </View>

          <Text style={styles.editLabel}>Número de teléfono</Text>
          <TextInput
            style={styles.textInput}
            value={p.telefono}
            onChangeText={p.setTelefono}
            placeholder="09XXXXXXXX"
            placeholderTextColor={colors.textTertiary}
            keyboardType="phone-pad"
            maxLength={20}
          />

          <Text style={styles.editLabel}>Fecha de nacimiento</Text>
          <View style={styles.dateGrid}>
            <View style={styles.dateCol}>
              <Text style={styles.dateColLabel}>Día</Text>
              <Picker selectedValue={p.birthDay} onValueChange={v => p.setBirthDay(Number(v))}
                style={styles.picker} itemStyle={styles.pickerItem} mode="dropdown">
                {p.days.map(d => <Picker.Item key={d} label={String(d).padStart(2, "0")} value={d} />)}
              </Picker>
            </View>
            <View style={[styles.dateCol, { flex: 1.8 }]}>
              <Text style={styles.dateColLabel}>Mes</Text>
              <Picker selectedValue={p.birthMonth} onValueChange={v => p.setBirthMonth(Number(v))}
                style={styles.picker} itemStyle={styles.pickerItem} mode="dropdown">
                {MONTH_LABELS.map((m, i) => <Picker.Item key={i} label={m[0].toUpperCase() + m.slice(1)} value={i + 1} />)}
              </Picker>
            </View>
            <View style={[styles.dateCol, { flex: 1.4 }]}>
              <Text style={styles.dateColLabel}>Año</Text>
              <Picker selectedValue={p.birthYear} onValueChange={v => p.setBirthYear(Number(v))}
                style={styles.picker} itemStyle={styles.pickerItem} mode="dropdown">
                {BIRTH_YEARS.map(y => <Picker.Item key={y} label={String(y)} value={y} />)}
              </Picker>
            </View>
          </View>

          <Text style={styles.editLabel}>Sexo</Text>
          <View style={styles.radioGroup}>
            {SEXO_OPTS.map(opt => (
              <TouchableOpacity
                key={opt}
                style={[styles.radioChip, p.sexo === opt && styles.radioChipOn]}
                onPress={() => p.setSexo(opt)}
                activeOpacity={0.7}
              >
                <Text style={[styles.radioChipText, p.sexo === opt && styles.radioChipTextOn]}>{opt}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <View style={styles.formActions}>
            {p.editing && (
              <TouchableOpacity
                style={styles.cancelBtn}
                onPress={() => p.setEditing(false)}
                disabled={p.saving}
                activeOpacity={0.75}
              >
                <Text style={styles.cancelBtnText}>Cancelar</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={[styles.primaryBtn, { flex: 1 }, p.saving && styles.btnDisabled]}
              onPress={p.onGuardar}
              disabled={p.saving}
              activeOpacity={0.8}
            >
              {p.saving
                ? <ActivityIndicator size="small" color="#fff" />
                : <Ionicons name="checkmark-circle-outline" size={18} color="#fff" />}
              <Text style={styles.primaryBtnText}>{p.saving ? "Guardando…" : "Guardar"}</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : null}
    </>
  )
}

// ─── Contenido del tab "Configuración" ───────────────────────────────────────
function ConfigTabContent(p: {
  showChangePw: boolean
  currentPw: string
  newPw: string
  confirmPw: string
  showCurrentPw: boolean
  showNewPw: boolean
  showConfirmPw: boolean
  pwSaving: boolean
  setShowChangePw: (fn: (v: boolean) => boolean) => void
  setCurrentPw: (v: string) => void
  setNewPw: (v: string) => void
  setConfirmPw: (v: string) => void
  setShowCurrentPw: (fn: (v: boolean) => boolean) => void
  setShowNewPw: (fn: (v: boolean) => boolean) => void
  setShowConfirmPw: (fn: (v: boolean) => boolean) => void
  onChangePw: () => void
}) {
  return (
    <>
      <SectionLabel text="Seguridad" />
      <TouchableOpacity style={styles.fieldRow} onPress={() => p.setShowChangePw(v => !v)} activeOpacity={0.7}>
        <FieldIcon icon="lock-closed-outline" bg="#FEF3C7" color="#D97706" />
        <View style={styles.fieldBody}>
          <Text style={styles.fieldLabel}>Cambiar contraseña</Text>
          <Text style={styles.fieldValue}>Actualiza tu clave de acceso</Text>
        </View>
        <Ionicons name={p.showChangePw ? "chevron-up" : "chevron-forward"} size={18} color={colors.textTertiary} />
      </TouchableOpacity>

      {p.showChangePw && (
        <View style={styles.changePwBox}>
          <PwField label="Contraseña actual" value={p.currentPw} onChange={p.setCurrentPw}
            show={p.showCurrentPw} onToggle={() => p.setShowCurrentPw(v => !v)} />
          <PwField label="Nueva contraseña" value={p.newPw} onChange={p.setNewPw}
            show={p.showNewPw} onToggle={() => p.setShowNewPw(v => !v)} />
          <PwField label="Confirmar nueva contraseña" value={p.confirmPw} onChange={p.setConfirmPw}
            show={p.showConfirmPw} onToggle={() => p.setShowConfirmPw(v => !v)} />
          <TouchableOpacity
            style={[styles.primaryBtn, { backgroundColor: "#D97706", marginTop: 4 }, p.pwSaving && styles.btnDisabled]}
            onPress={p.onChangePw}
            disabled={p.pwSaving}
            activeOpacity={0.8}
          >
            <Ionicons name="lock-open-outline" size={18} color="#fff" />
            <Text style={styles.primaryBtnText}>{p.pwSaving ? "Actualizando…" : "Actualizar contraseña"}</Text>
          </TouchableOpacity>
        </View>
      )}
    </>
  )
}

// ─── Sub-componentes ──────────────────────────────────────────────────────────

function TabButton({ label, icon, active, onPress }: {
  label: string
  icon: React.ComponentProps<typeof Ionicons>["name"]
  active: boolean
  onPress: () => void
}) {
  return (
    <TouchableOpacity
      style={[styles.tabBtn, active && styles.tabBtnActive]}
      onPress={onPress}
      activeOpacity={0.8}
    >
      <Ionicons name={icon} size={16} color={active ? colors.primary : colors.textTertiary} />
      <Text style={[styles.tabBtnText, active && styles.tabBtnTextActive]}>{label}</Text>
    </TouchableOpacity>
  )
}

function SectionLabel({ text }: { text: string }) {
  return (
    <View style={s.sectionRow}>
      <Text style={s.sectionText}>{text.toUpperCase()}</Text>
      <View style={s.sectionLine} />
    </View>
  )
}

function FieldIcon({ icon, bg, color }: {
  icon: React.ComponentProps<typeof Ionicons>["name"]; bg: string; color: string
}) {
  return (
    <View style={[s.fieldIcon, { backgroundColor: bg }]}>
      <Ionicons name={icon} size={20} color={color} />
    </View>
  )
}

function InfoRow({ icon, iconBg, iconColor, label, value }: {
  icon: React.ComponentProps<typeof Ionicons>["name"]
  iconBg: string; iconColor: string; label: string; value: string
}) {
  return (
    <View style={styles.fieldRow}>
      <FieldIcon icon={icon} bg={iconBg} color={iconColor} />
      <View style={styles.fieldBody}>
        <Text style={styles.fieldLabel}>{label}</Text>
        <Text style={styles.fieldValue}>{value}</Text>
      </View>
    </View>
  )
}

function PwField({ label, value, onChange, show, onToggle }: {
  label: string; value: string; onChange: (v: string) => void; show: boolean; onToggle: () => void
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
          <Ionicons name={show ? "eye-off-outline" : "eye-outline"} size={18} color={colors.textSecondary} />
        </TouchableOpacity>
      </View>
    </View>
  )
}

// ─── Estilos ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  sheet: {
    position: "absolute", bottom: 0, left: 0, right: 0,
    maxHeight: SHEET_MAX_H,
    backgroundColor: colors.surface,
    borderTopLeftRadius: 28, borderTopRightRadius: 28,
    overflow: "hidden", elevation: 24,
    shadowColor: "#000", shadowOpacity: 0.28, shadowRadius: 24, shadowOffset: { width: 0, height: -6 },
    paddingHorizontal: 20, paddingTop: 8,
  },
  dragHandle: {
    alignSelf: "center", width: 44, height: 5, borderRadius: 3,
    backgroundColor: colors.gray200, marginVertical: 10,
  },
  userHeader: {
    flexDirection: "row", alignItems: "center", gap: 14,
    paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: colors.gray100,
  },
  avatarLarge: {
    width: 60, height: 60, borderRadius: 30,
    backgroundColor: colors.secondary, justifyContent: "center", alignItems: "center",
    elevation: 4, shadowColor: colors.secondary, shadowOpacity: 0.4, shadowRadius: 8, shadowOffset: { width: 0, height: 2 },
  },
  avatarLargeText: { color: "#fff", fontWeight: "800", fontSize: 22 },
  userName: { fontSize: 17, fontWeight: "800", color: colors.textPrimary, flexShrink: 1 },
  userUsername: { fontSize: 13, color: colors.textSecondary, marginTop: 2 },
  roleBadge: {
    flexDirection: "row", alignItems: "center", gap: 4, marginTop: 6,
    backgroundColor: colors.secondaryLight, paddingVertical: 3, paddingHorizontal: 9,
    borderRadius: 10, alignSelf: "flex-start",
  },
  roleBadgeText: { color: colors.secondary, fontSize: 11, fontWeight: "700", textTransform: "capitalize" },
  closeBtn: {
    width: 34, height: 34, borderRadius: 17, backgroundColor: colors.gray100,
    justifyContent: "center", alignItems: "center",
  },

  // Tabs
  tabBar: {
    flexDirection: "row", gap: 8, marginTop: 14, marginBottom: 4,
  },
  tabBtn: {
    flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
    paddingVertical: 10, borderRadius: 12, backgroundColor: colors.gray50,
    borderWidth: 1.5, borderColor: "transparent",
  },
  tabBtnActive: { backgroundColor: colors.primaryLight, borderColor: colors.primary },
  tabBtnText: { fontSize: 13, fontWeight: "700", color: colors.textTertiary },
  tabBtnTextActive: { color: colors.primary },

  loadingRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 20, paddingHorizontal: 4 },
  loadingText: { fontSize: 13, color: colors.textSecondary },
  errorRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 16, paddingHorizontal: 4 },
  errorRowText: { fontSize: 13, color: colors.error, flex: 1 },

  fieldRow: {
    flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: colors.gray100,
  },
  fieldBody: { flex: 1 },
  fieldLabel: { fontSize: 14, fontWeight: "600", color: colors.textPrimary },
  fieldValue: { fontSize: 13, color: colors.textSecondary, marginTop: 2 },

  lockedNote: {
    flexDirection: "row", alignItems: "flex-start", gap: 8,
    marginTop: 14, paddingHorizontal: 4,
  },
  lockedNoteText: { flex: 1, fontSize: 12, color: colors.textTertiary, lineHeight: 17 },

  editBtn: {
    flexDirection: "row", alignItems: "center", gap: 6,
    alignSelf: "flex-start", marginTop: 14,
    paddingVertical: 7, paddingHorizontal: 12,
    borderRadius: 8, borderWidth: 1.5, borderColor: colors.primary,
    backgroundColor: colors.primaryLight,
  },
  editBtnText: { fontSize: 13, fontWeight: "600", color: colors.primary },

  formActions: { flexDirection: "row", gap: 10, marginTop: 4 },
  cancelBtn: {
    paddingVertical: 12, paddingHorizontal: 16, borderRadius: 10,
    borderWidth: 1.5, borderColor: "#D1D5DB", alignItems: "center", justifyContent: "center",
  },
  cancelBtnText: { fontSize: 14, fontWeight: "600", color: "#6B7280" },

  // Completar info
  completeBox: { marginTop: 14, gap: 8 },
  completeBanner: {
    flexDirection: "row", alignItems: "flex-start", gap: 8,
    backgroundColor: "#FFFBEB", borderRadius: 12, padding: 12,
    borderWidth: 1, borderColor: "#FDE68A", marginBottom: 4,
  },
  completeBannerText: { flex: 1, fontSize: 13, color: "#92400E", lineHeight: 18 },
  editLabel: { fontSize: 13, fontWeight: "600", color: colors.textPrimary, marginTop: 8 },
  textInput: {
    borderWidth: 1.5, borderColor: colors.gray200, borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: Platform.OS === "ios" ? 12 : 9,
    fontSize: 14, color: colors.textPrimary, backgroundColor: colors.gray50,
  },
  dateGrid: {
    flexDirection: "row", gap: 8, backgroundColor: colors.gray50,
    borderRadius: 16, paddingHorizontal: 8, paddingTop: 8,
  },
  dateCol: { flex: 1, alignItems: "center" },
  dateColLabel: {
    fontSize: 11, fontWeight: "700", color: colors.textTertiary,
    letterSpacing: 0.8, textTransform: "uppercase", marginBottom: 2,
  },
  picker: { width: "100%", ...Platform.select({ ios: { height: 160 }, android: {} }) },
  pickerItem: { fontSize: 15, color: colors.textPrimary },
  radioGroup: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 4 },
  radioChip: {
    paddingVertical: 7, paddingHorizontal: 16, borderRadius: 20,
    borderWidth: 1.5, borderColor: colors.gray200, backgroundColor: colors.gray50,
  },
  radioChipOn: { backgroundColor: colors.primaryLight, borderColor: colors.primary },
  radioChipText: { fontSize: 13, color: colors.textSecondary, fontWeight: "500" },
  radioChipTextOn: { color: colors.primary, fontWeight: "700" },

  primaryBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    backgroundColor: colors.primary, paddingVertical: 13, borderRadius: 14, marginTop: 14,
  },
  btnDisabled: { opacity: 0.55 },
  primaryBtnText: { color: "#fff", fontWeight: "700", fontSize: 15 },
  changePwBox: { backgroundColor: colors.gray50, borderRadius: 16, padding: 16, marginBottom: 4, gap: 4 },
  divider: { height: 1, backgroundColor: colors.gray100, marginVertical: 18 },
  logoutRow: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10,
    paddingVertical: 14, borderRadius: 14, borderWidth: 1.5, borderColor: "#FECACA", backgroundColor: "#FFF5F5",
  },
  logoutText: { color: colors.error, fontWeight: "700", fontSize: 15 },
})

const s = StyleSheet.create({
  sectionRow: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 22, marginBottom: 6 },
  sectionText: { fontSize: 11, fontWeight: "800", color: colors.textTertiary, letterSpacing: 1.2 },
  sectionLine: { flex: 1, height: 1, backgroundColor: colors.gray100 },
  fieldIcon: { width: 40, height: 40, borderRadius: 12, justifyContent: "center", alignItems: "center" },
  pwField: { marginBottom: 10 },
  pwLabel: { fontSize: 12, fontWeight: "600", color: colors.textSecondary, marginBottom: 6 },
  pwInputRow: {
    flexDirection: "row", alignItems: "center", backgroundColor: colors.surface,
    borderRadius: 12, borderWidth: 1, borderColor: colors.gray200, paddingHorizontal: 12,
  },
  pwInput: { flex: 1, paddingVertical: Platform.OS === "ios" ? 12 : 9, fontSize: 15, color: colors.textPrimary },
  pwEye: { padding: 6 },
})
