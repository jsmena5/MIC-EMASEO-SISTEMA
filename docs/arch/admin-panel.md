# Admin Panel — Arquitectura

## 1. Arquitectura del sistema

El Admin Panel es la interfaz web para el rol **ADMIN** de la plataforma MIC-EMASEO. Permite gestionar la estructura operativa completa del sistema: supervisores, zonas, operarios, calidad del modelo IA y auditoría de imágenes.

```
Navegador (admin)
  │  HTTPS
  ▼
[Cloudflare Pages]
  │  Archivos estáticos (React + Vite, bundle)
  │
  │  Llamadas API
  ▼
[api-gateway :4000]
  ├── /api/auth/*         → auth-service
  ├── /api/users/*        → users-service
  └── /api/supervisor/ia  → image-service
```

**Ruta raíz:** `Frontend/admin-panel/`
**Puerto dev:** 5173 (Vite)
**Deploy:** Cloudflare Pages (Wrangler)
**Build output:** `dist/`

---

## 2. Estilo de arquitectura

| Patrón | Aplicación |
|---|---|
| **SPA (Single Page Application)** | React Router v7, sin SSR |
| **Feature-based layout** | Código organizado por feature (`auth/`, `dashboard/`) |
| **Client-side auth** | JWT en localStorage, refresh automático |
| **Presentational + Container** | Pages como containers; componentes compartidos como presentacionales |

No hay estado global complejo (Redux/Zustand). Cada página gestiona su propio estado local con hooks React. La comunicación con el backend es directa vía `fetch`/`axios`.

---

## 3. Decisiones arquitectónicas

### 3.1 React 19 + Vite 8 (sin Next.js)
Aplicación de uso interno con usuarios contados. SSR no aporta beneficio; Vite ofrece HMR instantáneo y builds optimizados sin complejidad de servidor.

### 3.2 Tailwind CSS 4 sin librerías de componentes
Sin Shadcn/MUI/Chakra. Componentes construidos a medida con la paleta corporativa apagada de EMASEO (no azul #005BAC, no rojo vivo). Ver `feedback_colores_profesionales.md` en memory.

### 3.3 JWT en localStorage (no httpOnly cookie)
El admin panel no tiene backend propio que pueda manejar cookies httpOnly. El riesgo XSS se mitiga con Helmet + CSP en el gateway y la naturaleza intranet de la aplicación.

### 3.4 Refresh token en sessionStorage
El refresh token se guarda en sessionStorage (no localStorage) para que expire al cerrar el tab. El access token (15 min) en localStorage persiste entre tabs para UX consistente.

### 3.5 Leaflet para mapas (no Mapbox)
Leaflet + OpenStreetMap es gratuito y sin límites de requests. El admin importa polígonos GeoJSON de zonas y los renderiza con react-leaflet.

### 3.6 Despliegue en Cloudflare Pages (no mismo servidor)
Los assets estáticos se sirven desde el CDN de Cloudflare. No hay costos de servidor y el tiempo de carga es <1s globalmente. El API gateway vive en la VPS Contabo.

**Gotcha conocido:** El archivo `.env.production` debe guardarse sin BOM (UTF-8 sin BOM) para que Wrangler lo parsee correctamente.

---

## 4. Comunicación interna y externa

```
Admin Panel (browser)
  │
  │  GET /api/users/ciudadanos          → Listar ciudadanos
  │  POST /api/users/supervisores        → Crear supervisor
  │  GET  /api/supervisor/ia/estadisticas → Calidad IA
  │  GET  /api/supervisor/ia/imagenes    → Grid de auditoría
  │  PUT  /api/supervisor/ia/imagenes/:id/etiqueta
  │  GET  /api/supervisor/zonas/mapa    → GeoJSON zonas
  │  POST /api/zones                    → Crear zona
  │  POST /api/auth/login
  │  POST /api/auth/refresh
  │  POST /api/auth/change-password
  ▼
api-gateway → microservicios
```

### Autenticación
```typescript
// Al login exitoso:
localStorage.setItem('token', accessToken)     // JWT 15 min
sessionStorage.setItem('refreshToken', refresh) // opaco 7 días

// Interceptor automático antes de cada request:
if (tokenExpiresSoon()) {
  const newTokens = await POST('/api/auth/refresh', { refreshToken })
  localStorage.setItem('token', newTokens.token)
}
```

---

## 5. Funcionalidades

### 5.1 Login
- Formulario email + contraseña
- Glassmorphism design (backdrop-blur, bg-white/10)
- Valida rol === 'ADMIN'; bloquea otros roles
- Refresh silencioso al cargar la app

### 5.2 Dashboard Home (`/dashboard/home`)
KPIs en tiempo real:
- Total incidentes (hoy, semana, mes)
- Distribución por estado (pendientes, en revisión, en atención, resueltos)
- Distribución por nivel de acumulación
- Tasa de precisión IA (ia_fue_correcta)
- Mapa de calor de incidentes por zona

### 5.3 Gestión de supervisores (`/dashboard/supervisores`)
```
Lista: nombre, email, zona asignada, estado, fecha creación
Crear: formulario → POST /api/supervisores → genera password temporal → envía email
Editar: nombre, telefono, zona asignada
Cambiar estado: ACTIVO / INACTIVO
Reset password: genera nueva temporal y envía email
```

### 5.4 Gestión de operarios (`/dashboard/operarios`)
```
Lista: nombre, email, supervisor, zona, estado
(Solo lectura — los operarios son creados por supervisores o admin desde users-service)
```

### 5.5 Gestión de zonas (`/dashboard/zonas`)
```
Lista: nombre, supervisor, nº incidentes activos
Crear: nombre + importar GeoJSON (Polygon/MultiPolygon) + asignar supervisor
Editar: nombre, supervisor asignado, geometría
Eliminar: solo si sin incidentes activos
```

#### Importar zonas desde GeoJSON (`ImportModal` + `zonaImport.ts`)
El import hace **upsert por `codigo`** (`POST /api/users/zonas/import` →
`ON CONFLICT (codigo) DO UPDATE`). Reglas que el panel hace visibles para que el
operador entienda qué pasará **antes** de confirmar:

- **`codigo`** — identificador único, máx 20 chars (límite de `operations.zones.codigo`).
  Convención: `ZN-NOMBRE` en mayúsculas (p. ej. `ZN-SANGOLQUI`). Si el código
  **ya existe**, la zona se **actualiza** (reemplaza su geometría); si es **nuevo**,
  se **crea**. Para agregar una zona sin tocar las demás → usar un código inexistente.
- **`nombre`** — texto visible. **`descripcion`** — opcional.

UX (en `Zonas.tsx`):
- Botón **«Descargar plantilla»** → genera `plantilla-zona.geojson` (`TEMPLATE_GEOJSON`).
- Ayuda colapsable explicando los campos y la regla de upsert.
- **Preview con detección de colisiones** (`analizarPreview` en `zonaImport.ts`):
  por cada Feature compara su código contra las zonas existentes y muestra badge
  `NUEVA` (verde) / `ACTUALIZA` (ámbar, con el nombre que reemplazará) y avisos
  (código faltante / >20 chars / nombre faltante / código duplicado en el archivo).
  La lógica es pura y está cubierta por `zonaImport.test.ts`.

> Las zonas de prueba que demuestran la expansión vía import (valles, y Sangolquí
> del cantón Rumiñahui — fuera del DMQ) se generan con
> `scripts/extend_los_chillos_sangolqui.py`, que toma el límite real de OSM.
> En producción **no se toca la BD a mano**: siempre se sube por este panel.

### 5.6 Mapa (`/dashboard/mapa`) — `MapaAdmin.tsx`
```
Leaflet con todos los polígonos de zonas
Coloreados por carga (semáforo: verde < 5, ámbar 5-15, rojo > 15 pendientes)
Popup por zona: supervisor, nº incidentes, estado operarios
Admin ve TODAS las zonas (supervisores solo ven la suya)
```

### 5.7 Calidad IA (`/dashboard/ia`) — `FeedbackIA.tsx`
```
Precisión global: % de incidentes donde ia_fue_correcta === true
Tabla por clase de residuo: DOMÉSTICO 94%, MIXTO 87%, PELIGROSO 91%...
Últimas correcciones: tipo original → tipo supervisor, nivel original → nivel supervisor
Curva de precisión en el tiempo
```

### 5.8 Auditoría de imágenes R2 (`/dashboard/auditoria`) — `AuditoriaR2.tsx`
```
Grid paginado de imágenes del bucket R2 (thumbnails)
Filtros: estado etiqueta (SIN_ETIQUETAR | VÁLIDA | DUDOSA | EXCLUIR)
Click → lightbox con imagen completa + metadata del incidente
Etiquetado: PUT /api/supervisor/ia/imagenes/:id/etiqueta
Exportar dataset: descarga JSON con los datos de entrenamiento curados
```

### 5.9 Configuración (`/dashboard/configuracion`)
```
Cambio de contraseña del admin
Tolerancia de geocerca (metros) → PUT config
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
Frontend/admin-panel/src/
├── App.tsx
├── main.tsx
├── app/
│   └── router.tsx                    # React Router v7 config
├── features/
│   ├── auth/
│   │   ├── LoginPage.tsx
│   │   └── ProtectedRoute.tsx        # Bloquea si rol !== 'ADMIN'
│   └── dashboard/
│       ├── DashboardLayout.tsx       # Sidebar + Topbar + Outlet
│       ├── Sidebar.tsx               # Navegación lateral
│       ├── Topbar.tsx                # Header: usuario, zona, logout
│       └── pages/
│           ├── Home.tsx
│           ├── Supervisores.tsx
│           ├── Operarios.tsx
│           ├── Zonas.tsx
│           ├── MapaAdmin.tsx
│           ├── FeedbackIA.tsx
│           ├── AuditoriaR2.tsx
│           └── Configuracion.tsx
└── shared/
    └── components/
        └── InfoTooltip.tsx
```

### Despliegue
```bash
# Build
npm run build           # genera dist/

# Deploy a Cloudflare Pages
npx wrangler pages deploy dist/ --project-name mic-emaseo-admin

# Hash de bundle cacheado — si los assets se sirven viejos:
# Los nombres de archivo incluyen hash (main.abc123.js)
# Cloudflare Pages sirve el nuevo automáticamente en el próximo deploy
```

### Paleta de colores (corporativa EMASEO)
```
Primario:    #1a5f7a  (azul petróleo apagado)
Secundario:  #57837b  (verde oliva suave)
Accent:      #a0522d  (marrón tierra)
Fondo:       #f5f5f0  (crema claro)
Texto:       #2c2c2c
Error:       #8b2500  (rojo oscuro, NO #DC2626)
```
