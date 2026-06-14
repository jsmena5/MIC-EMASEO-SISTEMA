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
  // Pulso animado para prioridad CRITICA
  const pulse = prioridad === 'CRITICA'
    ? `<div style="position:absolute;inset:-5px;border-radius:50%;background:${color};opacity:0.25;animation:pulse-map 1.8s ease-out infinite;"></div>` : ''
  return L.divIcon({
    html: `<div style="position:relative;width:28px;height:28px;">
      ${pulse}
      <div style="
        position:absolute;inset:0;border-radius:50%;
        background:${color};border:2.5px solid white;
        display:flex;align-items:center;justify-content:center;
        box-shadow:0 2px 8px rgba(0,0,0,0.35);
        font-size:11px;font-weight:900;color:white;font-family:sans-serif;
      ">${(prioridad ?? 'B')[0]}</div>
    </div>`,
    className: '', iconSize: [28, 28], iconAnchor: [14, 14], popupAnchor: [0, -16],
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

// ── Popup de incidente — tarjeta completa con acciones ───────────────────────

function IncidentePopup({ inc }: Readonly<{ inc: IncidenteMapa }>) {
  const prioColor  = PRIORIDAD_COLOR[inc.prioridad ?? ''] ?? '#94a3b8'
  const prioLabel  = PRIORIDAD_LABEL[inc.prioridad ?? ''] ?? inc.prioridad ?? '—'
  const estadoSty  = ESTADO_STYLE[inc.estado] ?? { bg: '#F1F5F9', text: '#475569', label: inc.estado }
  const fecha      = new Date(inc.created_at).toLocaleString('es-EC', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })

  const gMapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${inc.latitud},${inc.longitud}`
  const bandeja  = `/dashboard/incidentes?id=${inc.id}&sin_supervisar=false&solo_detalle=true`

  return (
    <div style={{ fontFamily: 'system-ui, sans-serif', width: 260 }}>
      {/* Header */}
      <div style={{ marginBottom: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
          <span style={{ fontSize: 10, fontFamily: 'monospace', color: '#94a3b8', fontWeight: 600 }}>
            #{inc.id.slice(0, 8).toUpperCase()}
          </span>
          <span style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8' }}>
            {fecha}
          </span>
        </div>
        <div style={{ fontSize: 14, fontWeight: 800, color: '#0f172a', lineHeight: 1.3 }}>
          {inc.zona_nombre ?? 'Sin zona asignada'}
        </div>
      </div>

      {/* Badges */}
      <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginBottom: 10 }}>
        <span style={{
          background: prioColor, color: 'white',
          padding: '3px 9px', borderRadius: 20, fontSize: 10, fontWeight: 800,
        }}>
          ● {prioLabel}
        </span>
        <span style={{
          background: estadoSty.bg, color: estadoSty.text,
          padding: '3px 9px', borderRadius: 20, fontSize: 10, fontWeight: 700,
        }}>
          {estadoSty.label}
        </span>
      </div>

      {/* Descripción */}
      {inc.descripcion ? (
        <div style={{
          fontSize: 11, color: '#475569', marginBottom: 10,
          background: '#f8fafc', borderRadius: 8, padding: '7px 9px',
          borderLeft: `3px solid ${prioColor}`, lineHeight: 1.5,
        }}>
          {inc.descripcion.slice(0, 120)}{inc.descripcion.length > 120 ? '…' : ''}
        </div>
      ) : (
        <div style={{ fontSize: 11, color: '#cbd5e1', marginBottom: 10, fontStyle: 'italic' }}>
          Sin descripción
        </div>
      )}

      {/* Coordenadas */}
      <div style={{ fontSize: 10, color: '#94a3b8', marginBottom: 10, display: 'flex', gap: 6 }}>
        <span>📍 {Number(inc.latitud).toFixed(5)}, {Number(inc.longitud).toFixed(5)}</span>
      </div>

      <hr style={{ border: 'none', borderTop: '1px solid #f1f5f9', margin: '8px 0' }} />

      {/* Acción: ver caso */}
      <a href={bandeja} target="_blank" rel="noopener noreferrer" style={{
        display: 'block', textAlign: 'center',
        background: '#005BAC', color: 'white', borderRadius: 10,
        padding: '8px 0', fontSize: 12, fontWeight: 800, textDecoration: 'none',
        marginBottom: 8,
      }}>
        Ver caso en bandeja →
      </a>

      {/* Navegación — abre el selector de app del dispositivo */}
      <a href={gMapsUrl} target="_blank" rel="noopener noreferrer" style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
        background: '#16A34A', color: 'white', borderRadius: 10,
        padding: '8px 0', fontSize: 12, fontWeight: 800, textDecoration: 'none',
      }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="white">
          <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/>
        </svg>
        Navegar
      </a>
    </div>
  )
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
      fillOpacity: 0.3,
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
        ;(e.target as L.Path).setStyle({ fillOpacity: 0.5, weight: 3 })
      },
      mouseout: (e: L.LeafletMouseEvent) => {
        ;(e.target as L.Path).setStyle({ fillOpacity: 0.3, weight: 2 })
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
        @keyframes pulse-map {
          0%   { transform: scale(1);   opacity: 0.4; }
          70%  { transform: scale(2.2); opacity: 0;   }
          100% { transform: scale(2.2); opacity: 0;   }
        }
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
        .incident-popup .leaflet-popup-content-wrapper {
          border-radius: 14px; padding: 0; overflow: hidden;
          box-shadow: 0 8px 32px rgba(0,0,0,0.18);
        }
        .incident-popup .leaflet-popup-content { margin: 14px; }
        .incident-popup .leaflet-popup-tip-container { margin-top: -1px; }
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
        {(Object.keys(BASEMAPS) as BasemapKey[]).map(key => {
          let btnBg: string
          if (basemap === key) {
            btnBg = key === 'oscuro' ? '#1e293b' : '#f97316'
          } else {
            btnBg = 'transparent'
          }
          return (
            <button key={key} onClick={() => setBasemap(key)}
              style={{
                padding: '5px 12px', borderRadius: 16, border: 'none', cursor: 'pointer',
                fontSize: 11, fontWeight: basemap === key ? 700 : 500,
                background: btnBg,
                color:      basemap === key ? 'white' : '#64748b',
                transition: 'all 0.15s', display: 'flex', alignItems: 'center', gap: 4,
              }}>
              {key === 'oscuro' ? '🌙' : '☀️'} {BASEMAPS[key].label}
            </button>
          )
        })}
      </div>

      {/* Mapa — basemap conmutable claro/oscuro */}
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
              <Popup minWidth={260} maxWidth={300} className="incident-popup">
                <IncidentePopup inc={inc} />
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
            { label: 'Entrantes',      value: zonaPanel.pendientes,         color: '#eab308' },
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
