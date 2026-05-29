Z# Correcciones y añadidos pendientes para el PDF de tesis

> Documento generado a partir de la comparación entre **`MIC_EMASEO_ESCRITURA_V3 (1).pdf`** (estado de la tesis) y la implementación real del repositorio tras el despliegue en producción.
>
> Última actualización: 2026-05-28

---

## Resumen ejecutivo

| Prioridad | Sección de la tesis | Tipo de cambio | Esfuerzo estimado |
|---|---|---|---|
| 🔴 ALTA | 3.1.8.3 / 3.1.8.4 — Volumen estimado | Reescribir (es **incorrecto** técnicamente) | 1–2 h |
| 🔴 ALTA | 4.3 / 4.4 — Schema `auth` | Buscar/reemplazar `auth.*` → `app_auth.*` | 30 min |
| 🔴 ALTA | 4.4 — ENUM `incidents.incident_status` | Añadir 4 estados nuevos | 30 min |
| 🔴 ALTA | Nueva sección — Despliegue en producción cloud | Capítulo o sección nueva | 4–6 h |
| 🟡 MEDIA | 4.6.9 — Pipeline de inferencia | Documentar las 4 decisiones IA | 1 h |
| 🟡 MEDIA | Tabla 12 — Entidades de la DB | Añadir tablas/columnas faltantes (032/033) | 1 h |
| 🟡 MEDIA | 4.5 — Flujo del supervisor | Reemplazar por wizard 3 pasos | 1 h |
| 🟡 MEDIA | 4.8 — App móvil | Añadir cancelación, recorte, pre-check | 1 h |
| 🟢 BAJA | 2.1.3 — Cantidad de microservicios | Corregir conteo | 5 min |
| 🟢 BAJA | Apéndices A/B/C/D | Llenar | 2–3 h |
| 🟢 BAJA | Referencias | Añadir 4 fuentes técnicas | 30 min |

**Total estimado:** 12–18 horas de trabajo sobre el PDF.

---

## 🔴 1. ERRORES TÉCNICOS QUE FALSEAN LO IMPLEMENTADO

### 1.1 Sección 3.1.8.3 y 3.1.8.4 (págs. 39-40) — Estimación de volumen

**Lo que dice la tesis (incorrecto):**

> "Volumen estimado ∝ Área × d"
>
> "Volumen = π × (d/2)² × h"

Implica una **fórmula geométrica explícita** (cilindro, área × profundidad). Esto no es lo que el sistema hace.

**Lo que realmente hace el código** (`Backend/ml-service/tasks.py`):

1. **No calcula volumen con geometría.** Calcula un score adimensional `effective_ratio ∈ [0, 1]`.
2. El `effective_ratio` se obtiene multiplicando 4 factores heurísticos:
   - `coverage_ratio = Σ (área_bboxᵢ / área_imagen)`
   - `conf_factor = min(1.0, conf_media / 0.60)`
   - `det_factor = min(1.0, 0.40 + 0.20 × n_detecciones)`
   - `class_weight ∈ {PELIGROSO ×1.30, ESCOMBROS ×1.10, …, RECICLABLE ×0.85}`
   - Penalización adicional: `ISOLATION_PENALTY = 0.65` si una sola bbox cubre más del 55% del frame (evita que un primer plano se clasifique como acumulación CRÍTICA).
3. Luego **mapea** el `effective_ratio` a un **rango de volumen** por banda:

| `effective_ratio` | Nivel | Rango de volumen estimado |
|---|---|---|
| 0.00 – 0.15 | BAJO | 0.1 – 0.5 m³ |
| 0.15 – 0.40 | MEDIO | 0.5 – 2.0 m³ |
| 0.40 – 0.70 | ALTO | 2.0 – 5.0 m³ |
| 0.70 – 1.00 | CRÍTICO | 5.0 – 15.0 m³ |

**Acción:** Reescribir 3.1.8.3 y 3.1.8.4. La nueva redacción debe:

- Eliminar las fórmulas `π·r²·h` y `área × d` (que sugieren precisión geométrica que el sistema no tiene).
- Aclarar que el "volumen estimado" es una **proxy operativa para priorización**, no una medición física. Su utilidad es ordenar incidencias por urgencia, no estimar tonelaje real.
- Describir la fórmula real del `effective_ratio` con sus 4 factores y la lógica de `ISOLATION_PENALTY`.
- Mostrar la tabla de bandas → rango de volumen.
- Justificar la elección heurística: requeriría una cámara estereoscópica o un modelo de profundidad monocular adicional para calcular volumen real desde una foto 2D, lo cual está fuera del alcance del prototipo.

---

### 1.2 Sección 4.6.9 (págs. 64-66) — Pipeline de inferencia

**Lo que dice la tesis:** menciona que el endpoint devuelve `has_waste: true/false`.

**Lo que hace el sistema real (tras migración 032):** el ML emite uno de **cuatro veredictos estructurados** en el campo `decision_automatica`:

| `decision_automatica` | Cuándo | Estado del incidente | Imagen |
|---|---|---|---|
| `INCIDENTE_VALIDO` | Detecciones con buena confianza | `PENDIENTE` | Guardada en R2 |
| `REVISION_REQUERIDA` | Detecciones ambiguas, confianza media | `EN_REVISION` | Guardada en R2 (`imagen_auditoria_url`) |
| `RECHAZO_CONFIABLE` | Sin detecciones, ML confiado | `DESCARTADO` | **Guardada** (preservada para auditoría) |
| `ERROR_TECNICO` | Fallo de inferencia (timeout, modelo caído) | `FALLIDO` | Guardada si ya estaba en S3 |

**Diferencia clave con el diseño anterior:** ya NO se elimina la imagen al rechazar. Toda imagen se preserva en R2 para que el supervisor pueda revisarla y, si la IA se equivocó, anular el rechazo automático.

**Acción:** Añadir una subsección "Pipeline de decisión en 4 vías" dentro de 4.6.9 (o como 4.6.10 nueva) con esa tabla y un párrafo explicando por qué resuelve el problema de auditoría que mencionaba la migración 032.

---

### 1.3 Sección 4.3 (págs. 44-46) — Arquitectura

La tesis describe la **arquitectura de desarrollo local con Docker Compose** como si fuera la arquitectura final. **No menciona** en absoluto:

- **Supabase** (PostgreSQL managed, São Paulo)
- **Cloudflare R2** (en lugar de MinIO)
- **DuckDNS + Caddy + Let's Encrypt** (TLS automático)
- **Cloudflare Pages** (deploy del panel web)
- **EAS Build** (compilación del APK Android)
- **Contabo VPS** (hosting del backend)

**Acción:** Añadir una sección **4.X — Arquitectura de despliegue en producción** después de 4.3, con:

- Diagrama propio de la arquitectura cloud (puede adaptarse el de la sección 11 del README).
- Tabla comparativa "dev local vs producción" mostrando qué cambia entre los dos entornos.
- Costo mensual operativo: **~$5.40 USD** (solo Contabo VPS 10). Esto es un dato muy fuerte para la viabilidad institucional — EMASEO podría adoptar el sistema sin presupuesto significativo de infraestructura.
- Decisiones técnicas no triviales:
  - **Rename `auth` → `app_auth`** para coexistir con Supabase Auth.
  - **Conexión directa por IPv6 al puerto 5432** en lugar del pooler (porque Supavisor no conoce roles personalizados).
  - **Docker IPv6 habilitado** para que los contenedores enruten al host IPv6 de Supabase.
  - **`search_path` por rol** para acceder a `crypt()` y `gen_salt()` en el schema `extensions`.

---

### 1.4 Sección 4.4 (págs. 46-49) — Schema de base de datos

La tesis usa `auth.users`, `auth.refresh_tokens`, etc. **En la implementación final el schema se llama `app_auth`** debido al rename obligatorio para coexistir con Supabase Auth (commit `159d45b`).

**Acción:** Buscar y reemplazar globalmente en todo el PDF:

| Buscar | Reemplazar |
|---|---|
| `auth.users` | `app_auth.users` |
| `auth.refresh_tokens` | `app_auth.refresh_tokens` |
| `auth.password_reset_tokens` | `app_auth.password_reset_tokens` |
| `auth.pending_registrations` | `app_auth.pending_registrations` |
| `auth.device_tokens` | `app_auth.device_tokens` |
| `auth.user_consents` | `app_auth.user_consents` |
| "schema `auth`" | "schema `app_auth`" |
| `auth.user_role` | `app_auth.user_role` |
| `auth.user_status` | `app_auth.user_status` |

Y añadir un párrafo explicativo en la sección 4.4:

> *El schema fue denominado originalmente `auth` durante el desarrollo. Al desplegar en Supabase se renombró a `app_auth` para evitar colisión con el schema reservado por Supabase Auth (gotrue), que define sus propias tablas `auth.users`, `auth.refresh_tokens`, `auth.sessions`, etc. Aunque el sistema no utiliza Supabase Auth (se desactivó la Data API al crear el proyecto), el schema `auth` existe por defecto en cualquier proyecto Supabase y dropearlo causaría comportamientos impredecibles en el dashboard. La base de datos local de desarrollo también fue renombrada para mantener consistencia con el código del backend (9 archivos actualizados con `sed`).*

---

### 1.5 Tabla 12 — Entidades de la DB (pág. 47)

**Tablas que faltan documentar:**

| Tabla | Migración | Descripción |
|---|---|---|
| `app_auth.user_consents` | 023 | Registro LOPDP por usuario y versión de política (`version_politica`, `aceptada_at`, `ip_origen`, `user_agent`, `revocada_at`). UNIQUE `(user_id, version_politica)`. |
| `ai.analysis_feedback` | 030 | Feedback binario de operarios (`es_correcta`, `comentario`, `reportado_por`). Base para detección de drift. UNIQUE `(analysis_result_id, reportado_por)`. |
| `audit.audit_log` (+ particiones `audit_log_YYYY_MM`) | 017 | Trazabilidad de INSERT/UPDATE/DELETE en tablas críticas. SECURITY DEFINER. |

**Columnas nuevas en `incidents.incidents`** (migraciones 028/029/032):

| Columna | Tipo | Origen | Para qué |
|---|---|---|---|
| `ubicacion_aproximada` | `boolean` | 028 | TRUE cuando GPS no estaba disponible al reportar; bloquea asignación automática de zona. |
| `celery_task_id` | `varchar(255)` | 029 | Permite al recovery job retomar tareas Celery huérfanas. |
| `pending_s3_key` | `varchar(500)` | (área 034) | Clave S3 de imagen subida antes de completar análisis; evita re-upload en reintentos. |
| `decision_automatica` | `varchar(30)` con CHECK | 032 | Veredicto estructurado del ML (4 valores). |
| `confianza_decision` | `numeric(4,3)` | 032 | Confianza del modelo en la decisión tomada. |
| `imagen_auditoria_url` | `varchar(500)` | 032 | URL S3 de imagen conservada para auditoría en estados FALLIDO/DESCARTADO/EN_REVISION. |

**Columnas nuevas en `ai.analysis_results`** (migración 033):

| Columna | Tipo | Significado |
|---|---|---|
| `nivel_acumulacion_supervisor` | `ai.accumulation_level` | Nivel real según el supervisor (NULL si IA estaba bien). |
| `tipo_residuo_supervisor` | `ai.waste_type` | Tipo real (NULL si IA estaba bien). |
| `ia_fue_correcta` | `boolean` | `TRUE` si supervisor avala IA, `FALSE` si la corrige, `NULL` si sin revisar. |
| `nota_supervision` | `text` | Comentario libre del supervisor. |
| `supervisado_por` | `uuid` | FK a `app_auth.users`. |
| `supervisado_at` | `timestamptz` | Cuándo se firmó la revisión. |

**Principio de diseño:** estas columnas son **aditivas**. El valor original de la IA (`nivel_acumulacion`, `tipo_residuo`) **nunca se sobrescribe**. Esto preserva el dataset para auditoría de drift y reentrenamiento del modelo.

---

### 1.6 ENUM `incidents.incident_status` — Sección 4.4

La tesis lista **4 estados:** `PENDIENTE | EN_ATENCION | RESUELTA | RECHAZADA`.

**El ENUM real tiene 8** tras las migraciones 010 y 032:

```sql
incidents.incident_status:
    PENDIENTE     -- incidente válido, esperando asignación
    EN_ATENCION   -- asignado a un operario, en proceso de recolección
    RESUELTA      -- recolección completada
    RECHAZADA     -- el supervisor descartó manualmente el reporte
    PROCESANDO    -- (010) imagen recibida, ML está analizando
    FALLIDO       -- (010) error técnico en el procesamiento (ML caído, S3 falla)
    EN_REVISION   -- (032) ML emitió REVISION_REQUERIDA, espera supervisor
    DESCARTADO    -- (032) ML emitió RECHAZO_CONFIABLE, imagen preservada
```

**Acción:** actualizar la tabla del ENUM en 4.4 y añadir un párrafo explicando la máquina de estados completa:

```
PROCESANDO ──INCIDENTE_VALIDO──► PENDIENTE ──asignar──► EN_ATENCION ──completar──► RESUELTA
           ──REVISION_REQUERIDA─► EN_REVISION ──supervisor─► PENDIENTE | RECHAZADA
           ──RECHAZO_CONFIABLE──► DESCARTADO ──supervisor─► PENDIENTE (anular rechazo)
           ──ERROR_TECNICO─────► FALLIDO
```

---

## 🟡 2. SECCIONES QUE EXISTEN PERO LES FALTA PROFUNDIDAD

### 2.1 Sección 4.5 — Flujos de procesamiento (págs. 50-52)

**Falta el flujo del wizard de 3 pasos** del panel del supervisor. La tesis solo describe genéricamente.

**Acción:** Reemplazar la Figura 5 actual por un diagrama del wizard:

```
Bandeja → click en card de incidente
   ↓
Step1Validate.tsx
   "¿Es un reporte real?"
   ├─ ❌ Descartar (motivo obligatorio) → estado RECHAZADA (fin del flujo)
   └─ ✅ Es real → siguiente paso
                          ↓
                    Step2Classify.tsx
                       ReviewCard:
                          ☐ Confirmo decisión IA  (es_correcta_ia = TRUE)
                          ☐ Corregir nivel:     [BAJO/MEDIO/ALTO/CRITICO]
                          ☐ Corregir tipo:      [ORGANICO/RECICLABLE/...]
                          ☐ Nota de auditoría:  [texto libre]
                       → PUT /supervisor/incidents/:id/revision-ia
                                  ↓
                            Step3Assign.tsx
                               Select de operario + notas + fecha esperada
                               → POST /supervisor/incidents/:id/asignar
                               → estado EN_ATENCION
```

**Reglas a documentar:**

- No se puede saltar al paso 3 sin completar el paso 2.
- Si el incidente entra en estado `EN_REVISION` (por decisión `REVISION_REQUERIDA` del ML), el wizard arranca en paso 1.
- Si el incidente está en `DESCARTADO` y el supervisor lo abre, el paso 1 pre-marca "Descartar" y solo pide confirmación.
- El wizard retoma en el paso correspondiente según el estado actual del incidente.

### 2.2 Sección 4.6 — Diseño del módulo ML

**Falta documentar:**

1. **Endpoint `/ml/pre-check`** — Recibe un thumbnail (~15 KB, 320 px de ancho) y devuelve `{ garbage_score, is_garbage, threshold }`. Sirve para validar rápidamente desde el móvil **antes** de subir la imagen completa. Es **fail-closed**: si el pre-check falla por red o timeout, **no asume optimismo** (devuelve error y el cliente decide).

2. **Circuit Breaker (opossum)** sobre la llamada image → ML:
   - Timeout: 110 s (alineado con cold-start de PyTorch).
   - Umbral: 50% de errores en ventana de 60 s → abre el circuito.
   - Cuando abierto, el image-service responde con error inmediato sin colgar la petición.

3. **Recovery job de Celery** cada 30 s:
   - Revisa incidentes en estado `PROCESANDO` por más de 3 minutos.
   - Reintenta la tarea Celery usando `celery_task_id` o relanza una nueva con `pending_s3_key`.

### 2.3 Sección 4.6.6 — Fases de entrenamiento

Las 3 fases están descritas. **Falta justificar las 501 fotografías negativas de Quito** como decisión metodológica clave: imágenes de calles limpias del contexto geográfico real para reducir falsos positivos cuando el sistema se despliegue en Quito.

La matriz de confusión en la sección 5 (Figura 10 y 11) demuestra que esta decisión funcionó: **0 falsos positivos** sobre background (especificidad = 100%). Este dato es muy fuerte y debería destacarse.

### 2.4 Sección 4.8 (app móvil) — Cola offline + cancelación

Describe la cola offline pero **faltan features importantes**:

1. **Cancelación con polling en segundo plano:**
   - El usuario puede cancelar la espera del análisis en `ScanScreen`.
   - El `task_id` queda guardado en `AsyncStorage` bajo la clave `PROCESSING_TASKS_KEY`.
   - `HistorialScreen` detecta incidentes en `PROCESANDO` y activa auto-polling cada 5 s.
   - El resultado aparece automáticamente cuando el ML termina.

2. **Recorte real al recuadro de overlay** con `expo-image-manipulator`:
   - El componente `ScanOverlay.tsx` muestra un recuadro guía.
   - `cropToScanFrame.ts` es la **fuente única** de constantes (mismas medidas que el overlay).
   - El recorte se ejecuta en paralelo con la captura de GPS (`Promise.all`).
   - Esto reduce el tamaño de la imagen subida y mejora la calidad del análisis (menos contexto irrelevante).

3. **Backoff exponencial al subir** — la cola FIFO reintenta con 1s, 2s, 4s, 8s, 16s para no saturar el gateway en redes inestables.

### 2.5 Sección 5.4 — Validación práctica

**Datos relevantes que se pueden añadir** desde la matriz de confusión (sección 5.4.2, Figuras 10-11):

- **0 falsos positivos** sobre 5,989 imágenes de background (especificidad = 100%).
- **6,798 verdaderos positivos** / 7,364 imágenes con basura = **92.3% de precisión real**.
- **566 falsos negativos** = el modelo "se pierde" el 7.7% de las acumulaciones.

Este último dato es importante porque el sistema lo compensa con el flujo de revisión humana: lo que el ML reporta como `REVISION_REQUERIDA` cae en `EN_REVISION` y el supervisor decide.

---

## 🔴 3. SECCIONES QUE FALTAN POR COMPLETO

### 3.1 Capítulo / sección nueva — Despliegue del prototipo

**No existe en absoluto** en la tesis. Es el aporte más fuerte para demostrar viabilidad institucional.

**Estructura sugerida:**

```
4.11 Despliegue del prototipo en producción

4.11.1 Stack cloud elegido y costo mensual
   - Tabla con los 6 servicios cloud y su costo
   - Total: ~$5.40 USD/mes (justifica viabilidad para EMASEO)

4.11.2 Configuración de Supabase
   - Región sa-east-1 (latencia óptima a Ecuador)
   - Desactivación de Data API y RLS automático
   - Aplicación de las 28 migraciones + script de roles

4.11.3 Schema rename app_auth y justificación
   - Colisión con Supabase Auth (gotrue)
   - sed sobre 9 archivos del backend
   - Sincronización con la DB local de desarrollo

4.11.4 Conexión IPv6 directa vs pooler
   - Por qué el pooler (Supavisor) falla con roles custom
   - Habilitación de Docker IPv6 (daemon.json + enable_ipv6 en compose)
   - search_path por rol para acceso a extensions.crypt()

4.11.5 Cloudflare R2 como object storage
   - Bucket emaseo-incidents
   - Public Development URL para servir imágenes al panel
   - Account API Token con scope mínimo

4.11.6 VPS Contabo + Caddy + DuckDNS
   - Configuración del Caddyfile (reverse proxy + Let's Encrypt automático)
   - Cron DuckDNS para mantener IP actualizada
   - UFW + puertos 22/80/443

4.11.7 Cloudflare Pages para el panel
   - Build estático (Vite) + variable VITE_API_URL
   - Deploy vía Wrangler (porque el repo está bajo otra cuenta de GitHub)

4.11.8 EAS Build para el APK móvil
   - Cuenta gratuita de Expo
   - Resolución del problema de monorepo (.easignore + copia aislada)
   - Tarball reducido de 8.6 GB a 1.4 MB

4.11.9 Pipeline end-to-end verificado
   - Login: panel → Caddy → Gateway → auth-service → Supabase → JWT
   - Reporte: app → Caddy → Gateway → image-service → ML → R2 + Supabase
```

### 3.2 Sección — Roles de mínimo privilegio en producción

La tesis menciona vagamente "RBAC" pero **no documenta**:

- **3 roles de DB distintos** (`auth_svc`, `users_svc`, `image_svc`) además de los 4 roles de aplicación.
- **GRANTs concretos** de cada rol (ver migración `012_db_users_isolation.sql`).
- **La app conecta a la DB con un usuario distinto según el microservicio**, no con un superusuario único.
- **`search_path` configurado por rol** para acceder a las extensiones de Supabase sin calificar.

**Acción:** Añadir una sección 4.X después del RBAC de aplicación, titulada "Roles de mínimo privilegio en la base de datos", con la tabla:

| Rol DB | Permisos |
|---|---|
| `auth_svc` | RW en `app_auth.*`, SELECT en `public.ciudadanos`, SELECT en `operations.operarios` |
| `users_svc` | RW en `public.*`, RW en `operations.*`, SELECT/INSERT/UPDATE en `app_auth.users`, RW en `app_auth.pending_registrations` y `user_consents` |
| `image_svc` | RW en `incidents.*` y `ai.*`, INSERT en `notifications.notifications`, SELECT en `app_auth.users`, `public.ciudadanos`, `operations.zones`, `operations.operarios` |

### 3.3 Sección — Resultados de pruebas reales

La sección 5 dice "Pruebas con Locust" pero **no incluye resultados concretos**. Cuando ejecutes las pruebas reales (60 participantes en La Mariscal), añadir:

- Tabla de resultados Locust con percentiles **p50, p95, p99** reales para `/api/auth/login` y `/api/image/analyze`.
- Resultados SUS reales por tipo de usuario (35 ciudadanos, 15 operarios, 10 supervisores).
- Bugs encontrados durante las pruebas y cómo se resolvieron.
- Tiempo medio del flujo ciudadano (abrir app → incidencia registrada).
- Distribución de decisiones IA observada en producción (cuántos `INCIDENTE_VALIDO` vs `REVISION_REQUERIDA` vs `RECHAZO_CONFIABLE` vs `ERROR_TECNICO`).
- Acuerdo supervisor-IA (`ia_fue_correcta = true` vs `false`).
- Tasa de pre-check rechazado.

---

## 🟢 4. CORRECCIONES MENORES

### 4.1 Página de título (pág. 1)

Confirma que dice **"Ingeniería"** (no Maestría). En las versiones anteriores del README aparecía Maestría — ya corregido en el README v3.0.

### 4.2 Sección 2.1.3 — Cantidad de microservicios (págs. 23-24)

Dice "5 microservicios". El sistema real tiene:

- 5 microservicios de aplicación: api-gateway, auth-service, users-service, image-service, ml-service.
- 1 worker adicional: ml-worker (Celery).
- 3 servicios de infraestructura: PostgreSQL, MinIO/R2, Redis.
- 1 dashboard de monitoreo: Flower (Celery).

Total: **6 contenedores de aplicación + 3-4 de infraestructura**, dependiendo de si se incluye Flower.

### 4.3 Sección 4.4.1 — Roles RBAC

Lista 4 roles. **No menciona que `app_auth.users.estado`** tiene también un ENUM `app_auth.user_status` con `ACTIVO/INACTIVO/SUSPENDIDO` que se usa para deshabilitar usuarios sin borrarlos físicamente.

### 4.4 Tabla 1 — Análisis comparativo (pág. 23)

Las "limitaciones" de cada sistema externo están bien para justificar el aporte, pero **falta una fila final** con el sistema propuesto:

| Sistema | Año | Objetivo | Tecnologías | Geo | ML | Tipo | Aportes | Limitaciones |
|---|---|---|---|---|---|---|---|---|
| **MIC EMASEO (propuesto)** | 2026 | Reporte ciudadano + IA + asignación supervisor | RT-DETR-L v2, Node.js, PostGIS, Supabase, R2 | Sí | Sí | Web + Móvil + IA + Geo | 4 decisiones IA, revisión supervisada con corrección estructurada, despliegue cloud a $5/mes | Validado solo en sector controlado de La Mariscal; sin optimización de rutas (Fase 2) |

### 4.5 Sección 4.6.2 — Modelo en producción (pág. 58)

Datos adicionales a incluir:

- **Consumo de RAM real en producción** (medido con `docker stats` en el VPS Contabo):
  - `emaseo-ml-api`: ~351 MB
  - `ml-worker`: ~383 MB
  - Total stack completo: ~1.2 GB / 7.8 GB disponibles
- **Latencia de inferencia real en el VPS**: ~52 ms por imagen (medido tras cold-start).
- **Cold-start de PyTorch**: 30-90 s en la primera inferencia tras levantar el worker. Por eso el Circuit Breaker tiene timeout de 110 s.

---

## 5. Apéndices propuestos

Los apéndices A y B existen como placeholder pero están vacíos. Añadir:

### Apéndice A — Cuestionario SUS completo
Replicar la Tabla 2 del Cap. II con instrucciones de aplicación y fórmula de cálculo.

### Apéndice B — Listado completo de endpoints API
Generar desde el Swagger UI (`http://localhost:4000/api-docs` o `https://micemaseo.duckdns.org/api-docs` si se expone). Agrupar por servicio:
- Auth (login, register, refresh, forgot-password, reset-password, OTP)
- Users (CRUD perfiles, supervisor staff, operarios)
- Incidents (crear reporte, status polling, listado supervisor con filtros)
- ML (predict, pre-check, status)

### Apéndice C — Configuración de despliegue
Incluir tal cual:
- `Caddyfile` final con dominio
- `eas.json` con los 3 perfiles (development, preview, production)
- `/etc/docker/daemon.json` con IPv6 habilitado
- Script de cron de DuckDNS
- Comandos exactos de `wrangler` para Cloudflare Pages

### Apéndice D — Diagrama ER completo de la base de datos
Generar con `pg_dump --schema-only` + `pg_dump --schema-only --no-owner` exportado a `dbdiagram.io` o `dbml`. Mostrar las 7 schemas y las relaciones FK.

---

## 6. Referencias técnicas faltantes

Añadir a la sección de Referencias:

```
[63] Supabase. (2024). Connecting with PostgreSQL.
     https://supabase.com/docs/guides/database/connecting-to-postgres

[64] Cloudflare. (2024). R2 — S3-compatible object storage.
     https://developers.cloudflare.com/r2/

[65] Caddy Server. (2024). Automatic HTTPS.
     https://caddyserver.com/docs/automatic-https

[66] Proença, P. F., & Simões, P. (2020). TACO: Trash Annotations in Context for
     Litter Detection. arXiv preprint arXiv:2003.06975.
     https://arxiv.org/abs/2003.06975

[67] Expo. (2024). EAS Build documentation.
     https://docs.expo.dev/build/introduction/

[68] DuckDB Labs / DuckDNS. (2024). Free dynamic DNS service.
     https://www.duckdns.org/

[69] Zhao, Y., Lv, W., Xu, S., Wei, J., Wang, G., Dang, Q., Liu, Y., & Chen, J.
     (2024). DETRs Beat YOLOs on Real-time Object Detection.
     In CVPR 2024. https://arxiv.org/abs/2304.08069
```

(La última ya está como referencia [57], verificar que esté completa.)

---

## 7. Checklist final antes de defender la tesis

- [ ] **Buscar/reemplazar `auth.*` → `app_auth.*`** en todo el PDF (especialmente en código de ejemplo, diagramas y tabla 12).
- [ ] **Reescribir 3.1.8.3 y 3.1.8.4** (volumen estimado) — quitar fórmulas geométricas falsas.
- [ ] **Actualizar ENUM `incident_status`** a 8 estados.
- [ ] **Añadir las 4 decisiones IA** (`INCIDENTE_VALIDO`, `REVISION_REQUERIDA`, `RECHAZO_CONFIABLE`, `ERROR_TECNICO`) en la sección 4.6.
- [ ] **Crear sección 4.11 — Despliegue en producción** (la más importante).
- [ ] **Documentar el wizard de 3 pasos** del panel del supervisor.
- [ ] **Documentar los 3 roles de DB** (`auth_svc`, `users_svc`, `image_svc`).
- [ ] **Añadir columnas/tablas de migraciones 023, 028, 029, 030, 032, 033** a la tabla 12.
- [ ] **Ejecutar pruebas reales** y llenar las métricas concretas (Locust + SUS).
- [ ] **Llenar apéndices A/B/C/D**.
- [ ] **Añadir referencias técnicas** [63]–[69].
- [ ] **Verificar la consistencia** entre el README v3.0 del repo y la tesis (que no se contradigan).
- [ ] **Capturas de pantalla del sistema en producción** (URL https://mic-emaseo-panel.pages.dev y el APK funcionando en un Android real) — son evidencia muy fuerte para el tribunal.

---

**Última nota:** el README del repo (`README.md` v3.0) refleja la implementación real al día de hoy. Úsalo como fuente de verdad cuando haya dudas entre lo que dice la tesis y lo que hace el sistema.
