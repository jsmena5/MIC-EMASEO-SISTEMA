import { Ionicons } from "@expo/vector-icons"
import React from "react"
import { StyleSheet, Text, TouchableOpacity, View } from "react-native"

import { colors } from "../theme/colors"

interface Props {
  children: React.ReactNode
}

interface State {
  hasError: boolean
  // Cambia en cada recuperación para forzar el remontaje completo del árbol hijo.
  resetKey: number
}

/**
 * Error Boundary global.
 *
 * Captura CUALQUIER excepción lanzada durante el render de las pantallas y, en
 * lugar de dejar el árbol de React desmontado (lo que en una build de release se
 * ve como una PANTALLA NEGRA y obliga a reabrir la app), muestra una pantalla de
 * recuperación con un botón para volver al inicio.
 *
 * La recuperación remonta el subárbol hijo con una `key` nueva. Si se envuelve el
 * NavigationContainer, esto descarta TODO el estado de navegación y arranca de
 * cero en la ruta inicial — evitando un bucle de fallos si la pantalla que rompió
 * se rehidratara con los mismos params inválidos.
 *
 * Nota: los Error Boundaries solo atrapan errores de render/ciclo de vida de los
 * componentes hijos. NO atrapan errores en callbacks async (p. ej. dentro de un
 * setInterval o un onPress); esos se siguen manejando con try/catch en su sitio.
 */
export default class ErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false, resetKey: 0 }

  static getDerivedStateFromError(): Partial<State> {
    return { hasError: true }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    if (__DEV__) {
      console.error("[ErrorBoundary] Excepción de render capturada:", error, info.componentStack)
    }
    // Punto de enganche para un servicio de crash reporting (Sentry, etc.).
  }

  private readonly handleReset = () => {
    this.setState((s) => ({ hasError: false, resetKey: s.resetKey + 1 }))
  }

  render() {
    if (this.state.hasError) {
      return (
        <View style={styles.container}>
          <View style={styles.iconWrap}>
            <Ionicons name="alert-circle-outline" size={56} color={colors.primary} />
          </View>
          <Text style={styles.title}>Algo salió mal</Text>
          <Text style={styles.body}>
            Ocurrió un problema inesperado al mostrar esta pantalla. Puedes volver al inicio
            y continuar usando la app con normalidad.
          </Text>
          <TouchableOpacity style={styles.button} onPress={this.handleReset} activeOpacity={0.85}>
            <Ionicons name="home-outline" size={20} color="#fff" />
            <Text style={styles.buttonText}>Volver al inicio</Text>
          </TouchableOpacity>
        </View>
      )
    }

    return (
      <React.Fragment key={this.state.resetKey}>
        {this.props.children}
      </React.Fragment>
    )
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    justifyContent: "center",
    alignItems: "center",
    padding: 32,
  },
  iconWrap: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: colors.primaryLight,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 20,
  },
  title: {
    fontSize: 22,
    fontWeight: "700",
    color: colors.textPrimary,
    marginBottom: 10,
    textAlign: "center",
  },
  body: {
    fontSize: 15,
    color: colors.textSecondary,
    textAlign: "center",
    lineHeight: 22,
    marginBottom: 28,
  },
  button: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: colors.primary,
    paddingVertical: 14,
    paddingHorizontal: 28,
    borderRadius: 14,
    elevation: 4,
    shadowColor: colors.primary,
    shadowOpacity: 0.3,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
  },
  buttonText: {
    color: "#fff",
    fontWeight: "700",
    fontSize: 16,
  },
})
