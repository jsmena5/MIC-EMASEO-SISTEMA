-- ─────────────────────────────────────────────────────────────────────────────
-- Migración 035 — Corrige el bucket duplicado en URLs públicas de Cloudflare R2
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Problema:
--   El image-service construía la URL pública como `${S3_PUBLIC_URL}/${BUCKET}/${key}`.
--   Con Cloudflare R2 el dominio público (pub-xxx.r2.dev) YA está ligado al bucket,
--   por lo que el bucket NO debe ir en el path. El resultado:
--     https://pub-xxx.r2.dev/emaseo-incidents/incidents/<uuid>.jpg  → HTTP 404
--   La URL correcta es:
--     https://pub-xxx.r2.dev/incidents/<uuid>.jpg                   → HTTP 200
--
-- Solución:
--   1. Código: image.service.js ya construye `${S3_PUBLIC_URL}/${key}` (sin bucket)
--      para URLs nuevas (requiere redesplegar el image-service).
--   2. Esta migración corrige las URLs ya persistidas, quitando el segmento del
--      bucket "emaseo-incidents" que aparece antes del prefijo "incidents/".
--
-- Idempotente: el WHERE solo selecciona filas que aún tienen el bucket duplicado;
-- una vez corregidas, no vuelve a aplicar.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Imágenes principales (tabla incident_images)
UPDATE incidents.incident_images
SET    image_url = REPLACE(image_url, '/emaseo-incidents/incidents/', '/incidents/')
WHERE  image_url LIKE '%/emaseo-incidents/incidents/%';

-- 2. Imágenes de auditoría (columna imagen_auditoria_url en incidents), si aplica
UPDATE incidents.incidents
SET    imagen_auditoria_url = REPLACE(imagen_auditoria_url, '/emaseo-incidents/incidents/', '/incidents/')
WHERE  imagen_auditoria_url LIKE '%/emaseo-incidents/incidents/%';
