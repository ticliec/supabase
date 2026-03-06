# ⚙️ Configuración de Easypanel para Supabase

## 🔴 PROBLEMA ACTUAL

El servicio muestra "Service is not reachable" porque:
1. ❌ Había conflicto de puertos con Kong
2. ✅ **SOLUCIONADO**: Todos los puertos están ahora comentados
3. ⚠️ **PENDIENTE**: Configurar Easypanel para enrutar al puerto interno

---

## ✅ Solución Implementada

### Cambio en docker-compose.yml

**Antes** (causaba conflicto):
```yaml
kong:
  ports:
    - ${KONG_HTTP_PORT}:8000/tcp  # ❌ Conflicto con otros servicios
```

**Ahora** (sin conflictos):
```yaml
kong:
  # ports:  # ✅ Todos los puertos comentados
  #   - ${KONG_HTTP_PORT}:8000/tcp
  # Easypanel enruta internamente al puerto 8000
```

---

## 🔧 Configuración Requerida en Easypanel

### Paso 1: Configurar el Dominio

1. Ve a tu servicio `supabase` en Easypanel
2. Click en la pestaña "Domains" o "Dominios"
3. Configura:

```
Dominio: liec-web-supabase.wxeifq.easypanel.host
Puerto: 8000
Protocolo: HTTP (Easypanel maneja HTTPS)
```

**IMPORTANTE**: 
- El puerto debe ser `8000` (puerto interno de Kong)
- El protocolo debe ser `HTTP` (no HTTPS)
- Easypanel agregará HTTPS automáticamente

### Paso 2: Verificar la Configuración del Servicio

En la configuración del servicio, asegúrate de que:

```yaml
# En la sección de configuración de Easypanel
Service Port: 8000
Service Protocol: http
External Protocol: https (automático)
```

### Paso 3: Reiniciar el Servicio

Después de configurar el dominio:
1. Click en "Restart" o "Reiniciar"
2. Espera 1-2 minutos
3. Verifica el acceso

---

## 🌐 Arquitectura de Red

```
Internet (HTTPS)
    ↓
Easypanel Proxy
    ↓ (maneja SSL/TLS)
    ↓
Kong (puerto interno 8000, HTTP)
    ↓
Servicios Internos
    ├── Studio :3000
    ├── Auth :9999
    ├── REST :3000
    ├── Realtime :4000
    ├── Storage :5000
    └── etc.
```

**Clave**: 
- Ningún puerto está expuesto externamente desde Docker
- Easypanel enruta las peticiones al puerto interno 8000 de Kong
- Kong distribuye las peticiones a los servicios internos

---

## 📋 Checklist de Configuración

- [ ] Todos los puertos comentados en docker-compose.yml ✅ (ya hecho)
- [ ] Commit y push a GitHub ⏳ (pendiente)
- [ ] Easypanel detecta cambios y re-despliega ⏳ (pendiente)
- [ ] Configurar dominio en Easypanel con puerto 8000 ⏳ (pendiente)
- [ ] Reiniciar servicio en Easypanel ⏳ (pendiente)
- [ ] Verificar acceso al servicio ⏳ (pendiente)

---

## 🔍 Verificación

### Logs a Revisar

En Easypanel, revisa los logs de:

1. **Kong** - Debe mostrar:
   ```
   Kong started
   ```

2. **Studio** - Debe mostrar:
   ```
   ready - started server on 0.0.0.0:3000
   ```

3. **Analytics** - Debe mostrar:
   ```
   [info] Running LogflareWeb.Endpoint
   ```

### Comandos de Verificación

Si tienes acceso al contenedor de Kong:
```bash
# Verificar que Kong está escuchando en el puerto 8000
curl http://localhost:8000/
```

---

## 🆘 Solución de Problemas

### "Service is not reachable"

**Causa**: Easypanel no está enrutando correctamente al puerto interno.

**Solución**:
1. Verifica que el dominio esté configurado con puerto `8000`
2. Verifica que el protocolo sea `HTTP` (no HTTPS)
3. Reinicia el servicio
4. Espera 2-3 minutos para que todos los servicios inicien

### "ports is used in kong"

**Causa**: Los puertos aún están expuestos en docker-compose.yml

**Solución**:
1. ✅ Ya corregido en el último commit
2. Hacer push a GitHub
3. Easypanel re-desplegará automáticamente

### Kong no inicia

**Causa**: Problemas con variables de entorno o dependencias.

**Solución**:
1. Verifica que `analytics` esté healthy (Kong depende de él)
2. Revisa los logs de Kong en Easypanel
3. Verifica las variables de entorno:
   - `ANON_KEY`
   - `SERVICE_ROLE_KEY`
   - `DASHBOARD_USERNAME`
   - `DASHBOARD_PASSWORD`

### Studio no es accesible

**Causa**: Studio depende de Kong para el routing.

**Solución**:
1. Verifica que Kong esté funcionando primero
2. Verifica que el dominio apunte al puerto 8000 de Kong
3. Kong enrutará automáticamente a Studio

---

## 📊 Estado de los Servicios

Para verificar que todos los servicios estén funcionando:

```
✅ vector - Debe estar healthy
✅ db - Debe estar healthy  
✅ analytics - Debe estar healthy
✅ auth - Debe estar running
✅ rest - Debe estar running
✅ realtime - Debe estar healthy
✅ storage - Debe estar healthy
✅ kong - Debe estar running (CRÍTICO)
✅ studio - Debe estar running
✅ meta - Debe estar running
✅ functions - Debe estar running
✅ imgproxy - Debe estar healthy
✅ supavisor - Debe estar healthy
```

---

## 🚀 Próximos Pasos

1. **Hacer commit y push** de los cambios actuales:
   ```bash
   git add docker/docker-compose.yml PROJECT_CONTEXT.md
   git commit -m "Fix: Eliminar todos los puertos expuestos para evitar conflictos en Easypanel"
   git push upstream master
   ```

2. **Esperar re-despliegue** en Easypanel (1-2 minutos)

3. **Configurar dominio** en Easypanel:
   - Puerto: 8000
   - Protocolo: HTTP

4. **Reiniciar servicio** en Easypanel

5. **Verificar acceso**:
   ```
   https://liec-web-supabase.wxeifq.easypanel.host
   ```

---

## 📖 Referencias

- [Documentación de Kong](https://docs.konghq.com/)
- [Supabase Self-Hosting](https://supabase.com/docs/guides/hosting/overview)
- [Docker Compose Networking](https://docs.docker.com/compose/networking/)

---

**Última actualización**: 2026-03-06 17:15  
**Estado**: Cambios listos para commit y push
