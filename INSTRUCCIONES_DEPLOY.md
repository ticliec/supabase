# Instrucciones para Desplegar los Cambios

## ⚠️ IMPORTANTE: Debes hacer esto AHORA

Los cambios realizados en `docker-compose.yml` están solo en tu máquina local. Para que Easypanel los detecte y despliegue, debes subirlos a GitHub.

---

## Paso 1: Verificar los Cambios

```bash
# Ver qué archivos han cambiado
git status
```

Deberías ver:
- `docker/docker-compose.yml` (modificado)
- `PROJECT_CONTEXT.md` (nuevo)
- `docker/EASYPANEL_DEPLOYMENT.md` (nuevo)
- `CAMBIOS_EASYPANEL.md` (nuevo)
- `INSTRUCCIONES_DEPLOY.md` (nuevo - este archivo)

---

## Paso 2: Agregar los Archivos al Commit

```bash
# Agregar todos los archivos modificados y nuevos
git add docker/docker-compose.yml
git add PROJECT_CONTEXT.md
git add docker/EASYPANEL_DEPLOYMENT.md
git add CAMBIOS_EASYPANEL.md
git add INSTRUCCIONES_DEPLOY.md

# O agregar todo de una vez
git add .
```

---

## Paso 3: Hacer Commit

```bash
git commit -m "Fix: Compatibilidad con Easypanel

- Eliminados todos los container_name para evitar conflictos
- Comentados puertos de Supavisor (5432, 6543)
- Comentado puerto HTTPS de Kong (8443)
- Solo Kong expone puerto 8000 como punto de entrada
- Agregada documentación completa del proyecto
- Agregada guía de despliegue en Easypanel"
```

---

## Paso 4: Push a GitHub

```bash
# Subir cambios a GitHub
git push origin master

# Si tu rama principal es 'main' en lugar de 'master':
# git push origin main
```

---

## Paso 5: Verificar en GitHub

1. Ve a https://github.com/ticliec/supabase
2. Verifica que los cambios aparezcan en el repositorio
3. Revisa que el archivo `docker/docker-compose.yml` tenga los cambios

---

## Paso 6: Monitorear Easypanel

1. Ve a tu panel de Easypanel
2. Busca el proyecto `liec_web` → servicio `supabase`
3. En la sección "Deployments" verás el nuevo despliegue iniciándose
4. Espera 2-3 minutos a que complete
5. Revisa los logs de cada servicio para verificar que todo esté OK

---

## Paso 7: Verificar el Servicio

Una vez que Easypanel termine el despliegue:

```bash
# Probar que el servicio responde
curl https://liec-web-supabase.wxeifq.easypanel.host
```

O abre en tu navegador:
```
https://liec-web-supabase.wxeifq.easypanel.host
```

Deberías ver el dashboard de Supabase Studio.

---

## ¿Qué Pasa Después del Push?

1. **GitHub recibe los cambios** (inmediato)
2. **Easypanel detecta los cambios** (1-2 minutos)
   - Easypanel tiene un webhook o polling configurado
3. **Easypanel inicia el despliegue** (automático)
   - Descarga el código actualizado de GitHub
   - Ejecuta `docker compose up` con el nuevo `docker-compose.yml`
4. **Los servicios se reinician** (2-3 minutos)
   - Docker Compose detiene los contenedores antiguos
   - Crea nuevos contenedores sin `container_name` fijos
   - Los servicios inician con la nueva configuración
5. **El servicio está disponible** ✅

---

## Solución de Problemas

### "No tengo permisos para hacer push"

Si ves un error de autenticación:

```bash
# Configurar credenciales de GitHub
git config user.name "Tu Nombre"
git config user.email "tu-email@ejemplo.com"

# Si usas HTTPS, GitHub pedirá tu token de acceso personal
# Si usas SSH, asegúrate de tener tu clave SSH configurada
```

### "Easypanel no detecta los cambios"

1. Verifica que los cambios estén en GitHub
2. En Easypanel, ve al servicio y haz clic en "Rebuild" manualmente
3. Verifica que la rama configurada en Easypanel sea la correcta (master o main)

### "Los servicios no inician después del despliegue"

1. Revisa los logs en Easypanel de cada servicio
2. Verifica que las variables de entorno estén configuradas
3. Asegúrate de que el archivo `.env` esté configurado (ver `docker/EASYPANEL_DEPLOYMENT.md`)

---

## Comandos Rápidos (Resumen)

```bash
# Todo en uno
git add .
git commit -m "Fix: Compatibilidad con Easypanel - Eliminados container_name y ajustados puertos"
git push origin master
```

---

## Siguiente Paso Después del Deploy

Una vez que el servicio esté desplegado, debes:

1. **Configurar variables de entorno** en Easypanel (si no lo has hecho)
   - Ver `docker/EASYPANEL_DEPLOYMENT.md` para la lista completa
   
2. **Configurar el dominio** en Easypanel
   - Dominio: `liec-web-supabase.wxeifq.easypanel.host`
   - Puerto: `3000` (Studio) o `8000` (API)

3. **Generar secrets** (si no lo has hecho)
   ```bash
   cd docker
   sh ./utils/generate-keys.sh
   ```

---

**¿Listo para hacer el deploy?**

Ejecuta los comandos del "Paso 2" al "Paso 4" y estarás listo. 🚀

---

**Última actualización**: 2026-03-06
