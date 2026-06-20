-- ─────────────────────────────────────────────────────────────────────────────
-- Migración 034 — Reescritura de URLs de imágenes al proxy del api-gateway
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Problema:
--   Las imágenes se almacenaban con URLs apuntando directamente a MinIO
--   (http://localhost:9000/...). El puerto 9000 no se expone al host por defecto,
--   por lo que el navegador del supervisor recibía ERR_CONNECTION_REFUSED.
--
-- Solución (Migración 034):
--   Las URLs ahora apuntan al api-gateway (puerto 4000), que hace proxy interno
--   hacia MinIO usando la red Docker. MinIO no necesita estar expuesto al host.
--
--   Antes: http://localhost:9000/emaseo-incidents/incidents/<uuid>.jpg
--   Después: http://localhost:4000/api/media/emaseo-incidents/incidents/<uuid>.jpg
--
-- NOTAS:
--   • Esta migración es solo para bases de datos existentes.
--     En instalaciones frescas, S3_PUBLIC_URL ya genera las URLs correctas.
--   • El REPLACE funciona también para IPs de red (192.168.x.x:9000 → :4000/api/media).
--     Si usabas IP de LAN, ejecuta manualmente con los valores correctos.
--   • Las imágenes siguen siendo accesibles vía MinIO — solo cambia el proxy de entrega.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Imágenes principales (tabla incident_images)
UPDATE incidents.incident_images
SET    image_url = REPLACE(image_url, ':9000', ':4000/api/media')
WHERE  image_url LIKE '%:9000/%'
  AND  image_url NOT LIKE '%:4000/api/media%'; -- idempotente: no re-aplica si ya migrado

-- 2. Imágenes de auditoría (columna imagen_auditoria_url en incidents)
UPDATE incidents.incidents
SET    imagen_auditoria_url = REPLACE(imagen_auditoria_url, ':9000', ':4000/api/media')
WHERE  imagen_auditoria_url LIKE '%:9000/%'
  AND  imagen_auditoria_url NOT LIKE '%:4000/api/media%'; -- idempotente
