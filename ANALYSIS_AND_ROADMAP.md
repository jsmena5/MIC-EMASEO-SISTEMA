# Análisis Integral del Sistema EMASEO — Roadmap de Correcciones

**Fecha:** 2026-04-30  
**Estado:** Plan en ejecución  
**Responsable:** Equipo de Desarrollo  

---

## Tabla de Contenidos

1. [Resumen Ejecutivo](#resumen-ejecutivo)
2. [Flujo de Datos](#flujo-de-datos)
3. [Modelo de Machine Learning](#modelo-de-machine-learning)
4. [Interfaces de Usuario](#interfaces-de-usuario)
5. [Roadmap de Implementación](#roadmap-de-implementación)

---

## Resumen Ejecutivo

El análisis integral cubre tres áreas críticas del sistema EMASEO:

| Área | Estado Actual | Problema Principal | Solución Prioritaria |
|------|--------|-------------------|----------------------|
| **Flujo de Datos** | Parcial | Las notificaciones no existen | Implementar Notification Service |
| **Modelo ML** | Crítico | mAP@50=0.47 (57% falsos negativos) | Recolectar datos ecuatorianos y ajustar umbrales |
| **UI/UX** | Inconsistente | Componentes vacíos, sin feedback positivo | Implementar ButtonPrimary y Toast |

---

## 1. FLUJO DE DATOS

### Estado Actual

`App Móvil → API Gateway → Image Service → MinIO + ML Service → PostgreSQL → Notificaciones (No implementado)`

### Problemas Identificados

*   **P1 — CRÍTICO: Notificaciones no implementadas**
    *   **Síntoma:** El usuario reporta basura pero nunca recibe confirmación ni alertas de estado.
    *   **Causa:** La tabla `notifications.notifications` existe pero ningún servicio la consume o escribe.
    *   **Impacto:** Experiencia de usuario incompleta; carencia de feedback asincrónico.
    *   **Archivo:** `Backend/database/01_init_schema.sql` (schema `notifications`).

*   **P2 — ALTO: Polling sincrónico bloquea Image Service**
    *   **Síntoma:** El análisis de imagen tarda 30-90s si el procesamiento de ML es lento.
    *   **Causa:** `image.service.js` realiza polling síncrono a `/predict/status/{task_id}` en la misma petición HTTP.
    *   **Impacto:** El usuario espera bloqueado; consumo excesivo de slots de conexión en PostgreSQL.
    *   **Archivo:** `Backend/image-service/src/services/image.service.js` (líneas 100-150).

*   **P3 — ALTO: Imagen se sube antes de la validación ML**
    *   **Síntoma:** Imágenes huérfanas en MinIO si el proceso de eliminación falla.
    *   **Causa:** Flujo actual: `PutObjectCommand` → ML → `if has_waste==false` → `DeleteObjectCommand`.
    *   **Impacto:** Acumulación de archivos innecesarios; inconsistencia entre Base de Datos y MinIO.
    *   **Archivo:** `Backend/image-service/src/services/image.service.js` (líneas 60-75).

*   **P4 — MEDIO: S3_PUBLIC_URL estática a localhost**
    *   **Síntoma:** Las imágenes no cargan en entornos de producción ni en dispositivos externos.
    *   **Causa:** El archivo `.env.example` utiliza `http://localhost:9000` por defecto.
    *   **Impacto:** Imágenes no disponibles en la aplicación móvil y el panel de supervisión.
    *   **Archivo:** `Backend/image-service/.env.example`, `Backend/image-service/src/index.js`.

*   **P5 — MEDIO: Ausencia de circuit breaker en ML Service**
    *   **Síntoma:** Si el servicio ML no responde, el usuario experimenta un tiempo de espera de 110s.
    *   **Causa:** Ausencia de validación previa de estado (health check); timeout fijo mediante AbortSignal.
    *   **Impacto:** Degradación severa de la experiencia de usuario ante fallos del servicio.
    *   **Archivo:** `Backend/image-service/src/services/image.service.js`.

*   **P6 — BAJO: Credenciales MinIO expuestas**
    *   **Síntoma:** Credenciales `minioadmin/minioadmin` asignadas directamente en el código fuente.
    *   **Causa:** Las variables de entorno no se inyectan en la configuración inicial.
    *   **Impacto:** Vulnerabilidad de seguridad ante la exposición del código fuente.
    *   **Archivo:** `Backend/image-service/src/index.js`.

### Soluciones y Recomendaciones

*   [ ] **R1 — Implementar Notification Service** (Prioridad: 1)
    *   Desarrollar módulo `/Backend/notifications-service/` (Node.js + Bull/BullMQ).
    *   Integración con FCM (Firebase Admin SDK) o Expo Push API.
    *   Implementar consumidor para la tabla `notifications.notifications`.
    *   Establecer trigger en PostgreSQL al insertar nuevos incidentes.
    *   **Pruebas:** 90% de cobertura en casos de reintento.

*   [x] **R2 — Revertir flujo de procesamiento: ML previo a MinIO** (Prioridad: 2) — **ESTADO: COMPLETADO**
    *   Ejecutar petición a ML `/predict` sin carga previa de imagen.
    *   Si `has_waste==false`: Retornar error HTTP 422 directamente sin operaciones de borrado.
    *   Si `has_waste==true`: Proceder con carga a MinIO y subsecuente `INSERT` en PostgreSQL.

*   [x] **R3 — Implementar health check preventivo para ML Service** (Prioridad: 3) — **ESTADO: COMPLETADO**
    *   Ejecutar solicitud GET a `${ML_SERVICE_URL}/health` con timeout de 3000ms.
    *   Si falla: Retornar HTTP 503 (fail-fast mitigando la espera de 110s).
    *   Desplegar mensajes de error accionables al cliente.

*   [ ] **R4 — S3_PUBLIC_URL como variable de entorno obligatoria** (Prioridad: 4)
    *   Validación estricta durante el arranque de `image-service`.
    *   Interrumpir el proceso de arranque si la variable no está definida.
    *   Actualizar documentación (README) con la configuración requerida.

*   [ ] **R5 — Gestión segura de credenciales MinIO** (Prioridad: 5)
    *   Implementar `process.env.S3_ACCESS_KEY_ID` y `process.env.S3_SECRET_ACCESS_KEY`.
    *   Eliminar asignaciones estáticas en el código fuente.

---

## 2. MODELO DE MACHINE LEARNING

### Estado Actual

| Métrica | Valor Actual | Objetivo |
|---|---|---|
| mAP@50 | 0.4752 | 0.75 – 0.85 |
| mAP@50:95 | 0.2450 | 0.50 – 0.65 |
| Precision | 0.5523 | 0.75 – 0.85 |
| Recall | 0.4353 | 0.65 – 0.75 |

**Arquitectura:** RT-DETR-L (32.8M parámetros), pesos COCO.  
**Dataset de Entrenamiento:** ~25,000 imágenes (Roboflow Universe, predominantemente de origen europeo).  
**Hardware de Entrenamiento:** RTX 3050 6GB, batch=2, 50 épocas.

### Problemas Identificados (Resumen Ejecutivo)

*   **P1 — CRÍTICO:** El modelo descartaba todas sus predicciones (Corregido).
*   **P2 — CRÍTICO:** Dataset carente de contexto geográfico y visual ecuatoriano.
*   **P3 — ALTO:** mAP@50 de 0.47 es insuficiente para el despliegue en producción.
*   **P4 — ALTO:** NMS_CONF de 0.60 resultaba excesivamente restrictivo (Corregido).
*   **P5 — MEDIO:** La limitación de hardware (Batch=2) afecta la convergencia óptima del modelo.
*   **P6 — MEDIO:** 50 épocas de entrenamiento resultan insuficientes para la arquitectura Transformer.

### Soluciones y Roadmap Estratégico

#### Fase 1: Corto Plazo (0-2 semanas) — Optimización sin reentrenamiento
*   [x] **R1 — Corrección de filtro de clases** — **ESTADO: COMPLETADO**
*   [x] **R2 — Ajuste de umbrales NMS** — **ESTADO: COMPLETADO**

#### Fase 2: Mediano Plazo (2-4 semanas) — Localización de Datos
*   [ ] **R3 — Recolección de dataset local (500 fotografías de Quito)** (Prioridad: 1)
*   [ ] **R4 — Reentrenamiento extensivo (100 épocas)** (Prioridad: 2)
*   [ ] **R5 — Inclusión de 'Hard Negatives' y fondos limpios** (Prioridad: 3)

#### Fase 3: Largo Plazo (4-8 semanas) — Transfer Learning y Validación
*   [ ] **R6 — Fine-tuning basado en checkpoint de dominio específico** (Prioridad: 4)
*   [ ] **R7 — Validación de rendimiento con capturas móviles reales** (Prioridad: 5)

---

## 3. INTERFACES DE USUARIO (UI/UX)

### Estado Actual

**Stack Tecnológico:** React Native (Expo), 13 pantallas. Refactorización de estado y UI en curso.  
**Sistemas de Diseño:** Paleta de colores (`colors.ts`) definida.

### Soluciones y Roadmap Estratégico

#### Fase 1: Corto Plazo (1-2 semanas) — Optimizaciones de Alto Impacto

*   [x] **R1 — Prevención de peticiones concurrentes** (Prioridad: 1) — **ESTADO: COMPLETADO**
    *   Gestión de estado `loading` implementada en pantallas críticas (Login, Register, Scan).
    *   Deshabilitación dinámica de botones y visualización de indicadores de progreso.

*   [x] **R2 — Optimización de Mensajes de Error** (Prioridad: 2) — **ESTADO: COMPLETADO**
    *   Traducción de excepciones técnicas a lenguaje funcional para el usuario.
    *   Implementación de acciones de recuperación ("Reintentar") en modales de alerta.

*   [x] **R3 — Estandarización de Componentes: ButtonPrimary.tsx** (Prioridad: 3) — **ESTADO: COMPLETADO**
    *   Desarrollo de componente reutilizable con tres variantes funcionales (Primary, Secondary, Danger) integradas al sistema de diseño.

*   [x] **R4 — Sistema de Feedback Asíncrono (Toast)** (Prioridad: 4) — **ESTADO: COMPLETADO**
    *   Integración de librería `react-native-toast-message` para notificaciones no bloqueantes.

#### Fase 2: Mediano Plazo (2-4 semanas) — Refactorización Arquitectónica

*   [x] **R5 — Implementación de AuthContext Global** (Prioridad: 5) — **ESTADO: COMPLETADO**
    *   Gestión centralizada de sesión (`user`, `token`, `logout()`).
    *   Control de estado `isLoading` para prevenir renderizados prematuros durante la lectura de almacenamiento local.

*   [ ] **R6 — Indicadores de progreso en flujos de múltiples pasos** (Prioridad: 6)
    *   Integración de componente `ProgressBar` en pantallas de verificación y configuración de seguridad.

*   [ ] **R7 — Modularización de Componentes Complejos (ScanScreen)** (Prioridad: 7)
    *   Desacoplamiento de responsabilidades lógicas (`CameraView.tsx`, `ScanOverlay.tsx`).

#### Fase 3: Largo Plazo (4-8 semanas) — Accesibilidad y Usabilidad

*   [ ] **R8 — Cumplimiento de estándares de accesibilidad** (Prioridad: 8)
    *   Implementación de etiquetas semánticas (`accessibilityLabel`, `accessibilityRole`, `accessibilityHint`).

*   [x] **R9 — Exploración Geoespacial Interactiva** (Prioridad: 9) — **ESTADO: COMPLETADO**
    *   Habilitación de controles interactivos en mapas de detalle.
    *   Integración mediante Deep Linking para navegación en aplicaciones externas (Google Maps).

*   [ ] **R10 — Validación de integridad de datos (LoginScreen)** (Prioridad: 10)
    *   Validaciones por expresiones regulares preventivas.

### Tabla de Prioridades UI/UX Actualizada

| Modificación Solicitada | Impacto Esperado | Esfuerzo Estimado | Prioridad | Estado Actual |
|-------------------------|------------------|-------------------|-----------|---------------|
| R1 — Deshabilitar botones durante peticiones | Alto | 1-2 horas | 1 | Completado |
| R2 — Mensajes de error amigables | Alto | 2-3 horas | 2 | Completado |
| R3 — Componente ButtonPrimary | Medio | 1-2 horas | 3 | Completado |
| R4 — Sistema de Feedback (Toast) | Medio | 2-3 horas | 4 | Completado |
| R5 — AuthContext Global (`isLoading`) | Medio | 4-6 horas | 5 | Completado |
| R9 — Mapa interactivo / Navegación | Bajo | 1-2 horas | 9 | Completado |
| R6 — Barra de progreso en flujos | Bajo | 1-2 horas | 6 | Pendiente |
| R7 — Modularización ScanScreen | Mejora de Mantenibilidad | 6-8 horas | 7 | Pendiente |
| R8 — Estándares de Accesibilidad | Alto | 4-6 horas | 8 | Pendiente |
| R10 — Validación de campos (Email) | Bajo | 0.5-1 horas | 10 | Pendiente |

---

## 4. ROADMAP DE IMPLEMENTACIÓN Y CRONOGRAMA

### Cronograma de Ejecución Recomendado

**SEMANA 1-2 (Fase Actual)**
*   [Completado] Ajustes de umbrales y filtrado en modelo ML.
*   [Completado] Refactorización de flujo arquitectónico (ML-MinIO) y comprobaciones de estado.
*   [Completado] Optimizaciones rápidas de Interfaces (Botones, manejo de errores, componentes estandarizados).
*   [Completado] Implementación de contexto de autenticación global y seguro.

**SEMANA 3-4**
*   [Pendiente] Recolección de 500 fotografías locales representativas (Quito).
*   [Pendiente] Anotación exhaustiva del dataset geolocalizado.
*   [Pendiente] Desacoplamiento y refactorización del componente ScanScreen.
*   [Pendiente] Mejoras de experiencia de usuario adicionales (Validaciones y progreso).

**SEMANA 5-8**
*   [Pendiente] Ciclo de reentrenamiento del modelo base (100 épocas).
*   [Pendiente] Aplicación de técnicas de Transfer Learning y Fine-Tuning.
*   [Pendiente] Auditoría e implementación de accesibilidad total en UI.

**SEMANA 9+**
*   [Pendiente] Desarrollo e integración del servicio asíncrono de notificaciones.
*   [Pendiente] Fases de prueba integral y despliegue continuo.

### Métricas Clave de Desempeño (KPIs)

| Métrica a Evaluar | Estado Base | Objetivo Definido | Fecha Límite |
|-------------------|-------------|-------------------|--------------|
| **Precisión mAP@50** | 0.4752 | Mayor a 0.75 | Finalización Semana 8 |
| **Tasa de Recall** | 0.4353 | Mayor a 0.75 | Finalización Semana 8 |
| **Consistencia Visual (UI)** | 60% | 100% | Finalización Semana 4 |
| **Manejo de Errores** | Técnico | Legible y Accionable | Completado |
| **Cumplimiento Accesibilidad**| 0% | 80% mínimo | Finalización Semana 8 |
| **Entrega de Notificaciones** | Inexistente | 100% de confiabilidad | Finalización Semana 10 |

---

**Última actualización:** 2026-04-30  
**Próxima revisión programada:** 2026-05-07