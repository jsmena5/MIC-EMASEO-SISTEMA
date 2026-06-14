/**
 * IncidentsLayout — envoltura de la sección Incidentes.
 * Renderiza dos sub-pestañas: CASOS (lista revisable) y DASHBOARD (analíticas).
 *
 * La pestaña activa se persiste en el query param ?tab=casos|dashboard
 * para que el botón atrás del navegador funcione correctamente.
 */
import { useSearchParams } from "react-router-dom"
import IncidentsPage from "./IncidentsPage"
import IncidentsDashboard from "./IncidentsDashboard"

type Tab = "casos" | "dashboard"

function TabBtn({ label, active, onClick }: Readonly<{ label: string; active: boolean; onClick: () => void }>) {
  return (
    <button
      onClick={onClick}
      className={[
        "px-5 py-2.5 text-sm font-bold rounded-xl transition",
        active
          ? "bg-[#005BAC] text-white shadow-sm"
          : "text-slate-500 hover:text-slate-900 hover:bg-slate-100",
      ].join(" ")}
    >
      {label}
    </button>
  )
}

export default function IncidentsLayout() {
  const [params, setParams] = useSearchParams()
  const tab: Tab = (params.get("tab") as Tab) ?? "casos"

  const setTab = (t: Tab) => {
    const next = new URLSearchParams(params)
    next.set("tab", t)
    // Limpiar filtros de lista al cambiar de pestaña
    next.delete("estado")
    next.delete("prioridad")
    next.delete("id")
    next.delete("sin_supervisar")
    setParams(next, { replace: true })
  }

  return (
    <div className="flex flex-col gap-4">
      {/* ── Tab bar ─────────────────────────────────────────────── */}
      <div className="flex items-center gap-1 rounded-2xl bg-slate-100 p-1 w-fit">
        <TabBtn label="Casos"     active={tab === "casos"}     onClick={() => setTab("casos")}     />
        <TabBtn label="Dashboard" active={tab === "dashboard"} onClick={() => setTab("dashboard")} />
      </div>

      {/* ── Contenido de la pestaña activa ──────────────────────── */}
      {tab === "casos"     && <IncidentsPage />}
      {tab === "dashboard" && <IncidentsDashboard />}
    </div>
  )
}
