#!/bin/bash

# Script de despliegue para Easypanel
# Este script facilita el proceso de commit y push a GitHub

echo "================================================"
echo "  Despliegue de Supabase a Easypanel via GitHub"
echo "================================================"
echo ""

# Verificar que estamos en un repositorio git
if [ ! -d .git ]; then
    echo "❌ Error: No estás en un repositorio git"
    exit 1
fi

# Mostrar estado actual
echo "📋 Estado actual del repositorio:"
echo ""
git status
echo ""

# Preguntar si desea continuar
read -p "¿Deseas agregar estos cambios y hacer deploy? (s/n): " -n 1 -r
echo ""

if [[ ! $REPLY =~ ^[SsYy]$ ]]; then
    echo "❌ Deploy cancelado"
    exit 0
fi

# Agregar archivos
echo ""
echo "📦 Agregando archivos al commit..."
git add docker/docker-compose.yml
git add PROJECT_CONTEXT.md
git add docker/EASYPANEL_DEPLOYMENT.md
git add CAMBIOS_EASYPANEL.md
git add INSTRUCCIONES_DEPLOY.md
git add deploy.sh

# Verificar si hay cambios para commitear
if git diff --staged --quiet; then
    echo "⚠️  No hay cambios para commitear"
    exit 0
fi

# Hacer commit
echo ""
echo "💾 Creando commit..."
git commit -m "Fix: Compatibilidad con Easypanel

- Eliminados todos los container_name para evitar conflictos
- Comentados puertos de Supavisor (5432, 6543)
- Comentado puerto HTTPS de Kong (8443)
- Solo Kong expone puerto 8000 como punto de entrada
- Agregada documentación completa del proyecto
- Agregada guía de despliegue en Easypanel
- Agregado script de deploy automatizado"

# Verificar la rama actual
BRANCH=$(git rev-parse --abbrev-ref HEAD)
echo ""
echo "📍 Rama actual: $BRANCH"

# Preguntar si desea hacer push
read -p "¿Deseas hacer push a GitHub? (s/n): " -n 1 -r
echo ""

if [[ ! $REPLY =~ ^[SsYy]$ ]]; then
    echo "⚠️  Commit creado pero no se hizo push"
    echo "   Puedes hacer push manualmente con: git push origin $BRANCH"
    exit 0
fi

# Hacer push
echo ""
echo "🚀 Haciendo push a GitHub..."
git push origin $BRANCH

if [ $? -eq 0 ]; then
    echo ""
    echo "✅ ¡Deploy exitoso!"
    echo ""
    echo "📊 Próximos pasos:"
    echo "   1. Easypanel detectará los cambios automáticamente (1-2 min)"
    echo "   2. Iniciará el re-despliegue automáticamente"
    echo "   3. Los servicios se reiniciarán (2-3 min)"
    echo ""
    echo "🔍 Monitorea el progreso en:"
    echo "   https://easypanel.host (tu panel de Easypanel)"
    echo ""
    echo "🌐 Una vez completado, accede a:"
    echo "   https://liec-web-supabase.wxeifq.easypanel.host"
    echo ""
    echo "📖 Para más información, consulta:"
    echo "   - INSTRUCCIONES_DEPLOY.md"
    echo "   - docker/EASYPANEL_DEPLOYMENT.md"
    echo "   - PROJECT_CONTEXT.md"
    echo ""
else
    echo ""
    echo "❌ Error al hacer push"
    echo "   Verifica tus credenciales de GitHub"
    echo "   O intenta manualmente: git push origin $BRANCH"
    exit 1
fi
