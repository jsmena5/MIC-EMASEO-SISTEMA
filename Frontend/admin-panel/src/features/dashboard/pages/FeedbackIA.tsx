import { useEffect, useState } from "react"
import { getIAEstadisticas, downloadIADataset } from "../../../services/ia.service"
import type { IAEstadisticasResponse, ErrorTipo, ErrorNivel, Correccion } from "../../../services/ia.service"

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtTime(iso: string) {
  const d = new Date(iso)
  return d.toLocaleDateString("es-EC", { day: "2-digit", month: "short", year: "numeric" })
}

function PrecisionBar({ pct }: { pct: number }) {
  const color = pct >= 80 ? "#16A34A" : pct >= 60 ? "#CA8A04" : "#DC2626"
  return (
    <div className="flex items-center gap-3">
      <div className="flex-1 rounded-full bg-slate-100" style={{ height: 10 }}>
        <div
          className="rounded-full transition-all duration-500"
          style={{ width: `${pct}%`, height: 10, background: color }}
        />
      </div>
      <span className="w-12 text-right text-sm font-bold tabular-nums" style={{ color }}>{pct}%</span>
    </div>
  )
}

// ─── KPI Card ─────────────────────────────────────────────────────────────────

function KpiCard({ label, value, hint, accent }: { label: string; value: string | number; hint: string; accent: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5">
      <div className="h-2 w-2 rounded-full mb-3" style={{ background: accent }} />
      <div className="text-3xl font-black text-slate-900 tabular-nums">{value}</div>
      <div className="mt-1 text-xs font-semibold text-slate-700">{label}</div>
      <div className="mt-0.5 text-[11px] text-slate-500">{hint}</div>
    </div>
  )
}

// ─── Errors by type table ─────────────────────────────────────────────────────

function ErroresTipoTable({ rows }: { rows: ErrorTipo[] }) {
  if (rows.length === 0) return (
    <div className="px-4 py-6 text-center text-sm text-slate-400">Sin correcciones registradas</div>
  )
  const maxTotal = Math.max(...rows.map((r) => parseInt(r.total)))
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-slate-100 bg-slate-50">
          {["IA predijo", "Real (supervisor)", "Casos", ""].map((h) => (
            <th key={h} className="px-4 py-2.5 text-left text-[11px] font-bold uppercase tracking-wider text-slate-500">{h}</th>
          ))}
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-100">
        {rows.map((r, i) => {
          const pct = Math.round((parseInt(r.total) / maxTotal) * 100)
          return (
            <tr key={i} className="hover:bg-slate-50">
              <td className="px-4 py-2.5">
                <span className="rounded-full bg-red-100 px-2.5 py-0.5 text-[11px] font-bold text-red-700">
                  {r.tipo_ml ?? "—"}
                </span>
              </td>
              <td className="px-4 py-2.5">
                <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-[11px] font-bold text-emerald-700">
                  {r.tipo_real ?? "Sin corrección"}
                </span>
              </td>
              <td className="px-4 py-2.5 font-bold tabular-nums">{r.total}</td>
              <td className="px-4 py-2.5 w-32">
                <div className="h-2 rounded-full bg-slate-100">
                  <div className="h-2 rounded-full bg-red-400" style={{ width: `${pct}%` }} />
                </div>
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

// ─── Errors by level table ────────────────────────────────────────────────────

const NIVEL_COLOR: Record<string, string> = {
  BAJO: "#16A34A", MEDIO: "#CA8A04", ALTO: "#EA580C", CRITICO: "#DC2626",
}

function ErroresNivelTable({ rows }: { rows: ErrorNivel[] }) {
  if (rows.length === 0) return (
    <div className="px-4 py-6 text-center text-sm text-slate-400">Sin correcciones registradas</div>
  )
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-slate-100 bg-slate-50">
          {["IA predijo", "Real (supervisor)", "Casos"].map((h) => (
            <th key={h} className="px-4 py-2.5 text-left text-[11px] font-bold uppercase tracking-wider text-slate-500">{h}</th>
          ))}
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-100">
        {rows.map((r, i) => (
          <tr key={i} className="hover:bg-slate-50">
            <td className="px-4 py-2.5">
              <span className="font-bold text-xs" style={{ color: NIVEL_COLOR[r.nivel_ml ?? ""] ?? "#6B7280" }}>
                {r.nivel_ml ?? "—"}
              </span>
            </td>
            <td className="px-4 py-2.5">
              <span className="font-bold text-xs" style={{ color: NIVEL_COLOR[r.nivel_real ?? ""] ?? "#16A34A" }}>
                {r.nivel_real ?? "Sin corrección"}
              </span>
            </td>
            <td className="px-4 py-2.5 font-bold tabular-nums">{r.total}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

// ─── Corrections list ─────────────────────────────────────────────────────────

function CorreccionesList({ rows }: { rows: Correccion[] }) {
  if (rows.length === 0) return (
    <div className="px-4 py-6 text-center text-sm text-slate-400">Sin correcciones aún</div>
  )
  return (
    <ul className="divide-y divide-slate-100">
      {rows.map((c) => (
        <li key={c.incident_id} className="flex items-start gap-4 px-5 py-3 hover:bg-slate-50 transition">
          {c.image_url && (
            <img
              src={c.image_url}
              alt="Evidencia"
              className="h-12 w-12 shrink-0 rounded-xl object-cover bg-slate-100"
              onError={(e) => { (e.target as HTMLImageElement).style.display = "none" }}
            />
          )}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[11px] font-mono text-slate-400">{c.incident_id.slice(0, 8)}…</span>
              <span className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-bold text-red-700">
                IA: {c.tipo_ml ?? "—"} / {c.nivel_ml ?? "—"}
              </span>
              <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-700">
                Real: {c.tipo_real ?? c.nivel_real ?? "Corregido"}
              </span>
              {c.confianza != null && (
                <span className="text-[10px] text-slate-400">confianza {Math.round(c.confianza * 100)}%</span>
              )}
            </div>
            {c.nota_supervision && (
              <p className="mt-1 text-xs text-slate-600 line-clamp-2">{c.nota_supervision}</p>
            )}
            <div className="mt-1 text-[10px] text-slate-400">
              {c.supervisor_email} · {fmtTime(c.supervisado_at)}
            </div>
          </div>
        </li>
      ))}
    </ul>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function FeedbackIA() {
  const [data,       setData]       = useState<IAEstadisticasResponse | null>(null)
  const [loading,    setLoading]    = useState(true)
  const [error,      setError]      = useState("")
  const [exporting,  setExporting]  = useState(false)

  useEffect(() => {
    getIAEstadisticas()
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : "Error"))
      .finally(() => setLoading(false))
  }, [])

  const handleExport = async () => {
    setExporting(true)
    try { await downloadIADataset() }
    catch (e) { setError(e instanceof Error ? e.message : "Error al exportar") }
    finally { setExporting(false) }
  }

  const pct = data ? parseFloat(data.totales.precision_pct ?? "0") : 0

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-extrabold text-slate-900">Calidad del modelo IA</h2>
          <p className="text-sm text-slate-500">Precisión basada en revisiones de supervisores</p>
        </div>
        <button
          onClick={() => void handleExport()}
          disabled={exporting || loading}
          className="flex items-center gap-2 rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-2.5 text-sm font-bold text-indigo-700 hover:bg-indigo-100 disabled:opacity-50 transition"
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
          </svg>
          {exporting ? "Exportando…" : "Exportar dataset (.json)"}
        </button>
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <KpiCard label="Total analizados"     value={loading ? "—" : data?.totales.total_analizados ?? "0"}   hint="Con resultado ML"       accent="#4F46E5" />
        <KpiCard label="Supervisados"         value={loading ? "—" : data?.totales.total_supervisados ?? "0"} hint="Con veredicto firmado"   accent="#0891B2" />
        <KpiCard label="Correctos"            value={loading ? "—" : data?.totales.correctos ?? "0"}          hint="IA acertó"              accent="#16A34A" />
        <KpiCard label="Corregidos"           value={loading ? "—" : data?.totales.incorrectos ?? "0"}        hint="IA se equivocó"         accent="#DC2626" />
        <KpiCard label="Sin revisar"          value={loading ? "—" : data?.totales.pendientes_revision ?? "0"} hint="Pendientes de revisión" accent="#CA8A04" />
      </div>

      {/* Precision meter */}
      <div className="rounded-2xl border border-slate-200 bg-white p-6">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <div className="text-sm font-extrabold text-slate-900">Precisión global del modelo</div>
            <div className="text-xs text-slate-500">Sobre análisis revisados por supervisores</div>
          </div>
          <div className="text-2xl font-black tabular-nums" style={{ color: pct >= 80 ? "#16A34A" : pct >= 60 ? "#CA8A04" : "#DC2626" }}>
            {loading ? "—" : `${pct}%`}
          </div>
        </div>
        {!loading && <PrecisionBar pct={pct} />}
        <div className="mt-3 flex gap-4 text-[11px] text-slate-500">
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-emerald-500" /> ≥ 80% Buen rendimiento</span>
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-amber-500" /> 60-79% Revisar dataset</span>
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-red-500" /> &lt; 60% Reentrenamiento urgente</span>
        </div>
      </div>

      {/* Error tables */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
          <div className="border-b border-slate-100 bg-slate-50 px-4 py-3">
            <div className="text-sm font-extrabold text-slate-900">Errores por tipo de residuo</div>
            <div className="text-xs text-slate-500">Qué predijo la IA vs qué era real</div>
          </div>
          {loading
            ? <div className="px-4 py-6 text-center text-sm text-slate-400">Cargando…</div>
            : <ErroresTipoTable rows={data?.errores_por_tipo ?? []} />}
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
          <div className="border-b border-slate-100 bg-slate-50 px-4 py-3">
            <div className="text-sm font-extrabold text-slate-900">Errores por nivel de acumulación</div>
            <div className="text-xs text-slate-500">Severidad predicha vs real</div>
          </div>
          {loading
            ? <div className="px-4 py-6 text-center text-sm text-slate-400">Cargando…</div>
            : <ErroresNivelTable rows={data?.errores_por_nivel ?? []} />}
        </div>
      </div>

      {/* Recent corrections */}
      <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
        <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50 px-4 py-3">
          <div>
            <div className="text-sm font-extrabold text-slate-900">Últimas correcciones supervisadas</div>
            <div className="text-xs text-slate-500">Análisis donde la IA fue corregida · últimas 25</div>
          </div>
        </div>
        {loading
          ? <div className="px-4 py-6 text-center text-sm text-slate-400">Cargando…</div>
          : <CorreccionesList rows={data?.ultimas_correcciones ?? []} />}
      </div>
    </div>
  )
}
