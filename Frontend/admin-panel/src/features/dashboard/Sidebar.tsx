import { NavLink } from "react-router-dom"
import { useEffect, useState, type ReactNode } from "react"

const navigation = [
  { to: "/dashboard/home",          label: "Inicio",        iconKind: "home"     as const },
  { to: "/dashboard/supervisores",  label: "Cuentas",       iconKind: "users"    as const },
  { to: "/dashboard/zonas",         label: "Zonas",         iconKind: "map"      as const },
  { to: "/dashboard/ia",            label: "Modelo IA",     iconKind: "ia"       as const },
  { to: "/dashboard/auditoria",     label: "Auditoría R2",  iconKind: "gallery"  as const },
  { to: "/dashboard/configuracion", label: "Configuración", iconKind: "settings" as const },
]

type IconKind = "home" | "users" | "map" | "ia" | "gallery" | "settings"

function SidebarIcon({ kind }: { kind: IconKind }) {
  const paths: Record<IconKind, ReactNode> = {
    home: (
      <>
        <path d="M3 10.5 12 3l9 7.5" />
        <path d="M5.5 9.5V20h13V9.5" />
        <path d="M10 20v-5h4v5" />
      </>
    ),
    users: (
      <>
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
      </>
    ),
    map: (
      <>
        <path d="M9 18l-5 2V6l5-2 6 2 5-2v14l-5 2z" />
        <path d="M9 4v14" />
        <path d="M15 6v14" />
      </>
    ),
    ia: (
      <>
        <path d="M12 2a4 4 0 0 1 4 4c0 1.5-.8 2.8-2 3.5V11h2a2 2 0 0 1 2 2v2a2 2 0 0 1-2 2h-1v1a3 3 0 0 1-6 0v-1H7a2 2 0 0 1-2-2v-2a2 2 0 0 1 2-2h2V9.5A4 4 0 0 1 12 2z" />
        <path d="M9 13h.01M15 13h.01" />
      </>
    ),
    gallery: (
      <>
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <circle cx="8.5" cy="8.5" r="1.5" />
        <path d="M21 15l-5-5L5 21" />
      </>
    ),
    settings: (
      <>
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
      </>
    ),
  }
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      {paths[kind]}
    </svg>
  )
}

const STORAGE_KEY = "admin-sidebar-expanded"

export default function Sidebar() {
  const [expanded, setExpanded] = useState<boolean>(() => {
    const saved = typeof window !== "undefined" ? localStorage.getItem(STORAGE_KEY) : null
    if (saved !== null) return saved === "true"
    return typeof window !== "undefined" ? window.innerWidth >= 1024 : true
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
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-indigo-600 text-white">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 3l7 3v5c0 4.5-3 7.5-7 10-4-2.5-7-5.5-7-10V6z" />
            <path d="M9.5 12.5l1.8 1.8L15 10.5" />
          </svg>
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
        {navigation.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            title={!expanded ? item.label : undefined}
            className={({ isActive }) =>
              [
                "group flex items-center gap-3 rounded-xl px-3 py-2.5 transition border-l-2",
                isActive
                  ? "border-indigo-600 bg-indigo-50 text-indigo-700"
                  : "border-transparent text-slate-600 hover:bg-slate-50",
              ].join(" ")
            }
          >
            <span className="shrink-0"><SidebarIcon kind={item.iconKind} /></span>
            {expanded && <span className="truncate text-sm font-semibold">{item.label}</span>}
          </NavLink>
        ))}
      </nav>

      {/* Collapse toggle */}
      <div className="px-2 pb-3">
        <button
          onClick={() => setExpanded((v) => !v)}
          className="flex w-full items-center justify-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-500 hover:bg-slate-50 transition"
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
