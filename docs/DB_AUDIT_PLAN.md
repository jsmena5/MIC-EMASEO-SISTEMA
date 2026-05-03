# Auditoría de Base de Datos y Plan de Remediación

**Proyecto:** MIC-EMASEO Sistema de Reporte de Acumulación de Residuos
**Alcance:** PostgreSQL 15 + PostGIS — schemas `auth`, `public`, `operations`, `incidents`, `ai`, `notifications`
**Fecha del informe:** 2026-05-03
**Contexto operativo:** DMQ Quito, ~10–20k peticiones/día previstas, despliegue objetivo GCP GKE Autopilot
**SLA contractual aprobado:** 99,5 % disponibilidad · RPO 15 min · RTO 1 h

---

## 1. Resumen ejecutivo

| Categoría | Hallazgos | Severidad máxima |
|-----------|-----------|------------------|
| Bugs críticos (rompen el sistema) | 5 | 🔴 P0 |
| Diseño / estructura | 9 | 🟠 P1 |
| Rendimiento / índices faltantes | 5 | 🟡 P2 |
| Constraints / integridad | 5 | 🟡 P2 |
| Cumplimiento LOPDP | 5 | 🟠 P1 |
| Tooling / operación | 4 | 🟡 P2 |

**Veredicto:** el modelo conceptual es sólido (separación de schemas, identidad vs perfil, trazabilidad por triggers). Pero hay inconsistencias entre archivos de migración y `docker-compose.yml` que dejan instalaciones nuevas en estado roto. Hay que arreglarlas antes de tocar observabilidad — sino estaríamos midiendo un sistema que no se puede reinstalar.

---

## 2. Hallazgos detallados

### 2.1 🔴 Bugs críticos (P0, bloquean producción)

#### A1. Migración `011` duplicada con definiciones contradictorias

Existen dos archivos con número 011:

- `011_consolidation.sql` → define `fn_log_status_change` como **`BEFORE UPDATE`**, setea `resuelto_at` y crea trigger `fn_notify_citizen`.
- `011_status_history_trigger.sql` → define el mismo trigger como **`AFTER UPDATE`**, sin `resuelto_at`, sin `fn_notify_citizen`.

Si alguien corre las migraciones manualmente en orden alfabético, `011_status_history_trigger.sql` se ejecuta DESPUÉS y sobrescribe la versión correcta. Resultado: `resuelto_at` deja de auto-poblarse y las notificaciones al ciudadano dejan de generarse.

**Fix:** eliminar `011_status_history_trigger.sql` (la versión antigua) o moverla a `_archive/`.

#### A2. Migración del enum duplicada (`03_polling_estados.sql` vs `010_incident_status_async.sql`)

Ambas hacen `ALTER TYPE incident_status ADD VALUE 'PROCESANDO'` y `'FALLIDO'`. Solo difieren en el orden:

- `03_polling_estados.sql` → `BEFORE 'PENDIENTE'` y `AFTER 'RECHAZADA'`
- `010_incident_status_async.sql` → sin posición → al final

`IF NOT EXISTS` evita el error pero el resultado del orden depende de cuál corra primero — afecta queries que dependen del orden enum (`MIN()`, `ORDER BY estado`).

**Fix:** borrar `03_polling_estados.sql` (no está mounted ni referenciado), dejar solo `010`.

#### A3. `docker-compose.yml` no monta migraciones críticas → instalación fresca rota

`docker-compose.yml` solo monta:

```yaml
01_init_schema.sql
02_seed_data.sql
011_consolidation.sql        → 03_consolidation.sql
012_db_users_isolation.sql   → 04_db_users_isolation.sql
```

No están mounted:

- `008_refresh_tokens.sql` → tabla `auth.refresh_tokens` no existe
- `009_password_reset_tokens.sql` → tabla `auth.password_reset_tokens` no existe
- `010_incident_status_async.sql` → enum no tiene `PROCESANDO` ni `FALLIDO`

**Consecuencia:** al hacer `docker compose down -v && up`, el sistema arranca pero:

- Login no puede emitir refresh tokens → 500
- Forgot password → 500 (tabla no existe)
- Análisis de imagen → falla al transicionar a `PROCESANDO` (valor no en enum)
- 012 falla porque `auth.refresh_tokens` no existe (tampoco la grant la cubre, pero queda fuera del minimum-privilege)

#### A4. Migración `012` referencia objetos inexistentes → falla al ejecutar

```sql
-- Falla: tabla nunca creada
GRANT SELECT, INSERT, UPDATE, DELETE ON auth.email_verification_tokens TO users_svc;

-- Falla: auth.users usa UUID, no SERIAL → no existe esa secuencia
GRANT USAGE, SELECT ON SEQUENCE auth.users_id_seq TO users_svc;

-- Falla: notifications.notifications también usa UUID
GRANT USAGE, SELECT ON SEQUENCE notifications.notifications_id_seq TO image_svc;
```

PostgreSQL falla con `relation does not exist`. La migración aborta y el aislamiento de usuarios no se aplica.

**Fix:** eliminar esas líneas. Las tablas con UUID no necesitan secuencia.

#### A5. Estado inicial del incidente nunca se registra en `status_history`

Cuando se crea un incidente con `estado = 'PROCESANDO'`, el trigger `fn_log_status_change` se dispara en UPDATE, no en INSERT → la primera transición (NULL → PROCESANDO) se pierde. Las consultas de auditoría muestran "el incidente apareció en PENDIENTE de la nada".

**Fix:** agregar trigger `AFTER INSERT` que escriba la fila inicial.

---

### 2.2 🟠 Diseño y estructura (P1)

#### B1. Sin tabla `device_tokens` para FCM/APNs

El schema tiene `notifications.channel_type = 'PUSH'` pero no hay donde guardar los tokens FCM del dispositivo del ciudadano. Imposible enviar push notifications sin esto.

**Fix:**

```sql
CREATE TABLE auth.device_tokens (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  token        TEXT NOT NULL UNIQUE,
  platform     VARCHAR(10) NOT NULL CHECK (platform IN ('ios', 'android', 'web')),
  app_version  VARCHAR(20),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_device_tokens_user ON auth.device_tokens(user_id);
```

#### B2. Sin tabla central de auditoría (LOPDP exige rastreo)

`status_history` solo audita una tabla. LOPDP Art. 39 exige registro de tratamientos. Necesitas un log central:

```sql
CREATE TABLE audit.audit_log (
  id          BIGSERIAL PRIMARY KEY,
  ocurrido_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actor_id    UUID,
  actor_ip    INET,
  accion      VARCHAR(50) NOT NULL,
  schema_name TEXT NOT NULL,
  table_name  TEXT NOT NULL,
  row_pk      TEXT,
  diff        JSONB
) PARTITION BY RANGE (ocurrido_at);
```

Trigger genérico aplicable a `auth.users`, `public.ciudadanos`, `operations.operarios`, `incidents.incidents`.

#### B3. `pending_registrations` está en schema `public` (debería estar en `auth`)

Es flujo de identidad (OTP, email, password preliminar). Conceptualmente pertenece al schema `auth`, junto con `refresh_tokens` y `password_reset_tokens`. Hoy mezcla concerns.

**Nota:** la migración `012` de hecho asume que está en `auth` (`GRANT ... ON auth.email_verification_tokens`) — confirma que el diseño original era moverla.

**Fix:** `ALTER TABLE public.pending_registrations SET SCHEMA auth;` + actualizar referencias en `users-service`.

#### B4. Sin estrategia de soft-delete / anonimización (LOPDP "derecho al olvido")

`auth.users` tiene `estado = 'INACTIVO'` pero no hay procedimiento para responder al derecho de supresión del Art. 17 LOPDP. Las FK son `ON DELETE RESTRICT` para `incidents.reportado_por` → no se puede borrar al usuario.

**Fix:** función `auth.fn_anonymize_user(p_user_id UUID)` que:

- Reemplaza `email`, `username`, `password_hash` por valores hash irreversibles
- Reemplaza `nombre`, `apellido`, `cedula`, `telefono` en `ciudadanos` por `'[ELIMINADO]'`
- Mantiene `incidents` para no romper estadísticas (los incidentes no son datos personales del ciudadano una vez anonimizado el reportante)
- Registra en `audit_log` con causa "ARCO-supresión"

#### B5. Sin partitioning preparado para escalabilidad

A 20k req/día de los cuales ~10 % son nuevos incidentes = ~700k filas/año. En 3 años, 2M+ filas en `incidents.incidents`. Las queries de dashboard supervisor (filtros por estado + fecha) serán lentas.

**Fix:** convertir `incidents.incidents` a tabla particionada por mes (RANGE en `created_at`). Hacerlo ahora con tabla vacía es trivial; hacerlo después con datos requiere migración compleja.

#### B6. `notifications.notifications` sin retry policy

Si una notificación PUSH falla (`estado = 'FALLIDA'`), no hay:

- Contador de intentos
- Timestamp del último intento
- Mensaje de error para diagnóstico
- Ventana de reintento (próximo intento a las X)

**Fix:** agregar `intentos INT DEFAULT 0`, `ultimo_intento_at TIMESTAMPTZ`, `error TEXT`, `proximo_intento_at TIMESTAMPTZ`.

#### B7. `incidents.descripcion` sin límite → DoS por payload

`TEXT` permite cualquier tamaño. Un cliente malicioso puede insertar 100MB.

**Fix:** `CHECK (char_length(descripcion) <= 2000)`.

#### B8. `fn_assign_zone` falla silenciosamente fuera de zonas conocidas

Si la ubicación GPS no cae dentro de ninguna zona, `zona_id` queda NULL sin alerta. El supervisor no se entera de incidentes huérfanos.

**Fix:** el trigger debe escribir en `nota_fallo` "Sin zona operativa cubre esta ubicación" o disparar `NOTIFY` para alertar al admin.

#### B9. Trigger `BEFORE` vs `AFTER` mezclados en la misma columna

`fn_log_status_change` es `BEFORE UPDATE OF estado` y `fn_notify_citizen` es `AFTER UPDATE OF estado`. PostgreSQL ejecuta alfabéticamente los triggers del mismo evento → orden es `trg_log_status_change` (BEFORE), luego UPDATE real, luego `trg_notify_citizen` (AFTER). Funciona pero no está documentado, y cambiar nombres romperá el orden.

**Fix:** nombrar con prefijo numérico explícito: `trg_10_log_status_change`, `trg_20_notify_citizen`.

---

### 2.3 🟡 Índices faltantes (P2)

| # | Tabla.columna | Query afectada | Severidad |
|---|---------------|----------------|-----------|
| C1 | `password_reset_tokens(otp_hash)` | Lookup en cada `verify-reset-otp` y `reset-password` → table scan | Alta |
| C2 | `password_reset_tokens(expires_at)` | Cleanup `WHERE expires_at < NOW()` → table scan | Media |
| C3 | `status_history(cambiado_por)` | "¿Quién cambió qué?" → seq scan al filtrar por usuario | Media |
| C4 | `assignments(asignado_por)` | "¿Qué asignaciones hizo este supervisor?" → seq scan | Media |
| C5 | `notifications(created_at DESC)` | Métricas globales / reports | Baja |

Migración correctora simple:

```sql
CREATE INDEX idx_prt_otp_hash    ON auth.password_reset_tokens(otp_hash);
CREATE INDEX idx_prt_expires_at  ON auth.password_reset_tokens(expires_at);
CREATE INDEX idx_sh_cambiado_por ON incidents.status_history(cambiado_por);
CREATE INDEX idx_asg_asignado    ON incidents.assignments(asignado_por);
CREATE INDEX idx_notif_created   ON notifications.notifications(created_at DESC);
```

---

### 2.4 🟡 Constraints faltantes (P2)

| # | Constraint | Justificación |
|---|------------|---------------|
| D1 | `ciudadanos.cedula` checksum módulo 10 ecuatoriano | Hoy acepta `1234567890`. Hay algoritmo oficial |
| D2 | `ciudadanos.telefono` formato | `^\+?593?[0-9]{9,10}$` o normalizar |
| D3 | `incidents.ubicacion` dentro de Ecuador | `CHECK (ST_Within(ubicacion, st_makeenvelope(-92.01,-5.02,-75.18,1.45,4326)))` |
| D4 | `analysis_results.tiempo_inferencia_ms > 0` | Hoy acepta negativos |
| D5 | `incidents.prioridad` NULL solo en estados internos | `CHECK (prioridad IS NOT NULL OR estado IN ('PROCESANDO','FALLIDO'))` |

Función para D1:

```sql
CREATE OR REPLACE FUNCTION public.fn_validar_cedula_ec(p_cedula TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
    v_coef    INT[] := ARRAY[2,1,2,1,2,1,2,1,2];
    v_suma    INT   := 0;
    v_d       INT;
    v_prod    INT;
    v_verif   INT;
BEGIN
    IF p_cedula !~ '^[0-9]{10}$' THEN RETURN FALSE; END IF;
    IF substring(p_cedula,1,2)::INT NOT BETWEEN 1 AND 24 THEN RETURN FALSE; END IF;
    FOR i IN 1..9 LOOP
        v_d    := substring(p_cedula, i, 1)::INT;
        v_prod := v_d * v_coef[i];
        IF v_prod >= 10 THEN v_prod := v_prod - 9; END IF;
        v_suma := v_suma + v_prod;
    END LOOP;
    v_verif := (10 - (v_suma % 10)) % 10;
    RETURN v_verif = substring(p_cedula, 10, 1)::INT;
END;
$$;

ALTER TABLE public.ciudadanos
  ADD CONSTRAINT chk_cedula_valida CHECK (public.fn_validar_cedula_ec(cedula));
```

---

### 2.5 🟠 Cumplimiento LOPDP (P1)

| # | Hallazgo | Acción |
|---|----------|--------|
| E1 | Sin política/consentimiento registrado por usuario | Tabla `auth.user_consents (user_id, version_politica, aceptada_at, ip)` |
| E2 | Sin endpoint ARCO en BD | Funciones `fn_export_user_data(user_id)` (devuelve JSON), `fn_anonymize_user(user_id)` |
| E3 | PII en logs y backups sin cifrar | Cifrado columna con `pgcrypto` para `cedula`, `telefono` (PG `encrypt()` con KMS key) |
| E4 | Sin retención definida | Política: `pending_registrations` 24h, `password_reset_tokens` 1h, `incidents` 7 años (lenguaje LOTAIP) |
| E5 | Sin Row-Level Security para `image_svc` viendo `auth.users` | Habilitar RLS y permitir solo SELECT de columnas no sensibles vía VIEW |

---

### 2.6 🟡 Tooling y operación (P2)

| # | Hallazgo | Solución |
|---|----------|----------|
| F1 | Sin tabla `schema_migrations` ni herramienta | Adoptar **node-pg-migrate** o **Flyway** |
| F2 | Carpeta `_archive/` borra historial sin commits versionados | Migraciones nunca se borran, solo se reemplazan con nuevas |
| F3 | Sin pruebas de restore | Cron mensual: `pg_restore` a una BD `_test` y `SELECT count(*)` de tablas críticas |
| F4 | Sin tooling de carga de seed (zonas reales DMQ) | Script `load_zones.js` que toma shapefile oficial → INSERT |

---

## 3. Plan de remediación en fases

> **Premisa:** cada fase deja la BD en estado consistente y deployable. No avanzamos a la siguiente sin validar la anterior.

### Fase DB-1 — Bugs críticos P0 (3–4 días)

**Objetivo:** que `docker compose down -v && up` produzca una BD íntegra y operativa.

| # | Acción | Archivo |
|---|--------|---------|
| 1.1 | Eliminar `011_status_history_trigger.sql` (versión antigua) | `_archive/` |
| 1.2 | Eliminar `03_polling_estados.sql` (duplicado de 010) | `_archive/` |
| 1.3 | Crear `013_fix_init_completeness.sql` que añade lo que faltaba (refresh_tokens + password_reset_tokens + enum PROCESANDO/FALLIDO) | nuevo |
| 1.4 | Corregir `012_db_users_isolation.sql` (quitar grants a tablas/sequences inexistentes) | edición |
| 1.5 | Re-ordenar `docker-compose.yml` para montar **toda** la cadena de migraciones | edición |
| 1.6 | Crear `014_initial_status_history.sql` (trigger AFTER INSERT que registra el estado inicial) | nuevo |
| 1.7 | Renombrar triggers con prefijo numérico para orden explícito | edición de 011 |
| 1.8 | Verificación: levantar contenedor limpio, correr suite mínima de smoke tests SQL | manual |

**Entregable:** `docker compose down -v && docker compose up -d` deja una BD 100 % funcional con todas las tablas, enums, triggers y usuarios de servicio aplicados sin errores.

### Fase DB-2 — Estructura y diseño P1 (1 semana)

| # | Acción |
|---|--------|
| 2.1 | Mover `pending_registrations` de `public` a `auth` (con migración + actualización de código users-service) |
| 2.2 | Crear `auth.device_tokens` para FCM |
| 2.3 | Crear schema `audit` con `audit.audit_log` particionado por mes + trigger genérico |
| 2.4 | Funciones `fn_export_user_data(uuid)` y `fn_anonymize_user(uuid)` para LOPDP |
| 2.5 | Refactor `notifications.notifications` (intentos, error, próximo_intento) |
| 2.6 | Mejorar `fn_assign_zone` (alertar incidentes huérfanos en `nota_fallo`) |
| 2.7 | Convertir `incidents.incidents` a tabla particionada por mes |

**Entregable:** schema listo para LOPDP y FCM, escalable a 5 años sin reescritura.

### Fase DB-3 — Constraints e índices P2 (2–3 días)

| # | Acción |
|---|--------|
| 3.1 | Migración `015_missing_indexes.sql` con los 5 índices faltantes (Sección 2.3) |
| 3.2 | Migración `016_data_validation.sql` con CHECK constraints (Sección 2.4) |
| 3.3 | Función `fn_validar_cedula_ec` + constraint en `ciudadanos.cedula` |
| 3.4 | `EXPLAIN ANALYZE` antes/después de las 5 queries más frecuentes para validar mejora |

**Entregable:** queries críticas <50 ms incluso con 1M filas simuladas.

### Fase DB-4 — Compliance y operación (1 semana)

| # | Acción |
|---|--------|
| 4.1 | Adoptar **node-pg-migrate**: tabla `pg_migrations`, comando `npm run migrate up/down` |
| 4.2 | Mover migraciones existentes al formato esperado por la herramienta |
| 4.3 | Cifrado de `cedula` y `telefono` con `pgp_sym_encrypt` + key en GCP Secret Manager |
| 4.4 | Implementar Row-Level Security para `image_svc` sobre `auth.users` (vía VIEW de columnas seguras) |
| 4.5 | Tabla `auth.user_consents` + endpoint en users-service que la pobla en registro |
| 4.6 | Cron job `cleanup_expired_*` con `pg_cron` (ejecuta diario) |
| 4.7 | Documento `DB_RETENTION_POLICY.md` versionado en repo |

**Entregable:** BD cumple LOPDP, migraciones versionadas, retención automática.

### Fase DB-5 — Validación pre-observabilidad (2 días)

| # | Acción |
|---|--------|
| 5.1 | Cargar dataset de prueba: 100k incidentes, 50k usuarios, 1M status_history |
| 5.2 | Ejecutar `EXPLAIN ANALYZE` de las 10 queries críticas; registrar baseline |
| 5.3 | `pg_dump` de prueba + `pg_restore` en BD secundaria; medir RTO real |
| 5.4 | Verificar trigger de auditoría LOPDP escribe en `audit_log` correctamente |
| 5.5 | Documento `DB_BASELINE_METRICS.md` con números (filas, tamaño, latencia p95) |

**Entregable:** baseline cuantitativo de la BD listo para comparar con métricas que pondrá la fase de observabilidad.

---

## 4. Cronograma consolidado

| Semana | Fase | Hito |
|--------|------|------|
| 1 | DB-1 + DB-3 | Instalación fresca íntegra + índices |
| 2 | DB-2 (parte 1) | LOPDP base + device_tokens + audit_log |
| 3 | DB-2 (parte 2) + DB-4 | Particionado + tooling de migraciones + RLS |
| 4 | DB-5 + buffer | Validación, dataset de prueba, baseline |
| 5+ | Fase Observabilidad | Como en plan anterior |

**Estimación:** 4 semanas de 1 ingeniero full-time, o 6 semanas de 1 ingeniero part-time + 1 reviewer.

---

## 5. Mapa de archivos afectados

### Migraciones a archivar

- `Backend/database/03_polling_estados.sql` → `Backend/database/_archive/`
- `Backend/database/011_status_history_trigger.sql` → `Backend/database/_archive/`

### Migraciones a editar

- `Backend/database/012_db_users_isolation.sql` (eliminar grants a objetos inexistentes)
- `Backend/database/011_consolidation.sql` (renombrar triggers con prefijo numérico)

### Migraciones a crear (Fase DB-1)

- `Backend/database/013_fix_init_completeness.sql`
- `Backend/database/014_initial_status_history.sql`

### Migraciones a crear (Fase DB-2 a DB-4)

- `Backend/database/015_missing_indexes.sql`
- `Backend/database/016_data_validation.sql`
- `Backend/database/017_audit_schema.sql`
- `Backend/database/018_device_tokens.sql`
- `Backend/database/019_notifications_retry.sql`
- `Backend/database/020_pending_registrations_to_auth.sql`
- `Backend/database/021_partition_incidents.sql`
- `Backend/database/022_lopdp_arco_functions.sql`
- `Backend/database/023_user_consents.sql`
- `Backend/database/024_pgcrypto_pii.sql`
- `Backend/database/025_rls_image_svc.sql`

### Otros archivos

- `docker-compose.yml` — re-mountar la cadena completa de migraciones en orden
- `Backend/users-service/src/**` — actualizar referencias de `public.pending_registrations` → `auth.pending_registrations`
- `package.json` (raíz o por servicio) — añadir `node-pg-migrate` como dependency
- `docs/DB_RETENTION_POLICY.md` — nuevo
- `docs/DB_BASELINE_METRICS.md` — nuevo

---

## 6. Definition of Done

La fase de base de datos se considera completa cuando:

1. ✅ `docker compose down -v && docker compose up -d` deja una BD funcional sin errores de migración.
2. ✅ Toda migración se ejecuta vía `npm run migrate up`; nunca se ejecuta SQL manual contra producción.
3. ✅ Existen funciones `fn_export_user_data` y `fn_anonymize_user` invocables desde la API para responder a derechos ARCO en <15 días hábiles.
4. ✅ Tabla `audit.audit_log` registra automáticamente todo INSERT/UPDATE/DELETE en tablas marcadas como sensibles.
5. ✅ Las 5 queries críticas (login, listar mis incidentes, dashboard supervisor, asignar incidente, estadísticas zona) corren en <50 ms con 1M de filas simuladas.
6. ✅ Cifrado en reposo activo para `cedula` y `telefono`.
7. ✅ Restore probado y documentado: tiempo medido cumple RTO 1 h.
8. ✅ Política de retención escrita y aplicada vía `pg_cron`.

---

## 7. Próximo paso recomendado

Arrancar con la **Fase DB-1** (los bugs P0). Son fixes pequeños y bien delimitados. Concretamente:

1. Crear `013_fix_init_completeness.sql` (consolida 008+009+010 en una migración limpia).
2. Editar `012_db_users_isolation.sql` para quitar las líneas que fallan.
3. Mover `011_status_history_trigger.sql` y `03_polling_estados.sql` a `_archive/`.
4. Editar `docker-compose.yml` para montar el orden correcto.
5. Crear `014_initial_status_history.sql` con el trigger AFTER INSERT.

Una vez verde, avanzar a DB-2.
