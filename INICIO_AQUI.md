# 👋 ¡Empieza Aquí!

## 🎯 ¿Qué Pasó?

Se realizaron cambios en el archivo `docker-compose.yml` para que Supabase funcione correctamente en Easypanel. Los problemas de conflictos de nombres de contenedores y puertos han sido resueltos.

---

## 🚀 ¿Qué Debes Hacer Ahora?

### Paso 1: Subir los Cambios a GitHub

Tienes 2 opciones:

#### ⚡ Opción Rápida (Recomendada)

**Linux/Mac**:
```bash
chmod +x deploy.sh
./deploy.sh
```

**Windows**:
```powershell
.\deploy.ps1
```

#### 📝 Opción Manual

```bash
git add .
git commit -m "Fix: Compatibilidad con Easypanel"
git push origin master
```

---

### Paso 2: Esperar el Auto-Despliegue

Easypanel detectará los cambios automáticamente (1-2 minutos) y re-desplegará el servicio.

Monitorea el progreso en tu panel de Easypanel.

---

### Paso 3: Configurar Variables de Entorno

Si aún no lo has hecho, configura las variables de entorno en Easypanel:

1. Ve a tu servicio en Easypanel
2. Sección "Environment Variables"
3. Copia las variables de `docker/.env.example`
4. Genera secrets con: `sh docker/utils/generate-keys.sh`

Ver guía completa en: **[docker/EASYPANEL_DEPLOYMENT.md](docker/EASYPANEL_DEPLOYMENT.md)**

---

### Paso 4: Verificar el Servicio

Una vez desplegado, accede a:
```
https://liec-web-supabase.wxeifq.easypanel.host
```

Deberías ver el dashboard de Supabase Studio.

---

## 📚 Documentación Disponible

| Archivo | Descripción |
|---------|-------------|
| **[README_DEPLOY.md](README_DEPLOY.md)** | 🚀 Guía rápida de despliegue |
| **[INSTRUCCIONES_DEPLOY.md](INSTRUCCIONES_DEPLOY.md)** | 📋 Instrucciones detalladas paso a paso |
| **[docker/EASYPANEL_DEPLOYMENT.md](docker/EASYPANEL_DEPLOYMENT.md)** | 🔧 Guía completa de Easypanel |
| **[CAMBIOS_EASYPANEL.md](CAMBIOS_EASYPANEL.md)** | 📝 Resumen de cambios realizados |
| **[PROJECT_CONTEXT.md](PROJECT_CONTEXT.md)** | 📖 Contexto completo del proyecto |

---

## ✅ Checklist Rápido

- [ ] Ejecutar script de deploy o hacer push manual
- [ ] Esperar a que Easypanel detecte los cambios
- [ ] Monitorear el despliegue en Easypanel
- [ ] Configurar variables de entorno (si no está hecho)
- [ ] Configurar dominio en Easypanel
- [ ] Verificar que el servicio esté accesible

---

## 🔍 ¿Qué Cambió?

### Antes (❌ No funcionaba)
```yaml
services:
  studio:
    container_name: supabase-studio  # ❌ Conflicto
    ports:
      - 3000:3000  # ❌ Conflicto
```

### Después (✅ Funciona)
```yaml
services:
  studio:
    # container_name: supabase-studio  # ✅ Comentado
    # Puertos manejados internamente
```

**Resultado**: Sin conflictos, Easypanel puede desplegar correctamente.

---

## 🆘 ¿Problemas?

### "No puedo hacer push a GitHub"
- Verifica tus credenciales de GitHub
- Asegúrate de tener permisos en el repositorio
- Ver: [INSTRUCCIONES_DEPLOY.md](INSTRUCCIONES_DEPLOY.md#no-tengo-permisos-para-hacer-push)

### "Easypanel no detecta los cambios"
- Verifica que los cambios estén en GitHub
- Haz clic en "Rebuild" manualmente en Easypanel
- Ver: [docker/EASYPANEL_DEPLOYMENT.md](docker/EASYPANEL_DEPLOYMENT.md#solución-de-problemas)

### "El servicio no inicia"
- Revisa los logs en Easypanel
- Verifica las variables de entorno
- Ver: [docker/EASYPANEL_DEPLOYMENT.md](docker/EASYPANEL_DEPLOYMENT.md#solución-de-problemas)

---

## 🎉 ¡Listo!

Una vez que completes estos pasos, tu instancia de Supabase estará funcionando correctamente en Easypanel.

**¿Dudas?** Consulta la documentación completa en los archivos listados arriba.

---

**Última actualización**: 2026-03-06
