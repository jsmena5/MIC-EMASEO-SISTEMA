import { useEffect, useRef, useState } from "react"
import { Link, useLocation, useNavigate } from "react-router-dom"
import { getStoredUser, logoutStoredSession } from "../auth/authSession"
import { getIncidents } from "../../services/incident.service"

const pageTitle: Record<string, string> = {
  "/dashboard/home":           "Inicio",
  "/dashboard/incidencias":    "Bandeja de incidencias",
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
              <Link
                to="/dashboard/configuracion"
                onClick={() => setMenuOpen(false)}
                className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                <svg className="h-4 w-4 text-slate-400" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                Configuración
              </Link>
              <hr className="my-1 border-slate-100" />
              <button
                onClick={handleLogout}
                className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-semibold text-red-600 hover:bg-red-50"
              >
                <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                </svg>
                Cerrar sesión
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  )
}
