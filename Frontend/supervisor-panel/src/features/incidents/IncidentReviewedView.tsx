import { useState } from "react"
import type { IncidentDetail } from "../../services/incident.service"
import { toPublicMediaUrl } from "../../shared/api/mediaUrl"
import { NIVEL_LABEL, TIPO_LABEL, fmtDate, fmtPercent, fmtVolume } from "./styles"

export default function IncidentReviewedView({
  detail,
  onEdit,
}: {
  detail: IncidentDetail
  onEdit: () => void
}) {
  const imageUrl = toPublicMediaUrl(detail.image_url ?? detail.imagen_auditoria_url)
  const [lightboxOpen, setLightboxOpen] = useState(false)

  return (
    <div className="grid gap-5">
      {/* Imagen */}
      {imageUrl && (
        <>
          <button
            type="button"
            onClick={() => setLightboxOpen(true)}
            className="block w-full cursor-zoom-in overflow-hidden rounded-2xl border border-slate-200 bg-slate-900"
            title="Click para ver en grande"
          >
            <img
              src={imageUrl}
              alt="Incidente"
              className="aspect-video w-full object-contain"
            />
          </button>
          {lightboxOpen && (
            <div
              role="presentation"
              className="fixed inset-0 z-50 flex items-center justify-center bg-black/85"
              onClick={() => setLightboxOpen(false)}
            >
              <button
                type="button"
                className="absolute right-4 top-4 flex h-10 w-10 items-center justify-center rounded-full bg-white/20 text-white hover:bg-white/30"
                onClick={() => setLightboxOpen(false)}
              >
                ✕
              </button>
              <img
                src={imageUrl}
                alt="Incidente ampliado"
                className="max-h-[90vh] max-w-[90vw] rounded-xl object-contain shadow-2xl"
              />
            </div>
          )}
        </>
      )}

      {/* Resumen de la revisión */}
      <div className="rounded-2xl border border-sky-200 bg-sky-50 p-5 grid gap-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-sm font-extrabold text-sky-900">Revisión completada</div>
            <div className="text-xs text-sky-700 mt-0.5">
              Por {detail.supervisado_por ?? "supervisor"} · {fmtDate(detail.supervisado_at ?? detail.updated_at)}
            </div>
          </div>
          <button
            onClick={onEdit}
            className="rounded-xl border border-sky-300 bg-white px-3 py-2 text-xs font-bold text-sky-700 hover:bg-sky-100"
          >
            Editar revisión
          </button>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <KvRow
            label="Veredicto IA"
            value={(() => {
              if (detail.ia_fue_correcta === true) return "Correcta"
              if (detail.ia_fue_correcta === false) return "Incorrecta — corregida"
              return "No revisado"
            })()}
          />
          <KvRow label="Tipo de residuo" value={TIPO_LABEL[detail.tipo_residuo_supervisor ?? detail.tipo_residuo ?? ""] ?? "—"} />
          <KvRow label="Nivel acumulación" value={NIVEL_LABEL[detail.nivel_acumulacion_supervisor ?? detail.nivel_acumulacion ?? ""] ?? "—"} />
          <KvRow label="Confianza IA" value={fmtPercent(detail.confianza_decision ?? detail.confianza)} />
          <KvRow label="Volumen estimado" value={fmtVolume(detail.volumen_estimado_m3)} />
          <KvRow label="Detecciones" value={String(detail.num_detecciones ?? 0)} />
        </div>

        {detail.nota_supervision && (
          <div className="rounded-xl bg-white p-3">
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Comentario de auditoría</div>
            <div className="mt-1 text-xs text-slate-700 italic">"{detail.nota_supervision}"</div>
          </div>
        )}
      </div>
    </div>
  )
}

function KvRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-white p-2">
      <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{label}</div>
      <div className="mt-0.5 text-xs font-semibold text-slate-800">{value}</div>
    </div>
  )
}
