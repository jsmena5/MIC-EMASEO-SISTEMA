-- ============================================================================
-- Migración 058 — Seed de usuarios staff (post-056)
--
-- PROPÓSITO:
--   Inserta usuarios de prueba para desarrollo/staging compatibles con el
--   schema consolidado de la migración 056 (app_auth.users contiene el perfil
--   directamente; las tablas public.ciudadanos y operations.operarios ya no
--   existen).
--
-- USUARIOS CREADOS:
--   • admin@emaseo.gob.ec        — ADMIN      (contraseña: Test1234!)
--   • maria.lopez@emaseo.gob.ec  — SUPERVISOR (contraseña: Test1234!)
--   • pedro.garcia@emaseo.gob.ec — OPERARIO   (contraseña: Test1234!)
--   • luis.martinez@emaseo.gob.ec— OPERARIO   (contraseña: Test1234!)
--   • ana.ciudadana@gmail.com     — CIUDADANO  (contraseña: Test1234!)
--   • jorge.ramirez@gmail.com     — CIUDADANO  (contraseña: Test1234!)
--   • sistema@emaseo.gob.ec      — ADMIN      (contraseña irrecuperable)
--
-- NOTA: El hash '$2b$10$EixZaYVK1fsbw1ZfbX3OXePaWxn96p36zQvU1YePlKbleIFlyQtGy'
--   corresponde a bcrypt de "Test1234!" con salt rounds=10.
--
-- APLICAR EN DESARROLLO (fresco, post-056+057):
--   psql "..." -f 058_seed_staff_users.sql
-- ============================================================================

BEGIN;

-- ============================================================================
-- PASO 1: Usuario de sistema (usado por triggers ML)
-- Contraseña irrecuperable — no se puede hacer login con este usuario.
-- ============================================================================

INSERT INTO app_auth.users (
    id,
    email,
    password_hash,
    rol,
    estado,
    is_verified,
    nombre,
    apellido
)
VALUES (
    '00000000-0000-0000-0000-000000000001',
    'sistema@emaseo.gob.ec',
    crypt(gen_random_uuid()::text, gen_salt('bf', 10)),
    'ADMIN',
    'ACTIVO',
    TRUE,
    'Sistema',
    'EMASEO'
)
ON CONFLICT (id) DO NOTHING;

-- ============================================================================
-- PASO 2: Staff con perfil completo en app_auth.users (schema post-056)
-- zona_id se asigna en PASO 4, después de insertar las zonas.
-- ============================================================================

INSERT INTO app_auth.users (
    id,
    email,
    password_hash,
    rol,
    estado,
    is_verified,
    nombre,
    apellido,
    cedula,
    telefono,
    cargo
) VALUES
    (
        'a1000000-0000-0000-0000-000000000001',
        'admin@emaseo.gob.ec',
        '$2b$10$EixZaYVK1fsbw1ZfbX3OXePaWxn96p36zQvU1YePlKbleIFlyQtGy',
        'ADMIN',
        'ACTIVO',
        TRUE,
        'Carlos',
        'Administrador',
        '1700000100',
        '0991000001',
        'Administrador del Sistema'
    ),
    (
        'a1000000-0000-0000-0000-000000000002',
        'maria.lopez@emaseo.gob.ec',
        '$2b$10$EixZaYVK1fsbw1ZfbX3OXePaWxn96p36zQvU1YePlKbleIFlyQtGy',
        'SUPERVISOR',
        'ACTIVO',
        TRUE,
        'Maria',
        'Lopez',
        '1700001009',
        '0991000002',
        'Supervisora Zona Centro'
    ),
    (
        'a1000000-0000-0000-0000-000000000003',
        'pedro.garcia@emaseo.gob.ec',
        '$2b$10$EixZaYVK1fsbw1ZfbX3OXePaWxn96p36zQvU1YePlKbleIFlyQtGy',
        'OPERARIO',
        'ACTIVO',
        TRUE,
        'Pedro',
        'Garcia',
        '1700010000',
        '0991000003',
        'Operario de Campo'
    ),
    (
        'a1000000-0000-0000-0000-000000000004',
        'luis.martinez@emaseo.gob.ec',
        '$2b$10$EixZaYVK1fsbw1ZfbX3OXePaWxn96p36zQvU1YePlKbleIFlyQtGy',
        'OPERARIO',
        'ACTIVO',
        TRUE,
        'Luis',
        'Martinez',
        '1700100009',
        '0991000004',
        'Operario de Campo'
    )
ON CONFLICT (id) DO NOTHING;

-- ============================================================================
-- PASO 3: Ciudadanos con perfil completo
-- ============================================================================

INSERT INTO app_auth.users (
    id,
    email,
    password_hash,
    rol,
    estado,
    is_verified,
    nombre,
    apellido,
    cedula,
    telefono
) VALUES
    (
        'a1000000-0000-0000-0000-000000000005',
        'ana.ciudadana@gmail.com',
        '$2b$10$EixZaYVK1fsbw1ZfbX3OXePaWxn96p36zQvU1YePlKbleIFlyQtGy',
        'CIUDADANO',
        'ACTIVO',
        TRUE,
        'Ana',
        'Ciudadana',
        '1700000001',
        '0991000005'
    ),
    (
        'a1000000-0000-0000-0000-000000000006',
        'jorge.ramirez@gmail.com',
        '$2b$10$EixZaYVK1fsbw1ZfbX3OXePaWxn96p36zQvU1YePlKbleIFlyQtGy',
        'CIUDADANO',
        'ACTIVO',
        TRUE,
        'Jorge',
        'Ramirez',
        '1700000019',
        '0991000006'
    )
ON CONFLICT (id) DO NOTHING;

-- ============================================================================
-- PASO 4: Zonas operativas (si no existen ya — idempotente)
-- Polígonos representativos de sectores de Quito (WGS84 / SRID 4326).
-- En producción reemplazar con el shapefile oficial de EMASEO EP.
-- NOTA: Si ya se aplicó 048_seed_zones_dmq.sql o 051-053 con zonas OSM,
--   este INSERT es ignorado por ON CONFLICT y las zonas OSM prevalecen.
-- ============================================================================

INSERT INTO operations.zones (id, codigo, nombre, descripcion, geom, supervisor_id, activa)
VALUES
    (
        'b2000000-0000-0000-0000-000000000001',
        'ZN-CENTRO-01',
        'Centro Historico',
        'Zona del centro histórico de Quito — alta densidad poblacional y patrimonio cultural',
        ST_GeomFromText('POLYGON((-78.535 -0.240, -78.505 -0.240, -78.505 -0.210, -78.535 -0.210, -78.535 -0.240))', 4326),
        'a1000000-0000-0000-0000-000000000002',
        TRUE
    ),
    (
        'b2000000-0000-0000-0000-000000000002',
        'ZN-NORTE-01',
        'Norte — La Carolina',
        'Sector norte de Quito: La Carolina, Iñaquito, República del Salvador — zona comercial y residencial',
        ST_GeomFromText('POLYGON((-78.510 -0.185, -78.465 -0.185, -78.465 -0.155, -78.510 -0.155, -78.510 -0.185))', 4326),
        'a1000000-0000-0000-0000-000000000002',
        TRUE
    ),
    (
        'b2000000-0000-0000-0000-000000000003',
        'ZN-SUR-01',
        'Sur — Solanda',
        'Sector sur de Quito: Solanda, Turubamba, La Ecuatoriana — zona residencial alta densidad',
        ST_GeomFromText('POLYGON((-78.555 -0.295, -78.510 -0.295, -78.510 -0.255, -78.555 -0.255, -78.555 -0.295))', 4326),
        'a1000000-0000-0000-0000-000000000002',
        TRUE
    ),
    (
        'b2000000-0000-0000-0000-000000000004',
        'ZN-ORIENTE-01',
        'Valle de Los Chillos',
        'Sector oriental: San Rafael, Sangolquí, Conocoto — zona periurbana en expansión',
        ST_GeomFromText('POLYGON((-78.460 -0.340, -78.415 -0.340, -78.415 -0.295, -78.460 -0.295, -78.460 -0.340))', 4326),
        'a1000000-0000-0000-0000-000000000002',
        TRUE
    )
ON CONFLICT (id) DO NOTHING;

-- ============================================================================
-- PASO 5: Asignar zona_id al personal operativo
-- Idempotente: solo actualiza si zona_id es NULL para no pisar asignaciones
-- reales hechas desde el panel de administración.
-- ============================================================================

-- Pedro Garcia → Centro Histórico
UPDATE app_auth.users
SET zona_id = 'b2000000-0000-0000-0000-000000000001'
WHERE id = 'a1000000-0000-0000-0000-000000000003'
  AND zona_id IS NULL;

-- Luis Martinez → Norte La Carolina
UPDATE app_auth.users
SET zona_id = 'b2000000-0000-0000-0000-000000000002'
WHERE id = 'a1000000-0000-0000-0000-000000000004'
  AND zona_id IS NULL;

-- Maria Lopez (supervisora) → Centro Histórico
UPDATE app_auth.users
SET zona_id = 'b2000000-0000-0000-0000-000000000001'
WHERE id = 'a1000000-0000-0000-0000-000000000002'
  AND zona_id IS NULL;

-- Carlos (ADMIN) → sin zona (por diseño)

-- ============================================================================
-- VERIFICACIÓN POST-SEED
-- ============================================================================

DO $$
DECLARE
    v_staff_count  INTEGER;
    v_zonas_count  INTEGER;
    v_con_zona     INTEGER;
BEGIN
    SELECT COUNT(*) INTO v_staff_count
    FROM app_auth.users
    WHERE id IN (
        'a1000000-0000-0000-0000-000000000001',
        'a1000000-0000-0000-0000-000000000002',
        'a1000000-0000-0000-0000-000000000003',
        'a1000000-0000-0000-0000-000000000004'
    );

    SELECT COUNT(*) INTO v_zonas_count
    FROM operations.zones
    WHERE id IN (
        'b2000000-0000-0000-0000-000000000001',
        'b2000000-0000-0000-0000-000000000002',
        'b2000000-0000-0000-0000-000000000003',
        'b2000000-0000-0000-0000-000000000004'
    );

    SELECT COUNT(*) INTO v_con_zona
    FROM app_auth.users
    WHERE rol IN ('OPERARIO', 'SUPERVISOR')
      AND zona_id IS NOT NULL
      AND id LIKE 'a1000000%';

    RAISE NOTICE '058_seed_staff_users: % usuarios staff, % zonas seed, % con zona asignada',
        v_staff_count, v_zonas_count, v_con_zona;

    IF v_staff_count < 4 THEN
        RAISE WARNING 'Solo % de 4 usuarios staff insertados (posible conflicto ON CONFLICT DO NOTHING)',
            v_staff_count;
    END IF;
END $$;

COMMIT;

-- ============================================================================
-- VERIFICACIÓN MANUAL POST-SEED (ejecutar por separado para confirmar):
-- SELECT u.email, u.rol, u.nombre, u.apellido, u.cedula, z.nombre AS zona
-- FROM app_auth.users u
-- LEFT JOIN operations.zones z ON z.id = u.zona_id
-- WHERE u.id LIKE 'a1000000%' OR u.id = '00000000-0000-0000-0000-000000000001'
-- ORDER BY u.rol, u.email;
-- ============================================================================
