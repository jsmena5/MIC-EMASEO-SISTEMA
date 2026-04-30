# Análisis Integral del Sistema EMASEO — Roadmap de Correcciones

**Fecha:** 2026-04-30  
**Estado:** Plan en ejecución  
**Responsable:** equipo de desarrollo

---

## 📋 Tabla de Contenidos

1. [Resumen Ejecutivo](#resumen-ejecutivo)
2. [Flujo de Datos](#flujo-de-datos)
3. [Modelo de Machine Learning](#modelo-de-machine-learning)
4. [Interfaces de Usuario](#interfaces-de-usuario)
5. [Roadmap de Implementación](#roadmap-de-implementación)

---

## 🎯 Resumen Ejecutivo

El análisis integral cubre tres áreas críticas del sistema EMASEO:

| Área | Estado | Problema Principal | Solución Prioritaria |
|------|--------|-------------------|----------------------|
| **Flujo de Datos** | ⚠️ Parcial | Las notificaciones no existen | Implementar Notification Service |
| **Modelo ML** | ❌ Crítico | mAP@50=0.47 (57% falsos negativos) | Recolectar datos ecuatorianos + ajustar umbrales |
| **UI/UX** | ⚠️ Inconsistente | Componentes vacíos, sin feedback positivo | Implementar ButtonPrimary + Toast |

---

## 1️⃣ FLUJO DE DATOS

### Estado Actual

```
App Móvil → API Gateway → Image Service → MinIO + ML Service → PostgreSQL → ❌ Notificaciones (no existe)
```

### Problemas Identificados

#### P1 — 🔴 CRÍTICO: Notificaciones no implementadas
- **Síntoma:** El usuario reporta basura pero nunca recibe confirmación ni alertas de estado
- **Causa:** La tabla `notifications.notifications` existe pero ningún servicio la consume/escribe
- **Impacto:** Experiencia usuario incompleta; no hay feedback asincrónico
- **Archivo:** `Backend/database/01_init_schema.sql` (schema `notifications`)

#### P2 — 🟠 ALTO: Polling sincrónico bloquea Image Service
- **Síntoma:** Análisis de imagen tarda 30-90s si el ML es lento
- **Causa:** `image.service.js` hace polling síncrono a `/predict/status/{task_id}` en el mismo request
- **Impacto:** Usuario espera bloqueado; consume slots de conexión PostgreSQL
- **Archivo:** `Backend/image-service/src/services/image.service.js` líneas 100-150

#### P3 — 🟠 ALTO: Imagen sube ANTES de validación ML
- **Síntoma:** Imágenes huérfanas en MinIO si el delete falla
- **Causa:** `PutObjectCommand` → ML → `if has_waste==false` → `DeleteObjectCommand`
- **Impacto:** Acumulación de archivos basura; inconsistencia DB-MinIO
- **Archivo:** `Backend/image-service/src/services/image.service.js` líneas 60-75

#### P4 — 🟡 MEDIO: S3_PUBLIC_URL hardcodeada a localhost
- **Síntoma:** Las imágenes no cargan en producción ni en otras máquinas
- **Causa:** `.env.example` usa `http://localhost:9000`
- **Impacto:** Imágenes rotas en app móvil y panel supervisor
- **Archivo:** `Backend/image-service/.env.example`, `Backend/image-service/src/index.js`

#### P5 — 🟡 MEDIO: Sin circuit breaker ML Service
- **Síntoma:** Si ML está caído, el usuario espera 110s antes de fallar
- **Causa:** No hay health check previo; timeout fijo del AbortSignal
- **Impacto:** Mala UX en degradación del servicio
- **Archivo:** `Backend/image-service/src/services/image.service.js`

#### P6 — 🟢 BAJO: Credenciales MinIO hardcodeadas
- **Síntoma:** Credenciales `minioadmin/minioadmin` en código fuente
- **Causa:** Variables de entorno no usadas en inicial
- **Impacto:** Riesgo de seguridad si se expone el código
- **Archivo:** `Backend/image-service/src/index.js`

### ✅ Soluciones y Recomendaciones

- [ ] **R1 — Implementar Notification Service** (Prioridad: 1)
  - Crear `/Backend/notifications-service/` (Node.js + Bull/BullMQ)
  - Integrar FCM (Firebase Admin SDK) o Expo Push API
  - Consumidor de `notifications.notifications` tabla
  - Trigger PostgreSQL al insertar incidente
  - Tests: 90% cobertura de casos de retry

- [ ] **R2 — Revertir orden: ML primero, MinIO después** (Prioridad: 2)
  - Llamar ML `/predict` primero (sin subir imagen)
  - `if has_waste==false` → devolver 422 directo (sin borrado)
  - `if has_waste==true` → subir a MinIO → INSERT PostgreSQL
  - Elimina inconsistencia y reduce carga de red en rechazos

- [ ] **R3 — Health check ML antes de cada análisis** (Prioridad: 3)
  - GET `${ML_SERVICE_URL}/health` con timeout 3s
  - `if !ok` → 503 (fail-fast en lugar de 110s)
  - Mensajes de error accionables al usuario

- [ ] **R4 — S3_PUBLIC_URL como variable obligatoria** (Prioridad: 4)
  - Validar en startup de `image-service`
  - Si no está definida, el proceso no arranca
  - Documentar en README la configuración correcta
  - Ejemplo: `S3_PUBLIC_URL=https://storage.emaseo.ec` (no localhost)

- [ ] **R5 — Credenciales MinIO desde variables de entorno** (Prioridad: 5)
  - Usar `process.env.S3_ACCESS_KEY_ID` y `process.env.S3_SECRET_ACCESS_KEY`
  - No hardcodear `minioadmin/minioadmin` en código

---

## 2️⃣ MODELO DE MACHINE LEARNING

### Estado Actual

| Métrica | Valor | Objetivo |
|---|---|---|
| mAP@50 | 0.4752 | 0.75 – 0.85 |
| mAP@50:95 | 0.2450 | 0.50 – 0.65 |
| Precision | 0.5523 | 0.75 – 0.85 |
| Recall | 0.4353 | 0.65 – 0.75 |

**Arquitectura:** RT-DETR-L (32.8M parámetros), pesos COCO  
**Dataset:** ~25,000 imágenes (Roboflow Universe, mayormente europeas)  
**Hardware:** RTX 3050 6GB, batch=2, 50 épocas

### Problemas Identificados

#### P1 — 🔴 CRÍTICO: Modelo descartaba todas sus predicciones
- **Síntoma:** En producción, siempre `has_waste=false` incluso con basura visible
- **Causa:** Filtro en `tasks.py` línea 135 solo aceptaba `"garbage"` y `"basura"`, pero modelo 5-clases salida `RECICLABLE`, `ORGANICO`, `ESCOMBROS`, `PELIGROSO`, `MIXTO`
- **Impacto:** Modelo entrenado completamente inutilizado
- **Archivo:** `Backend/ml-service/tasks.py` línea 10-19
- **Estado:** ✅ **CORREGIDO** en commit `d743a97`

#### P2 — 🔴 CRÍTICO: Dataset sin contexto ecuatoriano
- **Síntoma:** Modelo entrenado con calles de Londres, Marsella, Roma
- **Causa:** Datasets descargados de Roboflow Universe (datasets públicos globales)
- **Impacto:** Domain shift severo; fallos en Quito con infraestructura diferente
- **Archivo:** `ML/descargar_nuevas_clases.py`

#### P3 — 🟠 ALTO: mAP@50=0.47 es insuficiente
- **Síntoma:** El modelo pierde el 57% de acúmulos reales (falsos negativos masivos)
- **Causa:** Bajo Recall (0.4353); combinación de datos débiles + umbral NMS alto
- **Impacto:** Usuarios ven "no detectado" en fotos con basura obvia
- **Archivo:** `ML/resultados/metricas_test_real.json`

#### P4 — 🟠 ALTO: NMS_CONF=0.60 era demasiado restrictivo
- **Síntoma:** Rechaza detecciones válidas con confianza 0.35-0.59
- **Causa:** Threshold incorrecto para modelo con Precision=0.55
- **Impacto:** Falsos negativos innecesarios
- **Archivo:** `Backend/ml-service/tasks.py` línea 30
- **Estado:** ✅ **CORREGIDO** (bajado a 0.35) en commit `d743a97`

#### P5 — 🟡 MEDIO: Batch=2 limita convergencia
- **Síntoma:** Gradientes ruidosos; modelo no converge óptimamente
- **Causa:** RTX 3050 solo permite batch=2 (6GB VRAM)
- **Impacto:** Pérdida de 2-3 puntos en mAP potencialmente
- **Archivo:** `ML/train_rtdetr.py` línea 40

#### P6 — 🟡 MEDIO: 50 épocas insuficientes
- **Síntoma:** RT-DETR-L converge más lento que YOLOv8
- **Causa:** Transformers requieren más iteraciones
- **Impacto:** Modelo no alcanza su mejor performance
- **Archivo:** `ML/train_rtdetr.py` línea 35

### ✅ Soluciones y Roadmap

#### Fase 1: Corto Plazo (0-2 semanas) — Sin reentrenamiento
- [x] **R1 — Corregir filtro de clases** (COMPLETADO ✅)
  - [x] Ampliar `_VALID_WASTE_CLASSES` para las 5 clases del modelo
  - [x] Agregar `"mixto"` a `_V2_CLASS_MAP`
  - [x] Status: Merged en PR #1

- [x] **R2 — Ajustar umbrales NMS** (COMPLETADO ✅)
  - [x] `NMS_CONF`: 0.60 → 0.35
  - [x] `NMS_IOU`: 0.45 → 0.50
  - [x] `CONF_NORMALIZATION_BASELINE`: 0.70 → 0.60
  - [x] Status: Merged en PR #1
  - 📊 Impacto esperado: Recall +15-20 puntos, mAP@50 ≈ 0.55-0.60

#### Fase 2: Mediano Plazo (2-4 semanas) — Datos locales

- [ ] **R3 — Recolectar 500 fotos reales de Quito** (Prioridad: 1)
  - [ ] Capturar desde múltiples ángulos, iluminación, clima
  - [ ] Zonas: Centro, Sur, Norte, periferias
  - [ ] Incluir escenas difíciles: lluvia, sombras, poca luz
  - [ ] Anotar con Roboflow (herramienta gratuita)
  - [ ] Meta: 300 imágenes positivas + 100 negativas
  - 📊 Impacto esperado: mAP@50 +10-20 puntos

- [ ] **R4 — Reentrenar con más épocas** (Prioridad: 2)
  - [ ] Aumentar `EPOCHS`: 50 → 100
  - [ ] Aumentar `PATIENCE`: 15 → 25
  - [ ] Bajar `lr0`: 0.00005 → 0.00002
  - [ ] Aumentar `warmup_epochs`: 5 → 10
  - 📊 Impacto esperado: mAP@50 +3-6 puntos

- [ ] **R5 — Aumentar backgrounds/hard negatives** (Prioridad: 3)
  - [ ] Expandir de 200 a 500-800 imágenes limpias
  - [ ] Incluir calles de Ecuador (Google Street View, propias)
  - [ ] Interiores, parques, zonas verdes
  - 📊 Impacto esperado: Reducir falsos positivos, +2-5 puntos

#### Fase 3: Largo Plazo (4-8 semanas) — Transfer Learning

- [ ] **R6 — Fine-tuning desde checkpoint de dominio** (Prioridad: 4)
  - [ ] Buscar modelos preentrenados en datasets de basura (Hugging Face)
  - [ ] Partir de checkpoint con mAP>0.80
  - [ ] Fine-tuning con datos ecuatorianos
  - 📊 Impacto esperado: mAP@50 +5-10 puntos

- [ ] **R7 — Validación con imágenes móvil real** (Prioridad: 5)
  - [ ] Tomar fotos desde app en condiciones reales
  - [ ] JPEG artifacts (quality=0.82), variación de exposición
  - [ ] Añadir al test set para validación
  - 📊 Impacto esperado: Identificar biases del pipeline

### 📊 Tabla de Prioridades

| Acción | Impacto en mAP@50 | Esfuerzo | Prioridad | Estado |
|--------|---|---|---|---|
| Corregir filtro de clases | +5-10 puntos | Muy bajo | 1 | ✅ DONE |
| Ajustar NMS_CONF a 0.35 | +3-8 puntos | Muy bajo | 2 | ✅ DONE |
| Datos reales ecuatorianos | +10-20 puntos | Alto | 3 | ⏳ TODO |
| Reentrenar 100 épocas | +3-6 puntos | Medio | 4 | ⏳ TODO |
| Hard negatives | +2-5 puntos | Bajo | 5 | ⏳ TODO |
| Fine-tuning desde checkpoint | +5-10 puntos | Medio | 6 | ⏳ TODO |

---

## 3️⃣ INTERFACES DE USUARIO

### Estado Actual

**Stack:** React Native (Expo), 13 pantallas, sin gestión de estado global  
**Estilos:** Paleta `colors.ts` bien definida, pero `globalStyles.ts` desactualizado

### Problemas Identificados

#### P1 — 🔴 CRÍTICO: Componentes vacíos
- **Síntoma:** `ButtonPrimary.tsx` e `InputField.tsx` sin contenido
- **Causa:** Archivos creados pero no implementados
- **Impacto:** Cada pantalla reimplementa botones manualmente → inconsistencia visual
- **Archivo:** `Frontend/smart-waste-mobile/src/components/ButtonPrimary.tsx`, `InputField.tsx`

#### P2 — 🔴 CRÍTICO: Sin feedback para acciones exitosas
- **Síntoma:** Solo `Alert.alert()` modal para errores; nada para éxitos
- **Causa:** No hay Toast/Snackbar, no hay notificaciones push
- **Impacto:** Usuario no sabe si su reporte fue enviado (salvo ir a otra pantalla)
- **Archivo:** Todas las pantallas

#### P3 — 🔴 CRÍTICO: Accesibilidad ausente
- **Síntoma:** Usuarios con discapacidad visual no pueden usar la app
- **Causa:** Sin `accessibilityLabel`, `accessibilityRole`, `accessibilityHint`
- **Impacto:** Incapacidad legal de usar en producción en muchos países
- **Archivo:** Todas las pantallas

#### P4 — 🟠 ALTO: Sin gestión de estado global
- **Síntoma:** Datos de usuario se decodifican del JWT en cada pantalla
- **Causa:** Solo `useState` local + `AsyncStorage`
- **Impacto:** Duplicación de lógica; si token expira en una pantalla, otras no lo saben
- **Archivo:** `Frontend/smart-waste-mobile/src/screens/` (todas)

#### P5 — 🟠 ALTO: ScanScreen con 570 líneas
- **Síntoma:** Componente muy complejo: permisos + cámara + upload + UI + animaciones
- **Causa:** Sin división en sub-componentes
- **Impacto:** Difícil de mantener, testear, debuggear
- **Archivo:** `Frontend/smart-waste-mobile/src/screens/ScanScreen.tsx`

#### P6 — 🟠 ALTO: Sin manejo de errores de red amigable
- **Síntoma:** Muestra strings técnicos al usuario: `"No se pudo conectar...\n\n${err?.message}"`
- **Causa:** Error bruto expuesto sin traducción
- **Impacto:** Usuario confundido, sin opción de reintentar
- **Archivo:** `LoginScreen.tsx`, `ScanScreen.tsx`, etc.

#### P7 — 🟡 MEDIO: Botones no se deshabilitan durante peticiones
- **Síntoma:** Usuario puede tocar "Entrar" 5 veces → 5 requests duplicados
- **Causa:** Sin estado `loading` que deshabilite el botón
- **Impacto:** Race conditions; cargas de servidor innecesarias
- **Archivo:** `LoginScreen.tsx`, `RegisterScreen.tsx`

#### P8 — 🟡 MEDIO: Flujo de registro sin indicador de progreso
- **Síntoma:** RegisterScreen muestra "Paso 1/3", pero OtpVerification y SetPassword no
- **Causa:** Sin `ProgressBar` en pantallas 2 y 3
- **Impacto:** Usuario abandona por no saber cuánto falta
- **Archivo:** `OtpVerificationScreen.tsx`, `SetPasswordScreen.tsx`

#### P9 — 🟡 MEDIO: Mapa no interactivo
- **Síntoma:** `scrollEnabled={false}`, `zoomEnabled={false}`, `rotateEnabled={false}`
- **Causa:** Decisión de diseño restrictiva
- **Impacto:** Usuario no puede explorar ni confirmar ubicación
- **Archivo:** `ReportDetailScreen.tsx`

#### P10 — 🟢 BAJO: globalStyles.ts desactualizado
- **Síntoma:** Dos sistemas de estilos coexistiendo: `colors.ts` + `globalStyles.ts` + inline
- **Causa:** Refactorización parcial
- **Impacto:** Tamaños de fuente inconsistentes entre pantallas (12-28px sin escala)
- **Archivo:** `Frontend/smart-waste-mobile/src/theme/globalStyles.ts`

### ✅ Soluciones y Roadmap

#### Fase 1: Corto Plazo (1-2 semanas) — Máximo impacto mínimo esfuerzo

- [ ] **R1 — Deshabilitar botones durante peticiones** (Prioridad: 1)
  - [ ] Agregar `loading` state en LoginScreen, RegisterScreen, ScanScreen
  - [ ] Pasar `disabled={loading}` a botones
  - [ ] Mostrar spinner mientras está en vuelo
  - 📍 Archivos: `LoginScreen.tsx`, `RegisterScreen.tsx`, `ScanScreen.tsx`
  - ⏱️ Esfuerzo: 1-2 horas

- [ ] **R2 — Mensajes de error amigables** (Prioridad: 2)
  - [ ] Reemplazar strings técnicos por mensajes en español
  - [ ] Agregar botón "Reintentar" en alerts
  - [ ] Ocultar detalles internos (codes, stacktraces)
  - 📍 Archivos: Todas las pantallas con Alert.alert
  - ⏱️ Esfuerzo: 2-3 horas

- [ ] **R3 — Implementar ButtonPrimary.tsx** (Prioridad: 3)
  - [ ] Props: `label`, `onPress`, `loading?`, `disabled?`, `variant?`
  - [ ] Soportar 3 variantes: "primary", "secondary", "danger"
  - [ ] Usar colores de `colors.ts`
  - [ ] Mostrar spinner cuando `loading={true}`
  - 📍 Archivo: `Frontend/smart-waste-mobile/src/components/ButtonPrimary.tsx`
  - ⏱️ Esfuerzo: 1-2 horas

- [ ] **R4 — Agregar Toast/Snackbar** (Prioridad: 4)
  - [ ] Instalar `react-native-toast-message`
  - [ ] Mostrar toast en acciones exitosas (login, reporte enviado, etc.)
  - [ ] Configurar global en App.tsx
  - 📍 Archivos: `App.tsx`, pantallas con actions exitosas
  - ⏱️ Esfuerzo: 2-3 horas

#### Fase 2: Mediano Plazo (2-4 semanas) — Arquitectura

- [ ] **R5 — Crear AuthContext** (Prioridad: 5)
  - [ ] Context global: `user`, `token`, `logout()`
  - [ ] Provider en App.tsx, consumible en cualquier pantalla
  - [ ] Elimina decodificación de JWT en cada pantalla
  - 📍 Archivos: `AuthContext.tsx`, `App.tsx`, todas las pantallas
  - ⏱️ Esfuerzo: 4-6 horas

- [ ] **R6 — Barra de progreso en registro** (Prioridad: 6)
  - [ ] Agregar `ProgressBar` en OtpVerification (paso 2/3) y SetPassword (paso 3/3)
  - [ ] Usar mismo componente que RegisterScreen
  - 📍 Archivos: `OtpVerificationScreen.tsx`, `SetPasswordScreen.tsx`
  - ⏱️ Esfuerzo: 1-2 horas

- [ ] **R7 — Dividir ScanScreen en sub-componentes** (Prioridad: 7)
  - [ ] `ScanScreen.tsx` (orquestador, ~100 líneas)
  - [ ] `CameraPermissionRequest.tsx` (~50 líneas)
  - [ ] `CameraView.tsx` (~150 líneas)
  - [ ] `ScanOverlay.tsx` (~100 líneas)
  - [ ] `AnalyzingOverlay.tsx` (~80 líneas)
  - 📍 Archivo: `Frontend/smart-waste-mobile/src/screens/`
  - ⏱️ Esfuerzo: 6-8 horas

#### Fase 3: Largo Plazo (4-8 semanas) — Accesibilidad

- [ ] **R8 — Accesibilidad básica** (Prioridad: 8)
  - [ ] `accessibilityLabel` en botones principales (captura, login, envío)
  - [ ] `accessibilityRole="button"` en componentes táctiles
  - [ ] `accessibilityHint` en campos complejos
  - 📍 Archivos: ScanScreen, LoginScreen, ScanResultScreen (prioritarios)
  - ⏱️ Esfuerzo: 4-6 horas

- [ ] **R9 — Mapa interactivo** (Prioridad: 9)
  - [ ] Habilitar `scrollEnabled`, `zoomEnabled` en ReportDetailScreen
  - [ ] Agregar botón "Abrir en Google Maps"
  - [ ] Usar Linking.openURL(`geo:${lat},${lon}`)
  - 📍 Archivo: `ReportDetailScreen.tsx`
  - ⏱️ Esfuerzo: 1-2 horas

- [ ] **R10 — Validación de email en Login** (Prioridad: 10)
  - [ ] Agregar regex check antes de enviar
  - [ ] Mostrar error inline si formato es inválido
  - 📍 Archivo: `LoginScreen.tsx`
  - ⏱️ Esfuerzo: 0.5-1 hora

### 📊 Tabla de Prioridades

| Cambio | Impacto | Esfuerzo | Prioridad | Estado |
|--------|--------|----------|-----------|--------|
| R1 — Deshabilitar botones | Alto | 1-2h | 1 | ⏳ TODO |
| R2 — Mensajes amigables | Alto | 2-3h | 2 | ⏳ TODO |
| R3 — ButtonPrimary real | Medio | 1-2h | 3 | ⏳ TODO |
| R4 — Toast/Snackbar | Medio | 2-3h | 4 | ⏳ TODO |
| R5 — AuthContext | Medio | 4-6h | 5 | ⏳ TODO |
| R6 — Barra de progreso | Bajo | 1-2h | 6 | ⏳ TODO |
| R7 — Dividir ScanScreen | Mantenibilidad | 6-8h | 7 | ⏳ TODO |
| R8 — Accesibilidad | Alto | 4-6h | 8 | ⏳ TODO |
| R9 — Mapa interactivo | Bajo | 1-2h | 9 | ⏳ TODO |
| R10 — Validación email | Bajo | 0.5-1h | 10 | ⏳ TODO |

---

## 🗺️ ROADMAP DE IMPLEMENTACIÓN

### Timeline Recomendado

```
SEMANA 1-2 (Ahora)
├── ✅ Correcciones ML (umbrales) — COMPLETADO
├── ⏳ UI Quick Wins (botones, errores, toast)
└── ⏳ AuthContext básico

SEMANA 3-4
├── ⏳ Recolectar 500 fotos de Quito
├── ⏳ Anotar dataset ecuatoriano
└── ⏳ Refactorizar ScanScreen

SEMANA 5-8
├── ⏳ Reentrenar modelo (100 épocas)
├── ⏳ Fine-tuning desde checkpoint
└── ⏳ Accesibilidad completa

SEMANA 9+
├── ⏳ Implementar Notification Service
└── ⏳ Testing completo e integración
```

### Dependencias Críticas

```
ML Data Collection (Quito photos)
    ↓
ML Retraining & Fine-tuning
    ↓
Validation on Real Domain
    ↓
Production Deployment

Paralelo (independiente del ML):
UI Improvements
    ↓
AuthContext & Component Refactor
    ↓
Notification Service Implementation
```

### Métricas de Éxito

| Métrica | Actual | Objetivo | Deadline |
|---------|--------|----------|----------|
| mAP@50 | 0.4752 | 0.75+ | Semana 8 |
| Recall | 0.4353 | 0.75+ | Semana 8 |
| UI Consistency | 0% | 100% | Semana 4 |
| Error Handling | Técnico | Humano | Semana 2 |
| Accesibilidad | 0% | 80% | Semana 8 |
| Notifications | No existe | 100% | Semana 10 |

---

## 📝 Notas Importantes

### Contexto del Dataset
- El modelo actual fue entrenado con imágenes **mayormente europeas** (Londres, Marsella, Roma)
- **No hay imágenes de contexto andino tropical** (Quito, calles ecuatorianas)
- Los contenedores, infraestructura y vegetación son muy diferentes
- **Conclusión:** Sin datos ecuatorianos locales, no se alcanzará 80-90% de precisión

### Modo DUMMY vs REAL
- `DUMMY_MODE=true` (desarrollo) → respuestas simuladas sin cargar modelo
- `DUMMY_MODE=false` (producción) → carga modelo `.pt` real
- Los cambios de configuración solo se ven en modo REAL

### Contribuyentes
- Análisis: Claude Sonnet 4.6
- Implementación: Equipo de desarrollo EMASEO

---

**Última actualización:** 2026-04-30  
**Próxima revisión:** 2026-05-07
