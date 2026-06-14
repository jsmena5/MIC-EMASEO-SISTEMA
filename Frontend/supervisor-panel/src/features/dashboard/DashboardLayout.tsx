import { NavLink, Outlet, useLocation } from "react-router-dom"
import Sidebar from "./Sidebar"
import Topbar from "./Topbar"
import type { ReactNode } from "react"

// ── Bottom navigation — solo visible en móvil (<sm) ─────────────────────────
const navItems = [
  {
    to: "/dashboard/home",
    label: "Inicio",
    icon: (active: boolean): ReactNode => (
      <svg className={active ? "text-[#005BAC]" : "text-slate-500"} width="22" height="22"
        viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
        strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 10.5 12 3l9 7.5" />
        <path d="M5.5 9.5V20h13V9.5" />
        <path d="M10 20v-5h4v5" />
      </svg>
    ),
  },
  {
    to: "/dashboard/incidentes",
    label: "Incidentes",
    icon: (active: boolean): ReactNode => (
      <svg className={active ? "text-[#005BAC]" : "text-slate-500"} width="22" height="22"
        viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
        strokeLinecap="round" strokeLinejoin="round">
        <path d="M6 4h12v16H6z" />
        <path d="M9 8h6M9 12h6M9 16h4" />
      </svg>
    ),
  },
  {
    to: "/dashboard/mapa",
    label: "Mapa",
    icon: (active: boolean): ReactNode => (
      <svg className={active ? "text-[#005BAC]" : "text-slate-500"} width="22" height="22"
        viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
        strokeLinecap="round" strokeLinejoin="round">
        <path d="M9 18l-5 2V6l5-2 6 2 5-2v14l-5 2z" />
        <path d="M9 4v14M15 6v14" />
      </svg>
    ),
  },
]

function BottomNav() {
  const location = useLocation()
  return (
    <nav className="sm:hidden fixed bottom-0 inset-x-0 z-30 flex h-16 items-center justify-around border-t border-slate-200 bg-white/95 backdrop-blur-sm">
      {navItems.map((item) => {
        const active = location.pathname.startsWith(item.to)
        return (
          <NavLink key={item.to} to={item.to}
            className="flex flex-col items-center justify-center gap-0.5 px-6 py-1">
            {item.icon(active)}
            <span className={["text-[10px] font-bold", active ? "text-[#005BAC]" : "text-slate-500"].join(" ")}>
              {item.label}
            </span>
          </NavLink>
        )
      })}
    </nav>
  )
}

export default function DashboardLayout() {
  return (
    <div className="flex h-screen bg-slate-50">
      {/* Sidebar: oculto en móvil, visible en sm+ */}
      <div className="hidden sm:block">
        <Sidebar />
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar />
        {/* pb-20 en móvil para que la bottom nav no tape el contenido */}
        <main className="flex-1 overflow-auto p-4 pb-20 sm:p-5 sm:pb-5">
          <Outlet />
        </main>
      </div>

      {/* Bottom nav solo en móvil */}
      <BottomNav />
    </div>
  )
}
