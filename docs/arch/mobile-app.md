# Mobile App — Arquitectura

## 1. Arquitectura del sistema

La app móvil es la interfaz para **ciudadanos** (reporte de basura) y **operarios** (gestión de asignaciones en campo). Es una aplicación React Native con Expo SDK 54, distribuida como APK nativo (arm64) y actualizable OTA con Expo Updates.

```
Ciudadano/Operario (smartphone Android/iOS)
  │
  [smart-waste-mobile — Expo SDK 54]
  │
  │  HTTPS + JWT
  ▼
[api-gateway :4000]
  ├── /api/auth/*
  ├── /api/users/*
  ├── /api/ml/pre-check       ← pre-validación imagen
  ├── /api/image/analyze      ← envío de imagen
  ├── /api/image/status/:id   ← polling resultado
  ├── /api/incidents/me       ← historial ciudadano
  ├── /api/incidents/notifications
  └── /api/operario/*         ← asignaciones operario
```

**Ruta raíz:** `Frontend/smart-waste-mobile/`
**Runtime:** React Native 0.81.5 + Expo SDK 54
**Target:** Android (arm64-v8a) principal; iOS secundario
**APK optimizado:** 36.9 MB (arm64-only + bundle compression; sin R8/minify)

---

## 2. Estilo de arquitectura

| Patrón | Aplicación |
|---|---|
| **Feature screens + contexts** | Screens por flujo, estado global vía React Context |
| **Services layer** | auth.service.ts, user.service.ts, image.service.ts encapsulan HTTP |
| **Navigator-based routing** | React Navigation (stack + bottom tabs) |
| **Fail-closed** | Pre-check falla → bloquea envío; no asume éxito ante error |
| **Offline-resilient** | Cola AsyncStorage + retry exponencial para envíos fallidos |

---

## 3. Decisiones arquitectónicas

### 3.1 App exclusiva para CIUDADANO y OPERARIO
Supervisores y admins usan los paneles web. La app móvil bloquea el acceso en 3 puntos si el rol no es CIUDADANO u OPERARIO:
1. `AuthContext` al decodificar el JWT en login
2. `ProtectedRoute` en AppNavigator
3. Token de sesión no se almacena si el rol no corresponde

**Por qué:** Evitar que supervisores/admins accedan a una UI incompleta para su rol.

### 3.2 VisionCamera v4 + frame processor (5fps)
La guía de distancia en tiempo real usa VisionCamera para acceder a los frames raw del sensor. Se procesa a 5fps para calcular cobertura de imagen y estimar si el objeto está demasiado cerca, en distancia óptima, o muy lejos.

**Por qué no la cámara de Expo:** ExpoCamera no permite acceso a frames para procesamiento en tiempo real.

### 3.3 Recorte exacto al overlay (`cropToScanFrame.ts`)
Al capturar, `expo-image-manipulator` recorta la imagen exactamente al área del `ScanOverlay` visible en pantalla. Una función fuente única (`cropToScanFrame.ts`) calcula las coordenadas de recorte a partir de las dimensiones del overlay y del sensor.

**Por qué:** El backend ML recibe la región de interés directamente, sin bordes negros ni áreas irrelevantes.

### 3.4 Pre-check fail-closed
Si `POST /ml/pre-check` retorna error de red o HTTP 5xx, la app **bloquea** el envío con mensaje "No se pudo validar la imagen". No assume que la imagen es válida ante silencio.

**Por qué:** Es preferible que el ciudadano reintente a crear incidentes con imágenes inválidas que contaminen el dataset de entrenamiento.

### 3.5 Tokens en Secure Store (no AsyncStorage)
El JWT y el refresh token se almacenan con `expo-secure-store` (Keychain en iOS, Keystore en Android). AsyncStorage es texto plano; no es adecuado para credenciales.

### 3.6 Build arm64-only sin R8/minify
El APK se compila solo para `arm64-v8a` (>98% de dispositivos modernos). Se desactivó R8 (minificación de bytecode) porque rompe worklets de VisionCamera y código de Reanimated.

**Resultado:** 90.5 MB → 36.9 MB sin comprometer compatibilidad.

### 3.7 OTA updates con Expo Updates
Cambios de JavaScript (no de código nativo) se distribuyen OTA sin pasar por las tiendas. Canal: `"preview"`. Los cambios nativos requieren generar un nuevo APK con EAS Build.

**Regla importante:** Publicar OTA siempre con `--platform android` o `--platform ios` **por separado**, nunca `--platform all`. Expo Router rompe el bundle web con `output=static`.

### 3.8 Polling para resultado ML (no WebSocket)
El cliente hace GET `/api/image/status/:taskId` cada 1 segundo hasta recibir `status: "completed"` o `"failed"`. No se implementó WebSocket porque el patrón de uso (1–2 reportes por sesión) no justifica la complejidad de mantener una conexión persistente.

---

## 4. Comunicación interna y externa

### Servicios externos
- **API Gateway:** HTTPS + JWT Bearer
- **Expo Push Service:** Token registrado al login; push recibido via sistema OS

### Flujo de autenticación
```typescript
// AuthContext.tsx
// Al arrancar la app:
1. Lee token de SecureStore
2. Si existe, decodifica con jwt-decode
3. Si expira en <2min → refresh silencioso
4. Si refresh falla → logout y navega a LoginScreen
5. Si sin token → navega a LoginScreen

// Payload del JWT:
{
  id: number,
  username: string,
  rol: "CIUDADANO" | "OPERARIO",
  nombre: string,
  tipo_perfil: "ciudadano" | "operario",
  iat, exp
}
```

### Registro de push token
```typescript
// Al login exitoso (ciudadano):
const { data: token } = await Notifications.getExpoPushTokenAsync({
  projectId: 'c259a64b-...'
})
await POST('/api/users/push-token', { token: token.data, platform: 'android' })
```

---

## 5. Funcionalidades

### 5.1 Registro de ciudadano (3 pasos en app)
```
Pantalla 1: RegisterScreen
  → { email, nombre, cedula, telefono }
  → POST /api/users/register

Pantalla 2: OtpVerificationScreen
  → { email, otp }
  → POST /api/users/verify-email

Pantalla 3: SetPasswordScreen
  → { email, password, confirmPassword }
  → POST /api/users/set-password
  → Login automático
```

### 5.2 Recuperación de contraseña
```
ForgotPasswordScreen → POST /api/auth/forgot-password → { email }
ForgotPasswordOtpScreen → POST /api/auth/verify-reset-otp
ResetPasswordScreen → POST /api/auth/reset-password
```

### 5.3 Escaneo y reporte (flujo principal del ciudadano)
```
ScanScreen:
  1. VisionCamera en modo captura
  2. ScanOverlay: marco visual, barra de distancia (TOO_CLOSE | OPTIMAL | TOO_FAR)
  3. useLiveDistanceGuidance: frame processor 5fps → cobertura → distancia hint
  4. Al presionar captura:
     a. expo-image-manipulator recorta al overlay
     b. expo-location obtiene GPS (en paralelo al recorte)
     c. POST /api/ml/pre-check (fail-closed)
     d. Si passes=true → POST /api/image/analyze
     e. Navega a ScanResultScreen con task_id

ScanResultScreen:
  1. AnalyzingOverlay mientras polling activo
  2. GET /api/image/status/:taskId cada 1s
  3. Al completar: muestra tipo, nivel, prioridad, confianza
  4. Tooltips explicativos para cada campo ML
  5. Botón "Ver en historial" → HistorialScreen
```

### 5.4 Historial de reportes (ciudadano)
```
HistorialScreen:
  GET /api/incidents/me (paginado, más reciente primero)
  Tarjetas: thumbnail, estado badge (color), tipo, fecha

ReportDetailScreen:
  GET /api/incidents/me/:id
  Imagen completa (lightbox)
  Resultados ML + corrección supervisor (si existe)
  CaseTimeline: historial de estados con timestamps
```

### 5.5 Notificaciones push (ciudadano)
```
AlertsScreen:
  GET /api/incidents/notifications
  Lista: título, cuerpo, timestamp, leído/no-leído
  PUT /api/incidents/notifications/:id/read al abrir
  PUT /api/incidents/notifications/read-all

Push notification recibida:
  Deep link: exp+mic-emaseo://incidents/:id → ReportDetailScreen
```

### 5.6 Flujo operario
```
OperarioNavigator (stack separado):
  
  Lista asignaciones:
    GET /api/operario/asignaciones
    Tarjetas: tipo residuo, prioridad, dirección, estado

  Detalle asignación:
    GET /api/operario/asignaciones/:id
    Imagen incidente, coordenadas, tipo, nivel
    Mapa con pin de ubicación

  Completar:
    Validar geocerca (GPS actual vs ubicación incidente, ≤10m)
    PUT /api/operario/asignaciones/:id/completar
      Body: { latitud, longitud }
    Feedback: ¿La IA fue correcta?
    POST /api/operario/feedback/:incident_id

  No-atendible:
    PUT /api/operario/asignaciones/:id/no-atendible
      Body: { motivo }
```

### 5.7 Consentimiento de privacidad
```
PrivacyConsentModal: aparece en primer login
Almacena aceptación en AsyncStorage
Sin aceptación → no puede avanzar al escaneo
(LOPDP Ecuador — consentimiento explícito para uso de GPS e imagen)
```

### 5.8 Pantallas informativas
```
EnvironmentalAwarenessScreen: estadísticas de impacto (residuos reportados, zonas limpias)
ManualScreen: instrucciones de uso de la app
HelpScreen: FAQ (¿Por qué necesita GPS?, ¿Qué pasa con mi foto?, etc.)
```

---

## 6. Otros aspectos importantes

### Estructura de archivos
```
Frontend/smart-waste-mobile/src/
├── App.tsx                              # Root: providers + navigator
├── navigation/
│   ├── AppNavigator.tsx                 # Stack principal
│   └── OperarioNavigator.tsx           # Stack operario
├── screens/
│   ├── SplashScreen.tsx
│   ├── LoginScreen.tsx
│   ├── RegisterScreen.tsx
│   ├── OtpVerificationScreen.tsx
│   ├── SetPasswordScreen.tsx
│   ├── ForgotPassword*.tsx
│   ├── ResetPasswordScreen.tsx
│   ├── HomeScreen.tsx                   # Bottom tabs
│   ├── ScanScreen.tsx
│   ├── ScanResultScreen.tsx
│   ├── HistorialScreen.tsx
│   ├── ReportDetailScreen.tsx
│   ├── AlertsScreen.tsx
│   ├── EnvironmentalAwarenessScreen.tsx
│   ├── ManualScreen.tsx
│   └── HelpScreen.tsx
├── contexts/
│   ├── AuthContext.tsx                  # Token + user + refresh silencioso
│   ├── AnalysisContext.tsx             # Estado task_id + resultado ML
│   └── NetworkContext.tsx              # Online/offline detection
├── services/
│   ├── auth.service.ts
│   ├── user.service.ts
│   └── image.service.ts
├── components/
│   ├── ScanOverlay.tsx                 # Marco visual + barra distancia
│   ├── CapturedFrameOverlay.tsx        # Preview del frame capturado
│   ├── AnalyzingOverlay.tsx            # Spinner con fases del análisis
│   ├── PrivacyConsentModal.tsx
│   └── ProfileBottomSheet.tsx
├── hooks/
│   ├── useLiveDistanceGuidance.ts      # Frame processor → TOO_CLOSE/OPTIMAL/TOO_FAR
│   └── useConnectivity.ts             # NetInfo online/offline
└── utils/
    ├── cropToScanFrame.ts              # Cálculo coordenadas de recorte
    ├── secureStorage.ts               # Wrapper expo-secure-store
    ├── navigationService.ts           # Navegación imperativa (push notifications)
    └── authSessionEvents.ts           # Evento global de logout
```

### Dependencias clave
```
react-native: 0.81.5
expo: ~54.0.33
react-native-vision-camera: ^4.7.0
expo-image-manipulator: ~14.0.8
expo-notifications: ~0.32.17
expo-location: ~17.0.1
expo-secure-store: ~14.0.1
@react-native-async-storage/async-storage: 2.2.0
axios: ^1.13.6
formik: ^2.4.9
yup: ^1.7.1
jwt-decode: ^4.0.0
@react-navigation/native: ^7.1.33
@react-navigation/native-stack: ^7.14.4
@react-navigation/bottom-tabs: ^7.4.0
```

### Build y distribución
```bash
# APK arm64 (producción)
eas build --platform android --profile production

# OTA update (solo cambios JS)
eas update --platform android --branch preview --message "Fix X"
# NUNCA: eas update --platform all (rompe web con output=static)

# Tamaño actual: 36.9 MB
# Configuración: arm64-v8a only, bundle compression ON, R8 OFF
```

### Variables de configuración
```typescript
// src/config/env.ts
export const API_URL = process.env.EXPO_PUBLIC_API_URL  // https://api.emaseo.ec
export const EXPO_PROJECT_ID = 'c259a64b-...'           // Expo push notifications
```

### Flujo de distancia en tiempo real
```typescript
// useLiveDistanceGuidance.ts
// Frame processor (VisionCamera, 5fps):
//   1. Captura frame JPEG reducido
//   2. Calcula coverage_union (ratio área oscura/total)
//   3. Aplica heurística calibrada con MiDaS:
//      coverage < 0.10 → TOO_FAR
//      0.10–0.60      → OPTIMAL
//      coverage > 0.60 → TOO_CLOSE
//   4. Devuelve hint al ScanOverlay

// ScanOverlay renderiza barra:
//   🔴 TOO_CLOSE → "Aleja el teléfono"
//   🟢 OPTIMAL   → "Distancia perfecta"
//   🟡 TOO_FAR   → "Acércate al punto"
```
