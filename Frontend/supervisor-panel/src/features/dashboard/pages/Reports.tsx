import type { CSSProperties, ReactNode } from 'react'
import { useCallback, useEffect, useState } from 'react'
import {
  type DecisionAutomatica,
  type DeteccionItem,
  type IncidentDetail,
  type IncidentEstado,
  type IncidentFilters,
  type IncidentListItem,
  type NivelAcum,
  type OperarioItem,
  type Prioridad,
  type RevisionIAPayload,
  type TipoResiduo,
  asignarIncidente,
  cambiarEstado,
  getIncidentDetail,
  getIncidents,
  getOperarios,
  revisionIA,
} from '../../../services/incident.service'

const palette = {
  primary: '#005BAC',
  primaryDark: '#003F7A',
  primarySoft: '#EBF4FF',
  secondary: '#00A859',
  secondarySoft: '#E6F7EF',
  bg: '#F0F4F8',
  card: '#FFFFFF',
  text: '#0F172A',
  muted: '#475569',
  faint: '#94A3B8',
  border: '#E2E8F0',
  warning: '#D97706',
  warningSoft: '#FFF7ED',
  danger: '#DC2626',
  dangerSoft: '#FEF2F2',
}

const ESTADO_STYLE: Record<string, { bg: string; text: string }> = {
  PROCESANDO: { bg: '#DBEAFE', text: '#1D4ED8' },
  PENDIENTE: { bg: '#FEF3C7', text: '#B45309' },
  EN_ATENCION: { bg: '#EDE9FE', text: '#6D28D9' },
  RESUELTA: { bg: '#DCFCE7', text: '#166534' },
  RECHAZADA: { bg: '#FEE2E2', text: '#991B1B' },
  FALLIDO: { bg: '#FCE7F3', text: '#BE185D' },
  EN_REVISION: { bg: '#FFF7ED', text: '#C2410C' },
  DESCARTADO: { bg: '#F1F5F9', text: '#475569' },
}

const DECISION_STYLE: Record<string, { bg: string; text: string; label: string }> = {
  ERROR_TECNICO: { bg: '#FEE2E2', text: '#991B1B', label: 'Error tecnico' },
  RECHAZO_CONFIABLE: { bg: '#F1F5F9', text: '#475569', label: 'Rechazo confiable' },
  REVISION_REQUERIDA: { bg: '#FFF7ED', text: '#C2410C', label: 'Revision requerida' },
  INCIDENTE_VALIDO: { bg: '#DCFCE7', text: '#166534', label: 'Incidente valido' },
}

const PRIORIDAD_STYLE: Record<string, { dot: string; label: string }> = {
  CRITICA: { dot: '#DC2626', label: 'Critica' },
  ALTA: { dot: '#EA580C', label: 'Alta' },
  MEDIA: { dot: '#CA8A04', label: 'Media' },
  BAJA: { dot: '#16A34A', label: 'Baja' },
}

const NIVEL_LABEL: Record<NivelAcum, string> = {
  BAJO: 'Bajo',
  MEDIO: 'Medio',
  ALTO: 'Alto',
  CRITICO: 'Critico',
}

const TIPO_LABEL: Record<TipoResiduo, string> = {
  DOMESTICO: 'Domestico',
  ORGANICO: 'Organico',
  RECICLABLE: 'Reciclable',
  ESCOMBROS: 'Escombros',
  PELIGROSO: 'Peligroso',
  MIXTO: 'Mixto',
  OTRO: 'Otro',
}

const TRANSICIONES: Record<string, IncidentEstado[]> = {
  PENDIENTE: ['EN_ATENCION', 'RECHAZADA'],
  EN_ATENCION: ['RESUELTA', 'RECHAZADA', 'PENDIENTE'],
  EN_REVISION: ['PENDIENTE', 'RECHAZADA'],
  DESCARTADO: ['PENDIENTE'],
  RESUELTA: [],
  RECHAZADA: [],
  PROCESANDO: [],
  FALLIDO: [],
}

const TRANSICION_LABEL: Partial<Record<IncidentEstado, string>> = {
  PENDIENTE: 'Aprobar incidente',
  EN_ATENCION: 'Enviar a operario',
  RECHAZADA: 'Rechazar',
  RESUELTA: 'Marcar resuelta',
}

function fmtDate(value: string | null) {
  if (!value) return 'Sin fecha'
  return new Date(value).toLocaleString('es-EC', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function fmtPercent(value: number | null) {
  if (value == null) return 'Sin dato'
  return `${Math.round(value * 100)}%`
}

function fmtVolume(value: number | null) {
  if (value == null) return 'Sin dato'
  return `${value.toFixed(2)} m3`
}

function buildImageUrl(item: Pick<IncidentListItem, 'image_url' | 'imagen_auditoria_url'>) {
  return item.image_url ?? item.imagen_auditoria_url
}

function hasActiveFilters(filters: IncidentFilters) {
  return Boolean(
    filters.estado ||
    filters.prioridad ||
    filters.decision_automatica ||
    filters.fecha_desde ||
    filters.fecha_hasta ||
    filters.ia_incorrecta ||
    filters.sin_supervisar
  )
}

function getEmptyRevisionForm(detail: IncidentDetail | null): RevisionIAPayload {
  return {
    es_correcta_ia: detail?.ia_fue_correcta ?? true,
    comentario: detail?.nota_supervision ?? '',
    nivel_acumulacion_supervisor: detail?.nivel_acumulacion_supervisor ?? detail?.nivel_acumulacion ?? null,
    tipo_residuo_supervisor: detail?.tipo_residuo_supervisor ?? detail?.tipo_residuo ?? null,
  }
}

function Icon({
  children,
  size = 18,
  color = 'currentColor',
}: {
  children: ReactNode
  size?: number
  color?: string
}) {
  return (
    <svg width={size} height={size} viewBox='0 0 24 24' fill='none' stroke={color} strokeWidth='1.8' strokeLinecap='round' strokeLinejoin='round'>
      {children}
    </svg>
  )
}

function ShellIcon({ name, color }: { name: 'camera' | 'shield' | 'map' | 'clock' | 'spark' | 'users'; color: string }) {
  const icons: Record<string, ReactNode> = {
    camera: (
      <>
        <path d='M4 7h3l1.5-2h7L17 7h3v11H4z' />
        <circle cx='12' cy='13' r='3.5' />
      </>
    ),
    shield: (
      <>
        <path d='M12 3l7 3v5c0 4.5-3 7.5-7 10-4-2.5-7-5.5-7-10V6z' />
        <path d='M9.5 12.5l1.8 1.8L15 10.5' />
      </>
    ),
    map: (
      <>
        <path d='M9 18l-5 2V6l5-2 6 2 5-2v14l-5 2z' />
        <path d='M9 4v14' />
        <path d='M15 6v14' />
      </>
    ),
    clock: (
      <>
        <circle cx='12' cy='12' r='8' />
        <path d='M12 8v5l3 2' />
      </>
    ),
    spark: (
      <>
        <path d='M12 3l1.7 5.3H19l-4.3 3.1 1.7 5.3L12 13.5 7.6 16.7l1.7-5.3L5 8.3h5.3z' />
      </>
    ),
    users: (
      <>
        <path d='M16 19v-1a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v1' />
        <circle cx='10' cy='8' r='3' />
        <path d='M20 19v-1a3.5 3.5 0 0 0-2.5-3.4' />
        <path d='M15.5 5.2a3 3 0 0 1 0 5.6' />
      </>
    ),
  }

  return <Icon color={color}>{icons[name]}</Icon>
}

function Badge({
  label,
  bg,
  color,
}: {
  label: string
  bg: string
  color: string
}) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '6px 10px',
        borderRadius: 999,
        background: bg,
        color,
        fontSize: 12,
        fontWeight: 700,
      }}
    >
      {label}
    </span>
  )
}

function FiltersBar({
  filters,
  onChange,
}: {
  filters: IncidentFilters
  onChange: (filters: IncidentFilters) => void
}) {
  const setFilters = (partial: Partial<IncidentFilters>) => onChange({ ...filters, ...partial, page: 1 })

  return (
    <div
      style={{
        background: 'linear-gradient(135deg, #ffffff 0%, #f8fbff 100%)',
        border: `1px solid ${palette.border}`,
        borderRadius: 24,
        padding: 18,
        display: 'grid',
        gap: 14,
      }}
    >
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
        <QuickFilterChip
          label='Casos en revision'
          active={filters.estado === 'EN_REVISION'}
          onClick={() => setFilters({ estado: filters.estado === 'EN_REVISION' ? '' : 'EN_REVISION' })}
          color={palette.warning}
        />
        <QuickFilterChip
          label='Descartados por IA'
          active={filters.estado === 'DESCARTADO'}
          onClick={() => setFilters({ estado: filters.estado === 'DESCARTADO' ? '' : 'DESCARTADO' })}
          color={palette.muted}
        />
        <QuickFilterChip
          label='IA marcada incorrecta'
          active={Boolean(filters.ia_incorrecta)}
          onClick={() => setFilters({ ia_incorrecta: !filters.ia_incorrecta })}
          color={palette.danger}
        />
        <QuickFilterChip
          label='Sin validacion humana'
          active={Boolean(filters.sin_supervisar)}
          onClick={() => setFilters({ sin_supervisar: !filters.sin_supervisar })}
          color={palette.primary}
        />
        {hasActiveFilters(filters) && (
          <button onClick={() => onChange({ page: 1, limit: filters.limit })} style={ghostButtonStyle}>
            Limpiar filtros
          </button>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 10 }}>
        <select value={filters.estado ?? ''} onChange={(e) => setFilters({ estado: (e.target.value as IncidentEstado) || '' })} style={fieldStyle}>
          <option value=''>Todos los estados</option>
          <option value='PENDIENTE'>Pendiente</option>
          <option value='EN_ATENCION'>En atencion</option>
          <option value='EN_REVISION'>En revision</option>
          <option value='RESUELTA'>Resuelta</option>
          <option value='RECHAZADA'>Rechazada</option>
          <option value='DESCARTADO'>Descartado</option>
          <option value='FALLIDO'>Fallido</option>
        </select>

        <select value={filters.prioridad ?? ''} onChange={(e) => setFilters({ prioridad: (e.target.value as Prioridad) || '' })} style={fieldStyle}>
          <option value=''>Todas las prioridades</option>
          <option value='CRITICA'>Critica</option>
          <option value='ALTA'>Alta</option>
          <option value='MEDIA'>Media</option>
          <option value='BAJA'>Baja</option>
        </select>

        <select
          value={filters.decision_automatica ?? ''}
          onChange={(e) => setFilters({ decision_automatica: (e.target.value as DecisionAutomatica) || '' })}
          style={fieldStyle}
        >
          <option value=''>Todas las decisiones IA</option>
          <option value='INCIDENTE_VALIDO'>Incidente valido</option>
          <option value='REVISION_REQUERIDA'>Revision requerida</option>
          <option value='RECHAZO_CONFIABLE'>Rechazo confiable</option>
          <option value='ERROR_TECNICO'>Error tecnico</option>
        </select>

        <input type='date' value={filters.fecha_desde ?? ''} onChange={(e) => setFilters({ fecha_desde: e.target.value || undefined })} style={fieldStyle} />
        <input type='date' value={filters.fecha_hasta ?? ''} onChange={(e) => setFilters({ fecha_hasta: e.target.value || undefined })} style={fieldStyle} />
      </div>
    </div>
  )
}

function QuickFilterChip({
  label,
  active,
  onClick,
  color,
}: {
  label: string
  active: boolean
  onClick: () => void
  color: string
}) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '9px 14px',
        borderRadius: 999,
        border: `1px solid ${active ? color : palette.border}`,
        background: active ? `${color}18` : '#fff',
        color: active ? color : palette.muted,
        fontSize: 12,
        fontWeight: 700,
        cursor: 'pointer',
      }}
    >
      {label}
    </button>
  )
}

function IncidentRail({
  incidents,
  selectedId,
  onSelect,
  loading,
  error,
  onRetry,
}: {
  incidents: IncidentListItem[]
  selectedId: string | null
  onSelect: (id: string) => void
  loading: boolean
  error: string | null
  onRetry: () => void
}) {
  return (
    <div
      style={{
        minWidth: 360,
        width: 390,
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        maxHeight: '100%',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div style={{ fontSize: 22, fontWeight: 800, color: palette.text }}>Bandeja de casos</div>
          <div style={{ fontSize: 13, color: palette.muted }}>Selecciona un incidente para revisarlo con evidencia visual.</div>
        </div>
      </div>

      <div
        style={{
          background: palette.card,
          border: `1px solid ${palette.border}`,
          borderRadius: 28,
          padding: 14,
          overflow: 'auto',
          minHeight: 520,
          boxShadow: '0 18px 40px rgba(15, 23, 42, 0.05)',
        }}
      >
        {loading && <StateMessage title='Cargando casos...' hint='Estamos consultando el historial del supervisor.' />}
        {error && !loading && <StateError message={error} onRetry={onRetry} />}
        {!loading && !error && incidents.length === 0 && (
          <StateMessage title='No hay incidentes para mostrar' hint='Prueba con otros filtros o espera nuevos reportes.' />
        )}

        {!loading && !error && incidents.length > 0 && (
          <div style={{ display: 'grid', gap: 12 }}>
            {incidents.map((incident) => (
              <IncidentRailCard
                key={incident.id}
                incident={incident}
                selected={selectedId === incident.id}
                onClick={() => onSelect(incident.id)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function IncidentRailCard({
  incident,
  selected,
  onClick,
}: {
  incident: IncidentListItem
  selected: boolean
  onClick: () => void
}) {
  const imageUrl = buildImageUrl(incident)
  const decision = incident.decision_automatica ? DECISION_STYLE[incident.decision_automatica] : null
  const status = ESTADO_STYLE[incident.estado] ?? { bg: '#E2E8F0', text: palette.muted }
  const priority = incident.prioridad ? PRIORIDAD_STYLE[incident.prioridad] : null

  return (
    <button
      onClick={onClick}
      style={{
        display: 'grid',
        gridTemplateColumns: '108px 1fr',
        gap: 14,
        width: '100%',
        textAlign: 'left',
        borderRadius: 24,
        border: `1px solid ${selected ? palette.primary : palette.border}`,
        background: selected ? 'linear-gradient(135deg, #f7fbff 0%, #ffffff 100%)' : '#fff',
        padding: 12,
        cursor: 'pointer',
        boxShadow: selected ? '0 12px 30px rgba(0, 91, 172, 0.12)' : 'none',
      }}
    >
      <div
        style={{
          height: 118,
          borderRadius: 18,
          overflow: 'hidden',
          background: palette.primarySoft,
          border: `1px solid ${palette.border}`,
          display: 'grid',
          placeItems: 'center',
        }}
      >
        {imageUrl ? (
          <img src={imageUrl} alt='Incidente' style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        ) : (
          <div style={{ color: palette.faint }}>
            <ShellIcon name='camera' color={palette.primary} />
          </div>
        )}
      </div>

      <div style={{ display: 'grid', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <span style={{ fontSize: 13, fontWeight: 800, color: palette.text }}>#{incident.id.slice(0, 8)}</span>
          <Badge label={incident.estado.replace('_', ' ')} bg={status.bg} color={status.text} />
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {decision && <Badge label={decision.label} bg={decision.bg} color={decision.text} />}
          {priority && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: palette.text, fontWeight: 700 }}>
              <span style={{ width: 9, height: 9, borderRadius: 999, background: priority.dot }} />
              {priority.label}
            </span>
          )}
        </div>

        <div style={{ display: 'grid', gap: 4 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: palette.text }}>{incident.zona_nombre ?? 'Zona sin definir'}</div>
          <div style={{ fontSize: 13, color: palette.muted }}>{incident.ciudadano_nombre ?? 'Ciudadano no disponible'}</div>
          <div style={{ fontSize: 12, color: palette.faint }}>{fmtDate(incident.created_at)}</div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 12, color: palette.muted }}>
          <span>Confianza IA: {fmtPercent(incident.confianza_decision ?? incident.confianza)}</span>
          <span>{incident.num_detecciones ?? 0} detecciones</span>
        </div>
      </div>
    </button>
  )
}

function DetailWorkspace({
  detail,
  loading,
  error,
  operarios,
  onRetry,
  onRefresh,
}: {
  detail: IncidentDetail | null
  loading: boolean
  error: string | null
  operarios: OperarioItem[]
  onRetry: () => void
  onRefresh: () => void
}) {
  const [saving, setSaving] = useState(false)
  const [revisionForm, setRevisionForm] = useState<RevisionIAPayload>(getEmptyRevisionForm(detail))
  const [selectedOperario, setSelectedOperario] = useState('')
  const [notasAsignacion, setNotasAsignacion] = useState('')
  const [observaciones, setObservaciones] = useState('')
  const [feedback, setFeedback] = useState<string | null>(null)

  useEffect(() => {
    setRevisionForm(getEmptyRevisionForm(detail))
    setSelectedOperario('')
    setNotasAsignacion('')
    setObservaciones('')
    setFeedback(null)
  }, [detail])

  const handleSaveRevision = async () => {
    if (!detail) return
    setSaving(true)
    setFeedback(null)
    try {
      await revisionIA(detail.id, revisionForm)
      setFeedback('Revision de IA guardada correctamente.')
      onRefresh()
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'No se pudo guardar la revision.')
    } finally {
      setSaving(false)
    }
  }

  const handleEstado = async (estado: IncidentEstado) => {
    if (!detail) return
    setSaving(true)
    setFeedback(null)
    try {
      await cambiarEstado(detail.id, estado, observaciones)
      setFeedback(`Estado actualizado a ${estado}.`)
      onRefresh()
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'No se pudo cambiar el estado.')
    } finally {
      setSaving(false)
    }
  }

  const handleAsignacion = async () => {
    if (!detail || !selectedOperario) return
    setSaving(true)
    setFeedback(null)
    try {
      await asignarIncidente(detail.id, selectedOperario, null, notasAsignacion)
      setFeedback('Incidente asignado correctamente.')
      onRefresh()
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'No se pudo asignar el incidente.')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <WorkspaceCard>
        <StateMessage title='Cargando detalle...' hint='Estamos trayendo imagen, diagnostico y trazabilidad.' />
      </WorkspaceCard>
    )
  }

  if (error) {
    return (
      <WorkspaceCard>
        <StateError message={error} onRetry={onRetry} />
      </WorkspaceCard>
    )
  }

  if (!detail) {
    return (
      <WorkspaceCard>
        <StateMessage title='Selecciona un caso' hint='Aqui veras la imagen ampliada, la decision de IA y las acciones del supervisor.' />
      </WorkspaceCard>
    )
  }

  const currentImage = buildImageUrl(detail)
  const decision = detail.decision_automatica ? DECISION_STYLE[detail.decision_automatica] : null
  const status = ESTADO_STYLE[detail.estado] ?? { bg: '#E2E8F0', text: palette.muted }
  const isReviewPending = detail.decision_automatica === 'REVISION_REQUERIDA' || detail.estado === 'EN_REVISION' || detail.ia_fue_correcta == null
  const hasAnalysisResult = Boolean(
    detail.modelo_nombre ||
    detail.analizado_at ||
    detail.tipo_residuo ||
    detail.nivel_acumulacion ||
    detail.detecciones ||
    detail.num_detecciones !== null
  )

  return (
    <WorkspaceCard>
      <div style={{ display: 'grid', gap: 18 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
          <div style={{ display: 'grid', gap: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 28, fontWeight: 800, color: palette.text }}>Caso #{detail.id.slice(0, 8)}</span>
              <Badge label={detail.estado.replace('_', ' ')} bg={status.bg} color={status.text} />
              {decision && <Badge label={decision.label} bg={decision.bg} color={decision.text} />}
            </div>
            <div style={{ fontSize: 14, color: palette.muted }}>
              {detail.zona_nombre ?? 'Zona sin definir'} · {detail.ciudadano_nombre ?? 'Ciudadano no disponible'} · {fmtDate(detail.created_at)}
            </div>
          </div>

          <button onClick={onRefresh} style={primaryGhostStyle}>
            Actualizar detalle
          </button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(320px, 1.2fr) minmax(320px, 0.9fr)', gap: 18 }}>
          <div style={{ display: 'grid', gap: 18 }}>
            <ImageViewer imageUrl={currentImage} detail={detail} />
            <EvidenceSection detail={detail} />
          </div>

          <div style={{ display: 'grid', gap: 18 }}>
            <ReviewCard
              detail={detail}
              form={revisionForm}
              onChange={setRevisionForm}
              saving={saving}
              onSave={handleSaveRevision}
              highlighted={isReviewPending}
              disabled={!hasAnalysisResult}
            />

            {hasAnalysisResult ? (
              <PanelCard title='Diagnostico IA' subtitle='Lo que detecto el modelo antes de la revision humana.'>
                <MetricGrid
                  items={[
                    { label: 'Confianza', value: fmtPercent(detail.confianza_decision ?? detail.confianza) },
                    { label: 'Tipo residuo', value: detail.tipo_residuo ? TIPO_LABEL[detail.tipo_residuo] : 'Sin clasificar' },
                    { label: 'Acumulacion', value: detail.nivel_acumulacion ? NIVEL_LABEL[detail.nivel_acumulacion] : 'Sin clasificar' },
                    { label: 'Volumen', value: fmtVolume(detail.volumen_estimado_m3) },
                    { label: 'Detecciones', value: String(detail.num_detecciones ?? detail.detecciones?.length ?? 0) },
                    { label: 'Tiempo IA', value: detail.tiempo_inferencia_ms ? `${detail.tiempo_inferencia_ms} ms` : 'Sin dato' },
                  ]}
                />
              </PanelCard>
            ) : (
              <PanelCard title='Fallo tecnico del analisis' subtitle='Este caso no tiene resultado de IA utilizable.'>
                <div style={{
                  borderRadius: 18,
                  background: palette.dangerSoft,
                  color: palette.danger,
                  padding: 16,
                  lineHeight: 1.6,
                  fontWeight: 700,
                }}>
                  {detail.nota_fallo ?? 'El pipeline tecnico fallo antes de producir imagen o clasificacion.'}
                </div>
              </PanelCard>
            )}

            <WorkflowCard
              detail={detail}
              operarios={operarios}
              observaciones={observaciones}
              setObservaciones={setObservaciones}
              selectedOperario={selectedOperario}
              setSelectedOperario={setSelectedOperario}
              notasAsignacion={notasAsignacion}
              setNotasAsignacion={setNotasAsignacion}
              onEstado={handleEstado}
              onAsignar={handleAsignacion}
              saving={saving}
            />
          </div>
        </div>

        {feedback && (
          <div
            style={{
              borderRadius: 18,
              padding: '12px 14px',
              background: feedback.includes('correctamente') || feedback.includes('actualizado') ? palette.secondarySoft : palette.dangerSoft,
              color: feedback.includes('correctamente') || feedback.includes('actualizado') ? palette.secondary : palette.danger,
              fontWeight: 700,
              fontSize: 13,
            }}
          >
            {feedback}
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18 }}>
          <PanelCard title='Historial de estados' subtitle='Trazabilidad completa del caso.'>
            <Timeline
              items={detail.historial.map((item) => ({
                title: `${item.estado_anterior} -> ${item.estado_nuevo}`,
                subtitle: `${item.actor} · ${item.actor_rol}`,
                meta: fmtDate(item.created_at),
                note: item.observaciones,
              }))}
              emptyLabel='Aun no hay movimientos registrados.'
            />
          </PanelCard>

          <PanelCard title='Asignaciones y feedback' subtitle='Lo que ya vio el equipo operativo.'>
            <Timeline
              items={[
                ...detail.asignaciones.map((item) => ({
                  title: item.operario_nombre,
                  subtitle: item.completada ? 'Asignacion completada' : 'Asignacion activa',
                  meta: fmtDate(item.created_at),
                  note: item.notas,
                })),
                ...detail.feedback_ia.detalle.map((item) => ({
                  title: item.es_correcta ? 'Feedback: IA correcta' : 'Feedback: IA incorrecta',
                  subtitle: `${item.reportado_por_username} · ${item.reportado_por_rol}`,
                  meta: fmtDate(item.created_at),
                  note: item.comentario,
                })),
              ]}
              emptyLabel='No hay asignaciones ni feedback operativo aun.'
            />
          </PanelCard>
        </div>
      </div>
    </WorkspaceCard>
  )
}

function ImageViewer({
  imageUrl,
  detail,
}: {
  imageUrl: string | null
  detail: IncidentDetail
}) {
  return (
    <PanelCard title='Evidencia visual' subtitle='La fotografia principal debe ser el centro de la decision.'>
      <div
        style={{
          display: 'grid',
          gap: 14,
        }}
      >
        <div
          style={{
            borderRadius: 26,
            overflow: 'hidden',
            background: 'linear-gradient(135deg, #dbeafe 0%, #eff6ff 100%)',
            minHeight: 360,
            border: `1px solid ${palette.border}`,
            position: 'relative',
          }}
        >
          {imageUrl ? (
            <img src={imageUrl} alt='Incidente' style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block', background: '#0F172A' }} />
          ) : (
            <div style={{ minHeight: 360, display: 'grid', placeItems: 'center', color: palette.faint }}>
              <div style={{ display: 'grid', gap: 10, textAlign: 'center' }}>
                <div style={{ display: 'grid', placeItems: 'center' }}>
                  <ShellIcon name='camera' color={palette.primary} />
                </div>
                <div>No hay imagen disponible para este incidente.</div>
              </div>
            </div>
          )}

          {detail.imagen_auditoria_url && !detail.image_url && (
            <div
              style={{
                position: 'absolute',
                top: 16,
                left: 16,
                background: 'rgba(15, 23, 42, 0.84)',
                color: '#fff',
                borderRadius: 999,
                padding: '8px 12px',
                fontSize: 12,
                fontWeight: 700,
              }}
            >
              Imagen preservada para auditoria
            </div>
          )}
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            <Badge label={detail.ia_fue_correcta == null ? 'Sin veredicto humano' : detail.ia_fue_correcta ? 'IA validada' : 'IA corregida'} bg={detail.ia_fue_correcta == null ? palette.primarySoft : detail.ia_fue_correcta ? palette.secondarySoft : palette.dangerSoft} color={detail.ia_fue_correcta == null ? palette.primary : detail.ia_fue_correcta ? palette.secondary : palette.danger} />
            {detail.prioridad && (
              <Badge label={`Prioridad ${PRIORIDAD_STYLE[detail.prioridad].label}`} bg={`${PRIORIDAD_STYLE[detail.prioridad].dot}18`} color={PRIORIDAD_STYLE[detail.prioridad].dot} />
            )}
          </div>

          {imageUrl && (
            <a href={imageUrl} target='_blank' rel='noreferrer' style={{ ...primaryGhostStyle, textDecoration: 'none' }}>
              Abrir imagen completa
            </a>
          )}
        </div>
      </div>
    </PanelCard>
  )
}

function EvidenceSection({ detail }: { detail: IncidentDetail }) {
  return (
    <PanelCard title='Contexto del reporte' subtitle='Datos del ciudadano y ubicacion reportada.'>
      <MetricGrid
        items={[
          { label: 'Ciudadano', value: detail.ciudadano_nombre ?? 'No disponible' },
          { label: 'Correo', value: detail.ciudadano_email ?? 'No disponible' },
          { label: 'Zona', value: detail.zona_nombre ?? 'No definida' },
          { label: 'Direccion', value: detail.direccion ?? 'Sin direccion' },
          { label: 'Latitud', value: String(detail.latitud) },
          { label: 'Longitud', value: String(detail.longitud) },
        ]}
      />

      {detail.descripcion && (
        <div style={{ marginTop: 16, padding: 14, borderRadius: 18, background: palette.bg, color: palette.text, lineHeight: 1.55 }}>
          {detail.descripcion}
        </div>
      )}

      {detail.detecciones && detail.detecciones.length > 0 && (
        <div style={{ marginTop: 18, display: 'grid', gap: 10 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: palette.text }}>Detecciones del modelo</div>
          <div style={{ display: 'grid', gap: 10 }}>
            {detail.detecciones.map((item, index) => (
              <DetectionCard key={`${item.class ?? 'class'}-${index}`} item={item} />
            ))}
          </div>
        </div>
      )}
    </PanelCard>
  )
}

function DetectionCard({ item }: { item: DeteccionItem }) {
  return (
    <div
      style={{
        border: `1px solid ${palette.border}`,
        borderRadius: 18,
        padding: 12,
        display: 'grid',
        gap: 8,
        background: '#fff',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: palette.text }}>{String(item.class ?? 'Clase no informada')}</div>
        <div style={{ fontSize: 12, color: palette.primary, fontWeight: 700 }}>{fmtPercent(typeof item.confidence === 'number' ? item.confidence : null)}</div>
      </div>
      {item.bbox && <div style={{ fontSize: 12, color: palette.muted }}>Caja: {item.bbox.join(', ')}</div>}
    </div>
  )
}

function ReviewCard({
  detail,
  form,
  onChange,
  onSave,
  saving,
  highlighted,
  disabled,
}: {
  detail: IncidentDetail
  form: RevisionIAPayload
  onChange: (payload: RevisionIAPayload) => void
  onSave: () => void
  saving: boolean
  highlighted: boolean
  disabled: boolean
}) {
  return (
    <PanelCard
      title='Decision del supervisor'
      subtitle='Aqui validas si la IA acerto y puedes corregir la clasificacion.'
      highlight={highlighted ? palette.warning : undefined}
    >
      <div style={{ display: 'grid', gap: 14 }}>
        {disabled && (
          <div
            style={{
              borderRadius: 18,
              background: palette.warningSoft,
              color: palette.warning,
              padding: 14,
              fontSize: 13,
              lineHeight: 1.6,
              fontWeight: 700,
            }}
          >
            Este incidente fallo antes de generar resultado de IA. Primero debemos corregir el error tecnico para que vuelva a existir imagen y clasificacion revisable.
          </div>
        )}

        <div style={{ display: 'grid', gap: 10 }}>
          <div style={{ fontSize: 13, color: palette.text, fontWeight: 700 }}>La IA tomo una buena decision?</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <DecisionToggle
              active={form.es_correcta_ia === true}
              label='Si, la IA esta bien'
              description='El analisis automatico representa correctamente el caso.'
              color={palette.secondary}
              disabled={disabled}
              onClick={() => onChange({ ...form, es_correcta_ia: true })}
            />
            <DecisionToggle
              active={form.es_correcta_ia === false}
              label='No, hay que corregir'
              description='El supervisor detecto un error y deja la correccion firmada.'
              color={palette.danger}
              disabled={disabled}
              onClick={() => onChange({ ...form, es_correcta_ia: false })}
            />
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <div style={{ display: 'grid', gap: 6 }}>
            <label style={labelStyle}>Tipo de residuo final</label>
            <select
              value={form.tipo_residuo_supervisor ?? ''}
              onChange={(e) => onChange({ ...form, tipo_residuo_supervisor: (e.target.value as TipoResiduo) || null })}
              style={fieldStyle}
              disabled={disabled}
            >
              <option value=''>Sin definir</option>
              {Object.entries(TIPO_LABEL).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>

          <div style={{ display: 'grid', gap: 6 }}>
            <label style={labelStyle}>Nivel final de acumulacion</label>
            <select
              value={form.nivel_acumulacion_supervisor ?? ''}
              onChange={(e) => onChange({ ...form, nivel_acumulacion_supervisor: (e.target.value as NivelAcum) || null })}
              style={fieldStyle}
              disabled={disabled}
            >
              <option value=''>Sin definir</option>
              {Object.entries(NIVEL_LABEL).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div style={{ display: 'grid', gap: 6 }}>
          <label style={labelStyle}>Justificacion del supervisor</label>
          <textarea
            rows={4}
            value={form.comentario ?? ''}
            onChange={(e) => onChange({ ...form, comentario: e.target.value })}
            placeholder='Describe por que la IA acerto o en que se equivoco. Este comentario luego sirve para auditoria y mejora del modelo.'
            style={{ ...fieldStyle, resize: 'vertical', minHeight: 120, fontFamily: 'inherit' }}
            disabled={disabled}
          />
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ fontSize: 12, color: palette.muted }}>
            Ultima revision: {detail.supervisado_at ? `${fmtDate(detail.supervisado_at)} · ${detail.supervisado_por_username ?? 'Supervisor'}` : 'Aun no se ha registrado una revision humana.'}
          </div>
          <button onClick={onSave} disabled={saving || disabled} style={{ ...primaryButtonStyle, opacity: saving || disabled ? 0.55 : 1 }}>
            {saving ? 'Guardando...' : disabled ? 'Revision no disponible' : 'Guardar revision'}
          </button>
        </div>
      </div>
    </PanelCard>
  )
}

function DecisionToggle({
  active,
  label,
  description,
  color,
  disabled,
  onClick,
}: {
  active: boolean
  label: string
  description: string
  color: string
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        borderRadius: 20,
        border: `1px solid ${active ? color : palette.border}`,
        background: active ? `${color}14` : '#fff',
        padding: 16,
        textAlign: 'left',
        display: 'grid',
        gap: 8,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.55 : 1,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ width: 16, height: 16, borderRadius: 999, border: `2px solid ${color}`, background: active ? color : 'transparent' }} />
        <span style={{ fontSize: 14, fontWeight: 800, color: palette.text }}>{label}</span>
      </div>
      <div style={{ fontSize: 12, color: palette.muted, lineHeight: 1.5 }}>{description}</div>
    </button>
  )
}

function WorkflowCard({
  detail,
  operarios,
  observaciones,
  setObservaciones,
  selectedOperario,
  setSelectedOperario,
  notasAsignacion,
  setNotasAsignacion,
  onEstado,
  onAsignar,
  saving,
}: {
  detail: IncidentDetail
  operarios: OperarioItem[]
  observaciones: string
  setObservaciones: (value: string) => void
  selectedOperario: string
  setSelectedOperario: (value: string) => void
  notasAsignacion: string
  setNotasAsignacion: (value: string) => void
  onEstado: (estado: IncidentEstado) => void
  onAsignar: () => void
  saving: boolean
}) {
  const transiciones = TRANSICIONES[detail.estado] ?? []

  return (
    <PanelCard title='Acciones operativas' subtitle='Despues de revisar el caso, mueve el flujo y asigna trabajo.'>
      <div style={{ display: 'grid', gap: 16 }}>
        <div style={{ display: 'grid', gap: 8 }}>
          <label style={labelStyle}>Observaciones de la transicion</label>
          <textarea
            rows={3}
            value={observaciones}
            onChange={(e) => setObservaciones(e.target.value)}
            placeholder='Notas visibles para la trazabilidad del cambio de estado.'
            style={{ ...fieldStyle, resize: 'vertical', minHeight: 90, fontFamily: 'inherit' }}
          />
        </div>

        {transiciones.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
            {transiciones.map((estado) => (
              <button key={estado} onClick={() => onEstado(estado)} disabled={saving} style={secondaryActionStyle(estado)}>
                {TRANSICION_LABEL[estado] ?? estado}
              </button>
            ))}
          </div>
        )}

        {['PENDIENTE', 'EN_ATENCION'].includes(detail.estado) && (
          <div style={{ display: 'grid', gap: 10, marginTop: 6 }}>
            <label style={labelStyle}>Asignar operario</label>
            <select value={selectedOperario} onChange={(e) => setSelectedOperario(e.target.value)} style={fieldStyle}>
              <option value=''>Selecciona un operario</option>
              {operarios.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.nombre_completo} {item.zona_nombre ? `· ${item.zona_nombre}` : ''} ({item.asignaciones_activas} activas)
                </option>
              ))}
            </select>

            <textarea
              rows={3}
              value={notasAsignacion}
              onChange={(e) => setNotasAsignacion(e.target.value)}
              placeholder='Notas para la cuadrilla o el operario responsable.'
              style={{ ...fieldStyle, resize: 'vertical', minHeight: 90, fontFamily: 'inherit' }}
            />

            <button onClick={onAsignar} disabled={!selectedOperario || saving} style={primaryButtonStyle}>
              {saving ? 'Guardando...' : 'Asignar incidente'}
            </button>
          </div>
        )}
      </div>
    </PanelCard>
  )
}

function MetricGrid({ items }: { items: Array<{ label: string; value: string }> }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
      {items.map((item) => (
        <div key={item.label} style={{ borderRadius: 18, background: palette.bg, padding: 14, display: 'grid', gap: 6 }}>
          <div style={{ fontSize: 12, color: palette.faint, textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 700 }}>{item.label}</div>
          <div style={{ fontSize: 16, color: palette.text, fontWeight: 800 }}>{item.value}</div>
        </div>
      ))}
    </div>
  )
}

function Timeline({
  items,
  emptyLabel,
}: {
  items: Array<{ title: string; subtitle: string; meta: string; note: string | null }>
  emptyLabel: string
}) {
  if (items.length === 0) {
    return <div style={{ fontSize: 13, color: palette.muted }}>{emptyLabel}</div>
  }

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      {items.map((item, index) => (
        <div key={`${item.title}-${index}`} style={{ display: 'grid', gridTemplateColumns: '14px 1fr', gap: 10 }}>
          <div style={{ display: 'grid', justifyItems: 'center', gap: 6 }}>
            <span style={{ width: 10, height: 10, borderRadius: 999, background: palette.primary, marginTop: 6 }} />
            {index < items.length - 1 && <span style={{ width: 2, height: '100%', background: palette.border }} />}
          </div>
          <div style={{ borderRadius: 18, border: `1px solid ${palette.border}`, padding: 14, display: 'grid', gap: 6 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
              <div style={{ fontSize: 14, fontWeight: 800, color: palette.text }}>{item.title}</div>
              <div style={{ fontSize: 12, color: palette.faint }}>{item.meta}</div>
            </div>
            <div style={{ fontSize: 13, color: palette.muted }}>{item.subtitle}</div>
            {item.note && <div style={{ fontSize: 13, color: palette.text }}>{item.note}</div>}
          </div>
        </div>
      ))}
    </div>
  )
}

function PanelCard({
  title,
  subtitle,
  children,
  highlight,
}: {
  title: string
  subtitle: string
  children: ReactNode
  highlight?: string
}) {
  return (
    <div
      style={{
        borderRadius: 24,
        border: `1px solid ${highlight ?? palette.border}`,
        background: '#fff',
        padding: 18,
        boxShadow: highlight ? `0 18px 40px ${highlight}22` : 'none',
      }}
    >
      <div style={{ display: 'grid', gap: 4, marginBottom: 16 }}>
        <div style={{ fontSize: 19, fontWeight: 800, color: palette.text }}>{title}</div>
        <div style={{ fontSize: 13, color: palette.muted, lineHeight: 1.5 }}>{subtitle}</div>
      </div>
      {children}
    </div>
  )
}

function WorkspaceCard({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        background: palette.card,
        border: `1px solid ${palette.border}`,
        borderRadius: 30,
        padding: 18,
        minHeight: 520,
        boxShadow: '0 18px 40px rgba(15, 23, 42, 0.06)',
      }}
    >
      {children}
    </div>
  )
}

function StateMessage({ title, hint }: { title: string; hint: string }) {
  return (
    <div style={{ minHeight: 320, display: 'grid', placeItems: 'center', textAlign: 'center', color: palette.muted, padding: 24 }}>
      <div style={{ display: 'grid', gap: 10, maxWidth: 320 }}>
        <div style={{ display: 'grid', placeItems: 'center' }}>
          <div style={{ width: 58, height: 58, borderRadius: 18, background: palette.primarySoft, display: 'grid', placeItems: 'center' }}>
            <ShellIcon name='shield' color={palette.primary} />
          </div>
        </div>
        <div style={{ fontSize: 18, fontWeight: 800, color: palette.text }}>{title}</div>
        <div style={{ fontSize: 14, lineHeight: 1.6 }}>{hint}</div>
      </div>
    </div>
  )
}

function StateError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div style={{ minHeight: 320, display: 'grid', placeItems: 'center', textAlign: 'center', padding: 24 }}>
      <div style={{ display: 'grid', gap: 12, maxWidth: 360 }}>
        <div style={{ fontSize: 18, fontWeight: 800, color: palette.danger }}>No pudimos cargar la informacion</div>
        <div style={{ fontSize: 14, lineHeight: 1.6, color: palette.muted }}>{message}</div>
        <div>
          <button onClick={onRetry} style={primaryButtonStyle}>
            Reintentar
          </button>
        </div>
      </div>
    </div>
  )
}

function Pagination({
  page,
  pages,
  total,
  onPage,
}: {
  page: number
  pages: number
  total: number
  onPage: (page: number) => void
}) {
  if (pages <= 1) return null

  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginTop: 12 }}>
      <div style={{ fontSize: 13, color: palette.muted }}>{total} incidentes en total</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button onClick={() => onPage(page - 1)} disabled={page <= 1} style={ghostButtonStyle}>
          Anterior
        </button>
        <span style={{ fontSize: 13, color: palette.text, fontWeight: 700 }}>
          Pagina {page} de {pages}
        </span>
        <button onClick={() => onPage(page + 1)} disabled={page >= pages} style={ghostButtonStyle}>
          Siguiente
        </button>
      </div>
    </div>
  )
}

const fieldStyle: CSSProperties = {
  width: '100%',
  borderRadius: 16,
  border: `1px solid ${palette.border}`,
  padding: '12px 14px',
  fontSize: 14,
  color: palette.text,
  background: '#fff',
  outline: 'none',
  boxSizing: 'border-box',
}

const labelStyle: CSSProperties = {
  fontSize: 12,
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  color: palette.faint,
}

const primaryButtonStyle: CSSProperties = {
  border: 'none',
  borderRadius: 18,
  background: 'linear-gradient(135deg, #005BAC 0%, #003F7A 100%)',
  color: '#fff',
  padding: '12px 18px',
  fontSize: 14,
  fontWeight: 800,
  cursor: 'pointer',
}

const primaryGhostStyle: CSSProperties = {
  border: `1px solid ${palette.primary}`,
  borderRadius: 18,
  background: '#fff',
  color: palette.primary,
  padding: '11px 16px',
  fontSize: 13,
  fontWeight: 800,
  cursor: 'pointer',
}

const ghostButtonStyle: CSSProperties = {
  border: `1px solid ${palette.border}`,
  borderRadius: 16,
  background: '#fff',
  color: palette.muted,
  padding: '10px 14px',
  fontSize: 13,
  fontWeight: 700,
  cursor: 'pointer',
}

function secondaryActionStyle(estado: IncidentEstado): CSSProperties {
  const tone =
    estado === 'RECHAZADA'
      ? { bg: palette.dangerSoft, text: palette.danger }
      : estado === 'PENDIENTE'
        ? { bg: palette.secondarySoft, text: palette.secondary }
        : { bg: palette.primarySoft, text: palette.primary }

  return {
    border: 'none',
    borderRadius: 16,
    background: tone.bg,
    color: tone.text,
    padding: '11px 14px',
    fontSize: 13,
    fontWeight: 800,
    cursor: 'pointer',
  }
}

export default function Reports() {
  const [filters, setFilters] = useState<IncidentFilters>({ page: 1, limit: 20 })
  const [incidents, setIncidents] = useState<IncidentListItem[]>([])
  const [pagination, setPagination] = useState({ total: 0, page: 1, pages: 1, limit: 20 })
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<IncidentDetail | null>(null)
  const [operarios, setOperarios] = useState<OperarioItem[]>([])
  const [listLoading, setListLoading] = useState(true)
  const [listError, setListError] = useState<string | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState<string | null>(null)

  const loadList = useCallback(async (nextFilters: IncidentFilters) => {
    setListLoading(true)
    setListError(null)
    try {
      const data = await getIncidents(nextFilters)
      setIncidents(data.incidents)
      setPagination(data.pagination)
      if (!selectedId && data.incidents.length > 0) {
        setSelectedId(data.incidents[0].id)
      }
    } catch (err) {
      setListError(err instanceof Error ? err.message : 'No se pudo cargar la bandeja.')
    } finally {
      setListLoading(false)
    }
  }, [selectedId])

  const loadDetail = useCallback(async (id: string) => {
    setDetailLoading(true)
    setDetailError(null)
    try {
      const [detailData, operariosData] = await Promise.all([
        getIncidentDetail(id),
        getOperarios(),
      ])
      setDetail(detailData)
      setOperarios(operariosData.operarios)
    } catch (err) {
      setDetail(null)
      setDetailError(err instanceof Error ? err.message : 'No se pudo cargar el detalle del incidente.')
    } finally {
      setDetailLoading(false)
    }
  }, [])

  useEffect(() => {
    loadList(filters)
    const interval = setInterval(() => loadList(filters), 30_000)
    return () => clearInterval(interval)
  }, [filters, loadList])

  useEffect(() => {
    if (selectedId) loadDetail(selectedId)
  }, [selectedId, loadDetail])

  const selectedIncident = incidents.find((item) => item.id === selectedId) ?? null

  return (
    <div style={{ display: 'grid', gap: 18, color: palette.text }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 18, flexWrap: 'wrap' }}>
        <div style={{ display: 'grid', gap: 8 }}>
          <div style={{ fontSize: 30, fontWeight: 900, lineHeight: 1.05 }}>Bandeja de revision</div>
          <div style={{ fontSize: 15, color: palette.muted, maxWidth: 720, lineHeight: 1.6 }}>
            Selecciona un caso, revisa la evidencia y decide si corresponde aprobarlo, rechazarlo o moverlo a atencion.
          </div>
        </div>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '12px 16px', borderRadius: 999, background: '#fff', border: `1px solid ${palette.border}`, color: palette.muted, fontWeight: 700 }}>
          <ShellIcon name='clock' color={palette.primary} />
          {pagination.total} casos · autoactualizacion 30 s
        </div>
      </div>

      <FiltersBar filters={filters} onChange={(next) => { setFilters(next); setDetail(null); setSelectedId(null) }} />

      <div style={{ display: 'grid', gridTemplateColumns: '390px minmax(0, 1fr)', gap: 18, alignItems: 'start' }}>
        <IncidentRail
          incidents={incidents}
          selectedId={selectedId}
          onSelect={setSelectedId}
          loading={listLoading}
          error={listError}
          onRetry={() => loadList(filters)}
        />

        <div style={{ display: 'grid', gap: 12 }}>
          {selectedIncident && !detail && !detailLoading && !detailError && (
            <div style={{ fontSize: 13, color: palette.muted }}>
              Cargando detalle del caso #{selectedIncident.id.slice(0, 8)}...
            </div>
          )}

          <DetailWorkspace
            detail={detail}
            loading={detailLoading}
            error={detailError}
            operarios={operarios}
            onRetry={() => selectedId && loadDetail(selectedId)}
            onRefresh={() => {
              loadList(filters)
              if (selectedId) loadDetail(selectedId)
            }}
          />

          <Pagination
            page={pagination.page}
            pages={pagination.pages}
            total={pagination.total}
            onPage={(page) => setFilters((current) => ({ ...current, page }))}
          />
        </div>
      </div>
    </div>
  )
}
