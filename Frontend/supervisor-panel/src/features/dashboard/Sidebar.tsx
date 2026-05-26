import { NavLink } from "react-router-dom";

const navigation = [
  {
    section: "Supervision",
    items: [
      {
        to: "/dashboard/home",
        label: "Resumen operativo",
        description: "Ver prioridades y flujo del supervisor.",
      },
      {
        to: "/dashboard/incidencias",
        label: "Incidencias",
        description: "Revisar, clasificar y mover el estado del caso.",
      },
    ],
  },
  {
    section: "Territorio",
    items: [
      {
        to: "/dashboard/mapa",
        label: "Mapa operativo",
        description: "Ver en mapa las incidencias de tu zona.",
      },
    ],
  },
];

function SidebarIcon({ kind }: { kind: "home" | "incidencias" | "mapa" }) {
  const icons = {
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
  };

  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      {icons[kind]}
    </svg>
  );
}

function iconKindForPath(path: string): "home" | "incidencias" | "mapa" {
  if (path.includes("mapa")) return "mapa";
  if (path.includes("incidencias")) return "incidencias";
  return "home";
}

export default function Sidebar() {
  return (
    <aside className="w-[320px] shrink-0 border-r border-slate-200 bg-white/90 px-5 py-6 backdrop-blur-xl">
      <div className="mb-8 rounded-[28px] bg-gradient-to-br from-[#005BAC] via-[#0A4E90] to-[#003F7A] p-5 text-white shadow-[0_20px_50px_rgba(0,91,172,0.28)]">
        <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-white/16 text-white">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 3l7 3v5c0 4.5-3 7.5-7 10-4-2.5-7-5.5-7-10V6z" />
            <path d="M9.5 12.5l1.8 1.8L15 10.5" />
          </svg>
        </div>

        <div className="text-xs font-semibold uppercase tracking-[0.28em] text-sky-100/80">
          EMASEO EP
        </div>
        <h2 className="mt-2 text-2xl font-black leading-tight">
          Panel de supervision
        </h2>
        <p className="mt-3 text-sm leading-6 text-sky-50/88">
          El supervisor recibe incidencias, valida si son reales, corrige la clasificacion de IA y da seguimiento hasta el cierre.
        </p>
      </div>

      <div className="space-y-6">
        {navigation.map((group) => (
          <div key={group.section}>
            <div className="mb-3 px-2 text-[11px] font-bold uppercase tracking-[0.24em] text-slate-400">
              {group.section}
            </div>

            <nav className="space-y-2">
              {group.items.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className={({ isActive }) =>
                    [
                      "group flex items-start gap-3 rounded-[22px] border px-4 py-4 transition",
                      isActive
                        ? "border-[#005BAC]/25 bg-[#EBF4FF] text-[#003F7A] shadow-[0_16px_35px_rgba(0,91,172,0.10)]"
                        : "border-transparent bg-slate-50/80 text-slate-700 hover:border-slate-200 hover:bg-white",
                    ].join(" ")
                  }
                >
                  {({ isActive }) => (
                    <>
                      <div
                        className={[
                          "mt-0.5 flex h-10 w-10 items-center justify-center rounded-2xl",
                          isActive
                            ? "bg-[#005BAC] text-white"
                            : "bg-white text-slate-500 ring-1 ring-slate-200",
                        ].join(" ")}
                      >
                        <SidebarIcon kind={iconKindForPath(item.to)} />
                      </div>

                      <div className="min-w-0">
                        <div className="text-sm font-extrabold">
                          {item.label}
                        </div>
                        <div className="mt-1 text-xs leading-5 text-slate-500 group-[.active]:text-slate-600">
                          {item.description}
                        </div>
                      </div>
                    </>
                  )}
                </NavLink>
              ))}
            </nav>
          </div>
        ))}
      </div>
    </aside>
  );
}
