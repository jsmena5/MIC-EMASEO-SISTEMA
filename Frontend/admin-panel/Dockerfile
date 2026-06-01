# =============================================================================
# Dockerfile multistage para el panel de administración.
# Stage 1: build estático con Vite (necesita VITE_API_URL en build time).
# Stage 2: nginx sirviendo /dist con SPA fallback.
# =============================================================================

# ── Build stage ───────────────────────────────────────────────────────────────
FROM node:24-alpine AS builder
WORKDIR /app

ARG VITE_API_URL

COPY package*.json ./
RUN npm ci --no-audit --no-fund

COPY . .
RUN if [ -n "$VITE_API_URL" ]; then \
      echo "VITE_API_URL=$VITE_API_URL" > .env.production; \
    fi
RUN npm run build

# ── Runtime stage ─────────────────────────────────────────────────────────────
FROM nginx:1.27-alpine
WORKDIR /usr/share/nginx/html

RUN rm -f /etc/nginx/conf.d/default.conf
COPY nginx.conf /etc/nginx/conf.d/admin-panel.conf

COPY --from=builder /app/dist /usr/share/nginx/html

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:80/health || exit 1

EXPOSE 80
