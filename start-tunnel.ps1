# Inicia Cloudflare Quick Tunnel -> API Gateway (puerto 4000)
# y actualiza .env.development del app movil con la nueva URL.

$ENV_FILE = "Frontend\smart-waste-mobile\.env.development"
$LOG_FILE = "$env:TEMP\cloudflared-tunnel.log"
$PORT = 4000

Write-Host "Iniciando Cloudflare Quick Tunnel -> http://localhost:$PORT ..." -ForegroundColor Cyan
Write-Host "Esperando URL del tunel..." -ForegroundColor Yellow

if (Test-Path $LOG_FILE) { Remove-Item $LOG_FILE }

$process = Start-Process -FilePath "cloudflared" `
    -ArgumentList "tunnel --url http://localhost:$PORT" `
    -RedirectStandardError $LOG_FILE `
    -NoNewWindow -PassThru

# Esperar hasta 30 seg que aparezca la URL en el log
$tunnelUrl = $null
for ($i = 0; $i -lt 30; $i++) {
    Start-Sleep -Seconds 1
    if (Test-Path $LOG_FILE) {
        $content = Get-Content $LOG_FILE -Raw -ErrorAction SilentlyContinue
        if ($content -match 'https://[a-z0-9\-]+\.trycloudflare\.com') {
            $tunnelUrl = $Matches[0]
            break
        }
    }
}

if (-not $tunnelUrl) {
    Write-Host "ERROR: No se obtuvo la URL. Asegurate de que el API Gateway este corriendo en el puerto $PORT." -ForegroundColor Red
    Stop-Process -Id $process.Id -ErrorAction SilentlyContinue
    exit 1
}

Write-Host ""
Write-Host "Tunel activo: $tunnelUrl" -ForegroundColor Green
Write-Host ""

# Actualizar .env.development
if (Test-Path $ENV_FILE) {
    $lines = Get-Content $ENV_FILE
    $updated = $lines | ForEach-Object {
        if ($_ -match '^EXPO_PUBLIC_API_URL=') { "# $_" } else { $_ }
    }
    # Agregar nueva URL al final
    $updated += "EXPO_PUBLIC_API_URL=$tunnelUrl/api"
    Set-Content -Path $ENV_FILE -Value $updated
    Write-Host "$ENV_FILE actualizado con: $tunnelUrl/api" -ForegroundColor Green
} else {
    Write-Host "ADVERTENCIA: No se encontro $ENV_FILE" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "Recarga Expo presionando 'r' en su terminal." -ForegroundColor Cyan
Write-Host "Presiona Ctrl+C para detener el tunel." -ForegroundColor Cyan
Write-Host ""

# Mantener vivo hasta Ctrl+C
try {
    $process.WaitForExit()
} finally {
    Stop-Process -Id $process.Id -ErrorAction SilentlyContinue
}
