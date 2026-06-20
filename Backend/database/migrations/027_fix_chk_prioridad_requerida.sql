-- A-13: Ampliar chk_prioridad_requerida para cubrir PROCESANDO y FALLIDO
--
-- El flujo de reporte crea incidentes con estado PROCESANDO (prioridad aún
-- sin asignar por la IA) y puede terminar en FALLIDO también sin prioridad.
-- La constraint original solo eximía PENDIENTE y RECHAZADA, lo que provocaría
-- un error de CHECK si algún código inserta/actualiza con esos estados y
-- prioridad NULL.
--
-- Estrategia: DROP + ADD dentro de una transacción para que sea atómica.

BEGIN;

ALTER TABLE incidents.incidents
    DROP CONSTRAINT IF EXISTS chk_prioridad_requerida;

ALTER TABLE incidents.incidents
    ADD CONSTRAINT chk_prioridad_requerida CHECK (
        prioridad IS NOT NULL
        OR estado IN ('PENDIENTE', 'RECHAZADA', 'PROCESANDO', 'FALLIDO')
    );

COMMIT;
