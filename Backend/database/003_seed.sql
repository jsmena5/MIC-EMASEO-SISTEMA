-- ============================================================================
-- MIC-EMASEO SISTEMA — Datos de Prueba (Seed)
-- ============================================================================
-- Ejecutar despues de 001_schema.sql
-- Coordenadas reales de Quito, Ecuador para pruebas realistas
-- ============================================================================

-- ── Usuarios de prueba ─────────────────────────────────────────────────────
-- Password para todos: "Test1234!" (hash bcrypt)
-- En produccion, el hash se genera desde el backend con bcrypt

INSERT INTO auth.users (id, nombre, apellido, cedula, email, username, password_hash, telefono, rol, estado) VALUES
    ('a1000000-0000-0000-0000-000000000001', 'Carlos',   'Administrador', '1712345678', 'admin@emaseo.gob.ec',     'admin',      '$2b$10$EixZaYVK1fsbw1ZfbX3OXePaWxn96p36zQvU1YePlKbleIFlyQtGy', '0991000001', 'ADMIN',      'ACTIVO'),
    ('a1000000-0000-0000-0000-000000000002', 'Maria',    'Lopez',         '1712345679', 'maria.lopez@emaseo.gob.ec','m.lopez',    '$2b$10$EixZaYVK1fsbw1ZfbX3OXePaWxn96p36zQvU1YePlKbleIFlyQtGy', '0991000002', 'SUPERVISOR', 'ACTIVO'),
    ('a1000000-0000-0000-0000-000000000003', 'Pedro',    'Garcia',        '1712345680', 'pedro.garcia@emaseo.gob.ec','p.garcia',  '$2b$10$EixZaYVK1fsbw1ZfbX3OXePaWxn96p36zQvU1YePlKbleIFlyQtGy', '0991000003', 'OPERARIO',   'ACTIVO'),
    ('a1000000-0000-0000-0000-000000000004', 'Luis',     'Martinez',      '1712345681', 'luis.martinez@emaseo.gob.ec','l.martinez','$2b$10$EixZaYVK1fsbw1ZfbX3OXePaWxn96p36zQvU1YePlKbleIFlyQtGy', '0991000004', 'OPERARIO',   'ACTIVO'),
    ('a1000000-0000-0000-0000-000000000005', 'Ana',      'Ciudadana',     '1712345682', 'ana.ciudadana@gmail.com',  'ana.c',      '$2b$10$EixZaYVK1fsbw1ZfbX3OXePaWxn96p36zQvU1YePlKbleIFlyQtGy', '0991000005', 'CIUDADANO',  'ACTIVO'),
    ('a1000000-0000-0000-0000-000000000006', 'Jorge',    'Ramirez',       '1712345683', 'jorge.ramirez@gmail.com',  'jorge.r',    '$2b$10$EixZaYVK1fsbw1ZfbX3OXePaWxn96p36zQvU1YePlKbleIFlyQtGy', '0991000006', 'CIUDADANO',  'ACTIVO');

-- ── Zonas operativas (poligonos reales de Quito) ──────────────────────────

INSERT INTO operations.zones (id, codigo, nombre, descripcion, geom, supervisor_id) VALUES
    (
        'b2000000-0000-0000-0000-000000000001',
        'ZN-CENTRO-01',
        'Centro Historico',
        'Zona del centro historico de Quito — alta densidad poblacional',
        ST_GeomFrom
