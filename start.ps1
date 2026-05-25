#Requires -Version 5.1
<#
.SYNOPSIS
    Arranque único del sistema MIC EMASEO en Windows (PowerShell).

.DESCRIPTION
    Genera el .env con secretos seguros si no existe, construye las imágenes
    Docker y levanta los 11 contenedores. Espera a que todos los servicios
    estén healthy antes de mostrar las URLs de acceso.

.PARAMETER Build
    Fuerza la reconstrucción de imágenes Docker (equivalente a --build en start.sh).

.PARAMETER NoBuild
    Salta la construcción de imágenes (usa las imágenes ya existentes).

.PARAMETER Dev
    Activa EXPOSE_DEV_PORTS=true para que MinIO, Redis y Flower sean
    accesibles desde el host en 127.0.0.1.

.EXAMPLE
    .\start.ps1
    .\start.ps1 -Build
    .\start.ps1 -Dev
    .\start.ps1 -NoBuild -Dev
#>
[CmdletBinding()]
param(
    [switch]$Build,
    [switch]$NoBuild,
    [switch]$Dev,
    [switch]$Tunnel,   # Inicia Cloudflare Quick Tunnel -> API Gateway :4000
    [switch]$Expo      # Abre Expo en nueva ventana (app movil)
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$ScriptDir  = Split-Path -Parent $MyInvocation.MyCommand.Path
$EnvFile    = Join-Path $ScriptDir ".env"
$ComposeFile = Join-Path $ScriptDir "docker-compose.yml"

# ── Workaround: Docker Compose v2 falla con "invalid proto:" cuando el path
#    del proyecto contiene espacios (bug en Windows/WSL2). Si hay espacios,
#    creamos una directory junction sin espacios y usamos ese path para compose.
$ComposeDir = $ScriptDir
if ($ScriptDir -match ' ') {
    $junctionPath = "C:\MIC-EMASEO-WORK"
    if (-not (Test-Path $junctionPath)) {
        New-Item -ItemType Junction -Path $junctionPath -Target $ScriptDir | Out-Null
    }
    $ComposeDir  = $junctionPath
    $ComposeFile = Join-Path $ComposeDir "docker-compose.yml"
}
$ComposeDevFile  = Join-Path $ComposeDir "docker-compose.dev.yml"
# Argumentos base para todos los comandos docker compose
$ComposeArgs = @("-f", $ComposeFile)
if ($Dev) { $ComposeArgs += @("-f", $ComposeDevFile) }

# ── Funciones de utilidad ────────────────────────────────────────────────────
function Write-Header([string]$Text) {
    Write-Host "`n$Text" -ForegroundColor Cyan
}
function Write-Ok([string]$Text) {
    Write-Host "  [OK] $Text" -ForegroundColor Green
}
function Write-Warn([string]$Text) {
    Write-Host "  [!]  $Text" -ForegroundColor Yellow
}
function Write-Err([string]$Text) {
    Write-Host "  [ERR] $Text" -ForegroundColor Red
}
function Write-Info([string]$Text) {
    Write-Host "  $Text" -ForegroundColor White
}

# Genera una cadena base64 de N bytes de entropía
function New-SecureSecret([int]$Bytes) {
    # Preferir openssl si está disponible; fallback a .NET
    $opensslCmd  = Get-Command openssl -ErrorAction SilentlyContinue
    $opensslPath = if ($opensslCmd) { $opensslCmd.Source } else { $null }
    if ($opensslPath) {
        $raw = & openssl rand -base64 $Bytes 2>$null
        return ($raw -replace "`r|`n", "")
    }
    # Fallback .NET (siempre disponible en Windows)
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    $buf = New-Object byte[] $Bytes
    $rng.GetBytes($buf)
    $rng.Dispose()
    return [System.Convert]::ToBase64String($buf)
}

# ── Banner ───────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "╔══════════════════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "║       MIC EMASEO — Sistema de Gestión de Residuos   ║" -ForegroundColor Cyan
Write-Host "║                    Arranque rápido                  ║" -ForegroundColor Cyan
Write-Host "╚══════════════════════════════════════════════════════╝" -ForegroundColor Cyan
Write-Host ""

# ── 1. Verificar dependencias ────────────────────────────────────────────────
Write-Header "[1/5] Verificando dependencias..."

$dockerCmd = Get-Command docker -ErrorAction SilentlyContinue
if (-not $dockerCmd) {
    Write-Err "Docker no está instalado o no está en el PATH."
    Write-Info "Instala Docker Desktop desde https://docs.docker.com/get-docker/"
    exit 1
}

try {
    docker info | Out-Null
} catch {
    Write-Err "El daemon de Docker no está corriendo."
    Write-Info "Abre Docker Desktop y espera a que inicie antes de continuar."
    exit 1
}

try {
    docker compose version | Out-Null
} catch {
    Write-Err "docker compose (plugin v2) no está disponible."
    Write-Info "Actualiza Docker Desktop a la versión 24+ para incluir el plugin Compose."
    exit 1
}

$dockerVer  = (docker --version) -replace "Docker version ([0-9.]+).*", '$1'
$composeVer = (docker compose version) -replace "Docker Compose version v([0-9.]+).*", '$1'
Write-Ok "Docker $dockerVer"
Write-Ok "Docker Compose $composeVer"

# ── 2. Generar .env si no existe ─────────────────────────────────────────────
Write-Header "[2/5] Configuración de variables de entorno..."

if (-not (Test-Path $EnvFile)) {
    Write-Warn "No se encontró .env — generando secretos seguros..."

    $postgresPassword = New-SecureSecret 24
    $dbPasswordAuth   = New-SecureSecret 24
    $dbPasswordUsers  = New-SecureSecret 24
    $dbPasswordImage  = New-SecureSecret 24
    $jwtSecret        = New-SecureSecret 48
    $minioPassword    = New-SecureSecret 24
    $redisPassword    = New-SecureSecret 24
    $internalToken    = New-SecureSecret 32
    $flowerPassword   = New-SecureSecret 24
    $timestamp        = (Get-Date -Format "yyyy-MM-dd HH:mm") + " UTC"

    
    $envContent = @"
# ============================================================
# MIC EMASEO — Variables de entorno (GENERADO POR start.ps1)
# Generado el $timestamp
# ⚠  NUNCA subas este archivo al repositorio.
# ============================================================

# ── PostgreSQL ────────────────────────────────────────────────────────────────
POSTGRES_USER=postgres
POSTGRES_PASSWORD=$postgresPassword
POSTGRES_DB=MIC-EMASEO

# ── Roles de servicio (mínimo privilegio) ─────────────────────────────────────
DB_USER_AUTH=auth_svc
DB_PASSWORD_AUTH=$dbPasswordAuth

DB_USER_USERS=users_svc
DB_PASSWORD_USERS=$dbPasswordUsers

DB_USER_IMAGE=image_svc
DB_PASSWORD_IMAGE=$dbPasswordImage

# ── JWT ───────────────────────────────────────────────────────────────────────
JWT_SECRET=$jwtSecret
JWT_EXPIRES_IN=15m

# ── MinIO (Object Storage S3-compatible) ──────────────────────────────────────
MINIO_ROOT_USER=emaseo_admin
MINIO_ROOT_PASSWORD=$minioPassword
S3_BUCKET=emaseo-incidents
S3_REGION=us-east-1
# ⚠ Cambia localhost por tu IP de red si el celular necesita ver imágenes:
S3_PUBLIC_URL=http://localhost:9000

# ── Redis ─────────────────────────────────────────────────────────────────────
REDIS_PASSWORD=$redisPassword

# ── SMTP — COMPLETAR MANUALMENTE ─────────────────────────────────────────────
SMTP_HOST=smtp.tudominio.com
SMTP_PORT=587
SMTP_USER=notificaciones@emaseo.ec
SMTP_PASS=COMPLETAR_MANUALMENTE
EMAIL_FROM=notificaciones@emaseo.ec

# ── Seguridad interna ─────────────────────────────────────────────────────────
INTERNAL_TOKEN=$internalToken

# ── CORS ──────────────────────────────────────────────────────────────────────
CORS_ORIGINS=http://localhost:5173

# ── ML Service ────────────────────────────────────────────────────────────────
# true  = modo demo (sin modelo .pt) | false = inferencia real
DUMMY_MODE=true

# ── Flower (dashboard Celery) ─────────────────────────────────────────────────
FLOWER_USER=admin
FLOWER_PASSWORD=$flowerPassword

# ── Puertos de administración (dev) ──────────────────────────────────────────
# true  = publica MinIO :9000/:9001, Redis :6379, Flower :5555 en 127.0.0.1
# vacío = sin publicación de puertos (producción)
EXPOSE_DEV_PORTS=
"@
    $utf8noBOM = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($EnvFile, $envContent, $utf8noBOM)
    Write-Ok ".env generado con secretos seguros."
    Write-Warn "Recuerda completar SMTP_* en .env para habilitar correos de OTP."
} else {
    Write-Ok "Usando .env existente."
}

# Activar EXPOSE_DEV_PORTS si se pasó -Dev
if ($Dev) {
    $envRaw = Get-Content $EnvFile -Raw
    if ($envRaw -match "(?m)^EXPOSE_DEV_PORTS=.*") {
        $envRaw = $envRaw -replace "(?m)^EXPOSE_DEV_PORTS=.*", "EXPOSE_DEV_PORTS=true"
    } else {
        $envRaw += "`nEXPOSE_DEV_PORTS=true"
    }
    $utf8noBOM = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($EnvFile, $envRaw, $utf8noBOM)
    Write-Warn "-Dev activado: puertos de MinIO, Redis y Flower expuestos en 127.0.0.1"
}

# Parsear el .env para usar variables en el script
$envVars = @{}
Get-Content $EnvFile | Where-Object { $_ -match "^[^#].*=.*" } | ForEach-Object {
    $parts = $_ -split "=", 2
    if ($parts.Count -eq 2) { $envVars[$parts[0].Trim()] = $parts[1].Trim() }
}

# ── 3. Construcción de imágenes ──────────────────────────────────────────────
Write-Header "[3/5] Construyendo imágenes Docker..."

if ($NoBuild) {
    Write-Warn "--no-build: saltando construcción."
} elseif ($Build) {
    Write-Info "Construcción forzada con --pull (puede tardar varios minutos)..."
    docker compose @ComposeArgs build --pull
    if ($LASTEXITCODE -ne 0) { Write-Err "docker compose build fallo (exit $LASTEXITCODE)."; exit 1 }
    Write-Ok "Imagenes construidas."
} else {
    Write-Info "Construyendo imagenes (solo las que cambiaron)..."
    docker compose @ComposeArgs build
    if ($LASTEXITCODE -ne 0) { Write-Err "docker compose build fallo (exit $LASTEXITCODE)."; exit 1 }
    Write-Ok "Imagenes listas."
}

# ── 4. Arrancar los contenedores ─────────────────────────────────────────────
Write-Header "[4/5] Levantando los 11 contenedores..."

# Eliminar contenedores huerfanos con los mismos nombres (de runs anteriores
# con distinto project name) para evitar conflictos de nombre.
$expectedNames = @(
    "emaseo-postgres","emaseo-minio","emaseo-minio-init","emaseo-redis",
    "emaseo-auth","emaseo-users","emaseo-image",
    "emaseo-gateway","emaseo-ml-api","emaseo-flower"
)
$prevEAP = $ErrorActionPreference; $ErrorActionPreference = "SilentlyContinue"
foreach ($cn in $expectedNames) {
    $info = docker inspect --format='{{.Id}}' $cn 2>&1
    if ($LASTEXITCODE -eq 0 -and $info) {
        Write-Warn "Removiendo contenedor previo: $cn"
        docker rm -f $cn 2>&1 | Out-Null
    }
}
$ErrorActionPreference = $prevEAP

docker compose @ComposeArgs up -d
if ($LASTEXITCODE -ne 0) { Write-Err "docker compose up fallo (exit $LASTEXITCODE)."; exit 1 }
Write-Ok "Contenedores iniciados."

# ── 5. Esperar a que los servicios estén healthy ─────────────────────────────
Write-Header "[5/5] Esperando a que los servicios estén listos..."

$HealthyServices = @(
    "emaseo-postgres",
    "emaseo-minio",
    "emaseo-redis",
    "emaseo-auth",
    "emaseo-users",
    "emaseo-image",
    "emaseo-gateway",
    "emaseo-ml-api"
)
$MaxWait  = 300  # segundos
$Interval = 5
$Elapsed  = 0
$Spinner  = @('|', '/', '-', '\')
$SpinIdx  = 0

# Obtiene el health status de un contenedor sin lanzar errores en PS 5.1
function Get-ContainerHealth([string]$Name) {
    $prev = $ErrorActionPreference
    $ErrorActionPreference = "SilentlyContinue"
    $out = docker inspect --format='{{.State.Health.Status}}' $Name 2>&1
    $ErrorActionPreference = $prev
    if ($LASTEXITCODE -ne 0) { return "missing" }
    $val = ($out | Where-Object { $_ -is [string] } | Select-Object -First 1)
    if (-not $val) { return "missing" }
    return $val.Trim()
}

function Test-AllHealthy {
    foreach ($svc in $HealthyServices) {
        if ((Get-ContainerHealth $svc) -ne "healthy") { return $false }
    }
    return $true
}

while (-not (Test-AllHealthy)) {
    if ($Elapsed -ge $MaxWait) {
        Write-Host ""
        Write-Err "Tiempo de espera agotado ($MaxWait s). Algun servicio no arranco."
        Write-Host ""
        Write-Info "Estado actual de contenedores:"
        $prev = $ErrorActionPreference; $ErrorActionPreference = "SilentlyContinue"
        docker compose @ComposeArgs ps 2>&1
        $ErrorActionPreference = $prev
        Write-Host ""
        Write-Info "Revisa los logs del servicio problemático:"
        Write-Info "  docker compose -f $ComposeFile logs --tail=50 <servicio>"
        exit 1
    }

    # Construir lista de pendientes
    $pending = @()
    foreach ($svc in $HealthyServices) {
        $st = Get-ContainerHealth $svc
        if ($st -ne "healthy") { $pending += "$svc($st)" }
    }

    $spin = $Spinner[$SpinIdx % $Spinner.Count]
    Write-Host "`r  $spin Esperando: $($pending -join ', ') ($Elapsed s / $MaxWait s)   " -NoNewline
    $SpinIdx++
    Start-Sleep -Seconds $Interval
    $Elapsed += $Interval
}

Write-Host "`r  [OK] Todos los servicios están listos.                                    " -ForegroundColor Green

# ── Cloudflare Quick Tunnel (opcional) ───────────────────────────────────────
$tunnelUrl = $null
$tunnelProcess = $null

if ($Tunnel) {
    Write-Header "[6/6] Iniciando Cloudflare Quick Tunnel..."

    # Buscar cloudflared: primero en PATH, luego en la ruta por defecto
    $cfCmd = Get-Command cloudflared -ErrorAction SilentlyContinue
    $cfPath = if ($cfCmd) { $cfCmd.Source } else { $null }
    if (-not $cfPath -and (Test-Path "C:\Program Files (x86)\cloudflared\cloudflared.exe")) {
        $cfPath = "C:\Program Files (x86)\cloudflared\cloudflared.exe"
    }
    if (-not $cfPath -and (Test-Path "C:\cloudflared\cloudflared.exe")) {
        $cfPath = "C:\cloudflared\cloudflared.exe"
    }
    if (-not $cfPath) {
        Write-Warn "cloudflared no encontrado. Instala desde https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/"
        Write-Warn "Saltando tunnel. El resto del sistema ya está en linea."
    } else {
        $cfLog = "$env:TEMP\cloudflared-emaseo.log"
        if (Test-Path $cfLog) { Remove-Item $cfLog -Force }

        Write-Info "Ejecutando: $cfPath tunnel --url http://localhost:4000"
        $tunnelProcess = Start-Process -FilePath $cfPath `
            -ArgumentList "tunnel --url http://localhost:4000" `
            -RedirectStandardError $cfLog `
            -NoNewWindow -PassThru

        # Esperar hasta 40 seg a que aparezca la URL en el log
        Write-Host "  Esperando URL del tunel" -NoNewline -ForegroundColor Yellow
        for ($t = 0; $t -lt 40; $t++) {
            Start-Sleep -Seconds 1
            Write-Host "." -NoNewline -ForegroundColor Yellow
            if (Test-Path $cfLog) {
                $logContent = Get-Content $cfLog -Raw -ErrorAction SilentlyContinue
                if ($logContent -match 'https://[a-z0-9\-]+\.trycloudflare\.com') {
                    $tunnelUrl = $Matches[0]
                    break
                }
            }
        }
        Write-Host ""

        if ($tunnelUrl) {
            Write-Ok "Tunnel activo: $tunnelUrl"

            # Actualizar .env.development del app movil
            $mobileEnv = Join-Path $ScriptDir "Frontend\smart-waste-mobile\.env.development"
            if (Test-Path $mobileEnv) {
                $envLines = Get-Content $mobileEnv
                # Comentar todas las lineas activas de EXPO_PUBLIC_API_URL
                $envLines = $envLines | ForEach-Object {
                    if ($_ -match '^EXPO_PUBLIC_API_URL=') { "# $_" } else { $_ }
                }
                # Agregar nueva URL activa al final
                $envLines += "EXPO_PUBLIC_API_URL=$tunnelUrl/api"
                Set-Content -Path $mobileEnv -Value $envLines -Encoding UTF8
                Write-Ok ".env.development actualizado con: $tunnelUrl/api"
            } else {
                Write-Warn "No se encontro $mobileEnv — actualiza EXPO_PUBLIC_API_URL manualmente."
            }
        } else {
            Write-Warn "No se obtuvo URL del tunnel en 40 segundos."
            Write-Warn "Asegurate de que el API Gateway este corriendo en :4000."
            if ($tunnelProcess -and -not $tunnelProcess.HasExited) {
                Stop-Process -Id $tunnelProcess.Id -Force -ErrorAction SilentlyContinue
            }
            $tunnelProcess = $null
        }
    }
}

# ── Expo — app movil (opcional) ───────────────────────────────────────────────
if ($Expo) {
    $mobileDir = Join-Path $ScriptDir "Frontend\smart-waste-mobile"
    if (-not (Test-Path $mobileDir)) {
        Write-Warn "No se encontro el directorio de la app: $mobileDir"
    } else {
        Write-Header "Abriendo Expo en nueva ventana..."
        $expoCmd = "Set-Location '$mobileDir'; Write-Host 'Iniciando Expo...' -ForegroundColor Cyan; npx expo start"
        Start-Process "powershell.exe" `
            -ArgumentList "-NoExit", "-Command", $expoCmd `
            -WindowStyle Normal
        Write-Ok "Expo arrancando en nueva ventana."
        if ($tunnelUrl) {
            Write-Warn "Presiona 'r' en la ventana de Expo para recargar con la nueva URL del tunnel."
        }
    }
}

# ── URLs de acceso ────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "  Sistema MIC EMASEO en linea" -ForegroundColor Green
Write-Host "════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host ""
Write-Host "  API Gateway:   http://localhost:4000" -ForegroundColor White
Write-Host "  Swagger UI:    http://localhost:4000/api-docs" -ForegroundColor White

if ($tunnelUrl) {
    Write-Host ""
    Write-Host "  Tunnel publico: $tunnelUrl" -ForegroundColor Green
    Write-Host "  API movil:      $tunnelUrl/api" -ForegroundColor Green
}

$exposeDev = $envVars["EXPOSE_DEV_PORTS"]
if ($exposeDev -and $exposeDev -ne "") {
    Write-Host ""
    Write-Host "  MinIO Console: http://localhost:9001" -ForegroundColor White
    Write-Host "  Flower:        http://localhost:5555" -ForegroundColor White
    Write-Host "  ML Swagger:    http://localhost:8000/docs" -ForegroundColor White
    Write-Host ""
    $minioUser = $envVars["MINIO_ROOT_USER"]
    $flowerUser = $envVars["FLOWER_USER"]
    Write-Warn "Credenciales MinIO: $minioUser / (ver .env -> MINIO_ROOT_PASSWORD)"
    Write-Warn "Credenciales Flower: $flowerUser / (ver .env -> FLOWER_PASSWORD)"
} else {
    Write-Host ""
    Write-Warn "MinIO, Redis y Flower no estan expuestos al host."
    Write-Warn "Usa '.\start.ps1 -Dev' o EXPOSE_DEV_PORTS=true en .env para acceder."
}

Write-Host ""
$dummyMode = $envVars["DUMMY_MODE"]
if ($dummyMode -eq "true") {
    Write-Warn "ML Service en MODO DUMMY — no requiere modelo .pt"
    Write-Warn "Para inferencia real: DUMMY_MODE=false + ML/modelos/rtdetr_l_best.pt"
} else {
    Write-Ok "ML Service con inferencia real (RT-DETR-L v2)"
}

Write-Host ""
Write-Host "  Verificar estado:  docker compose ps" -ForegroundColor White
Write-Host "  Ver logs:          docker compose logs -f api-gateway" -ForegroundColor White
Write-Host "  Apagar:            docker compose down" -ForegroundColor White
Write-Host ""

# Mantener el tunnel activo si esta corriendo
if ($tunnelProcess -and -not $tunnelProcess.HasExited) {
    Write-Host "  [Tunnel activo — presiona Ctrl+C para detenerlo]" -ForegroundColor Yellow
    Write-Host ""
    try {
        $tunnelProcess.WaitForExit()
    } finally {
        if (-not $tunnelProcess.HasExited) {
            Stop-Process -Id $tunnelProcess.Id -Force -ErrorAction SilentlyContinue
        }
    }
}
