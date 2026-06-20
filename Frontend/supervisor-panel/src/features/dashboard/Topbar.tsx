import { useEffect, useRef, useState } from "react"
import { Link, useLocation, useNavigate } from "react-router-dom"
import { getStoredUser, logoutStoredSession } from "../auth/authSession"
import { getIncidents } from "../../services/incident.service"
import { Bell, Settings, LogOut, MapPin } from "lucide-react"
import { getMiZona } from "../../services/supervisor.service"

const PAGE_LABEL: Record<string, string> = {
  "/dashboard/home":           "Inicio",
  "/dashboard/incidentes":     "Incidentes",
  "/dashboard/mapa":           "Mapa operativo",
  "/dashboard/configuracion":  "Configuración",
}

function userInitials(name: string | undefined) {
  if (!name) return "U"
  const parts = name.trim().split(/\s+/)
  const [a, b] = parts
  return ((a?.[0] ?? "") + (b?.[0] ?? "")).toUpperCase() || "U"
}

export default function Topbar() {
  const navigate = useNavigate()
  const location = useLocation()
  const user = getStoredUser()
  const [menuOpen,   setMenuOpen]   = useState(false)
  const [pendientes, setPendientes] = useState<number | null>(null)
  const [zonaNombre, setZonaNombre] = useState<string | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)

  const title = PAGE_LABEL[location.pathname] ?? "Panel de supervisión"

  // Actualiza el título del tab del navegador al cambiar de página
  useEffect(() => {
    document.title = `${title} — EMASEO EP`
    return () => { document.title = "EMASEO EP — Supervisión" }
  }, [title])

  useEffect(() => {
    let alive = true
    const load = async () => {
      try {
        const { pagination } = await getIncidents({ estado: "PENDIENTE", limit: 1, page: 1 })
        if (alive) setPendientes(pagination.total)
      } catch {
        if (alive) setPendientes(null)
      }
    }
    load()
    const id = setInterval(load, 60_000)
    return () => { alive = false; clearInterval(id) }
  }, [])

  useEffect(() => {
    getMiZona()
      .then(({ zona }) => { if (zona) setZonaNombre(zona.nombre) })
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (!menuOpen) return
    const onClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false)
    }
    document.addEventListener("mousedown", onClickOutside)
    return () => document.removeEventListener("mousedown", onClickOutside)
  }, [menuOpen])

  const handleLogout = async () => {
    await logoutStoredSession()
    navigate("/", { replace: true })
  }

  return (
    <header className="flex h-14 items-center gap-3 border-b border-slate-200 bg-white px-4 sm:px-6">
      <h1 className="min-w-0 flex-1 truncate text-base font-extrabold text-slate-900 sm:text-lg">{title}</h1>

      <div className="flex items-center gap-3">
        {zonaNombre && (
          <span className="flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-600">
            <MapPin size={11} strokeWidth={2.5} className="text-slate-400" />
            {zonaNombre}
          </span>
        )}

        {pendientes !== null && pendientes > 0 && (
          <Link
            to="/dashboard/incidentes?estado=PENDIENTE&sin_supervisar=false"
            className="flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-800 hover:bg-amber-100 transition"
          >
            <Bell size={12} strokeWidth={2} />
            {pendientes} {pendientes === 1 ? "pendiente" : "pendientes"}
          </Link>
        )}

        <div ref={menuRef} className="relative">
          <button
            onClick={() => setMenuOpen((v) => !v)}
            className="flex h-9 w-9 items-center justify-center rounded-full bg-blue-700 text-sm font-bold text-white hover:bg-blue-800 transition"
            title={user?.nombre ?? "Usuario"}
          >
            {userInitials(user?.nombre)}
          </button>

          {menuOpen && (
            <div className="absolute right-0 top-12 z-10 w-56 rounded-2xl border border-slate-200 bg-white p-2 shadow-lg">
              <div className="px-3 py-2">
                <div className="text-sm font-bold text-slate-900">{user?.nombre ?? "Usuario"}</div>
                <div className="text-xs text-slate-500">{user?.rol ?? "Sin rol"}</div>
              </div>
              <hr className="my-1 border-slate-100" />
              <Link
                to="/dashboard/configuracion"
                onClick={() => setMenuOpen(false)}
                className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 transition"
              >
                <Settings size={15} className="text-slate-400" />
                Configuración
              </Link>
              <hr className="my-1 border-slate-100" />
              <button
                onClick={handleLogout}
                className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-medium text-red-600 hover:bg-red-50 transition"
              >
                <LogOut size={15} />
                Cerrar sesión
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  )
}
