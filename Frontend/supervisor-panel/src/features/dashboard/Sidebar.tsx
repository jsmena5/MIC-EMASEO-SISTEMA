import { NavLink } from "react-router-dom"
import { useEffect, useState, type ReactNode } from "react"

const navigation = [
  { to: "/dashboard/home",        label: "Inicio",      iconKind: "home" as const },
  { to: "/dashboard/incidencias", label: "Incidencias", iconKind: "incidencias" as const },
  { to: "/dashboard/mapa",        label: "Mapa",        iconKind: "mapa" as const },
]

type IconKind = "home" | "incidencias" | "mapa"

function SidebarIcon({ kind }: { kind: IconKind }) {
  const paths: Record<IconKind, ReactNode> = {
    home: (
      <>
        <path d="M3 10.5 12 3l9 7.5" />
        <path d="M5.5 9.5V20h13V9.5" />
        <path d="M10 20v-5h4v5" />
      </>
    ),
    incidencias: (
      <>
        <path d="M6 4h12v16H6z" />
        <path d="M9 8h6" />
        <path d="M9 12h6" />
        <path d="M9 16h4" />
      </>
    ),
    mapa: (
      <>
        <path d="M9 18l-5 2V6l5-2 6 2 5-2v14l-5 2z" />
        <path d="M9 4v14" />
        <path d="M15 6v14" />
      </>
    ),
  }
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      {paths[kind]}
    </svg>
  )
}

const STORAGE_KEY = "sidebar-expanded"

export default function Sidebar() {
  // En tablet portrait (<1024px) colapsado por defecto, en landscape expandido.
  const [expanded, setExpanded] = useState<boolean>(() => {
    const saved = globalThis.window !== undefined ? localStorage.getItem(STORAGE_KEY) : null
    if (saved !== null) return saved === "true"
    return globalThis.window !== undefined ? window.innerWidth >= 1024 : true
  })

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, String(expanded))
  }, [expanded])

  return (
    <aside
      className={[
        "shrink-0 border-r border-slate-200 bg-white",
        "transition-[width] duration-200",
        expanded ? "w-56" : "w-20",
      ].join(" ")}
    >
      <div className="flex h-16 items-center gap-3 border-b border-slate-200 px-4">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#005BAC] text-white">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 3l7 3v5c0 4.5-3 7.5-7 10-4-2.5-7-5.5-7-10V6z" />
            <path d="M9.5 12.5l1.8 1.8L15 10.5" />
          </svg>
        </div>
        {expanded && (
          <div className="min-w-0 flex-1">
            <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">EMASEO EP</div>
            <div className="truncate text-sm font-extrabold text-slate-900">Supervisión</div>
          </div>
        )}
      </div>

      <nav className="space-y-1 px-2 py-3">
        {navigation.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            title={!expanded ? item.label : undefined}
            className={({ isActive }) =>
              [
                "group flex items-center gap-3 rounded-xl px-3 py-2.5 transition",
                "border-l-2",
                isActive
                  ? "border-[#005BAC] bg-[#EBF4FF] text-[#003F7A]"
                  : "border-transparent text-slate-600 hover:bg-slate-50",
              ].join(" ")
            }
          >
            <span className="shrink-0">
              <SidebarIcon kind={item.iconKind} />
            </span>
            {expanded && (
              <span className="truncate text-sm font-semibold">{item.label}</span>
            )}
          </NavLink>
        ))}
      </nav>

      <div className="px-2 pb-3">
        <button
          onClick={() => setExpanded((v) => !v)}
          className="flex w-full items-center justify-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-500 hover:bg-slate-50"
          title={expanded ? "Colapsar" : "Expandir"}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
               style={{ transform: expanded ? "rotate(180deg)" : undefined }}>
            <path d="M9 18l6-6-6-6" />
          </svg>
          {expanded && <span>Colapsar</span>}
        </button>
      </div>
    </aside>
  )
}
