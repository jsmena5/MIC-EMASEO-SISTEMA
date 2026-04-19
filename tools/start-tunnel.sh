#!/usr/bin/env bash
# Inicia un Cloudflare Quick Tunnel apuntando al API Gateway (puerto 4000)
# y actualiza automáticamente .env.development del app móvil con la nueva URL.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$SCRIPT_DIR/../Frontend/smart-waste-mobile/.env.development"
LOG_FILE="/tmp/cloudflared-tunnel.log"
PORT=4000

echo "Iniciando Cloudflare Quick Tunnel -> http://localhost:$PORT ..."
echo "Esperando URL del túnel..."

# Ejecutar cloudflared y capturar stderr donde aparece la URL
cloudflared tunnel --url "http://localhost:$PORT" 2>"$LOG_FILE" &
TUNNEL_PID=$!

# Esperar hasta que aparezca la URL en el log (máx 30 seg)
TUNNEL_URL=""
for i in $(seq 1 30); do
  sleep 1
  TUNNEL_URL=$(grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' "$LOG_FILE" | head -1)
  if [ -n "$TUNNEL_URL" ]; then
    break
  fi
done

if [ -z "$TUNNEL_URL" ]; then
  echo "ERROR: No se pudo obtener la URL del túnel. Revisa que el API Gateway esté corriendo en el puerto $PORT."
  kill "$TUNNEL_PID" 2>/dev/null
  exit 1
fi

echo ""
echo "Tunel activo: $TUNNEL_URL"
echo ""

# Actualizar .env.development con la nueva URL
if [ -f "$ENV_FILE" ]; then
  # Comentar cualquier línea activa de EXPO_PUBLIC_API_URL
  sed -i 's|^EXPO_PUBLIC_API_URL=.*|# &|' "$ENV_FILE"
  # Agregar la nueva URL al final
  echo "EXPO_PUBLIC_API_URL=$TUNNEL_URL/api" >> "$ENV_FILE"
  echo "$ENV_FILE actualizado con: $TUNNEL_URL/api"
else
  echo "ADVERTENCIA: No se encontró $ENV_FILE"
fi

echo ""
echo "Recarga Expo presionando 'r' en su terminal para que tome la nueva URL."
echo "Presiona Ctrl+C para detener el túnel."
echo ""

# Mantener el proceso activo
wait "$TUNNEL_PID"
