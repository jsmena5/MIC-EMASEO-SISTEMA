import { useCallback, useEffect, useRef, useState } from "react"
import {
  getOperarios, createOperario, updateOperario, deleteOperario,
} from "../../../services/operario.service"
import type { Operario, CreateOperarioPayload, UpdateOperarioPayload } from "../../../services/operario.service"
import { listZonas } from "../../../services/zona.service"
import type { Zona } from "../../../services/zona.service"

const ESTADO_STYLE: Record<string, string> = {
  ACTIVO:     "bg-emerald-100 text-emerald-700",
  INACTIVO:   "bg-slate-100 text-slate-500",
  SUSPENDIDO: "bg-amber-100 text-amber-700",
}

// ─── Modal base ───────────────────────────────────────────────────────────────

function Modal({ title, onClose, children }: Readonly<{ title: string; onClose: () => void; children: React.ReactNode }>) {
  const overlay = useRef<HTMLDivElement>(null)
  return (
    <div ref={overlay} aria-hidden="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
      onClick={e => { if (e.target === overlay.current) onClose() }}
      onKeyDown={e => { if (e.key === "Escape") onClose() }}>
      <div className="w-full max-w-lg rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
          <h2 className="text-base font-extrabold text-slate-900">{title}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 transition text-xl leading-none">×</button>
        </div>
        <div className="px-6 py-5">{children}</div>
      </div>
    </div>
  )
}

function Field({ label, name, type = "text", value, onChange, required, placeholder }: Readonly<{
  label: string; name: string; type?: string; value: string
  onChange: (v: string) => void; required?: boolean; placeholder?: string
}>) {
  return (
    <div>
      <label className="mb-1 block text-xs font-semibold text-slate-600">
        {label}{required && <span className="ml-0.5 text-red-500">*</span>}
      </label>
      <input type={type} name={name} value={value} onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm text-slate-900 focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200 transition" />
    </div>
  )
}

// ─── Crear operario ───────────────────────────────────────────────────────────

const EMPTY: CreateOperarioPayload = { nombre: "", apellido: "", cedula: "", telefono: "", email: "", cargo: "", password: "", zona_id: null }

function CreateModal({ zonas, onClose, onCreated }: Readonly<{ zonas: Zona[]; onClose: () => void; onCreated: () => void }>) {
  const [form, setForm]     = useState<CreateOperarioPayload>(EMPTY)
  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState("")
  const [tempPwd, setTempPwd] = useState<string | null>(null)

  const set = (k: keyof CreateOperarioPayload) => (v: string) => setForm(f => ({ ...f, [k]: v }))

  const handleSubmit = async () => {
    if (!form.nombre || !form.apellido || !form.cedula || !form.telefono || !form.email) {
      setError("Completa todos los campos obligatorios"); return
    }
    setError(""); setSaving(true)
    try {
      const payload = { ...form }
      if (!payload.password) delete payload.password
      if (!payload.cargo) delete payload.cargo
      const res = await createOperario(payload)
      if (res.password_temporal) setTempPwd(res.password_temporal)
      else { onCreated(); onClose() }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al crear")
    } finally { setSaving(false) }
  }

  if (tempPwd) return (
    <Modal title="Operario creado" onClose={() => { onCreated(); onClose() }}>
      <div className="space-y-4">
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
          <div className="text-sm font-bold text-emerald-700 mb-2">¡Operario creado exitosamente!</div>
          <div className="text-xs text-emerald-600">Contraseña temporal — entrégala al operario para su primer ingreso:</div>
          <div className="mt-3 rounded-lg border border-emerald-300 bg-white px-4 py-2.5 font-mono text-base font-bold text-slate-900 text-center tracking-widest select-all">
            {tempPwd}
          </div>
          <div className="mt-2 text-[11px] text-emerald-600">El operario la usará para ingresar a la app móvil.</div>
        </div>
        <button onClick={() => { onCreated(); onClose() }}
          className="w-full rounded-xl bg-slate-800 px-4 py-2.5 text-sm font-bold text-white hover:bg-slate-700 transition">
          Entendido
        </button>
      </div>
    </Modal>
  )

  return (
    <Modal title="Nuevo operario de campo" onClose={onClose}>
      <div className="space-y-3">
        {error && <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Nombre"   name="nombre"   value={form.nombre}   onChange={set("nombre")}   required placeholder="Juan" />
          <Field label="Apellido" name="apellido" value={form.apellido} onChange={set("apellido")} required placeholder="Pérez" />
        </div>
        <Field label="Cédula (10 dígitos)" name="cedula"   value={form.cedula}   onChange={set("cedula")}   required placeholder="1234567890" />
        <Field label="Teléfono"             name="telefono" value={form.telefono} onChange={set("telefono")} required placeholder="+593 99 000 0000" />
        <Field label="Correo electrónico"   name="email"    value={form.email}    onChange={set("email")}    required type="email" placeholder="operario@emaseo.gob.ec" />
        <Field label="Cargo (opcional)"     name="cargo"    value={form.cargo ?? ""} onChange={set("cargo")} placeholder="Operario de campo" />
        <div>
          <label className="mb-1 block text-xs font-semibold text-slate-600">Zona asignada (opcional)</label>
          <select
            value={form.zona_id ?? ""}
            onChange={e => setForm(f => ({ ...f, zona_id: e.target.value || null }))}
            className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm text-slate-900 focus:border-slate-400 focus:outline-none transition"
          >
            <option value="">Sin zona</option>
            {zonas.map(z => (
              <option key={z.id} value={z.id}>{z.nombre}</option>
            ))}
          </select>
        </div>
        <Field label="Contraseña (opcional — se genera si se omite)" name="password" type="password"
          value={form.password ?? ""} onChange={set("password")} placeholder="••••••••" />
        <div className="flex justify-end gap-3 pt-2">
          <button onClick={onClose} className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50 transition">Cancelar</button>
          <button onClick={() => void handleSubmit()} disabled={saving}
            className="rounded-xl bg-slate-800 px-5 py-2 text-sm font-bold text-white hover:bg-slate-700 disabled:opacity-60 transition">
            {saving ? "Creando…" : "Crear operario"}
          </button>
        </div>
      </div>
    </Modal>
  )
}

// ─── Editar operario ──────────────────────────────────────────────────────────

function EditModal({ op, zonas, onClose, onSaved }: Readonly<{
  op: Operario; zonas: Zona[]; onClose: () => void; onSaved: () => void
}>) {
  const [form, setForm]     = useState<UpdateOperarioPayload>({
    nombre: op.nombre, apellido: op.apellido, telefono: op.telefono,
    cargo: op.cargo ?? "", estado: op.estado, zona_id: op.zona_id,
  })
  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState("")

  const set = (k: keyof UpdateOperarioPayload) => (v: string) => setForm(f => ({ ...f, [k]: v }))

  const handleSubmit = async () => {
    if (!form.nombre || !form.apellido) { setError("Nombre y apellido son obligatorios"); return }
    setError(""); setSaving(true)
    try {
      await updateOperario(op.id, form)
      onSaved(); onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al actualizar")
    } finally { setSaving(false) }
  }

  return (
    <Modal title={`Editar — ${op.nombre} ${op.apellido}`} onClose={onClose}>
      <div className="space-y-3">
        {error && <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Nombre"   name="nombre"   value={form.nombre ?? ""}   onChange={set("nombre")}   required />
          <Field label="Apellido" name="apellido" value={form.apellido ?? ""} onChange={set("apellido")} required />
        </div>
        <Field label="Teléfono" name="telefono" value={form.telefono ?? ""} onChange={set("telefono")} />
        <Field label="Cargo"    name="cargo"    value={form.cargo    ?? ""} onChange={set("cargo")} />
        <div>
          <label className="mb-1 block text-xs font-semibold text-slate-600">Estado</label>
          <select value={form.estado} onChange={e => setForm(f => ({ ...f, estado: e.target.value as UpdateOperarioPayload["estado"] }))}
            className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm text-slate-900 focus:border-slate-400 focus:outline-none transition">
            <option value="ACTIVO">ACTIVO</option>
            <option value="INACTIVO">INACTIVO</option>
            <option value="SUSPENDIDO">SUSPENDIDO</option>
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold text-slate-600">Zona asignada</label>
          <select
            value={form.zona_id ?? ""}
            onChange={e => setForm(f => ({ ...f, zona_id: e.target.value || null }))}
            className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm text-slate-900 focus:border-slate-400 focus:outline-none transition"
          >
            <option value="">Sin zona</option>
            {zonas.map(z => (
              <option key={z.id} value={z.id}>{z.nombre}</option>
            ))}
          </select>
        </div>
        <div className="flex justify-end gap-3 pt-2">
          <button onClick={onClose} className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50 transition">Cancelar</button>
          <button onClick={() => void handleSubmit()} disabled={saving}
            className="rounded-xl bg-slate-800 px-5 py-2 text-sm font-bold text-white hover:bg-slate-700 disabled:opacity-60 transition">
            {saving ? "Guardando…" : "Guardar cambios"}
          </button>
        </div>
      </div>
    </Modal>
  )
}

// ─── Confirmar desactivación ──────────────────────────────────────────────────

function DeleteConfirm({ op, onClose, onDeleted }: Readonly<{ op: Operario; onClose: () => void; onDeleted: () => void }>) {
  const [deleting, setDeleting] = useState(false)
  const [error, setError]       = useState("")

  const handleDelete = async () => {
    setDeleting(true)
    try { await deleteOperario(op.id); onDeleted(); onClose() }
    catch (err) { setError(err instanceof Error ? err.message : "Error al desactivar") }
    finally { setDeleting(false) }
  }

  return (
    <Modal title="Desactivar operario" onClose={onClose}>
      <div className="space-y-4">
        <p className="text-sm text-slate-600">
          ¿Desactivar a <strong>{op.nombre} {op.apellido}</strong>? Su cuenta quedará como <span className="font-bold">INACTIVO</span> — no podrá ingresar a la app hasta ser reactivado.
        </p>
        {error && <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>}
        <div className="flex justify-end gap-3">
          <button onClick={onClose} className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50 transition">Cancelar</button>
          <button onClick={() => void handleDelete()} disabled={deleting}
            className="rounded-xl bg-red-700 px-5 py-2 text-sm font-bold text-white hover:bg-red-800 disabled:opacity-60 transition">
            {deleting ? "Desactivando…" : "Desactivar"}
          </button>
        </div>
      </div>
    </Modal>
  )
}

// ─── Página principal ─────────────────────────────────────────────────────────

export default function Operarios() {
  const [operarios,    setOperarios]    = useState<Operario[]>([])
  const [zonas,        setZonas]        = useState<Zona[]>([])
  const [loading,      setLoading]      = useState(true)
  const [error,        setError]        = useState("")
  const [search,       setSearch]       = useState("")
  const [showCreate,   setShowCreate]   = useState(false)
  const [editTarget,   setEditTarget]   = useState<Operario | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Operario | null>(null)

  const load = useCallback(async () => {
    setLoading(true); setError("")
    try {
      const [ops, zon] = await Promise.all([getOperarios(), listZonas()])
      setOperarios(ops)
      setZonas(zon.zonas)
    } catch { setError("No se pudieron cargar los operarios") }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { void load() }, [load])

  const filtered = operarios.filter(o => {
    const q = search.toLowerCase()
    return (
      o.nombre.toLowerCase().includes(q) ||
      o.apellido.toLowerCase().includes(q) ||
      o.cedula.includes(q) ||
      o.email.toLowerCase().includes(q)
    )
  })

  const zonaNombre = (zona_id: string | null) =>
    zonas.find(z => z.id === zona_id)?.nombre ?? <span className="italic text-slate-400">Sin zona</span>

  return (
    <div className="flex flex-col gap-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-extrabold text-slate-900">Operarios de campo</h2>
          <p className="text-sm text-slate-500">Personal que atiende los reportes en sitio</p>
        </div>
        <button onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 rounded-xl bg-slate-800 px-4 py-2.5 text-sm font-bold text-white hover:bg-slate-700 transition shadow-sm">
          <span className="text-lg leading-none">+</span> Nuevo operario
        </button>
      </div>

      {/* Buscador */}
      <div className="relative">
        <svg className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Buscar por nombre, cédula o correo…"
          className="w-full rounded-xl border border-slate-200 bg-white pl-10 pr-4 py-2.5 text-sm text-slate-900 focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200 transition" />
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-center justify-between rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
          <button onClick={() => void load()} className="text-xs font-bold underline">Reintentar</button>
        </div>
      )}

      {/* Tabla */}
      <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 bg-slate-50">
              {["Nombre", "Cédula", "Correo", "Cargo", "Zona", "Estado", "Acciones"].map(h => (
                <th key={h} className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-wider text-slate-500">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading && (
              <tr><td colSpan={7} className="px-4 py-6 text-center text-sm text-slate-400">Cargando operarios…</td></tr>
            )}
            {!loading && filtered.length === 0 && (
              <tr><td colSpan={7} className="px-4 py-6 text-center text-sm text-slate-400">
                {search ? "Sin resultados" : "No hay operarios registrados. Crea el primero."}
              </td></tr>
            )}
            {filtered.map(op => (
              <tr key={op.id} className="hover:bg-slate-50 transition">
                <td className="px-4 py-3 font-semibold text-slate-900">{op.nombre} {op.apellido}</td>
                <td className="px-4 py-3 font-mono text-xs text-slate-500">{op.cedula}</td>
                <td className="px-4 py-3 text-slate-600 text-xs">{op.email}</td>
                <td className="px-4 py-3 text-slate-500 text-xs">{op.cargo ?? "—"}</td>
                <td className="px-4 py-3 text-slate-500 text-xs">{zonaNombre(op.zona_id)}</td>
                <td className="px-4 py-3">
                  <span className={`inline-flex rounded-full px-2.5 py-0.5 text-[11px] font-bold ${ESTADO_STYLE[op.estado] ?? ESTADO_STYLE.INACTIVO}`}>
                    {op.estado}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <button onClick={() => setEditTarget(op)}
                      className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 transition">
                      Editar
                    </button>
                    <button onClick={() => setDeleteTarget(op)}
                      className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-50 transition">
                      Desactivar
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Modals */}
      {showCreate    && <CreateModal zonas={zonas} onClose={() => setShowCreate(false)} onCreated={load} />}
      {editTarget    && <EditModal op={editTarget} zonas={zonas} onClose={() => setEditTarget(null)} onSaved={load} />}
      {deleteTarget  && <DeleteConfirm op={deleteTarget} onClose={() => setDeleteTarget(null)} onDeleted={load} />}
    </div>
  )
}
