import { useEffect, useRef, useState } from "react"
import { useLocation, useNavigate } from "react-router-dom"
import { getStoredUser, logoutStoredSession } from "../auth/authSession"

const PAGE_TITLES: Record<string, string> = {
  "/dashboard/home":          "Inicio",
  "/dashboard/supervisores":  "Gestión de supervisores",
  "/dashboard/zonas":         "Gestión de zonas",
  "/dashboard/configuracion": "Configuración del sistema",
}

function userInitials(name?: string) {
  if (!name) return "A"
  const parts = name.trim().split(/\s+/)
  const [a, b] = parts
  return ((a?.[0] ?? "") + (b?.[0] ?? "")).toUpperCase() || "A"
}

export default function Topbar() {
  const navigate  = useNavigate()
  const location  = useLocation()
  const user      = getStoredUser()
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef   = useRef<HTMLDivElement | null>(null)

  const title = PAGE_TITLES[location.pathname] ?? "Panel Administrador"

  useEffect(() => {
    if (!menuOpen) return
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false)
    }
    document.addEventListener("mousedown", handler)
    return () => document.removeEventListener("mousedown", handler)
  }, [menuOpen])

  const handleLogout = async () => {
    await logoutStoredSession()
    navigate("/", { replace: true })
  }

  return (
    <header className="flex h-16 items-center justify-between border-b border-slate-200 bg-white px-6">
      <div className="flex items-center gap-3">
        <h1 className="text-lg font-extrabold text-slate-900">{title}</h1>
        <span className="rounded-full border border-indigo-200 bg-indigo-50 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-indigo-600">
          Admin
        </span>
      </div>

      <div ref={menuRef} className="relative">
        <button
          onClick={() => setMenuOpen((v) => !v)}
          className="flex h-9 w-9 items-center justify-center rounded-full bg-indigo-600 text-sm font-bold text-white hover:bg-indigo-500 transition"
          title={user?.nombre ?? "Administrador"}
        >
          {userInitials(user?.nombre)}
        </button>

        {menuOpen && (
          <div className="absolute right-0 top-11 z-10 w-56 rounded-2xl border border-slate-200 bg-white p-2 shadow-lg">
            <div className="px-3 py-2">
              <div className="text-sm font-bold text-slate-900">{user?.nombre ?? "Administrador"}</div>
              <div className="text-xs text-indigo-600 font-semibold">Administrador del sistema</div>
            </div>
            <hr className="my-1 border-slate-100" />
            <button
              onClick={() => { setMenuOpen(false); navigate("/dashboard/configuracion") }}
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition"
            >
              <svg className="h-4 w-4 text-slate-400" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              Configuración
            </button>
            <hr className="my-1 border-slate-100" />
            <button
              onClick={() => void handleLogout()}
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-semibold text-red-600 hover:bg-red-50 transition"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
              Cerrar sesión
            </button>
          </div>
        )}
      </div>
    </header>
  )
}
