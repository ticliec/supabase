# 🚀 Guía Rápida de Despliegue

## ⚡ Opción Rápida (Recomendada)

### En Linux/Mac:
```bash
chmod +x deploy.sh
./deploy.sh
```

### En Windows (PowerShell):
```powershell
.\deploy.ps1
```

El script te guiará paso a paso por el proceso de despliegue.

---

## 📋 Opción Manual

Si prefieres hacerlo manualmente:

```bash
# 1. Agregar cambios
git add .

# 2. Commit
git commit -m "Fix: Compatibilidad con Easypanel"

# 3. Push a GitHub
git push origin master
```

---

## 📚 Documentación Completa

- **[INSTRUCCIONES_DEPLOY.md](INSTRUCCIONES_DEPLOY.md)** - Instrucciones detalladas paso a paso
- **[docker/EASYPANEL_DEPLOYMENT.md](docker/EASYPANEL_DEPLOYMENT.md)** - Guía completa de despliegue en Easypanel
- **[PROJECT_CONTEXT.md](PROJECT_CONTEXT.md)** - Contexto completo del proyecto
- **[CAMBIOS_EASYPANEL.md](CAMBIOS_EASYPANEL.md)** - Resumen de cambios realizados

---

## ✅ Checklist Rápido

Antes de hacer deploy, asegúrate de:

- [ ] Haber revisado los cambios con `git status`
- [ ] Tener configuradas tus credenciales de GitHub
- [ ] Tener acceso al repositorio https://github.com/ticliec/supabase
- [ ] Tener acceso a Easypanel para monitorear el despliegue

Después del deploy:

- [ ] Configurar variables de entorno en Easypanel (ver `docker/.env.example`)
- [ ] Configurar el dominio en Easypanel
- [ ] Verificar que el servicio esté accesible

---

## 🆘 ¿Problemas?

Consulta la sección "Solución de Problemas" en:
- [INSTRUCCIONES_DEPLOY.md](INSTRUCCIONES_DEPLOY.md#solución-de-problemas)
- [docker/EASYPANEL_DEPLOYMENT.md](docker/EASYPANEL_DEPLOYMENT.md#solución-de-problemas)

---

## 🎯 ¿Qué se Desplegará?

Los cambios principales son:
- ✅ Eliminados `container_name` de todos los servicios
- ✅ Ajustados puertos para evitar conflictos
- ✅ Configuración optimizada para Easypanel
- ✅ Documentación completa agregada

---

**¿Listo?** Ejecuta el script de deploy y estarás en producción en minutos. 🚀
