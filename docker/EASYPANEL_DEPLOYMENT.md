# Guía de Despliegue en Easypanel

## Preparación Antes del Despliegue

### 0. Subir Cambios a GitHub

**IMPORTANTE**: Los cambios en `docker-compose.yml` deben estar en GitHub para que Easypanel los detecte.

```bash
# Verificar cambios
git status

# Agregar archivos modificados
git add docker/docker-compose.yml
git add PROJECT_CONTEXT.md
git add docker/EASYPANEL_DEPLOYMENT.md
git add CAMBIOS_EASYPANEL.md

# Commit
git commit -m "Fix: Compatibilidad con Easypanel - Eliminados container_name y ajustados puertos"

# Push a GitHub
git push origin master
```

Easypanel detectará automáticamente los cambios y re-desplegará el servicio.

### 1. Configurar Variables de Entorno

Copia el archivo de ejemplo y genera los secrets:

```bash
cd docker
cp .env.example .env
sh ./utils/generate-keys.sh
```

### 2. Editar el archivo .env

Abre `docker/.env` y configura las siguientes variables:

#### URLs (IMPORTANTE)
```env
SUPABASE_PUBLIC_URL=https://liec-web-supabase.wxeifq.easypanel.host
API_EXTERNAL_URL=https://liec-web-supabase.wxeifq.easypanel.host
SITE_URL=https://tu-frontend.com
```

#### Seguridad (CAMBIAR TODOS)
```env
POSTGRES_PASSWORD=tu-password-super-seguro-minimo-32-caracteres
DASHBOARD_USERNAME=tu-usuario-admin
DASHBOARD_PASSWORD=tu-password-dashboard-seguro
```

Los demás secrets ya fueron generados por el script `generate-keys.sh`.

---

## Configuración en Easypanel

### Paso 1: Verificar Configuración del Servicio

El servicio ya está configurado en Easypanel con:
- **Nombre**: `supabase`
- **Fuente**: Git (Auto-despliegue desde GitHub)
- **URL del repositorio**: `https://github.com/ticliec/supabase`
- **Rama**: `master` (o la rama principal)
- **Ruta de compilación**: `/docker`
- **Archivo Docker Compose**: `docker-compose.yml`

**Importante**: Los cambios realizados en el `docker-compose.yml` deben ser commiteados y pusheados a GitHub para que Easypanel los detecte.

### Paso 2: Configurar el Dominio

1. En la sección "Dominios", configura:
   - **Dominio**: `liec-web-supabase.wxeifq.easypanel.host`
   - **Puerto**: `3000` (Studio UI)
   - **Protocolo**: HTTPS (Easypanel maneja el certificado)

2. Para acceder a la API:
   - **Dominio API**: Mismo dominio o subdominio adicional
   - **Puerto**: `8000` (Kong Gateway)

### Paso 3: Variables de Entorno en Easypanel

Copia todas las variables del archivo `.env` a la sección de variables de entorno en Easypanel.

**Método rápido**: Puedes pegar todo el contenido del archivo `.env` en el campo de variables de entorno de Easypanel.

---

## Verificación Post-Despliegue

### 1. Verificar que los servicios están corriendo

En Easypanel, revisa los logs de cada servicio:
- ✅ `db` - Base de datos Postgres
- ✅ `auth` - Servicio de autenticación
- ✅ `rest` - API REST
- ✅ `realtime` - Subscripciones en tiempo real
- ✅ `storage` - Almacenamiento de archivos
- ✅ `kong` - API Gateway
- ✅ `studio` - Dashboard UI
- ✅ `analytics` - Logflare analytics

### 2. Acceder al Dashboard

Abre tu navegador y ve a:
```
https://liec-web-supabase.wxeifq.easypanel.host
```

Deberías ver el dashboard de Supabase Studio.

### 3. Probar la API

```bash
curl https://liec-web-supabase.wxeifq.easypanel.host/rest/v1/
```

Deberías recibir una respuesta del API Gateway.

---

## Solución de Problemas

### Error: "Service is not reachable"

**Causa**: Los servicios aún están iniciando o hay un problema de configuración.

**Solución**:
1. Revisa los logs en Easypanel
2. Verifica que todas las variables de entorno estén configuradas
3. Espera 2-3 minutos para que todos los servicios inicien
4. Verifica el healthcheck de cada servicio

### Error: "container_name is used in X"

**Causa**: Ya resuelto en el `docker-compose.yml` modificado.

**Verificación**: Asegúrate de usar el archivo modificado donde todos los `container_name` están comentados.

### Error: "ports is used in X"

**Causa**: Ya resuelto en el `docker-compose.yml` modificado.

**Verificación**: Los puertos de Supavisor deben estar comentados.

### Base de datos no se conecta

**Causa**: Postgres no ha iniciado completamente.

**Solución**:
1. Revisa los logs del servicio `db`
2. Verifica que el volumen de datos esté correctamente montado
3. Asegúrate de que `POSTGRES_PASSWORD` esté configurado

### No puedo acceder al Dashboard

**Causa**: El dominio no está apuntando correctamente o Studio no ha iniciado.

**Solución**:
1. Verifica que el dominio esté configurado en Easypanel
2. Revisa los logs del servicio `studio`
3. Verifica que `SUPABASE_PUBLIC_URL` esté correctamente configurado
4. Asegúrate de que el servicio `analytics` esté healthy (Studio depende de él)

---

## Arquitectura de Red en Easypanel

```
Internet
    ↓
Easypanel Proxy (HTTPS)
    ↓
Kong Gateway :8000 (HTTP interno)
    ↓
┌─────────────────────────────────┐
│  Servicios Internos             │
│  - auth :9999                   │
│  - rest :3000                   │
│  - realtime :4000               │
│  - storage :5000                │
│  - meta :8080                   │
│  - functions :9000              │
│  - studio :3000                 │
│  - analytics :4000              │
│  - db :5432 (interno)           │
└─────────────────────────────────┘
```

**Importante**: 
- Solo Kong (puerto 8000) está expuesto externamente
- Todos los demás servicios se comunican internamente
- Easypanel maneja el SSL/TLS automáticamente
- No es necesario exponer puertos adicionales

---

## Mantenimiento

### Actualizar Supabase

1. En Easypanel, ve al servicio `supabase`
2. Haz clic en "Rebuild" para obtener la última versión del repositorio
3. Revisa los logs para asegurar que todo inició correctamente

### Backup de la Base de Datos

```bash
# Desde el contenedor de Postgres
docker exec -t <postgres-container-id> pg_dumpall -c -U postgres > dump_$(date +%Y-%m-%d_%H_%M_%S).sql
```

### Restaurar Backup

```bash
cat dump_file.sql | docker exec -i <postgres-container-id> psql -U postgres
```

---

## Recursos Recomendados del VPS

- **CPU**: Mínimo 2 cores
- **RAM**: Mínimo 4GB (recomendado 8GB)
- **Disco**: Mínimo 20GB SSD
- **Ancho de banda**: Según tu tráfico esperado

---

## Contacto y Soporte

- **Documentación Oficial**: https://supabase.com/docs
- **Self-Hosting Guide**: https://supabase.com/docs/guides/hosting/overview
- **Discord**: https://discord.supabase.com
- **GitHub Issues**: https://github.com/supabase/supabase/issues

---

**Última actualización**: 2026-03-06
