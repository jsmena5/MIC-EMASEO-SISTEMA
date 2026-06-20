-- ============================================================================
-- Migración 024 — Cifrado PII: cedula y telefono
-- Tablas afectadas: public.ciudadanos, operations.operarios
-- ============================================================================
-- Cumplimiento: LOPDP (Ley Orgánica de Protección de Datos Personales —
-- Ecuador, vigente desde 2023). Art. 37 y 38 exigen medidas técnicas
-- adecuadas para datos personales sensibles. En caso de dump/exfiltración,
-- los campos PII no deben quedar expuestos en texto plano.
--
-- ALGORITMO: pgp_sym_encrypt / pgp_sym_decrypt (AES-256 OpenPGP simétrico).
--   Cada llamada produce un ciphertext distinto (session key aleatoria interna
--   de OpenPGP), por lo que NO es posible mantener un índice UNIQUE en
--   cedula_enc. La unicidad se seguirá garantizando por la columna original
--   (cedula) hasta que sea eliminada en la migración 025, y desde entonces
--   deberá validarse a nivel de aplicación o mediante un índice sobre el hash
--   SHA-256 de la cédula (ver NOTA al final).
--
-- ──────────────────────────────────────────────────────────────────────────
-- CLAVE DE CIFRADO — app.encryption_key
-- ──────────────────────────────────────────────────────────────────────────
--   La clave NO está hardcodeada aquí. PostgreSQL la lee en tiempo de
--   ejecución desde el parámetro de sesión "app.encryption_key", que DEBE
--   configurarse antes de correr esta migración y antes de cada consulta
--   que use la vista ciudadanos_desenc / operarios_desenc.
--
--   Formas de inyectarla:
--
--   1) GCP Secret Manager (producción):
--      El entrypoint del contenedor lee el secreto y lo exporta como variable
--      de entorno; el pool de conexiones (pg, knex, etc.) la inyecta al
--      abrir cada sesión:
--        SET app.encryption_key = '<valor-desde-secreto>';
--
--   2) .env local (desarrollo):
--      Agrega en .env:
--        PG_ENCRYPTION_KEY=una-clave-segura-de-al-menos-32-caracteres
--      El código Node.js la lee y la inyecta en la conexión:
--        await client.query(`SET app.encryption_key = $1`, [process.env.PG_ENCRYPTION_KEY]);
--
--   3) psql manual:
--        PGOPTIONS="-c app.encryption_key=<clave>" psql -d emaseo_db -f 024_pgcrypto_pii.sql
--
--   NUNCA incluyas la clave en este archivo, en scripts de CI/CD ni en logs.
--
-- ──────────────────────────────────────────────────────────────────────────
-- ESTRATEGIA DE MIGRACIÓN (zero-downtime, reversible):
--   Paso 1 — Agregar columnas cifradas como NULLABLE (sin romper escrituras).
--   Paso 2 — Verificar que app.encryption_key está presente.
--   Paso 3 — Cifrar y copiar datos existentes.
--   Paso 4 — Agregar NOT NULL solo a cedula_enc (telefono_enc queda nullable
--             porque telefono también lo es en el esquema original).
--   Paso 5 — Crear vistas de descifrado para minimizar cambios en el código.
--
--   Las columnas originales (cedula, telefono) NO se eliminan aquí.
--   Se eliminan en la migración 025 tras validar que el cifrado funciona.
-- ============================================================================

BEGIN;

-- ============================================================================
-- PASO 1 — Extensión (idempotente; ya habilitada en 01_init_schema.sql)
-- ============================================================================
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ============================================================================
-- PASO 2 — Agregar columnas cifradas (NULLABLE hasta completar la migración)
-- ============================================================================

-- public.ciudadanos
ALTER TABLE public.ciudadanos
    ADD COLUMN IF NOT EXISTS cedula_enc   BYTEA,
    ADD COLUMN IF NOT EXISTS telefono_enc BYTEA;

COMMENT ON COLUMN public.ciudadanos.cedula_enc
    IS 'Cédula cifrada con pgp_sym_encrypt (AES-256). Descifrar con pgp_sym_decrypt + app.encryption_key.';
COMMENT ON COLUMN public.ciudadanos.telefono_enc
    IS 'Teléfono cifrado con pgp_sym_encrypt (AES-256). NULL cuando el ciudadano no proporcionó teléfono.';

-- operations.operarios (misma categoría de PII)
ALTER TABLE operations.operarios
    ADD COLUMN IF NOT EXISTS cedula_enc   BYTEA,
    ADD COLUMN IF NOT EXISTS telefono_enc BYTEA;

COMMENT ON COLUMN operations.operarios.cedula_enc
    IS 'Cédula cifrada con pgp_sym_encrypt (AES-256). Descifrar con pgp_sym_decrypt + app.encryption_key.';
COMMENT ON COLUMN operations.operarios.telefono_enc
    IS 'Teléfono cifrado con pgp_sym_encrypt (AES-256). NULL cuando el operario no tiene teléfono registrado.';

-- ============================================================================
-- PASO 3 — Verificar que la clave de cifrado está configurada en la sesión
-- ============================================================================
DO $$
BEGIN
    IF COALESCE(current_setting('app.encryption_key', TRUE), '') = '' THEN
        RAISE EXCEPTION
            E'[024_pgcrypto_pii] app.encryption_key no está configurada.\n'
            'Ejecuta antes de correr esta migración:\n'
            '  SET app.encryption_key = ''<clave-segura>'';\n'
            'O usa: PGOPTIONS="-c app.encryption_key=<clave>" psql ...';
    END IF;
END;
$$;

-- ============================================================================
-- PASO 4 — Migrar datos existentes
-- ============================================================================
-- pgp_sym_encrypt(NULL, key) devuelve NULL → telefono_enc queda NULL
-- cuando el campo original está vacío. Comportamiento correcto.

UPDATE public.ciudadanos
SET
    cedula_enc   = pgp_sym_encrypt(cedula,   current_setting('app.encryption_key')),
    telefono_enc = pgp_sym_encrypt(telefono, current_setting('app.encryption_key'));

UPDATE operations.operarios
SET
    cedula_enc   = pgp_sym_encrypt(cedula,   current_setting('app.encryption_key')),
    telefono_enc = pgp_sym_encrypt(telefono, current_setting('app.encryption_key'));

-- ============================================================================
-- PASO 5 — Restricciones NOT NULL (solo cedula_enc; telefono puede ser NULL)
-- ============================================================================
ALTER TABLE public.ciudadanos
    ALTER COLUMN cedula_enc SET NOT NULL;

ALTER TABLE operations.operarios
    ALTER COLUMN cedula_enc SET NOT NULL;

-- ============================================================================
-- PASO 6 — Vistas de descifrado (minimiza cambios en el código de aplicación)
-- ============================================================================
-- Las vistas descifran en tiempo de consulta usando la clave de la sesión.
-- El código que actualmente lee de public.ciudadanos puede apuntar a
-- public.ciudadanos_desenc sin modificar las columnas que consume,
-- excepto que la columna cedula/telefono ahora se descifra al vuelo.
--
-- IMPORTANTE: La sesión debe tener app.encryption_key configurada antes de
-- consultar estas vistas; de lo contrario PostgreSQL lanzará un error.

CREATE OR REPLACE VIEW public.ciudadanos_desenc AS
SELECT
    id,
    user_id,
    nombre,
    apellido,
    -- Descifrado al leer; columna original "cedula" sigue existiendo hasta migración 025
    pgp_sym_decrypt(
        cedula_enc,
        current_setting('app.encryption_key')
    )::VARCHAR(10)                          AS cedula,
    CASE
        WHEN telefono_enc IS NOT NULL
        THEN pgp_sym_decrypt(
                 telefono_enc,
                 current_setting('app.encryption_key')
             )::VARCHAR(15)
        ELSE NULL
    END                                     AS telefono,
    avatar_url,
    created_at,
    updated_at
FROM public.ciudadanos;

COMMENT ON VIEW public.ciudadanos_desenc
    IS 'Vista de descifrado de public.ciudadanos. Requiere app.encryption_key configurada en la sesión. '
       'Usar en lugar de la tabla base mientras coexisten columnas cifradas y texto plano (migraciones 024-025).';

CREATE OR REPLACE VIEW operations.operarios_desenc AS
SELECT
    id,
    user_id,
    nombre,
    apellido,
    pgp_sym_decrypt(
        cedula_enc,
        current_setting('app.encryption_key')
    )::VARCHAR(10)                          AS cedula,
    CASE
        WHEN telefono_enc IS NOT NULL
        THEN pgp_sym_decrypt(
                 telefono_enc,
                 current_setting('app.encryption_key')
             )::VARCHAR(15)
        ELSE NULL
    END                                     AS telefono,
    zona_id,
    cargo,
    created_at,
    updated_at
FROM operations.operarios;

COMMENT ON VIEW operations.operarios_desenc
    IS 'Vista de descifrado de operations.operarios. Requiere app.encryption_key configurada en la sesión.';

-- ============================================================================
-- NOTAS PARA EL DESARROLLADOR
-- ============================================================================
-- 1. UNICIDAD DE CÉDULA TRAS ELIMINAR COLUMNA ORIGINAL (migración 025):
--    pgp_sym_encrypt produce ciphertext no determinista → no se puede crear
--    UNIQUE en cedula_enc. Opciones para la migración 025:
--
--    a) Índice sobre SHA-256 (recomendado para búsqueda + unicidad):
--         ALTER TABLE public.ciudadanos
--             ADD COLUMN cedula_hash BYTEA
--             GENERATED ALWAYS AS (digest(cedula_enc, 'sha256')) STORED;
--         CREATE UNIQUE INDEX uq_ciudadanos_cedula_hash
--             ON public.ciudadanos (cedula_hash);
--    b) Validar unicidad en la capa de aplicación antes de INSERT/UPDATE.
--
-- 2. ROTACIÓN DE CLAVE:
--    Si se rota app.encryption_key, re-cifrar todos los registros con la nueva
--    clave antes de revocar la antigua (escribir una migración dedicada).
--
-- 3. COLUMNAS ORIGINALES (pendiente de eliminación):
--    Las columnas cedula y telefono (texto plano) en public.ciudadanos y
--    operations.operarios serán eliminadas en la migración 025 una vez que
--    se valide que:
--    a) Las columnas _enc tienen datos correctos en todos los entornos.
--    b) El código de aplicación usa las vistas _desenc o descifra explícitamente.
-- ============================================================================

COMMIT;
