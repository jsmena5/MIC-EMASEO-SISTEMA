type Step = 1 | 2 | 3

export default function Stepper({
  current,
  reachable,
  onJump,
}: {
  current: Step
  reachable: Step
  onJump: (step: Step) => void
}) {
  const steps: { n: Step; label: string }[] = [
    { n: 1, label: "Validar" },
    { n: 2, label: "Clasificar" },
    { n: 3, label: "Asignar" },
  ]

  return (
    <div className="flex items-center gap-2">
      {steps.map((s, idx) => {
        const isDone    = current > s.n
        const isCurrent = current === s.n
        const isReachable = s.n <= reachable
        return (
          <div key={s.n} className="flex items-center gap-2">
            <button
              disabled={!isReachable}
              onClick={() => isReachable && onJump(s.n)}
              className={[
                "flex items-center gap-2 rounded-full border px-3 py-1.5 transition",
                isCurrent
                  ? "border-[#005BAC] bg-[#005BAC] text-white"
                  : isDone
                  ? "border-green-200 bg-green-50 text-green-700"
                  : isReachable
                  ? "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                  : "border-slate-200 bg-white text-slate-300 cursor-not-allowed",
              ].join(" ")}
            >
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-white/20 text-[11px] font-bold">
                {isDone ? "✓" : s.n}
              </span>
              <span className="text-xs font-bold">{s.label}</span>
            </button>
            {idx < steps.length - 1 && <span className="text-slate-300">→</span>}
          </div>
        )
      })}
    </div>
  )
}
