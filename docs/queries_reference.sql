-- ============================================================================
-- MIC-EMASEO SISTEMA — Consultas de Referencia
-- ============================================================================
-- Consultas optimizadas para las operaciones mas frecuentes del sistema.
-- Requiere que 01_init_schema.sql y 02_seed_data.sql hayan sido ejecutados.
--
-- IMPORTANTE: auth.users es solo tabla de credenciales.
--   - Nombre/apellido de ciudadanos → public.ciudadanos (JOIN por user_id)
--   - Nombre/apellido de personal   → operations.operarios (JOIN por user_id)
-- ============================================================================


-- ============================================================================
-- CONSULTA 1: Incidencias en un radio de 1 km desde un punto GPS
-- ============================================================================
-- Caso: El supervisor quiere ver incidencias cercanas a un punto especifico.
-- Usa el indice GIST sobre incidents.incidents.ubicacion.
-- ST_DWithin trabaja en metros cuando se usa ::geography.

SELECT
    i.id,
    i.descripcion,
    i.estado,
    i.prioridad,
    i.direccion,
    i.created_at,
    ST_Distance(
        i.ubicacion::geography,
        ST_SetSRID(ST_MakePoint(-78.4678, -0.1807), 4326)::geography
    )                          AS distancia_metros,
    ar.tipo_residuo,
    ar.nivel_acumulacion,
    ar.volumen_estimado_m3
FROM incidents.incidents i
LEFT JOIN ai.analysis_results ar ON ar.incident_id = i.id
WHERE ST_DWithin(
    i.ubicacion::geography,
    ST_SetSRID(ST_MakePoint(-78.4678, -0.1807), 4326)::geography,
    1000  -- 1000 metros = 1 km
)
ORDER BY distancia_metros ASC;


-- ============================================================================
-- CONSULTA 2: Incidencias filtradas por estado y nivel de prioridad
-- ============================================================================
-- Caso: El panel web filtra incidencias pendientes con prioridad alta o critica.
-- Usa el indice compuesto idx_incidents_estado_prioridad.
-- JOIN con public.ciudadanos para obtener el nombre del ciudadano que reporto.

SELECT
    i.id,
    i.descripcion,
    i.estado,
    i.prioridad,
    i.direccion,
    i.created_at,
    ST_X(i.ubicacion)                      AS longitud,
    ST_Y(i.ubicacion)                      AS latitud,
    c.nombre || ' ' || c.apellido          AS reportado_por,
    ar.tipo_residuo,
    ar.nivel_acumulacion
FROM incidents.incidents i
JOIN public.ciudadanos c ON c.user_id = i.reportado_por
LEFT JOIN ai.analysis_results ar ON ar.incident_id = i.id
WHERE i.estado = 'PENDIENTE'
  AND i.prioridad IN ('ALTA', 'CRITICA')
ORDER BY i.created_at DESC;


-- ============================================================================
-- CONSULTA 3: Incidencias dentro de una zona/sector especifico
-- ============================================================================
-- Caso: El supervisor quiere ver todas las incidencias de su zona asignada.

-- Opcion A: Usando zona_id (asignada por trigger — mas eficiente)
SELECT
    i.id,
    i.descripcion,
    i.estado,
    i.prioridad,
    i.direccion,
    ST_X(i.ubicacion)          AS longitud,
    ST_Y(i.ubicacion)          AS latitud,
    i.created_at,
    ar.tipo_residuo,
    ar.volumen_estimado_m3
FROM incidents.incidents i
LEFT JOIN ai.analysis_results ar ON ar.incident_id = i.id
WHERE i.zona_id = '{{zona_uuid}}'  -- Reemplazar con UUID de la zona
  AND i.estado <> 'RECHAZADA'
ORDER BY
    CASE i.prioridad
        WHEN 'CRITICA' THEN 1
        WHEN 'ALTA'    THEN 2
        WHEN 'MEDIA'   THEN 3
        WHEN 'BAJA'    THEN 4
    END,
    i.created_at DESC;

-- Opcion B: Contencion espacial directa (sin depender del trigger)
SELECT i.*
FROM incidents.incidents i
JOIN operations.zones z ON ST_Contains(z.geom, i.ubicacion)
WHERE z.codigo = 'ZN-NORTE-01';


-- ============================================================================
-- CONSULTA 4: Estadisticas de incidencias por sector (ultimos 30 dias)
-- ============================================================================
-- Caso: Dashboard del panel web — resumen operativo por zona.
-- JOIN con operations.operarios para obtener el nombre del supervisor.

SELECT
    z.codigo                                                AS zona_codigo,
    z.nombre                                                AS zona_nombre,
    COUNT(i.id)                                             AS total_incidencias,
    COUNT(*) FILTER (WHERE i.estado = 'PENDIENTE')          AS pendientes,
    COUNT(*) FILTER (WHERE i.estado = 'EN_ATENCION')        AS en_atencion,
    COUNT(*) FILTER (WHERE i.estado = 'RESUELTA')           AS resueltas,
    COUNT(*) FILTER (WHERE i.estado = 'RECHAZADA')          AS rechazadas,
    COUNT(*) FILTER (WHERE i.prioridad = 'CRITICA')         AS criticas,
    ROUND(AVG(ar.volumen_estimado_m3), 2)                   AS volumen_promedio_m3,
    ROUND(AVG(ar.confianza), 3)                             AS confianza_promedio_ia,
    op.nombre || ' ' || op.apellido                         AS supervisor
FROM operations.zones z
LEFT JOIN incidents.incidents i
    ON i.zona_id = z.id
    AND i.created_at >= NOW() - INTERVAL '30 days'
LEFT JOIN ai.analysis_results ar ON ar.incident_id = i.id
LEFT JOIN operations.operarios op ON op.user_id = z.supervisor_id
WHERE z.activa = TRUE
GROUP BY z.id, z.codigo, z.nombre, op.nombre, op.apellido
ORDER BY total_incidencias DESC;


-- ============================================================================
-- CONSULTA 5: Historial completo de una incidencia (timeline)
-- ============================================================================
-- Caso: El ciudadano o supervisor quiere ver toda la actividad de una incidencia.
-- JOIN con operations.operarios ya que quien cambia estados es personal interno.

SELECT
    sh.estado_anterior,
    sh.estado_nuevo,
    sh.observaciones,
    sh.created_at                          AS fecha_cambio,
    op.nombre || ' ' || op.apellido        AS cambiado_por,
    u.rol
FROM incidents.status_history sh
JOIN auth.users u ON u.id = sh.cambiado_por
JOIN operations.operarios op ON op.user_id = sh.cambiado_por
WHERE sh.incident_id = '{{incident_uuid}}'
ORDER BY sh.created_at ASC;


-- ============================================================================
-- CONSULTA 6: Incidencias asignadas a un operario (pendientes)
-- ============================================================================
-- Caso: El operario ve su lista de trabajo del dia.
-- JOIN con operations.operarios para nombre de quien asigno.

SELECT
    a.id                                   AS asignacion_id,
    i.id                                   AS incidencia_id,
    i.descripcion,
    i.prioridad,
    i.direccion,
    ST_X(i.ubicacion)                      AS longitud,
    ST_Y(i.ubicacion)                      AS latitud,
    a.fecha_esperada,
    a.notas,
    a.created_at                           AS asignado_el,
    op.nombre || ' ' || op.apellido        AS asignado_por
FROM incidents.assignments a
JOIN incidents.incidents i ON i.id = a.incident_id
JOIN operations.operarios op ON op.user_id = a.asignado_por
WHERE a.operario_id = '{{operario_uuid}}'
  AND a.completada = FALSE
ORDER BY
    CASE i.prioridad
        WHEN 'CRITICA' THEN 1
        WHEN 'ALTA'    THEN 2
        WHEN 'MEDIA'   THEN 3
        WHEN 'BAJA'    THEN 4
    END,
    a.fecha_esperada ASC NULLS LAST;


-- ============================================================================
-- CONSULTA 7: Notificaciones no leidas de un usuario
-- ============================================================================

SELECT
    n.id,
    n.titulo,
    n.mensaje,
    n.canal,
    n.estado,
    n.created_at
FROM notifications.notifications n
WHERE n.usuario_id = '{{usuario_uuid}}'
  AND n.estado IN ('PENDIENTE', 'ENVIADA')
ORDER BY n.created_at DESC
LIMIT 20;


-- ============================================================================
-- CONSULTA 8: Mapa de calor — densidad de incidencias por area
-- ============================================================================
-- Caso: Visualizar concentracion de incidencias en el panel web.
-- Retorna centroides agrupados en celdas de ~100m (3 decimales de coordenada).

SELECT
    ST_X(ST_Centroid(ST_Collect(i.ubicacion))) AS centroide_lon,
    ST_Y(ST_Centroid(ST_Collect(i.ubicacion))) AS centroide_lat,
    COUNT(*)                                   AS cantidad,
    ROUND(AVG(ar.volumen_estimado_m3), 2)      AS volumen_promedio
FROM incidents.incidents i
LEFT JOIN ai.analysis_results ar ON ar.incident_id = i.id
WHERE i.created_at >= NOW() - INTERVAL '30 days'
  AND i.estado <> 'RECHAZADA'
GROUP BY
    ROUND(ST_X(i.ubicacion)::numeric, 3),
    ROUND(ST_Y(i.ubicacion)::numeric, 3)
HAVING COUNT(*) >= 2
ORDER BY cantidad DESC;


-- ============================================================================
-- CONSULTA 9: Perfil completo de un ciudadano (credenciales + perfil)
-- ============================================================================
-- Caso: El backend reconstruye el objeto usuario tras login.

SELECT
    u.id,
    u.email,
    u.username,
    u.rol,
    u.estado,
    u.is_verified,
    u.ultimo_login,
    c.nombre,
    c.apellido,
    c.cedula,
    c.telefono,
    c.avatar_url
FROM auth.users u
JOIN public.ciudadanos c ON c.user_id = u.id
WHERE u.id = '{{usuario_uuid}}';


-- ============================================================================
-- CONSULTA 10: Perfil completo de un operario/supervisor (credenciales + perfil)
-- ============================================================================
-- Caso: El backend reconstruye el objeto usuario del personal interno tras login.

SELECT
    u.id,
    u.email,
    u.username,
    u.rol,
    u.estado,
    u.ultimo_login,
    op.nombre,
    op.apellido,
    op.cedula,
    op.telefono,
    op.cargo,
    z.codigo  AS zona_codigo,
    z.nombre  AS zona_nombre
FROM auth.users u
JOIN operations.operarios op ON op.user_id = u.id
LEFT JOIN operations.zones z ON z.id = op.zona_id
WHERE u.id = '{{usuario_uuid}}';
