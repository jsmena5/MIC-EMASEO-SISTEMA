import { MapContainer, TileLayer, GeoJSON, Marker, Popup } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { useEffect, useState, useCallback, useMemo } from 'react'
import {
  getMapaZonas,
  type MapaZonasResponse,
  type ZonaProperties,
  type IncidenteMapa,
} from '../../../services/supervisor.service'

// ── Fix íconos Leaflet + Vite ─────────────────────────────────────────────────
import iconUrl from 'leaflet/dist/images/marker-icon.png'
import iconShadow from 'leaflet/dist/images/marker-shadow.png'
L.Marker.prototype.options.icon = L.icon({
  iconUrl, shadowUrl: iconShadow,
  iconSize: [25, 41], iconAnchor: [12, 41], popupAnchor: [1, -34],
})

// ── Paleta estilo oscuro (inspirada en Uber) ──────────────────────────────────
// Fondo oscuro → colores cálidos saturados para destacar
const NIVEL_STYLE: Record<string, { fill: string; stroke: string; opacity: number }> = {
  critico:       { fill: '#ef4444', stroke: '#ef4444', opacity: 0.55 },
  alto:          { fill: '#f97316', stroke: '#f97316', opacity: 0.50 },
  medio:         { fill: '#eab308', stroke: '#eab308', opacity: 0.40 },
  bajo:          { fill: '#84cc16', stroke: '#84cc16', opacity: 0.30 },
  sin_actividad: { fill: '#475569', stroke: '#64748b', opacity: 0.25 },
}

const PRIORIDAD_COLOR: Record<string, string> = {
  CRITICA: '#ef4444',
  ALTA:    '#f97316',
  MEDIA:   '#eab308',
  BAJA:    '#22c55e',
}

// ── Icono de marcador limpio ─────────────────────────────────────────────────
function crearIcono(prioridad: string | null): L.DivIcon {
  const color = PRIORIDAD_COLOR[prioridad ?? ''] ?? '#94a3b8'
  return L.divIcon({
    html: `<div style="
      width:28px;height:28px;border-radius:50%;
      background:${color};border:2.5px solid rgba(255,255,255,0.9);
      display:flex;align-items:center;justify-content:center;
      box-shadow:0 2px 8px rgba(0,0,0,0.5);
      font-size:13px;font-weight:900;color:white;font-family:sans-serif;
    ">!</div>`,
    className: '',
    iconSize: [28, 28],
    iconAnchor: [14, 14],
    popupAnchor: [0, -16],
  })
}

// ── Filtrar polígonos diminutos de MultiPolygon ───────────────────────────────
// Los bordes de parroquias generan fragmentos minúsculos. Solo dibujamos
// polígonos con área > umbral para que el mapa quede limpio.
const MIN_POLY_AREA = 0.00005 // ~0.5 km² aprox

function filtrarGeometriaGrande(geom: GeoJSON.Geometry | null): GeoJSON.Geometry | null {
  if (!geom) return null
  if (geom.type === 'Polygon') {
    const coords = geom.coordinates[0]
    if (!coords || coords.length < 4) return null
    // Área aproximada del bounding box
    const lons = coords.map((c: number[]) => c[0])
    const lats = coords.map((c: number[]) => c[1])
    const area = (Math.max(...lons) - Math.min(...lons)) * (Math.max(...lats) - Math.min(...lats))
    return area > MIN_POLY_AREA ? geom : null
  }
  if (geom.type === 'MultiPolygon') {
    const polys = geom.coordinates.filter(ring => {
      const outer = ring[0]
      const lons = outer.map((c: number[]) => c[0])
      const lats = outer.map((c: number[]) => c[1])
      const area = (Math.max(...lons) - Math.min(...lons)) * (Math.max(...lats) - Math.min(...lats))
      return area > MIN_POLY_AREA
    })
    if (polys.length === 0) return null
    if (polys.length === 1) return { type: 'Polygon', coordinates: polys[0] }
    return { type: 'MultiPolygon', coordinates: polys }
  }
  return geom
}

function limpiarFeatureCollection(fc: GeoJSON.FeatureCollection): GeoJSON.FeatureCollection {
  return {
    ...fc,
    features: fc.features
      .map(f => ({ ...f, geometry: filtrarGeometriaGrande(f.geometry) }))
      .filter(f => f.geometry !== null) as GeoJSON.Feature[],
  }
}

// ── Centroide aproximado de una Feature ─────────────────────────────────────
function centroideFeature(f: GeoJSON.Feature): [number, number] | null {
  const geom = f.geometry
  let coords: number[][] = []
  if (geom.type === 'Polygon') coords = geom.coordinates[0]
  else if (geom.type === 'MultiPolygon') {
    // Tomar el polígono más grande
    let best: number[][] = []
    let bestArea = 0
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
  const lat = coords.reduce((s, c) => s + c[1], 0) / coords.length
  const lon = coords.reduce((s, c) => s + c[0], 0) / coords.length
  return [lat, lon]
}

const FILTROS = [
  { value: 'TODOS',       label: 'Todos' },
  { value: 'PENDIENTE',   label: 'Pendientes' },
  { value: 'EN_ATENCION', label: 'En atención' },
]

// ── Componente principal ─────────────────────────────────────────────────────
export default function MapaZonas() {
  const [datos, setDatos]           = useState<MapaZonasResponse | null>(null)
  const [loading, setLoading]       = useState(true)
  const [error, setError]           = useState<string | null>(null)
  const [zonaPanel, setZonaPanel]   = useState<ZonaProperties | null>(null)
  const [filtro, setFiltro]         = useState('TODOS')
  const [horaUpdate, setHoraUpdate] = useState('')

  const cargar = useCallback(async () => {
    try {
      const data = await getMapaZonas()
      setDatos(data)
      setError(null)
      setHoraUpdate(new Date().toLocaleTimeString('es-EC'))
    } catch {
      setError('No se pudieron cargar los datos del mapa.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    cargar()
    const t = setInterval(cargar, 30_000)
    return () => clearInterval(t)
  }, [cargar])

  const estiloZona = useCallback((feature: GeoJSON.Feature | undefined) => {
    const nivel = (feature?.properties as ZonaProperties)?.nivel ?? 'sin_actividad'
    const s = NIVEL_STYLE[nivel] ?? NIVEL_STYLE.sin_actividad
    return {
      fillColor:   s.fill,
      fillOpacity: s.opacity,
      color:       s.stroke,
      weight:      1.5,
      opacity:     0.7,
    }
  }, [])

  const onEachZona = useCallback((feature: GeoJSON.Feature, layer: L.Layer) => {
    const props = feature.properties as ZonaProperties
    const s = NIVEL_STYLE[props?.nivel ?? 'sin_actividad'] ?? NIVEL_STYLE.sin_actividad
    layer.on({
      click: () => setZonaPanel(props),
      mouseover: (e: L.LeafletMouseEvent) => {
        ;(e.target as L.Path).setStyle({ fillOpacity: Math.min(s.opacity + 0.2, 0.75), weight: 2.5 })
      },
      mouseout: (e: L.LeafletMouseEvent) => {
        ;(e.target as L.Path).setStyle({ fillOpacity: s.opacity, weight: 1.5 })
      },
    })
  }, [])

  const incidentesFiltrados = useMemo<IncidenteMapa[]>(
    () => (datos?.incidentes ?? []).filter(i => filtro === 'TODOS' || i.estado === filtro),
    [datos, filtro]
  )

  const zonasFiltradas = useMemo(() => {
    if (!datos?.zonas) return null
    return limpiarFeatureCollection(datos.zonas as GeoJSON.FeatureCollection)
  }, [datos])

  // Centroides para labels de zona
  const centroideLabels = useMemo(() => {
    if (!zonasFiltradas) return []
    return zonasFiltradas.features
      .map(f => ({ centroide: centroideFeature(f), props: f.properties as ZonaProperties }))
      .filter(({ centroide }) => centroide !== null) as { centroide: [number, number]; props: ZonaProperties }[]
  }, [zonasFiltradas])

  if (loading) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-slate-200 border-t-orange-400" />
        <span className="text-sm text-slate-400">Cargando mapa…</span>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3">
        <span className="text-red-500">⚠ {error}</span>
        <button onClick={cargar} className="rounded-xl bg-orange-500 px-5 py-2 text-sm font-bold text-white hover:bg-orange-600">
          Reintentar
        </button>
      </div>
    )
  }

  return (
    <div style={{
      position: 'relative',
      height: 'calc(100vh - 130px)',
      minHeight: 500,
      borderRadius: 20,
      overflow: 'hidden',
      border: '1px solid #1e293b',
    }}>

      {/* ── Barra de filtros flotante ── */}
      <div style={{
        position: 'absolute', top: 14, left: '50%',
        transform: 'translateX(-50%)', zIndex: 1000,
        background: 'rgba(15,23,42,0.92)', backdropFilter: 'blur(8px)',
        borderRadius: 24, padding: '5px 10px',
        boxShadow: '0 4px 20px rgba(0,0,0,0.4)',
        display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap',
        border: '1px solid rgba(255,255,255,0.08)',
      }}>
        {FILTROS.map(({ value, label }) => (
          <button
            key={value}
            onClick={() => setFiltro(value)}
            style={{
              padding: '5px 16px', borderRadius: 20, border: 'none',
              cursor: 'pointer', fontSize: 12, fontWeight: filtro === value ? 700 : 400,
              background: filtro === value ? '#f97316' : 'transparent',
              color:      filtro === value ? 'white'   : 'rgba(255,255,255,0.55)',
              transition: 'all 0.15s',
            }}
          >
            {label}
          </button>
        ))}
        <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', marginLeft: 4 }}>
          ⟳ {horaUpdate}
        </span>
      </div>

      {/* ── Mapa Leaflet ── */}
      <MapContainer
        center={[-0.22, -78.51]}
        zoom={12}
        style={{ height: '100%', width: '100%' }}
        zoomControl
      >
        {/* Tiles oscuros CartoDB Dark Matter */}
        <TileLayer
          attribution='&copy; <a href="https://carto.com/">CARTO</a> &copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>'
          url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
          subdomains="abcd"
          maxZoom={19}
        />

        {/* Polígonos de zonas — con geometrías simplificadas */}
        {zonasFiltradas && (
          <GeoJSON
            key={datos?.generado_at}
            data={zonasFiltradas}
            style={estiloZona}
            onEachFeature={onEachZona}
          />
        )}

        {/* Labels de nombre de zona centrados */}
        {centroideLabels.map(({ centroide, props }) => (
          <Marker
            key={`label-${props.codigo}`}
            position={centroide}
            icon={L.divIcon({
              html: `<div style="
                font-size:11px;font-weight:700;color:rgba(255,255,255,0.85);
                text-transform:uppercase;letter-spacing:0.08em;
                text-shadow:0 1px 4px rgba(0,0,0,0.8);
                white-space:nowrap;pointer-events:none;
              ">${props.nombre}</div>`,
              className: '',
              iconAnchor: [0, 0],
            })}
            interactive={false}
            zIndexOffset={-100}
          />
        ))}

        {/* Markers de incidentes */}
        {incidentesFiltrados.map(inc =>
          inc.latitud && inc.longitud ? (
            <Marker
              key={inc.id}
              position={[inc.latitud, inc.longitud]}
              icon={crearIcono(inc.prioridad)}
            >
              <Popup>
                <div style={{ minWidth: 180, fontFamily: 'sans-serif', background: '#0f172a', color: '#f1f5f9', padding: 4, borderRadius: 8 }}>
                  <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 4 }}>
                    {inc.zona_nombre ?? 'Sin zona'}
                  </div>
                  {inc.descripcion && (
                    <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 8 }}>
                      {inc.descripcion.slice(0, 100)}{inc.descripcion.length > 100 ? '…' : ''}
                    </div>
                  )}
                  <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                    <span style={{ background: PRIORIDAD_COLOR[inc.prioridad ?? ''] ?? '#475569', color: 'white', padding: '2px 8px', borderRadius: 8, fontSize: 10, fontWeight: 700 }}>
                      {inc.prioridad ?? 'Sin prioridad'}
                    </span>
                    <span style={{ background: '#1e293b', color: '#94a3b8', padding: '2px 8px', borderRadius: 8, fontSize: 10 }}>
                      {inc.estado}
                    </span>
                  </div>
                  <div style={{ fontSize: 10, color: '#475569', marginTop: 6 }}>
                    {new Date(inc.created_at).toLocaleString('es-EC', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                  </div>
                </div>
              </Popup>
            </Marker>
          ) : null
        )}
      </MapContainer>

      {/* ── Panel de zona seleccionada ── */}
      {zonaPanel && (
        <div style={{
          position: 'absolute', top: 0, right: 0, bottom: 0,
          width: 256, zIndex: 500,
          background: 'rgba(15,23,42,0.96)', backdropFilter: 'blur(12px)',
          padding: '20px 16px', overflowY: 'auto',
          boxShadow: '-4px 0 24px rgba(0,0,0,0.4)',
          borderLeft: '1px solid rgba(255,255,255,0.08)',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: 14, color: '#f1f5f9' }}>{zonaPanel.nombre}</div>
              <div style={{ fontSize: 10, color: '#64748b', marginTop: 2, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                {zonaPanel.codigo}
              </div>
            </div>
            <button onClick={() => setZonaPanel(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: '#475569', lineHeight: 1 }}>
              ×
            </button>
          </div>

          {/* Nivel badge */}
          <div style={{ marginBottom: 16 }}>
            <span style={{
              background: NIVEL_STYLE[zonaPanel.nivel]?.fill ?? '#475569',
              color: 'white', padding: '3px 14px', borderRadius: 20,
              fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em',
            }}>
              {zonaPanel.nivel.replace('_', ' ')}
            </span>
          </div>

          {/* Stats */}
          {[
            { label: 'Activos total',  value: zonaPanel.incidentes_activos, color: '#f97316' },
            { label: 'Pendientes',     value: zonaPanel.pendientes,         color: '#eab308' },
            { label: 'En atención',    value: zonaPanel.en_atencion,        color: '#3b82f6' },
            { label: 'Críticos',       value: zonaPanel.criticas,           color: '#ef4444' },
            { label: 'Últimas 24 h',   value: zonaPanel.ultimas_24h,        color: '#94a3b8' },
          ].map(stat => (
            <div key={stat.label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
              <span style={{ fontSize: 12, color: '#94a3b8' }}>{stat.label}</span>
              <span style={{ fontSize: 22, fontWeight: 800, color: stat.color }}>{stat.value}</span>
            </div>
          ))}
        </div>
      )}

      {/* ── Leyenda ── */}
      <div style={{
        position: 'absolute', bottom: 16, left: 14, zIndex: 1000,
        background: 'rgba(15,23,42,0.9)', backdropFilter: 'blur(8px)',
        borderRadius: 12, padding: '10px 14px', fontSize: 11,
        border: '1px solid rgba(255,255,255,0.08)',
        boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
      }}>
        <div style={{ fontWeight: 700, marginBottom: 7, color: 'rgba(255,255,255,0.7)', textTransform: 'uppercase', letterSpacing: '0.08em', fontSize: 10 }}>
          Actividad
        </div>
        {Object.entries(NIVEL_STYLE).map(([nivel, s]) => (
          <div key={nivel} style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 4 }}>
            <div style={{ width: 12, height: 12, borderRadius: 3, flexShrink: 0, background: s.fill, opacity: s.opacity + 0.3 }} />
            <span style={{ color: 'rgba(255,255,255,0.55)', textTransform: 'capitalize' }}>
              {nivel.replace('_', ' ')}
            </span>
          </div>
        ))}
      </div>

    </div>
  )
}
