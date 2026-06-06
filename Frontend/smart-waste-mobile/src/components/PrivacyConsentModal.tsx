/**
 * PrivacyConsentModal
 *
 * Aviso de privacidad y consentimiento informado exigido por la
 * Ley Orgánica de Protección de Datos Personales del Ecuador (LOPDP,
 * R.O. Suplemento 459, 26 mayo 2021 — vigente desde mayo 2023).
 *
 * Arts. relevantes aplicados:
 *   Art. 7  — Consentimiento libre, informado, específico e inequívoco.
 *   Art. 8  — Consentimiento explícito para datos sensibles (ubicación GPS).
 *   Art. 9  — Datos de menores: edad mínima 13 años (validada en el formulario).
 *   Art. 13 — Principio de finalidad: datos usados solo para lo declarado.
 *   Art. 17 — Derechos ARCOP del titular (Acceso, Rectificación, Cancelación,
 *              Oposición, Portabilidad).
 *
 * El modal se muestra UNA VEZ antes de que el usuario complete el formulario
 * de registro. Sin aceptación no se puede continuar ("No acepto" regresa atrás).
 */

import React from "react"
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native"
import { Ionicons } from "@expo/vector-icons"
import { colors } from "../theme/colors"

interface Props {
  visible: boolean
  onAccept: () => void
  onDecline: () => void
}

export default function PrivacyConsentModal({ visible, onAccept, onDecline }: Props) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      statusBarTranslucent
      onRequestClose={onDecline}
    >
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          {/* Encabezado */}
          <View style={styles.header}>
            <View style={styles.iconWrap}>
              <Ionicons name="shield-checkmark-outline" size={26} color={colors.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>Aviso de privacidad</Text>
              <Text style={styles.subtitle}>LOPDP — Ecuador</Text>
            </View>
          </View>

          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
          >
            {/* Responsable */}
            <Section icon="business-outline" title="Responsable del tratamiento">
              <Text style={styles.body}>
                <Text style={styles.bold}>EMASEO EP</Text> (Empresa Pública Metropolitana de Aseo de Quito), en el marco del presente proyecto académico de la Universidad Técnica del Ecuador.
              </Text>
            </Section>

            {/* Datos recopilados */}
            <Section icon="document-text-outline" title="Datos que recopilamos">
              <BulletItem text="Identificación: nombre completo, cédula de identidad, fecha de nacimiento, sexo." />
              <BulletItem text="Contacto: número de celular y correo electrónico." />
              <BulletItem text="Ubicación GPS: coordenadas del punto donde reportas una acumulación de basura." />
              <BulletItem text="Imágenes: fotografías tomadas desde la cámara de tu dispositivo." />
            </Section>

            {/* Finalidad */}
            <Section icon="flag-outline" title="Finalidad del tratamiento">
              <Text style={styles.body}>
                Los datos se usan <Text style={styles.bold}>exclusivamente</Text> para:
              </Text>
              <BulletItem text="Crear y gestionar tu cuenta de ciudadano." />
              <BulletItem text="Registrar y dar seguimiento a reportes de acumulación de residuos en vía pública." />
              <BulletItem text="Notificarte sobre el estado de tus reportes." />
              <BulletItem text="Mejorar la precisión del modelo de detección de basura (uso académico/investigativo)." />
            </Section>

            {/* Base legal */}
            <Section icon="library-outline" title="Base legal (Art. 7 y 22 LOPDP)">
              <Text style={styles.body}>
                Tu consentimiento expreso (este aviso) y la prestación de un servicio de interés público municipal constituyen la base legal del tratamiento.
              </Text>
            </Section>

            {/* Conservación */}
            <Section icon="time-outline" title="Conservación de datos">
              <Text style={styles.body}>
                Tus datos se conservan mientras mantengas una cuenta activa. Al eliminar tu cuenta, los datos se anonimizarán dentro de los 30 días siguientes, salvo obligación legal de retención.
              </Text>
            </Section>

            {/* Derechos ARCOP */}
            <Section icon="person-outline" title="Tus derechos (Art. 17 LOPDP)">
              <Text style={styles.body}>
                Como titular tienes derecho a:
              </Text>
              <BulletItem text="Acceso — consultar qué datos tenemos sobre ti." />
              <BulletItem text="Rectificación — corregir datos inexactos." />
              <BulletItem text="Cancelación — solicitar la eliminación de tus datos." />
              <BulletItem text="Oposición — oponerte a ciertos usos de tus datos." />
              <BulletItem text="Portabilidad — recibir tus datos en formato legible." />
            </Section>

            <View style={styles.note}>
              <Ionicons name="information-circle-outline" size={15} color={colors.primary} />
              <Text style={styles.noteText}>
                Al pulsar <Text style={styles.bold}>Acepto y continúo</Text> otorgas tu consentimiento libre, informado y específico conforme al Art. 7 de la LOPDP.
              </Text>
            </View>
          </ScrollView>

          {/* Botones */}
          <View style={styles.actions}>
            <TouchableOpacity style={styles.btnDecline} onPress={onDecline} activeOpacity={0.75}>
              <Text style={styles.btnDeclineText}>No acepto</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.btnAccept} onPress={onAccept} activeOpacity={0.85}>
              <Ionicons name="checkmark-circle-outline" size={18} color="#fff" />
              <Text style={styles.btnAcceptText}>Acepto y continúo</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  )
}

// ─── Sub-componentes internos ─────────────────────────────────────────────────

function Section({
  icon, title, children,
}: { icon: React.ComponentProps<typeof Ionicons>["name"]; title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Ionicons name={icon} size={15} color={colors.primary} />
        <Text style={styles.sectionTitle}>{title}</Text>
      </View>
      {children}
    </View>
  )
}

function BulletItem({ text }: { text: string }) {
  return (
    <View style={styles.bullet}>
      <Text style={styles.bulletDot}>•</Text>
      <Text style={styles.body}>{text}</Text>
    </View>
  )
}

// ─── Estilos ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.55)",
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: "#fff",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: "92%",
    paddingBottom: 8,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    padding: 20,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#F3F4F6",
  },
  iconWrap: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.primaryLight,
    alignItems: "center",
    justifyContent: "center",
  },
  title: {
    fontSize: 17,
    fontWeight: "800",
    color: colors.black,
  },
  subtitle: {
    fontSize: 12,
    color: colors.gray,
    marginTop: 1,
  },
  scroll: {
    flexShrink: 1,
  },
  scrollContent: {
    padding: 20,
    gap: 16,
  },
  section: {
    gap: 6,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 2,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: "700",
    color: colors.black,
  },
  body: {
    fontSize: 13,
    color: "#374151",
    lineHeight: 20,
    flex: 1,
  },
  bold: {
    fontWeight: "700",
    color: colors.black,
  },
  bullet: {
    flexDirection: "row",
    gap: 8,
    paddingLeft: 4,
  },
  bulletDot: {
    fontSize: 13,
    color: colors.primary,
    lineHeight: 20,
  },
  note: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    backgroundColor: colors.primaryLight,
    borderRadius: 10,
    padding: 12,
    marginTop: 4,
  },
  noteText: {
    flex: 1,
    fontSize: 12,
    color: colors.primary,
    lineHeight: 18,
  },
  actions: {
    flexDirection: "row",
    gap: 12,
    padding: 16,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: "#F3F4F6",
  },
  btnDecline: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: "center",
    borderWidth: 1.5,
    borderColor: "#D1D5DB",
  },
  btnDeclineText: {
    fontSize: 15,
    fontWeight: "600",
    color: "#6B7280",
  },
  btnAccept: {
    flex: 2,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: colors.primary,
  },
  btnAcceptText: {
    fontSize: 15,
    fontWeight: "700",
    color: "#fff",
  },
})
