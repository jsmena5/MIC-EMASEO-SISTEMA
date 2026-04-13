-- ============================================================================
-- MIC-EMASEO SISTEMA — Datos Base (Seed)
-- ============================================================================
-- Ejecutar despues de 01_init_schema.sql
-- Coordenadas reales de Quito, Ecuador (WGS84 / SRID 4326)
-- ============================================================================
-- NOTA: auth.users ya NO tiene columnas de perfil (nombre, cedula, etc.)
-- Esas columnas viven en public.ciudadanos y operations.operarios.
-- Password de todos los usuarios de prueba: "Test1234!"
-- ============================================================================

BEGIN;

-- ============================================================================
-- 1. CREDENCIALES (auth.users)
-- Tabla de identidad pura: solo email, username, hash, rol, estado.
-- ============================================================================

INSERT INTO auth.users (id, email, username, password_hash, rol, estado, is_verified) VALUES
    ('a1000000-0000-0000-0000-000000000001', 'admin@emaseo.gob.ec',        'admin',      '$2b$10$EixZaYVK1fsbw1ZfbX3OXePaWxn96p36zQvU1YePlKbleIFlyQtGy', 'ADMIN',      'ACTIVO', TRUE),
    ('a1000000-0000-0000-0000-000000000002', 'maria.lopez@emaseo.gob.ec',  'm.lopez',    '$2b$10$EixZaYVK1fsbw1ZfbX3OXePaWxn96p36zQvU1YePlKbleIFlyQtGy', 'SUPERVISOR', 'ACTIVO', TRUE),
    ('a1000000-0000-0000-0000-000000000003', 'pedro.garcia@emaseo.gob.ec', 'p.garcia',   '$2b$10$EixZaYVK1fsbw1ZfbX3OXePaWxn96p36zQvU1YePlKbleIFlyQtGy', 'OPERARIO',   'ACTIVO', TRUE),
    ('a1000000-0000-0000-0000-000000000004', 'luis.martinez@emaseo.gob.ec','l.martinez', '$2b$10$EixZaYVK1fsbw1ZfbX3OXePaWxn96p36zQvU1YePlKbleIFlyQtGy', 'OPERARIO',   'ACTIVO', TRUE),
    ('a1000000-0000-0000-0000-000000000005', 'ana.ciudadana@gmail.com',    'ana.c',      '$2b$10$EixZaYVK1fsbw1ZfbX3OXePaWxn96p36zQvU1YePlKbleIFlyQtGy', 'CIUDADANO',  'ACTIVO', TRUE),
    ('a1000000-0000-0000-0000-000000000006', 'jorge.ramirez@gmail.com',    'jorge.r',    '$2b$10$EixZaYVK1fsbw1ZfbX3OXePaWxn96p36zQvU1YePlKbleIFlyQtGy', 'CIUDADANO',  'ACTIVO', TRUE);

-- ============================================================================
-- 2. PERFILES CIUDADANOS (public.ciudadanos)
-- ============================================================================

INSERT INTO public.ciudadanos (user_id, nombre, apellido, cedula, telefono) VALUES
    ('a1000000-0000-0000-0000-000000000005', 'Ana',   'Ciudadana', '1712345682', '0991000005'),
    ('a1000000-0000-0000-0000-000000000006', 'Jorge', 'Ramirez',   '1712345683', '0991000006');

-- ============================================================================
-- 3. PERFILES PERSONAL OPERATIVO (operations.operarios)
-- zona_id se actualiza tras insertar las zonas (seccion 4)
-- ============================================================================

INSERT INTO operations.operarios (user_id, nombre, apellido, cedula, telefono, cargo) VALUES
    ('a1000000-0000-0000-0000-000000000001', 'Carlos', 'Administrador', '1712345678', '0991000001', 'Administrador del Sistema'),
    ('a1000000-0000-0000-0000-000000000002', 'Maria',  'Lopez',         '1712345679', '0991000002', 'Supervisora Zona Centro'),
    ('a1000000-0000-0000-0000-000000000003', 'Pedro',  'Garcia',        '1712345680', '0991000003', 'Operario de Campo'),
    ('a1000000-0000-0000-0000-000000000004', 'Luis',   'Martinez',      '1712345681', '0991000004', 'Operario de Campo');

-- ============================================================================
-- 4. ZONAS OPERATIVAS (operations.zones)
-- Poligonos reales aproximados de sectores de Quito — SRID 4326 (WGS84)
-- Generados como rectangulos representativos de cada sector.
-- En produccion reemplazar con shapefile oficial de EMASEO EP.
-- ============================================================================

INSERT INTO operations.zones (id, codigo, nombre, descripcion, geom, supervisor_id, activa) VALUES
    (
        'b2000000-0000-0000-0000-000000000001',
        'ZN-CENTRO-01',
        'Centro Historico',
        'Zona del centro historico de Quito — alta densidad poblacional y patrimonio cultural',
        ST_GeomFromText('POLYGON((-78.535 -0.240, -78.505 -0.240, -78.505 -0.210, -78.535 -0.210, -78.535 -0.240))', 4326),
        'a1000000-0000-0000-0000-000000000002',
        TRUE
    ),
    (
        'b2000000-0000-0000-0000-000000000002',
        'ZN-NORTE-01',
        'Norte — La Carolina',
        'Sector norte de Quito: La Carolina, Inanez, Republica del Salvador — zona comercial y residencial',
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
        'Sector oriental: San Rafael, Sangolqui, Conocoto — zona periurbana en expansion',
        ST_GeomFromText('POLYGON((-78.460 -0.340, -78.415 -0.340, -78.415 -0.295, -78.460 -0.295, -78.460 -0.340))', 4326),
        'a1000000-0000-0000-0000-000000000002',
        TRUE
    );

-- ============================================================================
-- 5. ASIGNAR ZONAS AL PERSONAL OPERATIVO
-- Actualizar despues de haber insertado las zonas
-- ============================================================================

UPDATE operations.operarios
    SET zona_id = 'b2000000-0000-0000-0000-000000000001'
    WHERE user_id IN (
        'a1000000-0000-0000-0000-000000000002',  -- Maria Lopez (Supervisora Centro)
        'a1000000-0000-0000-0000-000000000003'   -- Pedro Garcia (Operario Centro)
    );

UPDATE operations.operarios
    SET zona_id = 'b2000000-0000-0000-0000-000000000002'
    WHERE user_id = 'a1000000-0000-0000-0000-000000000004';  -- Luis Martinez (Operario Norte)

-- Carlos (ADMIN) no tiene zona asignada (zona_id = NULL por diseno)

COMMIT;

-- ============================================================================
-- VERIFICACION POST-SEED (ejecutar manualmente para confirmar)
-- ============================================================================
-- SELECT u.email, u.rol, u.is_verified FROM auth.users u ORDER BY u.rol;
-- SELECT c.nombre, c.apellido, c.cedula FROM public.ciudadanos c;
-- SELECT o.nombre, o.cargo, z.nombre AS zona FROM operations.operarios o LEFT JOIN operations.zones z ON z.id = o.zona_id;
-- SELECT codigo, nombre, ST_AsText(geom) FROM operations.zones ORDER BY codigo;
-- ============================================================================
