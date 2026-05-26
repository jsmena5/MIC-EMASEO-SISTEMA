import { useMemo } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { getStoredUser, logoutStoredSession } from "../auth/authSession";

const pageMeta: Record<string, { title: string; subtitle: string }> = {
  "/dashboard/home": {
    title: "Resumen operativo",
    subtitle: "Responsabilidades del supervisor, prioridades del turno y accesos rapidos.",
  },
  "/dashboard/incidencias": {
    title: "Bandeja de incidencias",
    subtitle: "Validar si la incidencia es real, revisar la IA y actualizar el estado.",
  },
  "/dashboard/mapa": {
    title: "Mapa operativo",
    subtitle: "Solo las incidencias y zonas que pertenecen al supervisor autenticado.",
  },
};

export default function Topbar() {
  const navigate = useNavigate();
  const location = useLocation();
  const user = getStoredUser();

  const current = useMemo(() => {
    return pageMeta[location.pathname] ?? {
      title: "Panel de supervision",
      subtitle: "Gestiona las incidencias y el seguimiento de campo.",
    };
  }, [location.pathname]);

  const handleLogout = async () => {
    await logoutStoredSession();
    navigate("/", { replace: true });
  };

  return (
    <header className="border-b border-slate-200 bg-white/80 px-8 py-5 backdrop-blur-xl">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="text-[11px] font-bold uppercase tracking-[0.26em] text-slate-400">
            Centro de supervision EMASEO
          </div>
          <h1 className="mt-2 text-2xl font-black text-slate-900">
            {current.title}
          </h1>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-500">
            {current.subtitle}
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-right shadow-sm">
            <div className="text-sm font-extrabold text-slate-900">
              {user?.nombre ?? "Usuario no autenticado"}
            </div>
            <div className="mt-1 text-xs font-semibold uppercase tracking-[0.14em] text-[#005BAC]">
              {user?.rol ?? "Sin rol"}
            </div>
          </div>

          <button
            onClick={handleLogout}
            className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-700 transition hover:border-red-200 hover:bg-red-50 hover:text-red-600"
          >
            Cerrar sesion
          </button>
        </div>
      </div>
    </header>
  );
}
