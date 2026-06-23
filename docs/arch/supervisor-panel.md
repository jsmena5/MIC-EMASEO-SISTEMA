# Supervisor Panel — Arquitectura

## 1. Arquitectura del sistema

El Supervisor Panel es la interfaz web para el rol **SUPERVISOR** de MIC-EMASEO. Permite al supervisor revisar los incidentes de su zona, validar/corregir el análisis de la IA, asignar operarios y monitorear el estado en tiempo real.

```
Navegador (supervisor)
  │  HTTPS
  ▼
[Cloudflare Pages]
  │  Archivos estáticos
  │
  │  Llamadas API
  ▼
[api-gateway :4000]
  ├── /api/auth/*
  └── /api/supervisor/*  → image-service
```

**Ruta raíz:** `Frontend/supervisor-panel/`
**Puerto dev:** 5173 (Vite)
**Deploy:** Cloudflare Pages (proyecto separado del admin)

---

## 2. Estilo de arquitectura

| Patrón | Aplicación |
|---|---|
| **SPA** | React Router v7, sin SSR |
| **Feature-based layout** | `auth/`, `incidents/`, `dashboard/` |
| **Rail + Detail** | Panel lateral de lista + panel de detalle adyacente |
| **Wizard multi-step** | Revisión de incidentes en 3 pasos secuenciales |
| **Client-side auth** | JWT en localStorage, refresh automático |

---

## 3. Decisiones arquitectónicas

### 3.1 Stack idéntico al admin-panel
React 19 + Vite 8 + TypeScript + Tailwind 4 + Leaflet. Esto facilita compartir patrones y actualizar dependencias de forma coordinada. Los dos paneles son proyectos separados (no monorepo) porque tienen ciclos de deploy independientes y roles de usuario completamente diferentes.

### 3.2 Layout Rail (bandeja de entrada de casos)
La pantalla principal de incidentes usa un layout de dos columnas: lista a la izquierda (`IncidentsPage`) y detalle a la derecha (`IncidentsRail`). El supervisor nunca pierde el contexto de la lista mientras revisa un caso.

**Por qué no modal:** El wizard de revisión requiere ver la imagen a tamaño completo y el historial del caso simultáneamente. Un modal no tiene suficiente espacio vertical.

### 3.3 Filtro default por PENDIENTE
Al cargar la bandeja de incidentes, el filtro inicial es `estado=PENDIENTE`. Así el supervisor ve directamente los casos que requieren acción, no todos los históricos.

### 3.4 Wizard de 3 pasos (no formulario único)
La revisión de un incidente sigue un flujo guiado:
1. **Validar:** Ver imagen, metadata ML, historial ciudadano
2. **Firmar veredicto:** Confirmar/corregir tipo de residuo y nivel de acumulación
3. **Asignar:** Seleccionar operario disponible en la zona

Separar en pasos evita que el supervisor omita alguna acción crítica y reduce errores.

### 3.5 Datos de zona aislados por backend
El supervisor solo ve los incidentes de su zona. El filtrado ocurre en el backend (image-service), no en el frontend. El frontend solo muestra lo que recibe; nunca intenta filtrar por zona en cliente.

### 3.6 Auto-avance en ReviewModal
Después de completar el paso 2 (firma), el modal avanza automáticamente al paso 3 (asignación) sin que el supervisor presione "Siguiente". Reduce fricción en el flujo más frecuente.

---

## 4. Comunicación interna y externa

```
Supervisor Panel (browser)
  │
  │  GET  /api/supervisor/incidents?estado=PENDIENTE&zona=...
  │  GET  /api/supervisor/incidents/:id
  │  PUT  /api/supervisor/incidents/:id/estado
  │  POST /api/supervisor/incidents/:id/asignar
  │  PUT  /api/supervisor/incidents/:id/revision-ia
  │  GET  /api/supervisor/operarios        → operarios disponibles
  │  GET  /api/supervisor/mi-zona          → zona del supervisor autenticado
  │  GET  /api/supervisor/zonas/mapa       → GeoJSON para Leaflet
  │  GET  /api/supervisor/zonas/estadisticas
  │  POST /api/auth/login
  │  POST /api/auth/refresh
  │  POST /api/auth/change-password
  ▼
api-gateway → image-service (supervisor.controller.js)
```

---

## 5. Funcionalidades

### 5.1 Login
- Glassmorphism (backdrop-blur, bg-white/10)
- Solo permite rol === 'SUPERVISOR'
- Badge de zona en topbar tras autenticarse

### 5.2 Dashboard Home (`/dashboard/home`)
KPIs de la zona del supervisor:
- Incidentes pendientes de revisión
- En atención (asignados a operarios)
- Resueltos esta semana
- Tasa de precisión IA en su zona
- Tarjetas de carga de operarios

### 5.3 Bandeja de incidentes (`/dashboard/incidentes`)

**Sub-pestaña CASOS:**
```
FiltersBar: estado | prioridad | tipo residuo | fecha
IncidentsPage: lista de casos con thumbnail, prioridad badge, tiempo transcurrido
IncidentsRail: detalle lateral al seleccionar un caso
  ├── Imagen (max-h-45vh, click → lightbox)
  ├── Resultados ML (tipo, nivel, confianza, detecciones)
  ├── Datos del ciudadano
  ├── CaseTimeline (historial de estados)
  └── Botón "Iniciar revisión" → abre wizard
```

**Sub-pestaña DASHBOARD:**
```
Estadísticas de la zona en tiempo real:
  - Gráfico de incidentes por día (últimos 30 días)
  - Distribución por tipo de residuo
  - Mapa de calor de puntos de incidentes
  - Tiempo promedio de resolución por operario
```

### 5.4 Wizard de revisión (3 pasos)

**Paso 1 — Validar:**
```
Muestra imagen completa + metadata ML completa
Ciudadano: nombre, cédula, historial de reportes
Historial del incidente
Acciones: Rechazar (→ RECHAZADA) | Continuar revisión
```

**Paso 2 — Firmar veredicto:**
```
¿La IA fue correcta? (Sí / No)
Si No:
  → Selector de tipo residuo correcto
  → Selector de nivel de acumulación correcto
  → Nota del supervisor (opcional)
PUT /api/supervisor/incidents/:id/revision-ia
  Body: { ia_fue_correcta, nivel_acumulacion_supervisor, tipo_residuo_supervisor }
→ Auto-avance al paso 3
```

**Paso 3 — Asignar operario:**
```
Lista de operarios disponibles en la zona (nombre, estado, carga actual)
Selector de operario
POST /api/supervisor/incidents/:id/asignar
  Body: { operario_id }
→ Estado cambia a EN_ATENCION
→ Notificación push al operario (backend)
→ Modal cierra, bandeja actualiza
```

### 5.5 Mapa de zona (`/dashboard/mapa`) — `MapaZonas.tsx`
```
Leaflet con el polígono de la zona del supervisor
Marcadores de incidentes activos (PENDIENTE, EN_REVISION, EN_ATENCION)
Click en marcador → popup con: ciudadano, tipo residuo, prioridad, estado
Filtro por estado en el mapa
```

### 5.6 Configuración (`/dashboard/configuracion`)
```
Cambio de contraseña del supervisor
POST /api/auth/change-password
```

---

## 6. Otros aspectos importantes

### Variables de entorno
```env
# .env.production (sin BOM)
VITE_API_URL=https://api.emaseo.ec
```

### Dependencias clave
```
react: ^19.2.4
react-dom: ^19.2.4
react-router-dom: ^7.14.1
leaflet: ^1.9.4
react-leaflet: ^5.0.0
lucide-react: ^1.18.0
framer-motion: ^12.38.0
jwt-decode: ^4.0.0
tailwindcss: ^4.2.2
vite: ^8.0.4
typescript: ~6.0.2
```

### Estructura de archivos
```
Frontend/supervisor-panel/src/
├── App.tsx
├── main.tsx
├── app/
│   └── router.tsx
├── features/
│   ├── auth/
│   │   ├── LoginPage.tsx
│   │   └── ProtectedRoute.tsx      # Bloquea si rol !== 'SUPERVISOR'
│   ├── dashboard/
│   │   ├── DashboardLayout.tsx
│   │   ├── Sidebar.tsx
│   │   ├── Topbar.tsx              # Badge con nombre de zona
│   │   └── pages/
│   │       ├── Home.tsx
│   │       ├── MapaZonas.tsx
│   │       └── Settings.tsx
│   └── incidents/
│       ├── IncidentsLayout.tsx     # Tabs: CASOS | DASHBOARD
│       ├── IncidentsPage.tsx       # Lista filtrable
│       ├── IncidentsDashboard.tsx  # Estadísticas zona
│       ├── IncidentsRail.tsx       # Panel lateral detalle
│       ├── IncidentPreview.tsx     # Thumbnail + badge estado
│       ├── IncidentReviewedView.tsx # Vista post-revisión
│       ├── CaseTimeline.tsx        # Historial de estados
│       └── FiltersBar.tsx          # Filtros estado/prioridad/tipo
```

### ProtectedRoute — lógica de acceso
```typescript
// ProtectedRoute.tsx
const { user } = useAuth()

if (!user) return <Navigate to="/" />
if (user.rol !== 'SUPERVISOR') return <Navigate to="/" />
return <Outlet />
```

### Despliegue
```bash
# Build
npm run build

# Deploy a Cloudflare Pages (proyecto separado)
npx wrangler pages deploy dist/ --project-name mic-emaseo-supervisor
```

### UX importante (decisiones confirmadas)
- Imagen max-h-45vh para que siempre sea visible sin scroll excesivo
- Filtro default PENDIENTE (no TODOS)
- CaseTimeline sin colores vivos; solo texto y timestamps
- Auto-avance paso 2→3 sin botón "Siguiente"
- Popup del mapa muestra prioridad con color, no solo texto
