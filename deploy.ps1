# Script de despliegue para Easypanel (PowerShell)
# Este script facilita el proceso de commit y push a GitHub

Write-Host "================================================" -ForegroundColor Cyan
Write-Host "  Despliegue de Supabase a Easypanel via GitHub" -ForegroundColor Cyan
Write-Host "================================================" -ForegroundColor Cyan
Write-Host ""

# Verificar que estamos en un repositorio git
if (-not (Test-Path .git)) {
    Write-Host "❌ Error: No estás en un repositorio git" -ForegroundColor Red
    exit 1
}

# Mostrar estado actual
Write-Host "📋 Estado actual del repositorio:" -ForegroundColor Yellow
Write-Host ""
git status
Write-Host ""

# Preguntar si desea continuar
$response = Read-Host "¿Deseas agregar estos cambios y hacer deploy? (s/n)"

if ($response -notmatch '^[SsYy]$') {
    Write-Host "❌ Deploy cancelado" -ForegroundColor Red
    exit 0
}

# Agregar archivos
Write-Host ""
Write-Host "📦 Agregando archivos al commit..." -ForegroundColor Yellow
git add docker/docker-compose.yml
git add PROJECT_CONTEXT.md
git add docker/EASYPANEL_DEPLOYMENT.md
git add CAMBIOS_EASYPANEL.md
git add INSTRUCCIONES_DEPLOY.md
git add deploy.sh
git add deploy.ps1

# Verificar si hay cambios para commitear
$staged = git diff --staged --quiet
if ($LASTEXITCODE -eq 0) {
    Write-Host "⚠️  No hay cambios para commitear" -ForegroundColor Yellow
    exit 0
}

# Hacer commit
Write-Host ""
Write-Host "💾 Creando commit..." -ForegroundColor Yellow
git commit -m "Fix: Compatibilidad con Easypanel

- Eliminados todos los container_name para evitar conflictos
- Comentados puertos de Supavisor (5432, 6543)
- Comentado puerto HTTPS de Kong (8443)
- Solo Kong expone puerto 8000 como punto de entrada
- Agregada documentación completa del proyecto
- Agregada guía de despliegue en Easypanel
- Agregado script de deploy automatizado"

# Verificar la rama actual
$branch = git rev-parse --abbrev-ref HEAD
Write-Host ""
Write-Host "📍 Rama actual: $branch" -ForegroundColor Cyan

# Preguntar si desea hacer push
$response = Read-Host "¿Deseas hacer push a GitHub? (s/n)"

if ($response -notmatch '^[SsYy]$') {
    Write-Host "⚠️  Commit creado pero no se hizo push" -ForegroundColor Yellow
    Write-Host "   Puedes hacer push manualmente con: git push origin $branch" -ForegroundColor Yellow
    exit 0
}

# Hacer push
Write-Host ""
Write-Host "🚀 Haciendo push a GitHub..." -ForegroundColor Yellow
git push origin $branch

if ($LASTEXITCODE -eq 0) {
    Write-Host ""
    Write-Host "✅ ¡Deploy exitoso!" -ForegroundColor Green
    Write-Host ""
    Write-Host "📊 Próximos pasos:" -ForegroundColor Cyan
    Write-Host "   1. Easypanel detectará los cambios automáticamente (1-2 min)"
    Write-Host "   2. Iniciará el re-despliegue automáticamente"
    Write-Host "   3. Los servicios se reiniciarán (2-3 min)"
    Write-Host ""
    Write-Host "🔍 Monitorea el progreso en:" -ForegroundColor Cyan
    Write-Host "   https://easypanel.host (tu panel de Easypanel)"
    Write-Host ""
    Write-Host "🌐 Una vez completado, accede a:" -ForegroundColor Cyan
    Write-Host "   https://liec-web-supabase.wxeifq.easypanel.host"
    Write-Host ""
    Write-Host "📖 Para más información, consulta:" -ForegroundColor Cyan
    Write-Host "   - INSTRUCCIONES_DEPLOY.md"
    Write-Host "   - docker/EASYPANEL_DEPLOYMENT.md"
    Write-Host "   - PROJECT_CONTEXT.md"
    Write-Host ""
} else {
    Write-Host ""
    Write-Host "❌ Error al hacer push" -ForegroundColor Red
    Write-Host "   Verifica tus credenciales de GitHub" -ForegroundColor Yellow
    Write-Host "   O intenta manualmente: git push origin $branch" -ForegroundColor Yellow
    exit 1
}
