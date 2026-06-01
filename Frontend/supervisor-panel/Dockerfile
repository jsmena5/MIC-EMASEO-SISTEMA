# =============================================================================
# Dockerfile multistage para el panel del supervisor.
# Stage 1: build estático con Vite (necesita VITE_API_URL en build time).
# Stage 2: nginx sirviendo /dist con SPA fallback.
# =============================================================================

# ── Build stage ───────────────────────────────────────────────────────────────
FROM node:22-alpine AS builder
WORKDIR /app

# VITE_API_URL se lee de .env.production por defecto.
# Si se pasa --build-arg VITE_API_URL=..., sobreescribe .env.production.
ARG VITE_API_URL

COPY package*.json ./
RUN npm ci --no-audit --no-fund

COPY . .
# Solo inyectar el ARG en .env.production si fue pasado explícitamente;
# de lo contrario Vite usa el .env.production del repo.
RUN if [ -n "$VITE_API_URL" ]; then \
      echo "VITE_API_URL=$VITE_API_URL" > .env.production; \
    fi
RUN npm run build

# ── Runtime stage ─────────────────────────────────────────────────────────────
FROM nginx:1.27-alpine
WORKDIR /usr/share/nginx/html

# SPA fallback: cualquier ruta no-asset cae a index.html para que React Router
# resuelva la URL. Sin esto, refrescar /dashboard/incidencias devolvería 404.
RUN rm -f /etc/nginx/conf.d/default.conf
COPY nginx.conf /etc/nginx/conf.d/supervisor-panel.conf

COPY --from=builder /app/dist /usr/share/nginx/html

# Healthcheck contra el propio nginx
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:80/health || exit 1

EXPOSE 80
