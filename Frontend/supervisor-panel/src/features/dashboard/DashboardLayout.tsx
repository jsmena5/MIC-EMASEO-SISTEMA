import { NavLink, Outlet, useLocation } from "react-router-dom"
import Sidebar from "./Sidebar"
import Topbar from "./Topbar"
import { Home, ClipboardList, Map } from "lucide-react"

const navItems = [
  { to: "/dashboard/home",       label: "Inicio",     Icon: Home          },
  { to: "/dashboard/incidentes", label: "Incidentes", Icon: ClipboardList },
  { to: "/dashboard/mapa",       label: "Mapa",       Icon: Map           },
]

function BottomNav() {
  const location = useLocation()
  return (
    <nav className="sm:hidden fixed bottom-0 inset-x-0 z-30 flex h-16 items-center justify-around border-t border-slate-200 bg-white/95 backdrop-blur-sm">
      {navItems.map(({ to, label, Icon }) => {
        const active = location.pathname.startsWith(to)
        return (
          <NavLink key={to} to={to}
            className="flex flex-col items-center justify-center gap-0.5 px-6 py-1">
            <Icon size={22} strokeWidth={1.8}
              className={active ? "text-blue-700" : "text-slate-400"} />
            <span className={["text-[10px] font-semibold", active ? "text-blue-700" : "text-slate-400"].join(" ")}>
              {label}
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
      <div className="hidden sm:block">
        <Sidebar />
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar />
        <main className="flex-1 overflow-auto p-4 pb-20 sm:p-5 sm:pb-5">
          <Outlet />
        </main>
      </div>
      <BottomNav />
    </div>
  )
}
