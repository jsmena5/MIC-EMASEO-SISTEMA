import { useEffect, useRef, useState } from "react"
import { MapContainer, TileLayer, GeoJSON as GeoJSONLayer } from "react-leaflet"
import type { Layer, PathOptions } from "leaflet"
import type { Feature, FeatureCollection, Polygon, MultiPolygon } from "geojson"
import {
  listZonas, updateZona, importZonas,
} from "../../../services/zona.service"
import type { Zona } from "../../../services/zona.service"
import { getSupervisores } from "../../../services/supervisor.service"
import type { Supervisor } from "../../../services/supervisor.service"
import { analizarPreview, descargarPlantilla } from "./zonaImport"

// ─── Leaflet icon fix (required for CRA/Vite) ─────────────────────────────────
import L from "leaflet"
import "leaflet/dist/leaflet.css"
delete (L.Icon.Default.prototype as unknown as Record<string, unknown>)._getIconUrl
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  iconUrl:       "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl:     "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
})

// ─── Assign supervisor modal ─────────────────────────────────────────────────

function Modal({ title, onClose, children }: Readonly<{ title: string; onClose: () => void; children: React.ReactNode }>) {
  const overlay = useRef<HTMLDivElement>(null)
  return (
    <div
      ref={overlay}
      aria-hidden="true"
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
      onClick={(e) => { if (e.target === overlay.current) onClose() }}
      onKeyDown={(e) => { if (e.key === 'Escape') onClose() }}
    >
      <div className="w-full max-w-md rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
          <h2 className="text-base font-extrabold text-slate-900">{title}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl leading-none transition">×</button>
        </div>
        <div className="px-6 py-5">{children}</div>
      </div>
    </div>
  )
}

function AssignModal({
  zona, supervisores, todasLasZonas, onClose, onSaved,
}: Readonly<{
  zona: Zona; supervisores: Supervisor[]; todasLasZonas: Zona[]; onClose: () => void; onSaved: () => Promise<void>
}>) {
  const [supId,   setSupId]   = useState<string>(zona.supervisor_id ?? "")
  const [nombre,  setNombre]  = useState(zona.nombre)
  const [desc,    setDesc]    = useState(zona.descripcion ?? "")
  const [activa,  setActiva]  = useState(zona.activa)
  const [saving,  setSaving]  = useState(false)
  const [error,   setError]   = useState("")

  const handleSave = async () => {
    setSaving(true); setError("")
    try {
      await updateZona(zona.id, {
        nombre,
        descripcion: desc || undefined,
        supervisor_id: supId || null,
        activa,
      })
      await onSaved()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al guardar")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal title={`Editar zona — ${zona.codigo}`} onClose={onClose}>
      <div className="space-y-3">
        {error && <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>}
        <div>
          <label htmlFor="zona-nombre" className="mb-1 block text-xs font-semibold text-slate-600">Nombre</label>
          <input
            id="zona-nombre"
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-200 transition"
          />
        </div>
        <div>
          <label htmlFor="zona-desc" className="mb-1 block text-xs font-semibold text-slate-600">Descripción</label>
          <textarea
            id="zona-desc"
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
            rows={2}
            className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-200 transition resize-none"
          />
        </div>
        <div>
          <label htmlFor="zona-supervisor" className="mb-1 block text-xs font-semibold text-slate-600">Supervisor asignado</label>
          <select
            id="zona-supervisor"
            value={supId}
            onChange={(e) => setSupId(e.target.value)}
            className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-200 transition"
          >
            <option value="">Sin supervisor</option>
            {supervisores.map((s) => {
              const otrasZonas = todasLasZonas
                .filter((z) => z.id !== zona.id && z.supervisor_id === s.id)
                .map((z) => z.nombre)
              const label = otrasZonas.length > 0 ? ` (también en: ${otrasZonas.join(", ")})` : ""
              return (
                <option key={s.id} value={s.id}>
                  {s.nombre} {s.apellido} — {s.email}{label}
                </option>
              )
            })}
          </select>
        </div>
        <div className="flex items-center gap-3">
          <input
            type="checkbox"
            id="activa"
            checked={activa}
            onChange={(e) => setActiva(e.target.checked)}
            className="h-4 w-4 rounded border-slate-300 text-indigo-600"
          />
          <label htmlFor="activa" className="text-sm font-semibold text-slate-700">Zona activa</label>
        </div>
        <div className="flex justify-end gap-3 pt-2">
          <button onClick={onClose} className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50 transition">
            Cancelar
          </button>
          <button
            onClick={() => void handleSave()}
            disabled={saving}
            className="rounded-xl bg-indigo-600 px-5 py-2 text-sm font-bold text-white hover:bg-indigo-500 disabled:opacity-60 transition"
          >
            {saving ? "Guardando…" : "Guardar"}
          </button>
        </div>
      </div>
    </Modal>
  )
}

// ─── GeoJSON Import modal ─────────────────────────────────────────────────────

// Extrae los Features de tipo Polygon/MultiPolygon de un GeoJSON (FeatureCollection o Feature).
function extractPolygonFeatures(json: FeatureCollection | Feature): Feature<Polygon | MultiPolygon>[] {
  const isPoly = (t?: string) => t === "Polygon" || t === "MultiPolygon"
  if (json.type === "FeatureCollection") {
    return json.features.filter(
      (f) => isPoly(f.geometry?.type)
    ) as Feature<Polygon | MultiPolygon>[]
  }
  if (json.type === "Feature" && isPoly(json.geometry?.type)) {
    return [json as Feature<Polygon | MultiPolygon>]
  }
  return []
}

// Lee un archivo GeoJSON y resuelve con sus Features Polygon/MultiPolygon, o rechaza
// con un mensaje legible. Usa Blob#text() (nativo, más simple que FileReader).
async function parseGeoJsonFile(file: File): Promise<Feature<Polygon | MultiPolygon>[]> {
  let text: string
  try {
    text = await file.text()
  } catch {
    throw new Error("Error al leer el archivo")
  }
  try {
    const json = JSON.parse(text) as FeatureCollection | Feature
    const features = extractPolygonFeatures(json)
    if (features.length === 0) {
      throw new Error("El archivo no contiene polígonos válidos (Polygon o MultiPolygon)")
    }
    return features
  } catch (e) {
    throw e instanceof Error ? e : new Error("El archivo no es un JSON válido")
  }
}

function ImportSuccessView({ count, onClose }: Readonly<{ count: number; onClose: () => void }>) {
  return (
    <Modal title="Importación completada" onClose={onClose}>
      <div className="space-y-4">
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-center">
          <div className="text-3xl font-black text-emerald-700">{count}</div>
          <div className="text-sm font-semibold text-emerald-600">
            zona{count === 1 ? "" : "s"} importada{count === 1 ? "" : "s"}
          </div>
          <div className="mt-2 text-xs text-emerald-500">Las zonas ya existentes fueron actualizadas; las nuevas fueron creadas.</div>
        </div>
        <button
          onClick={onClose}
          className="w-full rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-indigo-500 transition"
        >
          Cerrar
        </button>
      </div>
    </Modal>
  )
}

function ImportModal({ zonasExistentes, onClose, onImported }: Readonly<{ zonasExistentes: Zona[]; onClose: () => void; onImported: () => void }>) {
  const [importing, setImporting] = useState(false)
  const [error, setError]         = useState("")
  const [result, setResult]       = useState<{ imported: number } | null>(null)
  const [preview, setPreview]     = useState<Feature<Polygon | MultiPolygon>[] | null>(null)
  const [fileName, setFileName]   = useState("")
  const [showHelp, setShowHelp]   = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const filas = preview ? analizarPreview(preview, zonasExistentes) : []
  const nuevas      = filas.filter((f) => !f.existe && f.errores.length === 0).length
  const actualiza   = filas.filter((f) => f.existe).length
  const conErrores  = filas.filter((f) => f.errores.length > 0).length

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setError(""); setPreview(null); setFileName(file.name)
    parseGeoJsonFile(file)
      .then(setPreview)
      .catch((err) => setError(err instanceof Error ? err.message : "Error al leer el archivo"))
  }

  const handleImport = async () => {
    if (!preview) return
    setError(""); setImporting(true)
    try {
      const res = await importZonas(preview)
      setResult({ imported: res.imported })
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al importar")
    } finally {
      setImporting(false)
    }
  }

  if (result) {
    return <ImportSuccessView count={result.imported} onClose={() => { onImported(); onClose() }} />
  }

  return (
    <Modal title="Importar zonas desde GeoJSON" onClose={onClose}>
      <div className="space-y-4">
        <p className="text-sm text-slate-600">
          Sube un archivo <strong>.geojson</strong> o <strong>.json</strong> con geometrías{" "}
          <code className="rounded bg-slate-100 px-1 py-0.5 text-xs">Polygon</code> o{" "}
          <code className="rounded bg-slate-100 px-1 py-0.5 text-xs">MultiPolygon</code>.
          Cada zona es un <em>Feature</em> con <code className="rounded bg-slate-100 px-1 py-0.5 text-xs">codigo</code> y{" "}
          <code className="rounded bg-slate-100 px-1 py-0.5 text-xs">nombre</code>.
        </p>

        {/* Plantilla + ayuda */}
        <div className="rounded-xl border border-slate-200 bg-slate-50/60">
          <div className="flex items-center gap-2 px-3 py-2.5">
            <button
              type="button"
              onClick={() => setShowHelp((v) => !v)}
              className="flex items-center gap-1.5 text-xs font-bold text-slate-600 hover:text-slate-900 transition"
            >
              <svg className={`h-3.5 w-3.5 transition-transform ${showHelp ? "rotate-90" : ""}`} fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
              </svg>
              ¿Cómo se arma el archivo?
            </button>
            <button
              type="button"
              onClick={descargarPlantilla}
              className="ml-auto flex items-center gap-1.5 rounded-lg border border-indigo-200 bg-white px-2.5 py-1 text-xs font-bold text-indigo-700 hover:bg-indigo-50 transition"
            >
              <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
              </svg>
              Descargar plantilla
            </button>
          </div>
          {showHelp && (
            <div className="space-y-2.5 border-t border-slate-200 px-3 py-3 text-xs text-slate-600">
              <ul className="space-y-1.5">
                <li><code className="rounded bg-white px-1 py-0.5 font-semibold text-indigo-700">codigo</code> — identificador <strong>único</strong> de la zona (máx 20 caracteres). Convención: <code className="rounded bg-white px-1">ZN-NOMBRE</code> en MAYÚSCULAS, p. ej. <code className="rounded bg-white px-1">ZN-SANGOLQUI</code>.</li>
                <li><code className="rounded bg-white px-1 py-0.5 font-semibold text-indigo-700">nombre</code> — texto visible en el panel, p. ej. «Valle de Sangolquí».</li>
                <li><code className="rounded bg-white px-1 py-0.5 font-semibold text-indigo-700">descripcion</code> — opcional, una nota libre.</li>
              </ul>
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-2 text-amber-800">
                <strong>Regla clave (para no corromper datos):</strong> el sistema busca por <code className="rounded bg-white px-1">codigo</code>.
                Si el código <strong>ya existe</strong>, esa zona se <strong>actualiza</strong> (se reemplaza su geometría). Si es <strong>nuevo</strong>, se <strong>crea</strong> una zona.
                Para <em>agregar</em> una zona sin tocar las demás, usa un código que no exista. La tabla te muestra abajo qué hará cada una antes de importar.
              </div>
            </div>
          )}
        </div>

        {error && <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>}

        {/* File picker area */}
        <button
          type="button"
          className={`flex w-full flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed px-6 py-8 cursor-pointer transition ${
            preview ? "border-emerald-400 bg-emerald-50/40" : "border-slate-300 bg-slate-50 hover:border-indigo-400 hover:bg-indigo-50/30"
          }`}
          onClick={() => fileRef.current?.click()}
        >
          <svg className={`h-9 w-9 ${preview ? "text-emerald-500" : "text-slate-400"}`} fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
            {preview
              ? <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              : <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
            }
          </svg>
          <div className="text-sm font-semibold text-slate-700 text-center">
            {preview
              ? <><span className="text-emerald-700">{fileName}</span><br /><span className="text-xs font-normal text-slate-500">Haz clic para cambiar el archivo</span></>
              : "Haz clic o arrastra un archivo GeoJSON"
            }
          </div>
          {!preview && <div className="text-xs text-slate-500">Formatos: .geojson, .json</div>}
        </button>

        {/* Preview table con detección de colisiones contra la BD */}
        {preview && (
          <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-slate-100 bg-slate-50 px-4 py-2">
              <span className="text-xs font-semibold text-slate-600">{preview.length} zona{preview.length === 1 ? "" : "s"} en el archivo</span>
              {nuevas > 0 && <span className="text-xs font-semibold text-emerald-600">{nuevas} nueva{nuevas === 1 ? "" : "s"}</span>}
              {actualiza > 0 && <span className="text-xs font-semibold text-amber-600">{actualiza} actualizará{actualiza === 1 ? "" : "n"} existente{actualiza === 1 ? "" : "s"}</span>}
              {conErrores > 0 && <span className="text-xs font-semibold text-red-600">{conErrores} con avisos</span>}
            </div>
            <div className="max-h-44 overflow-y-auto divide-y divide-slate-100">
              {filas.map((fila, i) => (
                <div key={fila.codigo || `zona-${i}`} className="px-4 py-2">
                  <div className="flex items-center gap-3">
                    <span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs font-mono font-semibold text-slate-700">
                      {fila.codigo || "sin código"}
                    </span>
                    <span className="truncate text-sm text-slate-700">{fila.nombre || "sin nombre"}</span>
                    {fila.existe ? (
                      <span className="ml-auto shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-700" title={`Reemplazará la geometría de «${fila.existe.nombre}»`}>
                        ACTUALIZA
                      </span>
                    ) : (
                      <span className="ml-auto shrink-0 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-700">
                        NUEVA
                      </span>
                    )}
                  </div>
                  {fila.existe && (
                    <div className="mt-0.5 pl-1 text-[11px] text-amber-600">
                      Coincide con «{fila.existe.nombre}» — se reemplazará su geometría.
                    </div>
                  )}
                  {fila.errores.map((e) => (
                    <div key={e} className="mt-0.5 flex items-start gap-1 pl-1 text-[11px] text-red-600">
                      <span>⚠</span><span>{e}</span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        )}

        <input
          ref={fileRef}
          type="file"
          accept=".geojson,.json,application/geo+json,application/json"
          onChange={handleFile}
          className="hidden"
        />

        {/* Action buttons */}
        <div className="flex gap-3 pt-1">
          <button
            onClick={onClose}
            className="flex-1 rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-50 transition"
          >
            Cancelar
          </button>
          <button
            onClick={() => void handleImport()}
            disabled={!preview || importing}
            className="flex-1 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed transition"
          >
            {(() => {
              if (importing) return "Importando…"
              const n = preview?.length ?? 0
              return `Importar ${n > 0 ? n : ""} zona${n === 1 ? "" : "s"}`
            })()}
          </button>
        </div>
      </div>
    </Modal>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function Zonas() {
  const [zonas,       setZonas]       = useState<Zona[]>([])
  const [supervisores, setSupervisores] = useState<Supervisor[]>([])
  const [loading,     setLoading]     = useState(true)
  const [error,       setError]       = useState("")
  const [editTarget,  setEditTarget]  = useState<Zona | null>(null)
  const [showImport,  setShowImport]  = useState(false)
  const [selected,    setSelected]    = useState<Zona | null>(null)

  const load = async () => {
    setLoading(true); setError("")
    try {
      const [z, s] = await Promise.all([listZonas(), getSupervisores()])
      setZonas(z.zonas); setSupervisores(s)
      setSelected((prev) => prev ? (z.zonas.find((zona) => zona.id === prev.id) ?? null) : null)
    } catch {
      setError("No se pudieron cargar las zonas")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void load() }, [])

  // Build GeoJSON FeatureCollection for the map
  const geojsonData: FeatureCollection = {
    type: "FeatureCollection",
    features: zonas
      .filter((z) => z.geom != null)
      .map((z) => ({
        type: "Feature" as const,
        geometry: z.geom!,
        properties: { id: z.id, nombre: z.nombre, activa: z.activa },
      })),
  }

  const styleFeature = (): PathOptions => ({
    color: "#4F46E5",
    weight: 2,
    opacity: 0.8,
    fillColor: "#4F46E5",
    fillOpacity: 0.08,
  })

  const onEachFeature = (feature: Feature, layer: Layer) => {
    const props = feature.properties
    if (props) {
      layer.bindTooltip(props.nombre as string, { permanent: false, direction: "center" })
      layer.on("click", () => {
        const z = zonas.find((z) => z.id === props.id)
        if (z) setSelected(z)
      })
    }
  }

  return (
    <div className="flex flex-col gap-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-extrabold text-slate-900">Zonas operativas</h2>
          <p className="text-sm text-slate-500">
            {(() => {
              if (loading) return "Cargando…"
              const plural = zonas.length === 1 ? "" : "s"
              return `${zonas.length} zona${plural} · toca un polígono para editar`
            })()}
          </p>
        </div>
        <button
          onClick={() => setShowImport(true)}
          className="flex items-center gap-2 rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-2.5 text-sm font-bold text-indigo-700 hover:bg-indigo-100 transition"
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
          </svg>
          Importar GeoJSON
        </button>
      </div>

      {error && (
        <div className="flex items-center justify-between rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
          <button onClick={() => void load()} className="text-xs font-bold underline">Reintentar</button>
        </div>
      )}

      {/* Map + Table */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {/* Map */}
        <div className="h-[480px] overflow-hidden rounded-2xl border border-slate-200 bg-white">
          {loading ? (
            <div className="flex h-full items-center justify-center text-sm text-slate-400">Cargando mapa…</div>
          ) : (
            <MapContainer
              center={[-0.225219, -78.5248]}
              zoom={11}
              style={{ height: "100%", width: "100%" }}
              scrollWheelZoom={true}
            >
              <TileLayer
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                attribution='© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
              />
              {geojsonData.features.length > 0 && (
                <GeoJSONLayer
                  key={JSON.stringify(geojsonData)}
                  data={geojsonData}
                  style={styleFeature}
                  onEachFeature={onEachFeature}
                />
              )}
            </MapContainer>
          )}
        </div>

        {/* Zones list */}
        <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
          <div className="border-b border-slate-100 bg-slate-50 px-4 py-3">
            <div className="text-xs font-bold uppercase tracking-wider text-slate-500">Lista de zonas</div>
          </div>
          <div className="divide-y divide-slate-100 overflow-y-auto" style={{ maxHeight: 440 }}>
            {loading && <div className="px-4 py-6 text-center text-sm text-slate-400">Cargando…</div>}
            {!loading && zonas.length === 0 && (
              <div className="px-4 py-6 text-center text-sm text-slate-400">
                Sin zonas. Importa un archivo GeoJSON para comenzar.
              </div>
            )}
            {zonas.map((z) => (
              <div key={z.id} className="flex">
              <button
                type="button"
                className={[
                  "flex flex-1 items-center justify-between px-4 py-3 cursor-pointer transition text-left",
                  selected?.id === z.id ? "bg-indigo-50" : "hover:bg-slate-50",
                ].join(" ")}
                onClick={() => setSelected(z)}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span
                      className={`h-2 w-2 shrink-0 rounded-full ${z.activa ? "bg-emerald-500" : "bg-slate-300"}`}
                    />
                    <span className="truncate text-sm font-semibold text-slate-900">{z.nombre}</span>
                    <span className="shrink-0 font-mono text-[10px] text-slate-400">{z.codigo}</span>
                  </div>
                  <div className="mt-0.5 truncate pl-4 text-xs text-slate-500">
                    {z.supervisor_nombre ?? <span className="italic">Sin supervisor</span>}
                  </div>
                </div>
              </button>
                <button
                  onClick={(e) => { e.stopPropagation(); setEditTarget(z) }}
                  className="ml-3 shrink-0 rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-100 transition"
                >
                  Editar
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Selected zone detail card */}
      {selected && (
        <div className="rounded-2xl border border-indigo-200 bg-indigo-50 p-5">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="text-base font-extrabold text-indigo-900">{selected.nombre}</h3>
                <span className="font-mono text-xs text-indigo-500 bg-indigo-100 rounded px-1.5 py-0.5">{selected.codigo}</span>
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${selected.activa ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-500"}`}>
                  {selected.activa ? "ACTIVA" : "INACTIVA"}
                </span>
              </div>
              {selected.descripcion && (
                <p className="mt-1 text-sm text-indigo-700">{selected.descripcion}</p>
              )}
              <div className="mt-2 text-sm text-indigo-700">
                <strong>Supervisor:</strong>{" "}
                {selected.supervisor_nombre ? (
                  <span>{selected.supervisor_nombre} — <span className="text-indigo-500">{selected.supervisor_email}</span></span>
                ) : (
                  <span className="italic text-indigo-400">Sin asignar</span>
                )}
              </div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setEditTarget(selected)}
                className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-bold text-white hover:bg-indigo-500 transition"
              >
                Editar zona
              </button>
              <button
                onClick={() => setSelected(null)}
                className="rounded-xl border border-indigo-200 px-3 py-2 text-sm font-semibold text-indigo-600 hover:bg-indigo-100 transition"
              >
                ×
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modals */}
      {editTarget && (
        <AssignModal
          zona={editTarget}
          supervisores={supervisores}
          todasLasZonas={zonas}
          onClose={() => setEditTarget(null)}
          onSaved={load}
        />
      )}
      {showImport && (
        <ImportModal zonasExistentes={zonas} onClose={() => setShowImport(false)} onImported={load} />
      )}
    </div>
  )
}
