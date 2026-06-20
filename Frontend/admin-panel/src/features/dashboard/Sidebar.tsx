import { NavLink } from "react-router-dom"
import { useEffect, useState } from "react"
import { Home, Users, Map, Brain, Images, Settings, ChevronLeft, ChevronRight, Shield, HardHat, Globe } from "lucide-react"

const navigation = [
  { to: "/dashboard/home",          label: "Inicio",        Icon: Home     },
  { to: "/dashboard/supervisores",  label: "Supervisores",  Icon: Users    },
  { to: "/dashboard/operarios",     label: "Operarios",     Icon: HardHat  },
  { to: "/dashboard/zonas",         label: "Zonas",         Icon: Map      },
  { to: "/dashboard/mapa",          label: "Mapa",          Icon: Globe    },
  { to: "/dashboard/ia",            label: "Modelo IA",     Icon: Brain    },
  { to: "/dashboard/auditoria",     label: "Auditoría R2",  Icon: Images   },
  { to: "/dashboard/configuracion", label: "Configuración", Icon: Settings },
]

const STORAGE_KEY = "admin-sidebar-expanded"

export default function Sidebar() {
  const [expanded, setExpanded] = useState<boolean>(() => {
    const saved = globalThis.window === undefined ? null : localStorage.getItem(STORAGE_KEY)
    if (saved !== null) return saved === "true"
    return globalThis.window === undefined ? true : window.innerWidth >= 1024
  })

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, String(expanded))
  }, [expanded])

  return (
    <aside className={[
      "shrink-0 border-r border-slate-200 bg-white flex flex-col",
      "transition-[width] duration-200",
      expanded ? "w-56" : "w-[68px]",
    ].join(" ")}>

      {/* Logo */}
      <div className="flex h-16 items-center gap-3 border-b border-slate-200 px-4">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-800 text-white">
          <Shield size={18} strokeWidth={1.8} />
        </div>
        {expanded && (
          <div className="min-w-0 flex-1">
            <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">EMASEO EP</div>
            <div className="truncate text-sm font-extrabold text-slate-900">Administrador</div>
          </div>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 space-y-1 px-2 py-3">
        {navigation.map(({ to, label, Icon }) => (
          <NavLink
            key={to}
            to={to}
            title={expanded ? undefined : label}
            className={({ isActive }) =>
              [
                "group flex items-center gap-3 rounded-xl px-3 py-2.5 transition border-l-2",
                isActive
                  ? "border-slate-800 bg-slate-100 text-slate-900"
                  : "border-transparent text-slate-500 hover:bg-slate-50 hover:text-slate-800",
              ].join(" ")
            }
          >
            <span className="shrink-0"><Icon size={20} strokeWidth={1.8} /></span>
            {expanded && <span className="truncate text-sm font-semibold">{label}</span>}
          </NavLink>
        ))}
      </nav>

      {/* Collapse toggle */}
      <div className="px-2 pb-3">
        <button
          onClick={() => setExpanded(v => !v)}
          className="flex w-full items-center justify-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-400 hover:bg-slate-50 hover:text-slate-600 transition"
          title={expanded ? "Colapsar" : "Expandir"}
        >
          {expanded ? <ChevronLeft size={14} /> : <ChevronRight size={14} />}
          {expanded && <span>Colapsar</span>}
        </button>
      </div>
    </aside>
  )
}
