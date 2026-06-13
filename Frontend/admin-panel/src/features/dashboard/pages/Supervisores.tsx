import { useCallback, useEffect, useRef, useState } from "react"
import {
  getSupervisores, createSupervisor, updateSupervisor, deleteSupervisor,
} from "../../../services/supervisor.service"
import type { Supervisor, CreateSupervisorPayload, UpdateSupervisorPayload } from "../../../services/supervisor.service"
import {
  getCiudadanos, setCiudadanoEstado, resetCiudadanoPassword,
} from "../../../services/ciudadano.service"
import type { Ciudadano } from "../../../services/ciudadano.service"

// ─── Badge helpers ────────────────────────────────────────────────────────────

const ESTADO_STYLE: Record<string, string> = {
  ACTIVO:     "bg-emerald-100 text-emerald-700",
  INACTIVO:   "bg-slate-100 text-slate-500",
  SUSPENDIDO: "bg-amber-100 text-amber-700",
}

// ─── Modal base ───────────────────────────────────────────────────────────────

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  const overlay = useRef<HTMLDivElement>(null)
  return (
    <div
      ref={overlay}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
      onClick={(e) => { if (e.target === overlay.current) onClose() }}
    >
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

function Field({
  label, name, type = "text", value, onChange, required, placeholder,
}: {
  label: string; name: string; type?: string; value: string; onChange: (v: string) => void
  required?: boolean; placeholder?: string
}) {
  return (
    <div>
      <label className="mb-1 block text-xs font-semibold text-slate-600">
        {label}{required && <span className="ml-0.5 text-red-500">*</span>}
      </label>
      <input
        type={type}
        name={name}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm text-slate-900 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-200 transition"
      />
    </div>
  )
}

// ─── Create modal ─────────────────────────────────────────────────────────────

const EMPTY_CREATE: CreateSupervisorPayload = {
  nombre: "", apellido: "", cedula: "", telefono: "", email: "", password: "",
}

function CreateModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [form, setForm] = useState<CreateSupervisorPayload>(EMPTY_CREATE)
  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState("")
  const [tempPwd, setTempPwd] = useState<string | null>(null)

  const set = (k: keyof CreateSupervisorPayload) => (v: string) =>
    setForm((f) => ({ ...f, [k]: v }))

  const handleSubmit = async () => {
    if (!form.nombre || !form.apellido || !form.cedula || !form.telefono || !form.email) {
      setError("Completa todos los campos obligatorios"); return
    }
    setError(""); setSaving(true)
    try {
      const payload: CreateSupervisorPayload = { ...form }
      if (!payload.password) delete payload.password
      const res = await createSupervisor(payload)
      if (res.password_temporal) setTempPwd(res.password_temporal)
      else { onCreated(); onClose() }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al crear")
    } finally {
      setSaving(false)
    }
  }

  if (tempPwd) {
    return (
      <Modal title="Supervisor creado" onClose={() => { onCreated(); onClose() }}>
        <div className="space-y-4">
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
            <div className="text-sm font-bold text-emerald-700 mb-2">¡Supervisor creado exitosamente!</div>
            <div className="text-xs text-emerald-600">
              Se generó una contraseña temporal. Entrégala al supervisor para su primer ingreso:
            </div>
            <div className="mt-3 rounded-lg border border-emerald-300 bg-white px-4 py-2.5 font-mono text-base font-bold text-slate-900 text-center tracking-widest select-all">
              {tempPwd}
            </div>
            <div className="mt-2 text-[11px] text-emerald-600">
              El supervisor deberá cambiarla desde el panel de supervisión.
            </div>
          </div>
          <button
            onClick={() => { onCreated(); onClose() }}
            className="w-full rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-indigo-500 transition"
          >
            Entendido
          </button>
        </div>
      </Modal>
    )
  }

  return (
    <Modal title="Nuevo supervisor" onClose={onClose}>
      <div className="space-y-3">
        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Nombre" name="nombre" value={form.nombre} onChange={set("nombre")} required placeholder="Juan" />
          <Field label="Apellido" name="apellido" value={form.apellido} onChange={set("apellido")} required placeholder="Pérez" />
        </div>
        <Field label="Cédula (10 dígitos)" name="cedula" value={form.cedula} onChange={set("cedula")} required placeholder="1234567890" />
        <Field label="Teléfono" name="telefono" value={form.telefono} onChange={set("telefono")} required placeholder="+593 99 000 0000" />
        <Field label="Correo electrónico" name="email" type="email" value={form.email} onChange={set("email")} required placeholder="supervisor@emaseo.gob.ec" />
        <Field label="Contraseña (opcional — se genera si se omite)" name="password" type="password" value={form.password ?? ""} onChange={set("password")} placeholder="••••••••" />
        <div className="flex justify-end gap-3 pt-2">
          <button onClick={onClose} className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50 transition">
            Cancelar
          </button>
          <button
            onClick={() => void handleSubmit()}
            disabled={saving}
            className="rounded-xl bg-indigo-600 px-5 py-2 text-sm font-bold text-white hover:bg-indigo-500 disabled:opacity-60 transition"
          >
            {saving ? "Creando…" : "Crear supervisor"}
          </button>
        </div>
      </div>
    </Modal>
  )
}

// ─── Edit modal ───────────────────────────────────────────────────────────────

function EditModal({ sup, onClose, onSaved }: { sup: Supervisor; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState<UpdateSupervisorPayload>({
    nombre: sup.nombre, apellido: sup.apellido, telefono: sup.telefono, estado: sup.estado,
  })
  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState("")

  const set = (k: keyof UpdateSupervisorPayload) => (v: string) =>
    setForm((f) => ({ ...f, [k]: v }))

  const handleSubmit = async () => {
    if (!form.nombre || !form.apellido) { setError("Nombre y apellido son obligatorios"); return }
    setError(""); setSaving(true)
    try {
      await updateSupervisor(sup.id, form)
      onSaved(); onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al actualizar")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal title={`Editar — ${sup.nombre} ${sup.apellido}`} onClose={onClose}>
      <div className="space-y-3">
        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Nombre" name="nombre" value={form.nombre ?? ""} onChange={set("nombre")} required />
          <Field label="Apellido" name="apellido" value={form.apellido ?? ""} onChange={set("apellido")} required />
        </div>
        <Field label="Teléfono" name="telefono" value={form.telefono ?? ""} onChange={set("telefono")} />
        <div>
          <label className="mb-1 block text-xs font-semibold text-slate-600">Estado</label>
          <select
            value={form.estado}
            onChange={(e) => setForm((f) => ({ ...f, estado: e.target.value as UpdateSupervisorPayload["estado"] }))}
            className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm text-slate-900 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-200 transition"
          >
            <option value="ACTIVO">ACTIVO</option>
            <option value="INACTIVO">INACTIVO</option>
            <option value="SUSPENDIDO">SUSPENDIDO</option>
          </select>
        </div>
        <div className="flex justify-end gap-3 pt-2">
          <button onClick={onClose} className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50 transition">
            Cancelar
          </button>
          <button
            onClick={() => void handleSubmit()}
            disabled={saving}
            className="rounded-xl bg-indigo-600 px-5 py-2 text-sm font-bold text-white hover:bg-indigo-500 disabled:opacity-60 transition"
          >
            {saving ? "Guardando…" : "Guardar cambios"}
          </button>
        </div>
      </div>
    </Modal>
  )
}

// ─── Delete confirm ───────────────────────────────────────────────────────────

function DeleteConfirm({ sup, onClose, onDeleted }: { sup: Supervisor; onClose: () => void; onDeleted: () => void }) {
  const [deleting, setDeleting] = useState(false)
  const [error, setError]       = useState("")

  const handleDelete = async () => {
    setDeleting(true)
    try { await deleteSupervisor(sup.id); onDeleted(); onClose() }
    catch (err) { setError(err instanceof Error ? err.message : "Error al desactivar") }
    finally { setDeleting(false) }
  }

  return (
    <Modal title="Desactivar supervisor" onClose={onClose}>
      <div className="space-y-4">
        <p className="text-sm text-slate-600">
          ¿Desactivar a <strong>{sup.nombre} {sup.apellido}</strong>? Su cuenta quedará como <span className="font-bold text-slate-800">INACTIVO</span> y no podrá acceder al panel hasta ser reactivado.
        </p>
        {error && <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>}
        <div className="flex justify-end gap-3">
          <button onClick={onClose} className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50 transition">
            Cancelar
          </button>
          <button
            onClick={() => void handleDelete()}
            disabled={deleting}
            className="rounded-xl bg-red-600 px-5 py-2 text-sm font-bold text-white hover:bg-red-500 disabled:opacity-60 transition"
          >
            {deleting ? "Desactivando…" : "Desactivar"}
          </button>
        </div>
      </div>
    </Modal>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

// ─── Tab: Ciudadanía ─────────────────────────────────────────────────────────

const ESTADO_COLOR: Record<string, string> = {
  ACTIVO:     "bg-emerald-100 text-emerald-700",
  INACTIVO:   "bg-slate-100 text-slate-500",
  SUSPENDIDO: "bg-amber-100 text-amber-700",
}

function fmtDate(iso: string | null) {
  if (!iso) return "—"
  return new Date(iso).toLocaleDateString("es-EC", { day: "2-digit", month: "short", year: "numeric" })
}

const MIN_SEARCH = 2

function CiudadanosTab() {
  const [ciudadanos, setCiudadanos] = useState<Ciudadano[]>([])
  const [loading,    setLoading]    = useState(false)
  const [error,      setError]      = useState("")
  const [search,     setSearch]     = useState("")
  const [debouncedSearch, setDebouncedSearch] = useState("")
  const [estadoFiltro, setEstadoFiltro] = useState("")
  const [page,     setPage]     = useState(1)
  const [totalPag, setTotalPag] = useState(1)
  const [total,    setTotal]    = useState(0)
  const [hasSearched, setHasSearched] = useState(false)
  const [savingId, setSavingId] = useState<string | null>(null)
  const [pwModal,  setPwModal]  = useState<{ id: string; nombre: string } | null>(null)
  const [tempPwd,  setTempPwd]  = useState<string | null>(null)

  const term = debouncedSearch.trim()
  const searchActive = term.length >= MIN_SEARCH

  // Debounce search
  useEffect(() => {
    const t = setTimeout(() => { setDebouncedSearch(search); setPage(1) }, 350)
    return () => clearTimeout(t)
  }, [search])

  // Solo consulta cuando hay un término de búsqueda válido (rendimiento: no
  // cargamos toda la ciudadanía). El filtro de estado se aplica sobre la búsqueda.
  const load = useCallback(async () => {
    if (!searchActive) {
      setCiudadanos([]); setHasSearched(false); setTotal(0); setTotalPag(1)
      return
    }
    setLoading(true); setError(""); setHasSearched(true)
    try {
      const data = await getCiudadanos({ search: term, estado: estadoFiltro, page, limit: 20 })
      setCiudadanos(data.ciudadanos)
      setTotalPag(data.pagination.pages)
      setTotal(data.pagination.total)
    } catch { setError("No se pudieron cargar los ciudadanos.") }
    finally   { setLoading(false) }
  }, [searchActive, term, estadoFiltro, page])

  useEffect(() => { load().catch(() => { /* errores ya gestionados en load */ }) }, [load])

  const toggleEstado = async (c: Ciudadano) => {
    const nuevo = c.estado === "ACTIVO" ? "INACTIVO" : "ACTIVO"
    setSavingId(c.id)
    try { await setCiudadanoEstado(c.id, nuevo); await load() }
    catch (e) { alert(e instanceof Error ? e.message : "Error") }
    finally   { setSavingId(null) }
  }

  const handleResetPw = async () => {
    if (!pwModal) return
    setSavingId(pwModal.id)
    try {
      const res = await resetCiudadanoPassword(pwModal.id)
      setTempPwd(res.nueva_password)
    } catch (e) { alert(e instanceof Error ? e.message : "Error") }
    finally     { setSavingId(null) }
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Buscador + filtro */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <svg className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por cédula, nombre, apellido o correo…"
            className="w-full rounded-xl border border-slate-200 bg-white pl-10 pr-4 py-2.5 text-sm text-slate-900 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-200 transition"
          />
        </div>
        <select
          value={estadoFiltro}
          onChange={(e) => { setEstadoFiltro(e.target.value); setPage(1) }}
          disabled={!searchActive}
          className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-700 focus:border-indigo-400 focus:outline-none disabled:opacity-50"
        >
          <option value="">Todos los estados</option>
          <option value="ACTIVO">Activo</option>
          <option value="INACTIVO">Inactivo</option>
          <option value="SUSPENDIDO">Suspendido</option>
        </select>
      </div>

      {/* Stats — solo cuando hay búsqueda activa con resultados */}
      {searchActive && !loading && !error && hasSearched && (
        <p className="text-xs text-slate-400 font-medium">
          {total} resultado{total !== 1 ? "s" : ""} para “{term}”
        </p>
      )}

      {error && (
        <div className="flex items-center justify-between rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
          <button onClick={() => { load().catch(() => { /* errores ya gestionados en load */ }) }} className="text-xs font-bold underline">Reintentar</button>
        </div>
      )}

      {/* Estado inicial: invitar a buscar (no cargamos toda la ciudadanía) */}
      {!searchActive && !error && (
        <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-6 py-12 text-center">
          <svg className="mx-auto h-10 w-10 text-slate-300" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <p className="mt-3 text-sm font-semibold text-slate-600">Busca un ciudadano para empezar</p>
          <p className="mt-1 text-xs text-slate-400">
            Escribe al menos {MIN_SEARCH} caracteres de su cédula, nombre, apellido o correo.
            <br />Por rendimiento no se carga el listado completo de la ciudadanía.
          </p>
        </div>
      )}

      {/* Tabla — solo visible con búsqueda activa */}
      {searchActive && (
      <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 bg-slate-50">
              {["Nombre completo", "Cédula", "Correo", "Reportes", "Último acceso", "Registro", "Estado", "Acciones"].map((h) => (
                <th key={h} className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-wider text-slate-500">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading && (
              <tr><td colSpan={8} className="px-4 py-6 text-center text-sm text-slate-400">Buscando…</td></tr>
            )}
            {!loading && ciudadanos.length === 0 && !error && (
              <tr><td colSpan={8} className="px-4 py-6 text-center text-sm text-slate-400">
                Sin resultados para “{term}”{estadoFiltro ? ` con estado ${estadoFiltro}` : ""}
              </td></tr>
            )}
            {ciudadanos.map((c) => (
              <tr key={c.id} className="hover:bg-slate-50 transition">
                <td className="px-4 py-3">
                  <div className="font-semibold text-slate-900">
                    {[c.primer_nombre, c.segundo_nombre, c.primer_apellido, c.segundo_apellido].filter(Boolean).join(" ")}
                  </div>
                </td>
                <td className="px-4 py-3 font-mono text-xs text-slate-500">{c.cedula_masked}</td>
                <td className="px-4 py-3 text-slate-600 text-xs">{c.email}</td>
                <td className="px-4 py-3 text-center">
                  <span className="inline-flex items-center justify-center rounded-full bg-indigo-50 text-indigo-700 text-xs font-bold w-8 h-8">{c.total_reportes}</span>
                </td>
                <td className="px-4 py-3 text-xs text-slate-500">{fmtDate(c.ultimo_login)}</td>
                <td className="px-4 py-3 text-xs text-slate-500">{fmtDate(c.created_at)}</td>
                <td className="px-4 py-3">
                  <span className={`inline-flex rounded-full px-2.5 py-0.5 text-[11px] font-bold ${ESTADO_COLOR[c.estado] ?? ESTADO_COLOR.INACTIVO}`}>
                    {c.estado}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => void toggleEstado(c)}
                      disabled={savingId === c.id}
                      className={[
                        "rounded-lg border px-3 py-1.5 text-xs font-semibold transition disabled:opacity-50",
                        c.estado === "ACTIVO"
                          ? "border-slate-200 text-slate-700 hover:bg-slate-100"
                          : "border-emerald-200 text-emerald-700 hover:bg-emerald-50",
                      ].join(" ")}
                    >
                      {savingId === c.id ? "…" : c.estado === "ACTIVO" ? "Desactivar" : "Activar"}
                    </button>
                    <button
                      onClick={() => { setPwModal({ id: c.id, nombre: c.primer_nombre }); setTempPwd(null) }}
                      className="rounded-lg border border-amber-200 px-3 py-1.5 text-xs font-semibold text-amber-700 hover:bg-amber-50 transition"
                    >
                      Resetear clave
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      )}

      {/* Paginación */}
      {searchActive && totalPag > 1 && (
        <div className="flex items-center justify-center gap-2">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
            className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-40 transition"
          >← Anterior</button>
          <span className="text-xs text-slate-500">Página {page} de {totalPag}</span>
          <button
            onClick={() => setPage((p) => Math.min(totalPag, p + 1))}
            disabled={page === totalPag}
            className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-40 transition"
          >Siguiente →</button>
        </div>
      )}

      {/* Modal reset de contraseña */}
      {pwModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
          onClick={(e) => { if (e.target === e.currentTarget) { setPwModal(null); setTempPwd(null) } }}
        >
          <div className="w-full max-w-md rounded-2xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
              <h2 className="text-base font-extrabold text-slate-900">Resetear contraseña</h2>
              <button onClick={() => { setPwModal(null); setTempPwd(null) }} className="text-slate-400 hover:text-slate-600 text-xl leading-none">×</button>
            </div>
            <div className="px-6 py-5 space-y-4">
              {!tempPwd ? (
                <>
                  <p className="text-sm text-slate-600">
                    Se generará una contraseña temporal para <strong>{pwModal.nombre}</strong>. Deberás entregársela de forma segura para que pueda iniciar sesión.
                  </p>
                  <div className="flex justify-end gap-3">
                    <button
                      onClick={() => { setPwModal(null) }}
                      className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50 transition"
                    >Cancelar</button>
                    <button
                      onClick={() => void handleResetPw()}
                      disabled={savingId === pwModal.id}
                      className="rounded-xl bg-amber-500 px-4 py-2 text-sm font-bold text-white hover:bg-amber-400 disabled:opacity-50 transition"
                    >{savingId === pwModal.id ? "Generando…" : "Generar contraseña"}</button>
                  </div>
                </>
              ) : (
                <div className="space-y-4">
                  <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
                    <div className="text-sm font-bold text-amber-700 mb-2">Contraseña temporal generada</div>
                    <div className="mt-2 rounded-lg border border-amber-300 bg-white px-4 py-2.5 font-mono text-base font-bold text-slate-900 text-center tracking-widest select-all">
                      {tempPwd}
                    </div>
                    <div className="mt-2 text-[11px] text-amber-600">Copia y comparte esta contraseña con el ciudadano. No se podrá ver de nuevo.</div>
                  </div>
                  <button
                    onClick={() => { setPwModal(null); setTempPwd(null) }}
                    className="w-full rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-indigo-500 transition"
                  >Entendido</button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Página principal con pestañas ────────────────────────────────────────────

type TabKind = "interno" | "ciudadania"

export default function Supervisores() {
  const [tab, setTab] = useState<TabKind>("interno")
  const [supervisores, setSupervisores] = useState<Supervisor[]>([])
  const [loading, setLoading]           = useState(true)
  const [error, setError]               = useState("")
  const [search, setSearch]             = useState("")
  const [showCreate, setShowCreate]     = useState(false)
  const [editTarget, setEditTarget]     = useState<Supervisor | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Supervisor | null>(null)

  const load = async () => {
    setLoading(true); setError("")
    try { setSupervisores(await getSupervisores()) }
    catch { setError("No se pudieron cargar los supervisores") }
    finally { setLoading(false) }
  }

  useEffect(() => { load().catch(() => { /* errores ya gestionados en load */ }) }, [])

  const filtered = supervisores.filter((s) => {
    const q = search.toLowerCase()
    return (
      s.nombre.toLowerCase().includes(q) ||
      s.apellido.toLowerCase().includes(q) ||
      s.cedula.includes(q) ||
      s.email.toLowerCase().includes(q)
    )
  })

  return (
    <div className="flex flex-col gap-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-extrabold text-slate-900">Gestión de cuentas</h2>
          <p className="text-sm text-slate-500">Personal interno de EMASEO y ciudadanía registrada</p>
        </div>
        {tab === "interno" && (
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-indigo-500 transition shadow-sm"
          >
            <span className="text-lg leading-none">+</span> Nuevo supervisor
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 rounded-xl border border-slate-200 bg-slate-50 p-1 w-fit">
        {([
          { id: "interno"    as const, label: "Personal interno" },
          { id: "ciudadania" as const, label: "Ciudadanía" },
        ]).map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={[
              "rounded-lg px-4 py-2 text-sm font-bold transition",
              tab === t.id ? "bg-white text-indigo-700 shadow-sm" : "text-slate-500 hover:text-slate-700",
            ].join(" ")}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "ciudadania" ? <CiudadanosTab /> : (
      <>
      {/* Search */}
      <div className="relative">
        <svg className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar por nombre, cédula o correo…"
          className="w-full rounded-xl border border-slate-200 bg-white pl-10 pr-4 py-2.5 text-sm text-slate-900 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-200 transition"
        />
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-center justify-between rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
          <button onClick={() => { load().catch(() => { /* errores ya gestionados en load */ }) }} className="text-xs font-bold underline">Reintentar</button>
        </div>
      )}

      {/* Table */}
      <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 bg-slate-50">
              {["Nombre", "Cédula", "Correo", "Teléfono", "Estado", "Acciones"].map((h) => (
                <th key={h} className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-wider text-slate-500">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading && (
              <tr><td colSpan={6} className="px-4 py-6 text-center text-sm text-slate-400">Cargando supervisores…</td></tr>
            )}
            {!loading && filtered.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-6 text-center text-sm text-slate-400">
                {search ? "Sin resultados para la búsqueda" : "No hay supervisores aún"}
              </td></tr>
            )}
            {filtered.map((s) => (
              <tr key={s.id} className="hover:bg-slate-50 transition">
                <td className="px-4 py-3">
                  <div className="font-semibold text-slate-900">{s.nombre} {s.apellido}</div>
                </td>
                <td className="px-4 py-3 font-mono text-xs text-slate-600">{s.cedula}</td>
                <td className="px-4 py-3 text-slate-600">{s.email}</td>
                <td className="px-4 py-3 text-slate-600">{s.telefono}</td>
                <td className="px-4 py-3">
                  <span className={`inline-flex rounded-full px-2.5 py-0.5 text-[11px] font-bold ${ESTADO_STYLE[s.estado] ?? ESTADO_STYLE.INACTIVO}`}>
                    {s.estado}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setEditTarget(s)}
                      className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 transition"
                    >
                      Editar
                    </button>
                    <button
                      onClick={() => setDeleteTarget(s)}
                      className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-50 transition"
                    >
                      Desactivar
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      </>
      )}

      {/* Modals */}
      {showCreate  && <CreateModal onClose={() => setShowCreate(false)} onCreated={load} />}
      {editTarget  && <EditModal sup={editTarget} onClose={() => setEditTarget(null)} onSaved={load} />}
      {deleteTarget && <DeleteConfirm sup={deleteTarget} onClose={() => setDeleteTarget(null)} onDeleted={load} />}
    </div>
  )
}
