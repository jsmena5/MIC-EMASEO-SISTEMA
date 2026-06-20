/**
 * splashSetup.ts — DEBE ser el primer import de App.tsx.
 *
 * Por qué funciona:
 *   Babel convierte todos los `import` a `require()` y los hoista al inicio
 *   del bundle JS en el orden en que aparecen en el archivo fuente.
 *   Al poner `import './splashSetup'` como PRIMERA línea de App.tsx, Metro
 *   garantiza que este módulo se evalúa primero — antes de React, AuthContext
 *   o cualquier otro módulo.
 *
 *   Dentro de este módulo, `import * as SplashScreen` se resuelve y ejecuta,
 *   y a continuación preventAutoHideAsync() se llama sincrónicamente.
 *   El splash nativo (fondo #001828 + splash-icon.png de app.json) permanece
 *   visible hasta que SplashScreen.tsx llame a hideAsync().
 */
import * as SplashScreen from "expo-splash-screen"

SplashScreen.preventAutoHideAsync().catch(() => {
  // Ignorar si el splash ya fue ocultado (p.ej. recarga con Fast Refresh)
})
