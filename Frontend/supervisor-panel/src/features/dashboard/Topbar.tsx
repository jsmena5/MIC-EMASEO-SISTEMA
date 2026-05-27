import { useEffect, useRef, useState } from "react"
import { Link, useLocation, useNavigate } from "react-router-dom"
import { getStoredUser, logoutStoredSession } from "../auth/authSession"
import { getIncidents } from "../../services/incident.service"

const pageTitle: Record<string, string> = {
  "/dashboard/home":        "Inicio",
  "/dashboard/incidencias": "Bandeja de incidencias",
  "/dashboard/mapa":        "Mapa operativo",
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
  const [menuOpen, setMenuOpen] = useState(false)
  const [pendientes, setPendientes] = useState<number | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)

  const title = pageTitle[location.pathname] ?? "Panel de supervisión"

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
    <header className="flex h-16 items-center justify-between border-b border-slate-200 bg-white px-6">
      <h1 className="text-lg font-extrabold text-slate-900">{title}</h1>

      <div className="flex items-center gap-3">
        {pendientes !== null && pendientes > 0 && (
          <Link
            to="/dashboard/incidencias?estado=PENDIENTE"
            className="flex items-center gap-2 rounded-full border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-bold text-amber-700 hover:bg-amber-100"
          >
            <span className="h-2 w-2 rounded-full bg-amber-500" />
            {pendientes} {pendientes === 1 ? "pendiente" : "pendientes"}
          </Link>
        )}

        <div ref={menuRef} className="relative">
          <button
            onClick={() => setMenuOpen((v) => !v)}
            className="flex h-10 w-10 items-center justify-center rounded-full bg-[#005BAC] text-sm font-bold text-white hover:bg-[#004B8E]"
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
              <button
                onClick={handleLogout}
                className="block w-full rounded-lg px-3 py-2 text-left text-sm font-semibold text-red-600 hover:bg-red-50"
              >
                Cerrar sesión
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  )
}
