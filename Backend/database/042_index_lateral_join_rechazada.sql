-- Índice parcial para acelerar el LATERAL JOIN en getMyIncidents/getMyIncidentById.
-- El join busca la fila más reciente de status_history donde estado_nuevo='RECHAZADA'
-- por incidente. Sin este índice, PostgreSQL hace seq-scan de status_history por
-- cada incidente del ciudadano, causando timeout en conexiones pgBouncer.
CREATE INDEX IF NOT EXISTS idx_sh_incident_rechazada_desc
  ON incidents.status_history (incident_id, created_at DESC)
  WHERE estado_nuevo = 'RECHAZADA';
