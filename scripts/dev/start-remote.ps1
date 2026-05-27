#Requires -Version 5.1
<#
.SYNOPSIS
    Modo remoto completo: dos tunneles Cloudflare (API + Metro) + Expo Go.
    No requiere ngrok ni cuenta de ninguna plataforma.

.DESCRIPTION
    1. Verifica Docker (emaseo-gateway healthy).
    2. Verifica cloudflared.
    3. Libera el puerto 8081 si un Metro anterior quedo colgado.
    4. Inicia Quick Tunnel para API Gateway (puerto 4000).
    5. Inicia Quick Tunnel para Metro Bundler (puerto 8081).
    6. Actualiza .env.development con la URL del API.
    7. Abre Expo en nueva ventana apuntando al tunnel de Metro.
    8. Mantiene ambos tunneles activos hasta Ctrl+C.

.EXAMPLE
    .\start-remote.ps1
#>

$ROOT      = $PSScriptRoot
$ENV_FILE  = Join-Path $ROOT "Frontend\smart-waste-mobile\.env.development"
$EXPO_DIR  = Join-Path $ROOT "Frontend\smart-waste-mobile"
$LOG_API   = Join-Path $env:TEMP "cf_emaseo_api.log"
$LOG_METRO = Join-Path $env:TEMP "cf_emaseo_metro.log"

# ---------------------------------------------------------------------------
# Encabezado
# ---------------------------------------------------------------------------
Write-Host ""
Write-Host "===========================================================" -ForegroundColor Cyan
Write-Host "   EMASEO EP -- Modo Remoto  (sin ngrok, solo cloudflared) " -ForegroundColor Cyan
Write-Host "===========================================================" -ForegroundColor Cyan

# ---------------------------------------------------------------------------
# Paso 1: Verificar Docker
# ---------------------------------------------------------------------------
Write-Host ""
Write-Host "[ 1/4 ] Verificando Docker..." -ForegroundColor Yellow

$gwStatus = docker inspect --format "{{.State.Health.Status}}" emaseo-gateway 2>&1
if ($gwStatus -ne "healthy") {
    Write-Host "  [ERROR] emaseo-gateway no esta healthy (estado: $gwStatus)" -ForegroundColor Red
    Write-Host "  Ejecuta: docker compose up -d" -ForegroundColor Yellow
    exit 1
}
Write-Host "  [OK] Docker OK -- emaseo-gateway healthy" -ForegroundColor Green

# ---------------------------------------------------------------------------
# Paso 2: Verificar cloudflared
# ---------------------------------------------------------------------------
Write-Host ""
Write-Host "[ 2/4 ] Verificando cloudflared..." -ForegroundColor Yellow

$cfCmd = Get-Command cloudflared -ErrorAction SilentlyContinue
if (-not $cfCmd) {
    Write-Host "  [ERROR] cloudflared no encontrado en el PATH." -ForegroundColor Red
    Write-Host "  Instalalo: winget install --id Cloudflare.cloudflared" -ForegroundColor Yellow
    exit 1
}
$cfVer = (& cloudflared --version 2>&1 | Select-Object -First 1) -replace "`n", ""
Write-Host "  [OK] $cfVer" -ForegroundColor Green

# ---------------------------------------------------------------------------
# Paso 3: Limpiar procesos anteriores e iniciar tunneles
# ---------------------------------------------------------------------------
Write-Host ""
Write-Host "[ 3/4 ] Iniciando Quick Tunnels (API:4000 y Metro:8081)..." -ForegroundColor Yellow
Write-Host "  Puede tardar hasta 30 segundos..." -ForegroundColor DarkGray

# Matar cloudflared anterior para liberar logs
Get-Process -Name "cloudflared" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Milliseconds 700

# Liberar puerto 8081 si quedo ocupado por un Metro Bundler de sesion anterior.
# Esto ocurre al cerrar la ventana de Expo con la X en vez de Ctrl+C.
$conn8081 = Get-NetTCPConnection -LocalPort 8081 -ErrorAction SilentlyContinue | Select-Object -First 1
if ($conn8081) {
    $pid8081 = $conn8081.OwningProcess
    $procName = (Get-Process -Id $pid8081 -ErrorAction SilentlyContinue).Name
    Write-Host "  Puerto 8081 ocupado por '$procName' (PID $pid8081) - liberando..." -ForegroundColor DarkGray
    Stop-Process -Id $pid8081 -Force -ErrorAction SilentlyContinue
    Start-Sleep -Milliseconds 500
    Write-Host "  [OK] Puerto 8081 liberado" -ForegroundColor Green
}

Remove-Item $LOG_API   -Force -ErrorAction SilentlyContinue
Remove-Item $LOG_METRO -Force -ErrorAction SilentlyContinue

# Lanzar ambos tunneles a la vez
Start-Process cmd -ArgumentList "/c cloudflared tunnel --url http://localhost:4000 > `"$LOG_API`"   2>&1" -WindowStyle Hidden
Start-Process cmd -ArgumentList "/c cloudflared tunnel --url http://localhost:8081 > `"$LOG_METRO`" 2>&1" -WindowStyle Hidden

# Esperar hasta que ambas URLs aparezcan (maximo 60 s)
$apiUrl   = $null
$metroUrl = $null

for ($i = 1; $i -le 60; $i++) {
    Start-Sleep -Seconds 1

    $apiStatus   = if ($apiUrl)   { "[OK]" } else { "..." }
    $metroStatus = if ($metroUrl) { "[OK]" } else { "..." }
    Write-Host "  $i/60 s  |  API $apiStatus  |  Metro $metroStatus     `r" -NoNewline -ForegroundColor DarkGray

    if (-not $apiUrl -and (Test-Path $LOG_API)) {
        $c = Get-Content $LOG_API -Raw -ErrorAction SilentlyContinue
        if ($c -match "https://[a-z0-9-]+\.trycloudflare\.com") { $apiUrl = $Matches[0] }
    }
    if (-not $metroUrl -and (Test-Path $LOG_METRO)) {
        $c = Get-Content $LOG_METRO -Raw -ErrorAction SilentlyContinue
        if ($c -match "https://[a-z0-9-]+\.trycloudflare\.com") { $metroUrl = $Matches[0] }
    }

    if ($apiUrl -and $metroUrl) { break }
}
Write-Host "                                              `r" -NoNewline

if (-not $apiUrl) {
    Write-Host "  [ERROR] No se obtuvo URL del tunnel API (puerto 4000)." -ForegroundColor Red
    Write-Host "  Verifica que Docker este corriendo y el puerto 4000 accesible." -ForegroundColor Yellow
    Get-Process -Name "cloudflared" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
    exit 1
}
if (-not $metroUrl) {
    Write-Host "  [ERROR] No se obtuvo URL del tunnel Metro (puerto 8081)." -ForegroundColor Red
    Write-Host "  cloudflared inicio el tunnel antes de que Metro arranque -- eso es normal." -ForegroundColor Yellow
    Write-Host "  Pero si el error persiste, verifica tu conexion a Internet." -ForegroundColor Yellow
    Get-Process -Name "cloudflared" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
    exit 1
}

Write-Host "  [OK] API   -> $apiUrl" -ForegroundColor Green
Write-Host "  [OK] Metro -> $metroUrl" -ForegroundColor Green

# ---------------------------------------------------------------------------
# Actualizar .env.development con la URL del API
# ---------------------------------------------------------------------------
$newApiUrl  = "$apiUrl/api"
$metroHost  = $metroUrl -replace "https://", ""

if (Test-Path $ENV_FILE) {
    $envContent = Get-Content $ENV_FILE -Raw -Encoding UTF8
    # Comenta CUALQUIER linea activa de EXPO_PUBLIC_API_URL (https://, http://, IP, etc.)
    $envContent = [regex]::Replace(
        $envContent,
        '(?m)^(EXPO_PUBLIC_API_URL=.+)',
        '# $1  <- anterior (reemplazado por start-remote.ps1)'
    )
    $envContent = $envContent.TrimEnd() + "`nEXPO_PUBLIC_API_URL=$newApiUrl`n"
    [System.IO.File]::WriteAllText($ENV_FILE, $envContent, [System.Text.Encoding]::UTF8)
    Write-Host "  [OK] .env.development -> $newApiUrl" -ForegroundColor Green
} else {
    "EXPO_PUBLIC_API_URL=$newApiUrl" | Out-File $ENV_FILE -Encoding utf8
    Write-Host "  [OK] .env.development creado -> $newApiUrl" -ForegroundColor Green
}

# ---------------------------------------------------------------------------
# Paso 4: Abrir Expo apuntando al tunnel de Metro
# ---------------------------------------------------------------------------
Write-Host ""
Write-Host "[ 4/4 ] Abriendo Expo en nueva ventana..." -ForegroundColor Yellow
Write-Host "  Metro tunnel host: $metroHost" -ForegroundColor DarkGray

# Escribir el script de Expo a un archivo temp (evita problemas de codificacion
# y comillas al pasar por -Command de Start-Process)
$expoScript = Join-Path $env:TEMP "emaseo_expo_start.ps1"
$expoScriptContent = @(
    "Set-Location '" + $EXPO_DIR.Replace("'", "''") + "'"
    "Write-Host ''"
    "Write-Host '  Metro Bundler via cloudflared (sin ngrok)'"
    "Write-Host '  Proxy URL: $metroUrl'"
    "Write-Host '  Escanea el QR con Expo Go cuando aparezca.'"
    "Write-Host ''"
    "`$env:EXPO_PACKAGER_PROXY_URL = '$metroUrl'"
    "npx expo start -c"
) -join "`r`n"
Set-Content -LiteralPath $expoScript -Value $expoScriptContent -Encoding ASCII

Start-Process powershell -ArgumentList "-NoExit", "-File", $expoScript

Write-Host "  [OK] Expo iniciando en la otra ventana (puede tardar ~30 s)" -ForegroundColor Green
Write-Host "       Escanea el QR desde Expo Go (cualquier red, datos moviles)." -ForegroundColor Gray

# ---------------------------------------------------------------------------
# Resumen
# ---------------------------------------------------------------------------
Write-Host ""
Write-Host "===========================================================" -ForegroundColor Green
Write-Host "  [OK] Dos tunneles activos + Expo abierto:" -ForegroundColor Green
Write-Host ""
Write-Host "  API   -> $apiUrl" -ForegroundColor White
Write-Host "  Metro -> $metroUrl" -ForegroundColor White
Write-Host ""
Write-Host "  [!] Ctrl+C en esta ventana cierra ambos tunneles." -ForegroundColor Yellow
Write-Host "===========================================================" -ForegroundColor Green
Write-Host ""

# ---------------------------------------------------------------------------
# Mantener activo mientras cloudflared corra (Ctrl+C para detener)
# ---------------------------------------------------------------------------
Write-Host "  Presiona Ctrl+C para detener." -ForegroundColor DarkGray
Write-Host ""

try {
    while (Get-Process -Name "cloudflared" -ErrorAction SilentlyContinue) {
        Start-Sleep -Seconds 3
    }
    Write-Host "  [!] cloudflared se cerro inesperadamente." -ForegroundColor Yellow
} finally {
    Get-Process -Name "cloudflared" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
    Remove-Item $LOG_API   -Force -ErrorAction SilentlyContinue
    Remove-Item $LOG_METRO -Force -ErrorAction SilentlyContinue
    if (Test-Path $expoScript) { Remove-Item $expoScript -Force -ErrorAction SilentlyContinue }
    Write-Host ""
    Write-Host "  Tunneles cerrados." -ForegroundColor DarkGray
}
