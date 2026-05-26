import { Link } from "react-router-dom";
import { getStoredUser } from "../../auth/authSession";

const responsibilities = [
  {
    step: "1",
    title: "Validar la incidencia",
    description:
      "Revisar la evidencia que envio el ciudadano y confirmar si el caso es real antes de moverlo en el flujo.",
  },
  {
    step: "2",
    title: "Corregir o confirmar la IA",
    description:
      "Decidir si la clasificacion automatica es correcta y dejar trazabilidad si hubo que ajustar tipo o severidad.",
  },
  {
    step: "3",
    title: "Dar seguimiento en campo",
    description:
      "Cuando sea necesario, acudir al lugar, actualizar el estado y registrar el cierre con foto y coordenadas.",
  },
];

const shortcuts = [
  {
    to: "/dashboard/incidencias",
    label: "Ir a incidencias",
    description: "Abrir la bandeja donde llegan los casos para revision y seguimiento.",
  },
  {
    to: "/dashboard/mapa",
    label: "Abrir mapa operativo",
    description: "Ver en mapa las incidencias registradas y su distribucion territorial.",
  },
];

export default function Home() {
  const user = getStoredUser();

  return (
    <div className="grid gap-6">
      <section className="rounded-[32px] bg-gradient-to-br from-[#005BAC] via-[#0B5EA8] to-[#003F7A] p-8 text-white shadow-[0_28px_70px_rgba(0,91,172,0.28)]">
        <div className="max-w-4xl">
          <div className="text-[11px] font-bold uppercase tracking-[0.3em] text-sky-100/80">
            Rol operativo
          </div>
          <h2 className="mt-3 text-4xl font-black leading-tight">
            El supervisor no administra usuarios. Gestiona incidencias.
          </h2>
          <p className="mt-4 text-base leading-7 text-sky-50/90">
            Tu trabajo empieza cuando llega una incidencia. Debes revisar si es real, validar o corregir la clasificacion de IA, dar seguimiento en campo cuando haga falta y mantener el estado sincronizado para que el ciudadano siempre vea el avance.
          </p>

          <div className="mt-6 inline-flex rounded-full border border-white/20 bg-white/10 px-4 py-2 text-sm font-semibold text-white/92">
            {user ? `${user.nombre} · ${user.rol}` : "Supervisor autenticado"}
          </div>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        {responsibilities.map((item) => (
          <article
            key={item.step}
            className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-[0_18px_40px_rgba(15,23,42,0.05)]"
          >
            <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-2xl bg-[#EBF4FF] text-lg font-black text-[#005BAC]">
              {item.step}
            </div>
            <h3 className="text-lg font-black text-slate-900">
              {item.title}
            </h3>
            <p className="mt-3 text-sm leading-6 text-slate-600">
              {item.description}
            </p>
          </article>
        ))}
      </section>

      <section className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
        <article className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-[0_18px_40px_rgba(15,23,42,0.05)]">
          <div className="text-[11px] font-bold uppercase tracking-[0.26em] text-slate-400">
            Flujo esperado
          </div>
          <h3 className="mt-3 text-2xl font-black text-slate-900">
            Como debe moverse una incidencia
          </h3>

          <div className="mt-6 grid gap-4">
            {[
              "Llega la incidencia con foto, ubicacion y clasificacion automatica.",
              "El supervisor valida si el caso existe y si la IA clasifico bien el residuo o la gravedad.",
              "Si el caso necesita atencion, actualiza el estado y coordina la atencion de campo.",
              "Cuando el requerimiento se resuelve, se registra una nueva foto y coordenadas para dejar evidencia del cierre.",
              "Todos los cambios quedan sincronizados con la app para informar al ciudadano.",
            ].map((step, index) => (
              <div key={step} className="flex gap-4 rounded-2xl bg-slate-50 p-4">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-white text-sm font-black text-[#005BAC] ring-1 ring-slate-200">
                  {index + 1}
                </div>
                <p className="text-sm leading-6 text-slate-700">{step}</p>
              </div>
            ))}
          </div>
        </article>

        <article className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-[0_18px_40px_rgba(15,23,42,0.05)]">
          <div className="text-[11px] font-bold uppercase tracking-[0.26em] text-slate-400">
            Accesos directos
          </div>
          <h3 className="mt-3 text-2xl font-black text-slate-900">
            Lo que mas usaras en el turno
          </h3>

          <div className="mt-6 space-y-3">
            {shortcuts.map((shortcut) => (
              <Link
                key={shortcut.to}
                to={shortcut.to}
                className="block rounded-[22px] border border-slate-200 bg-slate-50 px-5 py-4 transition hover:border-[#005BAC]/20 hover:bg-[#EBF4FF]"
              >
                <div className="text-sm font-black text-slate-900">
                  {shortcut.label}
                </div>
                <div className="mt-1 text-sm leading-6 text-slate-600">
                  {shortcut.description}
                </div>
              </Link>
            ))}
          </div>

          <div className="mt-6 rounded-[22px] bg-[#F8FAFC] p-5 text-sm leading-6 text-slate-600 ring-1 ring-slate-200">
            El mapa debe servir para ver el territorio y las incidencias registradas. La bandeja de incidencias es donde tomas decisiones, corriges la IA y cambias estados.
          </div>
        </article>
      </section>
    </div>
  );
}
