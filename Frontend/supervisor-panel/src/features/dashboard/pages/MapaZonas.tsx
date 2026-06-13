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

// ── Fix íconos Leaflet + Vite ────────────────────────────────────────────────
import iconUrl from 'leaflet/dist/images/marker-icon.png'
import iconShadow from 'leaflet/dist/images/marker-shadow.png'
L.Marker.prototype.options.icon = L.icon({
  iconUrl, shadowUrl: iconShadow,
  iconSize: [25, 41], iconAnchor: [12, 41], popupAnchor: [1, -34],
})

// ── Color categórico por zona (muestra la división claramente) ────────────────
// Cada Administración Zonal del DMQ tiene su color distintivo.
const ZONA_COLOR: Record<string, string> = {
  'ZN-CALDERON':       '#e11d48', // rosa-rojo
  'ZN-ELOY-ALFARO':    '#f97316', // naranja
  'ZN-EUGENIO-ESPEJO': '#eab308', // ámbar
  'ZN-LA-DELICIA':     '#84cc16', // lima
  'ZN-LOS-CHILLOS':    '#06b6d4', // cian
  'ZN-MANUELA-SAENZ':  '#8b5cf6', // violeta
  'ZN-QUITUMBE':       '#ec4899', // rosa
  'ZN-TUMBACO':        '#14b8a6', // verde-azulado
}
const COLOR_FALLBACK = '#64748b'

const PRIORIDAD_COLOR: Record<string, string> = {
  CRITICA: '#dc2626', ALTA: '#f97316', MEDIA: '#eab308', BAJA: '#22c55e',
}

function crearIcono(prioridad: string | null): L.DivIcon {
  const color = PRIORIDAD_COLOR[prioridad ?? ''] ?? '#94a3b8'
  return L.divIcon({
    html: `<div style="
      width:26px;height:26px;border-radius:50%;
      background:${color};border:2.5px solid white;
      display:flex;align-items:center;justify-content:center;
      box-shadow:0 2px 6px rgba(0,0,0,0.4);
      font-size:13px;font-weight:900;color:white;font-family:sans-serif;
    ">!</div>`,
    className: '', iconSize: [26, 26], iconAnchor: [13, 13], popupAnchor: [0, -14],
  })
}

// ── Centroide aproximado para los labels de zona ─────────────────────────────
function centroideFeature(f: GeoJSON.Feature): [number, number] | null {
  const geom = f.geometry
  let coords: number[][] = []
  if (geom.type === 'Polygon') coords = geom.coordinates[0]
  else if (geom.type === 'MultiPolygon') {
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

// ── Capas base disponibles ───────────────────────────────────────────────────
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

export default function MapaZonas() {
  const [datos, setDatos]           = useState<MapaZonasResponse | null>(null)
  const [loading, setLoading]       = useState(true)
  const [error, setError]           = useState<string | null>(null)
  const [zonaPanel, setZonaPanel]   = useState<ZonaProperties | null>(null)
  const [filtro, setFiltro]         = useState('TODOS')
  const [horaUpdate, setHoraUpdate] = useState('')
  const [basemap, setBasemap]       = useState<BasemapKey>('claro')

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
    const codigo = (feature?.properties as ZonaProperties)?.codigo ?? ''
    const color = ZONA_COLOR[codigo] ?? COLOR_FALLBACK
    return {
      fillColor:   color,
      fillOpacity: 0.30,
      color:       color,
      weight:      2,
      opacity:     0.9,
    }
  }, [])

  const onEachZona = useCallback((feature: GeoJSON.Feature, layer: L.Layer) => {
    const props = feature.properties as ZonaProperties
    layer.on({
      click: () => setZonaPanel(props),
      mouseover: (e: L.LeafletMouseEvent) => {
        ;(e.target as L.Path).setStyle({ fillOpacity: 0.50, weight: 3 })
      },
      mouseout: (e: L.LeafletMouseEvent) => {
        ;(e.target as L.Path).setStyle({ fillOpacity: 0.30, weight: 2 })
      },
    })
    layer.bindTooltip(props.nombre, {
      permanent: false, direction: 'top', className: 'zona-tooltip',
      opacity: 1,
    })
  }, [])

  const incidentesFiltrados = useMemo<IncidenteMapa[]>(
    () => (datos?.incidentes ?? []).filter(i => filtro === 'TODOS' || i.estado === filtro),
    [datos, filtro]
  )

  const zonas = useMemo(
    () => (datos?.zonas as GeoJSON.FeatureCollection | undefined) ?? null,
    [datos]
  )

  const labels = useMemo(() => {
    if (!zonas) return []
    return zonas.features
      .map(f => ({ centroide: centroideFeature(f), props: f.properties as ZonaProperties }))
      .filter(({ centroide }) => centroide !== null) as { centroide: [number, number]; props: ZonaProperties }[]
  }, [zonas])

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
      position: 'relative', height: 'calc(100vh - 130px)', minHeight: 500,
      borderRadius: 20, overflow: 'hidden', border: '1px solid #e2e8f0',
    }}>
      {/* CSS para tooltips y labels — adapta según basemap claro/oscuro */}
      <style>{`
        .zona-tooltip {
          background: rgba(255,255,255,0.95); border: 1px solid #e2e8f0;
          border-radius: 8px; font-weight: 700; font-size: 12px; color: #1e293b;
          box-shadow: 0 2px 8px rgba(0,0,0,0.12); padding: 3px 8px;
        }
        .zona-tooltip::before { border-top-color: rgba(255,255,255,0.95); }
        .zona-label {
          font-size: 12px; font-weight: 800; ${
            basemap === 'oscuro'
              ? 'color: rgba(255,255,255,0.95); text-shadow: 0 0 4px rgba(0,0,0,0.9), 0 0 4px rgba(0,0,0,0.9), 0 1px 3px rgba(0,0,0,0.8);'
              : 'color: #0f172a; text-shadow: 0 0 4px white, 0 0 4px white, 0 1px 3px rgba(255,255,255,0.9);'
          }
          text-transform: uppercase; letter-spacing: 0.04em; white-space: nowrap;
          pointer-events: none;
        }
      `}</style>

      {/* Barra de filtros */}
      <div style={{
        position: 'absolute', top: 14, left: '50%', transform: 'translateX(-50%)',
        zIndex: 1000, background: 'white', borderRadius: 24, padding: '5px 10px',
        boxShadow: '0 4px 16px rgba(0,0,0,0.15)', display: 'flex', alignItems: 'center',
        gap: 6, whiteSpace: 'nowrap', border: '1px solid #e2e8f0',
      }}>
        {FILTROS.map(({ value, label }) => (
          <button key={value} onClick={() => setFiltro(value)}
            style={{
              padding: '5px 16px', borderRadius: 20, border: 'none', cursor: 'pointer',
              fontSize: 12, fontWeight: filtro === value ? 700 : 500,
              background: filtro === value ? '#f97316' : '#f1f5f9',
              color:      filtro === value ? 'white'   : '#475569',
              transition: 'all 0.15s',
            }}>
            {label}
          </button>
        ))}
        <span style={{ fontSize: 11, color: '#94a3b8', marginLeft: 4 }}>⟳ {horaUpdate}</span>
      </div>

      {/* Toggle de fondo claro/oscuro — esquina superior derecha */}
      <div style={{
        position: 'absolute', top: 14, right: 14, zIndex: 1000,
        background: 'white', borderRadius: 20, padding: 3,
        boxShadow: '0 4px 16px rgba(0,0,0,0.15)', display: 'flex',
        border: '1px solid #e2e8f0',
      }}>
        {(Object.keys(BASEMAPS) as BasemapKey[]).map(key => (
          <button key={key} onClick={() => setBasemap(key)}
            style={{
              padding: '5px 12px', borderRadius: 16, border: 'none', cursor: 'pointer',
              fontSize: 11, fontWeight: basemap === key ? 700 : 500,
              background: basemap === key ? (key === 'oscuro' ? '#1e293b' : '#f97316') : 'transparent',
              color:      basemap === key ? 'white' : '#64748b',
              transition: 'all 0.15s', display: 'flex', alignItems: 'center', gap: 4,
            }}>
            {key === 'oscuro' ? '🌙' : '☀️'} {BASEMAPS[key].label}
          </button>
        ))}
      </div>

      {/* Mapa — basemap conmutable claro/oscuro */}
      <MapContainer center={[-0.22, -78.50]} zoom={11} style={{ height: '100%', width: '100%' }} zoomControl>
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

        {/* Labels de nombre de zona */}
        {labels.map(({ centroide, props }) => (
          <Marker key={`lbl-${props.codigo}`} position={centroide}
            icon={L.divIcon({ html: `<div class="zona-label">${props.nombre}</div>`, className: '', iconAnchor: [0, 0] })}
            interactive={false} zIndexOffset={-100} />
        ))}

        {/* Incidentes */}
        {incidentesFiltrados.map(inc =>
          inc.latitud && inc.longitud ? (
            <Marker key={inc.id} position={[inc.latitud, inc.longitud]} icon={crearIcono(inc.prioridad)}>
              <Popup>
                <div style={{ minWidth: 180, fontFamily: 'sans-serif' }}>
                  <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 4, color: '#0f172a' }}>
                    {inc.zona_nombre ?? 'Sin zona'}
                  </div>
                  {inc.descripcion && (
                    <div style={{ fontSize: 11, color: '#64748b', marginBottom: 8 }}>
                      {inc.descripcion.slice(0, 100)}{inc.descripcion.length > 100 ? '…' : ''}
                    </div>
                  )}
                  <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                    <span style={{ background: PRIORIDAD_COLOR[inc.prioridad ?? ''] ?? '#cbd5e1', color: 'white', padding: '2px 8px', borderRadius: 8, fontSize: 10, fontWeight: 700 }}>
                      {inc.prioridad ?? 'Sin prioridad'}
                    </span>
                    <span style={{ background: '#f1f5f9', color: '#475569', padding: '2px 8px', borderRadius: 8, fontSize: 10 }}>
                      {inc.estado}
                    </span>
                  </div>
                  <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 6 }}>
                    {new Date(inc.created_at).toLocaleString('es-EC', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                  </div>
                </div>
              </Popup>
            </Marker>
          ) : null
        )}
      </MapContainer>

      {/* Panel de zona seleccionada */}
      {zonaPanel && (
        <div style={{
          position: 'absolute', top: 0, right: 0, bottom: 0, width: 256, zIndex: 500,
          background: 'white', padding: '20px 16px', overflowY: 'auto',
          boxShadow: '-4px 0 20px rgba(0,0,0,0.12)', borderLeft: '1px solid #e2e8f0',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ width: 14, height: 14, borderRadius: 4, background: ZONA_COLOR[zonaPanel.codigo] ?? COLOR_FALLBACK, flexShrink: 0 }} />
              <div>
                <div style={{ fontWeight: 700, fontSize: 14, color: '#0f172a' }}>{zonaPanel.nombre}</div>
                <div style={{ fontSize: 10, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{zonaPanel.codigo}</div>
              </div>
            </div>
            <button onClick={() => setZonaPanel(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: '#94a3b8', lineHeight: 1 }}>×</button>
          </div>

          {[
            { label: 'Activos total',  value: zonaPanel.incidentes_activos, color: '#f97316' },
            { label: 'Pendientes',     value: zonaPanel.pendientes,         color: '#eab308' },
            { label: 'En atención',    value: zonaPanel.en_atencion,        color: '#3b82f6' },
            { label: 'Críticos',       value: zonaPanel.criticas,           color: '#ef4444' },
            { label: 'Últimas 24 h',   value: zonaPanel.ultimas_24h,        color: '#64748b' },
          ].map(stat => (
            <div key={stat.label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid #f1f5f9' }}>
              <span style={{ fontSize: 12, color: '#475569' }}>{stat.label}</span>
              <span style={{ fontSize: 22, fontWeight: 800, color: stat.color }}>{stat.value}</span>
            </div>
          ))}
        </div>
      )}

      {/* Leyenda — nombres de zona con su color */}
      <div style={{
        position: 'absolute', bottom: 16, left: 14, zIndex: 1000,
        background: 'white', borderRadius: 12, padding: '10px 14px', fontSize: 11,
        border: '1px solid #e2e8f0', boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
        maxWidth: 180,
      }}>
        <div style={{ fontWeight: 700, marginBottom: 7, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.06em', fontSize: 10 }}>
          Zonas
        </div>
        {Object.entries(ZONA_COLOR).map(([codigo, color]) => {
          const nombre = (datos?.zonas as GeoJSON.FeatureCollection | undefined)?.features
            .find(f => (f.properties as ZonaProperties)?.codigo === codigo)
            ?.properties?.nombre as string | undefined
          if (!nombre) return null
          return (
            <div key={codigo} style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 4 }}>
              <span style={{ width: 11, height: 11, borderRadius: 3, flexShrink: 0, background: color }} />
              <span style={{ color: '#475569' }}>{nombre}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
