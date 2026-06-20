/**
 * Tooltip informativo accesible sin estado (hover/focus por CSS).
 *
 * Muestra un ícono "?" que al pasar el cursor revela una explicación corta.
 * Útil para aclarar conceptos del dominio (p. ej. "Confianza IA") sin saturar
 * la interfaz. Vive en shared/components porque es un primitivo de UI reusable.
 */
export default function InfoTooltip({ text }: Readonly<{ text: string }>) {
  return (
    <span className="group relative inline-flex items-center align-middle">
      <button
        type="button"
        aria-label={text}
        className="flex h-4 w-4 cursor-help items-center justify-center rounded-full bg-slate-300 text-[10px] font-bold text-white outline-none focus:ring-2 focus:ring-slate-400"
      >
        ?
      </button>
      <span
        role="tooltip"
        className="pointer-events-none invisible absolute bottom-full left-1/2 z-20 mb-1.5 w-60 -translate-x-1/2 rounded-lg bg-slate-800 px-3 py-2 text-[11px] font-normal leading-snug text-white opacity-0 shadow-lg transition group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100"
      >
        {text}
      </span>
    </span>
  )
}
