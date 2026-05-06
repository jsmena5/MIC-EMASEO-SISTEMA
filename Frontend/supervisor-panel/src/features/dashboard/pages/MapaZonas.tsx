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

// ── Fix bug de íconos de Leaflet con Vite ────────────────────────────────────
import iconUrl from 'leaflet/dist/images/marker-icon.png'
import iconShadow from 'leaflet/dist/images/marker-shadow.png'
L.Marker.prototype.options.icon = L.icon({
  iconUrl,
  shadowUrl: iconShadow,
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
})

// ── Paleta de colores ─────────────────────────────────────────────────────────
const NIVEL_COLOR: Record<string, { fill: string; stroke: string }> = {
  critico:       { fill: '#dc2626', stroke: '#991b1b' },
  alto:          { fill: '#f97316', stroke: '#c2410c' },
  medio:         { fill: '#fb923c', stroke: '#ea580c' },
  bajo:          { fill: '#fdba74', stroke: '#f97316' },
  sin_actividad: { fill: '#e5e7eb', stroke: '#9ca3af' },
}

const PRIORIDAD_COLOR: Record<string, string> = {
  CRITICA: '#dc2626',
  ALTA:    '#f97316',
  MEDIA:   '#eab308',
  BAJA:    '#22c55e',
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function crearIcono(prioridad: string | null): L.DivIcon {
  const color = PRIORIDAD_COLOR[prioridad ?? ''] ?? '#6b7280'
  return L.divIcon({
    html: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="10" fill="${color}" stroke="white" stroke-width="2"/>
      <text x="12" y="16" text-anchor="middle" fill="white"
            font-size="11" font-family="sans-serif" font-weight="bold">!</text>
    </svg>`,
    className: '',
    iconSize: [24, 24],
    iconAnchor: [12, 12],
    popupAnchor: [0, -14],
  })
}

const FILTROS = [
  { value: 'TODOS',       label: 'Todos' },
  { value: 'PENDIENTE',   label: 'Pendientes' },
  { value: 'EN_ATENCION', label: 'En atención' },
]

// ── Componente ────────────────────────────────────────────────────────────────
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
    const c = NIVEL_COLOR[nivel] ?? NIVEL_COLOR.sin_actividad
    return {
      fillColor:   c.fill,
      fillOpacity: 0.35,
      color:       c.stroke,
      weight:      2,
    }
  }, [])

  const onEachZona = useCallback((feature: GeoJSON.Feature, layer: L.Layer) => {
    const props = feature.properties as ZonaProperties
    layer.on({
      click: () => setZonaPanel(props),
      mouseover: (e: L.LeafletMouseEvent) => {
        ;(e.target as L.Path).setStyle({ fillOpacity: 0.6, weight: 3 })
      },
      mouseout: (e: L.LeafletMouseEvent) => {
        ;(e.target as L.Path).setStyle({ fillOpacity: 0.35, weight: 2 })
      },
    })
  }, [])

  const incidentesFiltrados = useMemo<IncidenteMapa[]>(
    () => (datos?.incidentes ?? []).filter(
      i => filtro === 'TODOS' || i.estado === filtro
    ),
    [datos, filtro]
  )

  // ── Estados de carga / error ──────────────────────────────────────────────
  if (loading) {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        height: '100%', flexDirection: 'column', gap: 12,
      }}>
        <div style={{
          width: 40, height: 40, border: '4px solid #f3f4f6',
          borderTop: '4px solid #f97316', borderRadius: '50%',
          animation: 'spin 1s linear infinite',
        }} />
        <span style={{ color: '#6b7280', fontSize: 14 }}>
          Cargando mapa de zonas…
        </span>
        <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
      </div>
    )
  }

  if (error) {
    return (
      <div style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        justifyContent: 'center', height: '100%', gap: 12,
      }}>
        <span style={{ color: '#dc2626', fontSize: 15 }}>⚠ {error}</span>
        <button
          onClick={cargar}
          style={{
            padding: '8px 20px', background: '#f97316', color: 'white',
            border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 14,
          }}
        >
          Reintentar
        </button>
      </div>
    )
  }

  // ── Vista principal ───────────────────────────────────────────────────────
  return (
    <div style={{ display: 'flex', height: '100%', position: 'relative', overflow: 'hidden' }}>

      {/* Barra de filtros flotante */}
      <div style={{
        position: 'absolute', top: 12, left: '50%',
        transform: 'translateX(-50%)', zIndex: 1000,
        background: 'white', borderRadius: 24,
        padding: '6px 12px',
        boxShadow: '0 2px 12px rgba(0,0,0,0.15)',
        display: 'flex', alignItems: 'center', gap: 6,
        whiteSpace: 'nowrap',
      }}>
        {FILTROS.map(({ value, label }) => (
          <button
            key={value}
            onClick={() => setFiltro(value)}
            style={{
              padding: '4px 14px', borderRadius: 20,
              border: 'none', cursor: 'pointer', fontSize: 13,
              fontWeight: filtro === value ? 600 : 400,
              background: filtro === value ? '#f97316' : '#f3f4f6',
              color:      filtro === value ? 'white'   : '#374151',
              transition: 'all 0.15s',
            }}
          >
            {label}
          </button>
        ))}
        <span style={{ fontSize: 11, color: '#9ca3af', marginLeft: 6 }}>
          ⟳ {horaUpdate}
        </span>
      </div>

      {/* Mapa principal — centro de Quito DMQ */}
      <MapContainer
        center={[-0.1807, -78.4678]}
        zoom={11}
        style={{ flex: 1, height: '100%' }}
        zoomControl
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        {/* Polígonos de zonas */}
        {datos?.zonas && (
          <GeoJSON
            key={datos.generado_at}
            data={datos.zonas as GeoJSON.FeatureCollection}
            style={estiloZona}
            onEachFeature={onEachZona}
          />
        )}

        {/* Markers de incidentes activos */}
        {incidentesFiltrados.map(inc =>
          inc.latitud && inc.longitud ? (
            <Marker
              key={inc.id}
              position={[inc.latitud, inc.longitud]}
              icon={crearIcono(inc.prioridad)}
            >
              <Popup>
                <div style={{ minWidth: 185, fontFamily: 'sans-serif' }}>
                  <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 4 }}>
                    {inc.zona_nombre ?? 'Sin zona asignada'}
                  </div>
                  {inc.descripcion && (
                    <div style={{ fontSize: 12, color: '#4b5563', marginBottom: 8 }}>
                      {inc.descripcion.length > 100
                        ? inc.descripcion.slice(0, 100) + '…'
                        : inc.descripcion}
                    </div>
                  )}
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    <span style={{
                      background: PRIORIDAD_COLOR[inc.prioridad ?? ''] ?? '#e5e7eb',
                      color: 'white', padding: '2px 8px',
                      borderRadius: 10, fontSize: 11, fontWeight: 600,
                    }}>
                      {inc.prioridad ?? 'Sin prioridad'}
                    </span>
                    <span style={{
                      background: inc.estado === 'PENDIENTE' ? '#fef3c7' : '#dbeafe',
                      color:      inc.estado === 'PENDIENTE' ? '#92400e' : '#1e40af',
                      padding: '2px 8px', borderRadius: 10, fontSize: 11,
                    }}>
                      {inc.estado}
                    </span>
                  </div>
                  <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 6 }}>
                    {new Date(inc.created_at).toLocaleString('es-EC', {
                      day: '2-digit', month: '2-digit',
                      hour: '2-digit', minute: '2-digit',
                    })}
                  </div>
                </div>
              </Popup>
            </Marker>
          ) : null
        )}
      </MapContainer>

      {/* Panel lateral — zona seleccionada */}
      {zonaPanel && (
        <div style={{
          width: 270, background: 'white', padding: '20px 16px',
          overflowY: 'auto', zIndex: 500,
          boxShadow: '-3px 0 12px rgba(0,0,0,0.1)',
          display: 'flex', flexDirection: 'column',
        }}>
          {/* Header del panel */}
          <div style={{ display: 'flex', justifyContent: 'space-between',
                        alignItems: 'flex-start', marginBottom: 8 }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: 15, color: '#111827' }}>
                {zonaPanel.nombre}
              </div>
              <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 2 }}>
                {zonaPanel.codigo}
                {zonaPanel.supervisor ? ` · ${zonaPanel.supervisor}` : ''}
              </div>
            </div>
            <button
              onClick={() => setZonaPanel(null)}
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                fontSize: 20, color: '#9ca3af', lineHeight: 1, padding: 0,
              }}
            >
              ×
            </button>
          </div>

          {/* Badge de nivel */}
          <div style={{ marginBottom: 16 }}>
            <span style={{
              background: NIVEL_COLOR[zonaPanel.nivel]?.fill ?? '#e5e7eb',
              color: zonaPanel.nivel === 'sin_actividad' ? '#374151' : 'white',
              padding: '3px 14px', borderRadius: 20,
              fontSize: 12, fontWeight: 700, textTransform: 'uppercase',
            }}>
              {zonaPanel.nivel.replace('_', ' ')}
            </span>
          </div>

          {/* Estadísticas */}
          {([
            { label: 'Incidentes activos', value: zonaPanel.incidentes_activos, color: '#f97316' },
            { label: 'Pendientes',         value: zonaPanel.pendientes,         color: '#eab308' },
            { label: 'En atención',        value: zonaPanel.en_atencion,        color: '#3b82f6' },
            { label: '🔴 Críticos',        value: zonaPanel.criticas,           color: '#dc2626' },
            { label: 'Últimas 24 h',       value: zonaPanel.ultimas_24h,        color: '#6b7280' },
          ] as const).map(stat => (
            <div key={stat.label} style={{
              display: 'flex', justifyContent: 'space-between',
              alignItems: 'center', padding: '10px 0',
              borderBottom: '1px solid #f3f4f6',
            }}>
              <span style={{ fontSize: 13, color: '#374151' }}>{stat.label}</span>
              <span style={{ fontSize: 22, fontWeight: 700, color: stat.color }}>
                {stat.value}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Leyenda inferior izquierda */}
      <div style={{
        position: 'absolute', bottom: 20, left: 12, zIndex: 1000,
        background: 'white', borderRadius: 10, padding: '10px 14px',
        boxShadow: '0 2px 8px rgba(0,0,0,0.15)', fontSize: 12,
      }}>
        <div style={{ fontWeight: 600, marginBottom: 6, color: '#374151' }}>
          Nivel de actividad
        </div>
        {Object.entries(NIVEL_COLOR).map(([nivel, c]) => (
          <div key={nivel} style={{ display: 'flex', alignItems: 'center',
                                    gap: 7, marginBottom: 3 }}>
            <div style={{
              width: 14, height: 14, borderRadius: 3, flexShrink: 0,
              background: c.fill, border: `2px solid ${c.stroke}`,
            }} />
            <span style={{ color: '#4b5563', textTransform: 'capitalize' }}>
              {nivel.replace('_', ' ')}
            </span>
          </div>
        ))}
      </div>

    </div>
  )
}
