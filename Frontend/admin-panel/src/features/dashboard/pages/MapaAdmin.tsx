import { MapContainer, TileLayer, GeoJSON, Marker, Popup } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { useEffect, useState, useCallback, useMemo } from 'react'
import type { FeatureCollection } from 'geojson'
import { getMapaZonas, updateZona, type ZonaProperties, type IncidenteMapa } from '../../../services/zona.service'
import { getSupervisores, type Supervisor } from '../../../services/supervisor.service'

import iconUrl from 'leaflet/dist/images/marker-icon.png'
import iconShadow from 'leaflet/dist/images/marker-shadow.png'
L.Marker.prototype.options.icon = L.icon({
  iconUrl, shadowUrl: iconShadow,
  iconSize: [25, 41], iconAnchor: [12, 41], popupAnchor: [1, -34],
})

const ZONA_COLOR: Record<string, string> = {
  'ZN-CALDERON':       '#e11d48',
  'ZN-ELOY-ALFARO':    '#f97316',
  'ZN-EUGENIO-ESPEJO': '#eab308',
  'ZN-LA-DELICIA':     '#84cc16',
  'ZN-LOS-CHILLOS':    '#06b6d4',
  'ZN-MANUELA-SAENZ':  '#8b5cf6',
  'ZN-QUITUMBE':       '#ec4899',
  'ZN-TUMBACO':        '#14b8a6',
}
const COLOR_FALLBACK = '#64748b'

const PRIORIDAD_COLOR: Record<string, string> = {
  CRITICA: '#dc2626', ALTA: '#f97316', MEDIA: '#eab308', BAJA: '#22c55e',
}
const PRIORIDAD_LABEL: Record<string, string> = {
  CRITICA: 'Crítica', ALTA: 'Alta', MEDIA: 'Media', BAJA: 'Baja',
}
const ESTADO_STYLE: Record<string, { bg: string; text: string; label: string }> = {
  PROCESANDO:  { bg: '#DBEAFE', text: '#1D4ED8', label: 'Procesando'  },
  PENDIENTE:   { bg: '#FEF3C7', text: '#B45309', label: 'Pendiente'   },
  VALIDO:      { bg: '#E0F2FE', text: '#0369A1', label: 'Válido'      },
  EN_ATENCION: { bg: '#EDE9FE', text: '#6D28D9', label: 'En atención' },
  RESUELTA:    { bg: '#DCFCE7', text: '#166534', label: 'Resuelta'    },
  RECHAZADO:   { bg: '#FEE2E2', text: '#991B1B', label: 'Rechazado'   },
  DESCARTADO:  { bg: '#F1F5F9', text: '#475569', label: 'Descartado'  },
  FALLIDO:     { bg: '#FCE7F3', text: '#BE185D', label: 'Fallido'     },
}

function crearIcono(prioridad: string | null): L.DivIcon {
  const color = PRIORIDAD_COLOR[prioridad ?? ''] ?? '#94a3b8'
  const pulse = prioridad === 'CRITICA'
    ? `<div style="position:absolute;inset:-5px;border-radius:50%;background:${color};opacity:0.25;animation:pulse-map 1.8s ease-out infinite;"></div>` : ''
  return L.divIcon({
    html: `<div style="position:relative;width:28px;height:28px;">
      ${pulse}
      <div style="position:absolute;inset:0;border-radius:50%;background:${color};border:2.5px solid white;
        display:flex;align-items:center;justify-content:center;
        box-shadow:0 2px 8px rgba(0,0,0,0.35);font-size:11px;font-weight:900;color:white;font-family:sans-serif;">
        ${(prioridad ?? 'B')[0]}
      </div>
    </div>`,
    className: '', iconSize: [28, 28], iconAnchor: [14, 14], popupAnchor: [0, -16],
  })
}

function centroideFeature(f: GeoJSON.Feature): [number, number] | null {
  const geom = f.geometry
  let coords: number[][] = []
  if (geom.type === 'Polygon') coords = geom.coordinates[0]
  else if (geom.type === 'MultiPolygon') {
    let best: number[][] = []; let bestArea = 0
    for (const ring of geom.coordinates) {
      const outer = ring[0]
      const lons = outer.map((c: number[]) => c[0])
      const lats = outer.map((c: number[]) => c[1])
      const area = (Math.max(...lons) - Math.min(...lons)) * (Math.max(...lats) - Math.min(...lats))
      if (area > bestArea) { bestArea = area; best = outer }
    }
    coords = best
  }
  if (!coords.length) return null
  return [
    coords.reduce((s, c) => s + c[1], 0) / coords.length,
    coords.reduce((s, c) => s + c[0], 0) / coords.length,
  ]
}

function IncidentePopup({ inc }: Readonly<{ inc: IncidenteMapa }>) {
  const prioColor = PRIORIDAD_COLOR[inc.prioridad ?? ''] ?? '#94a3b8'
  const prioLabel = PRIORIDAD_LABEL[inc.prioridad ?? ''] ?? inc.prioridad ?? '—'
  const estadoSty = ESTADO_STYLE[inc.estado] ?? { bg: '#F1F5F9', text: '#475569', label: inc.estado }
  const fecha     = new Date(inc.created_at).toLocaleString('es-EC', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })
  return (
    <div style={{ fontFamily: 'system-ui, sans-serif', width: 240 }}>
      <div style={{ marginBottom: 8 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
          <span style={{ fontSize: 10, fontFamily: 'monospace', color: '#94a3b8', fontWeight: 600 }}>
            #{inc.id.slice(0, 8).toUpperCase()}
          </span>
          <span style={{ fontSize: 10, fontWeight: 700, color: '#94a3b8' }}>{fecha}</span>
        </div>
        <div style={{ fontSize: 13, fontWeight: 800, color: '#0f172a' }}>
          {inc.zona_nombre ?? 'Sin zona'}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginBottom: 8 }}>
        <span style={{ background: prioColor, color: 'white', padding: '2px 8px', borderRadius: 20, fontSize: 10, fontWeight: 800 }}>
          ● {prioLabel}
        </span>
        <span style={{ background: estadoSty.bg, color: estadoSty.text, padding: '2px 8px', borderRadius: 20, fontSize: 10, fontWeight: 700 }}>
          {estadoSty.label}
        </span>
      </div>
      {inc.descripcion && (
        <div style={{ fontSize: 11, color: '#475569', background: '#f8fafc', borderRadius: 6, padding: '6px 8px', borderLeft: `3px solid ${prioColor}`, marginBottom: 8 }}>
          {inc.descripcion.slice(0, 100)}{inc.descripcion.length > 100 ? '…' : ''}
        </div>
      )}
    </div>
  )
}

// ── Modal para asignar supervisor a zona ──────────────────────────────────────

function AsignarSupervisorModal({
  zona, supervisores, onClose, onSaved,
}: Readonly<{
  zona: ZonaProperties & { zona_id: string }
  supervisores: Supervisor[]
  onClose: () => void
  onSaved: () => void
}>) {
  const [supId,  setSupId]  = useState(supervisores.find(s => s.nombre + ' ' + s.apellido === zona.supervisor)?.id ?? '')
  const [saving, setSaving] = useState(false)
  const [error,  setError]  = useState('')

  const handleSave = async () => {
    setSaving(true); setError('')
    try {
      await updateZona(zona.zona_id, { supervisor_id: supId || null })
      onSaved(); onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al guardar')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(4px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
    }} onClick={onClose}>
      <div style={{
        background: 'white', borderRadius: 20, width: '100%', maxWidth: 420,
        boxShadow: '0 20px 60px rgba(0,0,0,0.2)',
      }} onClick={e => e.stopPropagation()}>
        <div style={{ padding: '18px 22px 14px', borderBottom: '1px solid #f1f5f9', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontWeight: 800, fontSize: 15, color: '#0f172a' }}>Asignar supervisor</div>
            <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>{zona.nombre} · {zona.codigo}</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 20, color: '#94a3b8' }}>×</button>
        </div>
        <div style={{ padding: '18px 22px 22px' }}>
          {error && (
            <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 10, padding: '8px 12px', fontSize: 12, color: '#dc2626', marginBottom: 14 }}>
              {error}
            </div>
          )}
          <label style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em', display: 'block', marginBottom: 6 }}>
            Supervisor asignado
          </label>
          <select
            value={supId}
            onChange={e => setSupId(e.target.value)}
            style={{ width: '100%', border: '1px solid #e2e8f0', borderRadius: 12, padding: '10px 14px', fontSize: 13, outline: 'none' }}
          >
            <option value="">Sin supervisor</option>
            {supervisores.map(s => (
              <option key={s.id} value={s.id}>
                {s.nombre} {s.apellido} — {s.email}
              </option>
            ))}
          </select>
          <div style={{ display: 'flex', gap: 10, marginTop: 18, justifyContent: 'flex-end' }}>
            <button onClick={onClose} style={{
              border: '1px solid #e2e8f0', background: 'white', borderRadius: 12,
              padding: '9px 18px', fontSize: 13, fontWeight: 600, cursor: 'pointer', color: '#64748b',
            }}>
              Cancelar
            </button>
            <button onClick={() => void handleSave()} disabled={saving} style={{
              background: '#1e293b', color: 'white', border: 'none', borderRadius: 12,
              padding: '9px 20px', fontSize: 13, fontWeight: 700, cursor: 'pointer', opacity: saving ? 0.6 : 1,
            }}>
              {saving ? 'Guardando…' : 'Guardar'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

const FILTROS = [
  { value: 'TODOS',       label: 'Todos' },
  { value: 'PENDIENTE',   label: 'Pendientes' },
  { value: 'EN_ATENCION', label: 'En atención' },
]

const BASEMAPS = {
  claro: {
    label: 'Claro',
    url: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
    attribution: '&copy; <a href="https://carto.com/">CARTO</a> &copy; OSM',
  },
  oscuro: {
    label: 'Oscuro',
    url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    attribution: '&copy; <a href="https://carto.com/">CARTO</a> &copy; OSM',
  },
} as const
type BasemapKey = keyof typeof BASEMAPS

export default function MapaAdmin() {
  const [datos,        setDatos]        = useState<{ zonas: FeatureCollection; incidentes: IncidenteMapa[]; generado_at: string } | null>(null)
  const [supervisores, setSupervisores] = useState<Supervisor[]>([])
  const [loading,      setLoading]      = useState(true)
  const [error,        setError]        = useState<string | null>(null)
  const [zonaPanel,    setZonaPanel]    = useState<(ZonaProperties & { zona_id: string }) | null>(null)
  const [editZona,     setEditZona]     = useState<(ZonaProperties & { zona_id: string }) | null>(null)
  const [filtro,       setFiltro]       = useState('TODOS')
  const [horaUpdate,   setHoraUpdate]   = useState('')
  const [basemap,      setBasemap]      = useState<BasemapKey>('claro')

  const cargar = useCallback(async () => {
    try {
      const [mapa, sups] = await Promise.all([getMapaZonas(), getSupervisores()])
      setDatos(mapa)
      setSupervisores(sups)
      setError(null)
      setHoraUpdate(new Date().toLocaleTimeString('es-EC'))
    } catch {
      setError('No se pudieron cargar los datos del mapa.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void cargar()
    const t = setInterval(() => void cargar(), 30_000)
    return () => clearInterval(t)
  }, [cargar])

  const estiloZona = useCallback((feature: GeoJSON.Feature | undefined) => {
    const codigo = (feature?.properties as ZonaProperties)?.codigo ?? ''
    const color = ZONA_COLOR[codigo] ?? COLOR_FALLBACK
    return { fillColor: color, fillOpacity: 0.25, color, weight: 2, opacity: 0.9 }
  }, [])

  const onEachZona = useCallback((feature: GeoJSON.Feature, layer: L.Layer) => {
    const props = feature.properties as ZonaProperties
    const sup   = props.supervisor ?? 'Sin supervisor'
    layer.on({
      click: () => setZonaPanel({ ...props, zona_id: props.id }),
      mouseover: (e: L.LeafletMouseEvent) => { ;(e.target as L.Path).setStyle({ fillOpacity: 0.45, weight: 3 }) },
      mouseout:  (e: L.LeafletMouseEvent) => { ;(e.target as L.Path).setStyle({ fillOpacity: 0.25, weight: 2 }) },
    })
    layer.bindTooltip(`<b>${props.nombre}</b><br/><span style="font-size:11px;color:#64748b">${sup}</span>`, {
      permanent: false, direction: 'top', className: 'zona-tooltip', opacity: 1,
    })
  }, [])

  const incidentesFiltrados = useMemo<IncidenteMapa[]>(
    () => (datos?.incidentes ?? []).filter(i => filtro === 'TODOS' || i.estado === filtro),
    [datos, filtro],
  )

  const zonas = useMemo(
    () => datos?.zonas ?? null,
    [datos],
  )

  const labels = useMemo(() => {
    if (!zonas) return []
    return zonas.features
      .map(f => ({ centroide: centroideFeature(f), props: f.properties as ZonaProperties }))
      .filter(({ centroide }) => centroide !== null) as { centroide: [number, number]; props: ZonaProperties }[]
  }, [zonas])

  // Contadores de resumen
  const totales = useMemo(() => {
    const inc = datos?.incidentes ?? []
    return {
      total:      inc.length,
      criticos:   inc.filter(i => i.prioridad === 'CRITICA').length,
      pendientes: inc.filter(i => i.estado === 'PENDIENTE').length,
      atencion:   inc.filter(i => i.estado === 'EN_ATENCION').length,
    }
  }, [datos])

  if (loading) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-slate-200 border-t-indigo-500" />
        <span className="text-sm text-slate-400">Cargando mapa…</span>
      </div>
    )
  }
  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3">
        <span className="text-red-500">⚠ {error}</span>
        <button onClick={() => void cargar()} className="rounded-xl bg-indigo-600 px-5 py-2 text-sm font-bold text-white hover:bg-indigo-500">
          Reintentar
        </button>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Encabezado con KPIs */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-extrabold text-slate-900">Mapa de operaciones</h2>
          <p className="text-sm text-slate-500">Vista global — todas las zonas y todos los incidentes activos</p>
        </div>
        <div className="flex gap-3">
          {[
            { label: 'Activos',    value: totales.total,      color: '#f97316' },
            { label: 'Críticos',   value: totales.criticos,   color: '#dc2626' },
            { label: 'Pendientes', value: totales.pendientes, color: '#eab308' },
            { label: 'En campo',   value: totales.atencion,   color: '#8b5cf6' },
          ].map(({ label, value, color }) => (
            <div key={label} style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: 14, padding: '8px 16px', textAlign: 'center', minWidth: 72 }}>
              <div style={{ fontSize: 22, fontWeight: 900, color }}>{value}</div>
              <div style={{ fontSize: 10, color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Mapa */}
      <div style={{
        position: 'relative', height: 'calc(100vh - 220px)', minHeight: 500,
        borderRadius: 20, overflow: 'hidden', border: '1px solid #e2e8f0',
      }}>
        <style>{`
          @keyframes pulse-map {
            0%   { transform: scale(1);   opacity: 0.4; }
            70%  { transform: scale(2.2); opacity: 0;   }
            100% { transform: scale(2.2); opacity: 0;   }
          }
          .zona-tooltip {
            background: rgba(255,255,255,0.97); border: 1px solid #e2e8f0;
            border-radius: 8px; font-size: 12px; color: #1e293b;
            box-shadow: 0 2px 8px rgba(0,0,0,0.12); padding: 5px 10px;
          }
          .zona-label-admin {
            font-size: 11px; font-weight: 800; color: #0f172a;
            text-shadow: 0 0 4px white, 0 0 4px white;
            text-transform: uppercase; letter-spacing: 0.04em;
            white-space: nowrap; pointer-events: none;
          }
        `}</style>

        {/* Filtros centrados */}
        <div style={{
          position: 'absolute', top: 14, left: '50%', transform: 'translateX(-50%)',
          zIndex: 1000, background: 'white', borderRadius: 24, padding: '5px 10px',
          boxShadow: '0 4px 16px rgba(0,0,0,0.15)', display: 'flex', alignItems: 'center',
          gap: 6, whiteSpace: 'nowrap', border: '1px solid #e2e8f0',
        }}>
          {FILTROS.map(({ value, label }) => (
            <button key={value} onClick={() => setFiltro(value)} style={{
              padding: '5px 16px', borderRadius: 20, border: 'none', cursor: 'pointer',
              fontSize: 12, fontWeight: filtro === value ? 700 : 500,
              background: filtro === value ? '#4f46e5' : '#f1f5f9',
              color: filtro === value ? 'white' : '#475569', transition: 'all 0.15s',
            }}>
              {label}
            </button>
          ))}
          <span style={{ fontSize: 11, color: '#94a3b8', marginLeft: 4 }}>⟳ {horaUpdate}</span>
        </div>

        {/* Toggle basemap */}
        <div style={{
          position: 'absolute', top: 14, right: 14, zIndex: 1000,
          background: 'white', borderRadius: 20, padding: 3,
          boxShadow: '0 4px 16px rgba(0,0,0,0.15)', display: 'flex', border: '1px solid #e2e8f0',
        }}>
          {(Object.keys(BASEMAPS) as BasemapKey[]).map(key => (
            <button key={key} onClick={() => setBasemap(key)} style={{
              padding: '5px 12px', borderRadius: 16, border: 'none', cursor: 'pointer',
              fontSize: 11, fontWeight: basemap === key ? 700 : 500,
              background: basemap === key ? (key === 'oscuro' ? '#1e293b' : '#4f46e5') : 'transparent',
              color: basemap === key ? 'white' : '#64748b', transition: 'all 0.15s',
            }}>
              {key === 'oscuro' ? '🌙' : '☀️'} {BASEMAPS[key].label}
            </button>
          ))}
        </div>

        <MapContainer center={[-0.22, -78.5]} zoom={11} style={{ height: '100%', width: '100%' }} zoomControl>
          <TileLayer
            key={basemap}
            attribution={BASEMAPS[basemap].attribution}
            url={BASEMAPS[basemap].url}
            subdomains="abcd"
            maxZoom={19}
          />

          {zonas && (
            <GeoJSON key={datos?.generado_at} data={zonas} style={estiloZona} onEachFeature={onEachZona} />
          )}

          {labels.map(({ centroide, props }) => (
            <Marker
              key={`lbl-${props.codigo}`}
              position={centroide}
              icon={L.divIcon({ html: `<div class="zona-label-admin">${props.nombre}</div>`, className: '', iconAnchor: [0, 0] })}
              interactive={false}
              zIndexOffset={-100}
            />
          ))}

          {incidentesFiltrados.map(inc =>
            inc.latitud && inc.longitud ? (
              <Marker key={inc.id} position={[inc.latitud, inc.longitud]} icon={crearIcono(inc.prioridad)}>
                <Popup minWidth={240} maxWidth={280}>
                  <IncidentePopup inc={inc} />
                </Popup>
              </Marker>
            ) : null,
          )}
        </MapContainer>

        {/* Panel de zona seleccionada */}
        {zonaPanel && (
          <div style={{
            position: 'absolute', top: 0, right: 0, bottom: 0, width: 268, zIndex: 500,
            background: 'white', padding: '20px 18px', overflowY: 'auto',
            boxShadow: '-4px 0 20px rgba(0,0,0,0.12)', borderLeft: '1px solid #e2e8f0',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ width: 14, height: 14, borderRadius: 4, background: ZONA_COLOR[zonaPanel.codigo] ?? COLOR_FALLBACK, flexShrink: 0 }} />
                <div>
                  <div style={{ fontWeight: 800, fontSize: 14, color: '#0f172a' }}>{zonaPanel.nombre}</div>
                  <div style={{ fontSize: 10, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{zonaPanel.codigo}</div>
                </div>
              </div>
              <button onClick={() => setZonaPanel(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: '#94a3b8' }}>×</button>
            </div>

            {/* Supervisor asignado */}
            <div style={{ background: '#f8fafc', borderRadius: 12, padding: '10px 12px', marginBottom: 14 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>
                Supervisor
              </div>
              {zonaPanel.supervisor ? (
                <>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#0f172a' }}>{zonaPanel.supervisor}</div>
                  {zonaPanel.supervisor_email && (
                    <div style={{ fontSize: 11, color: '#64748b' }}>{zonaPanel.supervisor_email}</div>
                  )}
                </>
              ) : (
                <div style={{ fontSize: 12, color: '#f97316', fontStyle: 'italic' }}>Sin supervisor asignado</div>
              )}
              <button
                onClick={() => setEditZona(zonaPanel)}
                style={{
                  marginTop: 10, width: '100%', background: '#1e293b', color: 'white',
                  border: 'none', borderRadius: 10, padding: '8px 0', fontSize: 12,
                  fontWeight: 700, cursor: 'pointer',
                }}
              >
                Cambiar supervisor
              </button>
            </div>

            {/* Stats */}
            {[
              { label: 'Activos total',  value: zonaPanel.incidentes_activos, color: '#f97316' },
              { label: 'Entrantes',      value: zonaPanel.pendientes,         color: '#eab308' },
              { label: 'En atención',    value: zonaPanel.en_atencion,        color: '#8b5cf6' },
              { label: 'Críticos',       value: zonaPanel.criticas,           color: '#dc2626' },
              { label: 'Últimas 24 h',   value: zonaPanel.ultimas_24h,        color: '#64748b' },
            ].map(stat => (
              <div key={stat.label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid #f1f5f9' }}>
                <span style={{ fontSize: 12, color: '#475569' }}>{stat.label}</span>
                <span style={{ fontSize: 22, fontWeight: 800, color: stat.color }}>{stat.value}</span>
              </div>
            ))}
          </div>
        )}

        {/* Leyenda */}
        <div style={{
          position: 'absolute', bottom: 16, left: 14, zIndex: 1000,
          background: 'white', borderRadius: 12, padding: '10px 14px', fontSize: 11,
          border: '1px solid #e2e8f0', boxShadow: '0 4px 16px rgba(0,0,0,0.12)', maxWidth: 180,
        }}>
          <div style={{ fontWeight: 700, marginBottom: 7, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.06em', fontSize: 10 }}>
            Zonas DMQ
          </div>
          {Object.entries(ZONA_COLOR).map(([codigo, color]) => {
            const nombre = zonas?.features.find(f => (f.properties as ZonaProperties)?.codigo === codigo)?.properties?.nombre as string | undefined
            if (!nombre) return null
            return (
              <div key={codigo} style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 4 }}>
                <span style={{ width: 11, height: 11, borderRadius: 3, flexShrink: 0, background: color }} />
                <span style={{ color: '#475569' }}>{nombre}</span>
              </div>
            )
          })}
          <div style={{ borderTop: '1px solid #f1f5f9', marginTop: 8, paddingTop: 8 }}>
            <div style={{ fontWeight: 700, marginBottom: 5, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.06em', fontSize: 10 }}>
              Prioridad
            </div>
            {Object.entries(PRIORIDAD_COLOR).map(([k, c]) => (
              <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 3 }}>
                <span style={{ width: 11, height: 11, borderRadius: '50%', flexShrink: 0, background: c }} />
                <span style={{ color: '#475569' }}>{PRIORIDAD_LABEL[k]}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Modal asignación supervisor */}
      {editZona && (
        <AsignarSupervisorModal
          zona={editZona}
          supervisores={supervisores}
          onClose={() => setEditZona(null)}
          onSaved={() => void cargar()}
        />
      )}
    </div>
  )
}
