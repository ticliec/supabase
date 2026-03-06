# Contexto del Proyecto Supabase

> **IMPORTANTE**: Este archivo debe ser consultado antes de realizar cualquier cambio en el proyecto. Contiene información crítica sobre la infraestructura, arquitectura y configuración del entorno.

## Información General del Proyecto

### Descripción
Este es el repositorio oficial de **Supabase**, una plataforma de desarrollo Postgres de código abierto que replica las funcionalidades de Firebase utilizando herramientas empresariales open source.

- **Nombre**: Supabase
- **Versión**: 0.0.0 (monorepo)
- **Licencia**: Apache-2.0
- **Repositorio**: https://github.com/supabase/supabase

### Características Principales
- ✅ Base de datos Postgres alojada
- ✅ Autenticación y Autorización (GoTrue)
- ✅ APIs auto-generadas (REST, GraphQL, Realtime)
- ✅ Funciones (Database Functions, Edge Functions)
- ✅ Almacenamiento de archivos (Storage)
- ✅ Toolkit de AI + Vector/Embeddings
- ✅ Dashboard de administración (Studio)

---

## Entorno de Despliegue

### Infraestructura Actual
- **Proveedor de Hosting**: Hostinger VPS
- **Panel de Control**: Easypanel
- **Tipo de Despliegue**: Self-hosted (autoalojado)
- **Sistema Operativo**: Linux (VPS)
- **Repositorio**: https://github.com/ticliec/supabase
- **Auto-Despliegue**: Easypanel detecta cambios en GitHub automáticamente

### Flujo de Despliegue
1. Desarrollador hace cambios localmente
2. Commit y push a GitHub (`git push origin master`)
3. Easypanel detecta cambios automáticamente (webhook o polling)
4. Easypanel re-despliega el servicio automáticamente
5. Los servicios se reinician con la nueva configuración

### Consideraciones Importantes
1. Este proyecto está configurado para **autoalojamiento** en lugar de usar la plataforma cloud de Supabase
2. La configuración de Docker es crítica para el despliegue en Easypanel
3. Se deben considerar los recursos limitados del VPS al realizar cambios
4. Las configuraciones de red y puertos deben ser compatibles con Easypanel
5. **Todos los cambios deben estar en GitHub** para que Easypanel los detecte

---

## Arquitectura del Proyecto

### Estructura de Monorepo
El proyecto utiliza **pnpm workspaces** y **Turbo** para gestionar múltiples aplicaciones y paquetes:

```
supabase/
├── apps/              # Aplicaciones principales
│   ├── studio/        # Dashboard de administración
│   ├── docs/          # Documentación
│   ├── design-system/ # Sistema de diseño
│   ├── learn/         # Plataforma de aprendizaje
│   └── ui-library/    # Biblioteca de componentes UI
├── packages/          # Paquetes compartidos
├── docker/            # Configuraciones de Docker
├── supabase/          # Configuración de Supabase CLI
├── e2e/               # Tests end-to-end
├── examples/          # Ejemplos de uso
└── blocks/            # Bloques reutilizables
```

### Componentes de la Arquitectura Supabase

1. **PostgreSQL**: Base de datos relacional principal
2. **Realtime**: Servidor Elixir para websockets y subscripciones
3. **PostgREST**: API RESTful auto-generada desde Postgres
4. **GoTrue**: API de autenticación basada en JWT
5. **Storage**: API RESTful para gestión de archivos (S3)
6. **pg_graphql**: Extensión de PostgreSQL para API GraphQL
7. **postgres-meta**: API RESTful para gestión de Postgres
8. **Kong**: API Gateway cloud-native

---

## Requisitos del Sistema

### Versiones Requeridas
- **Node.js**: >= 22
- **pnpm**: 10.24.0 (obligatorio, no usar npm o yarn)
- **Docker**: Requerido para desarrollo local y despliegue
- **Supabase CLI**: ^2.76.10

### Instalación de Dependencias
```bash
# Solo se permite pnpm (enforced por preinstall script)
pnpm install
```

---

## Scripts Principales

### Desarrollo
```bash
pnpm dev                    # Ejecutar todos los proyectos en modo desarrollo
pnpm dev:studio             # Solo Studio
pnpm dev:docs               # Solo Docs
pnpm dev:design-system      # Solo Design System
```

### Build
```bash
pnpm build                  # Build de todos los proyectos
pnpm build:studio           # Build solo de Studio
pnpm build:docs             # Build solo de Docs
```

### Testing
```bash
pnpm test:studio            # Tests de Studio
pnpm test:docs              # Tests de Docs
pnpm lint                   # Linting
pnpm typecheck              # Type checking
```

### Docker y Self-Hosting
```bash
pnpm setup:cli              # Configurar Supabase CLI local
pnpm e2e:setup:selfhosted   # Setup para entorno self-hosted
```

---

## Configuración de Docker

### Archivos de Configuración
- `docker/docker-compose.yml`: Configuración principal
- `docker/docker-compose.nginx.yml`: Configuración con Nginx
- `docker/docker-compose.caddy.yml`: Configuración con Caddy
- `docker/docker-compose.s3.yml`: Configuración de S3
- `docker/.env.example`: Variables de entorno de ejemplo

### Volúmenes Docker
Los datos persistentes se almacenan en `docker/volumes/`

---

## Consideraciones para Easypanel

### ⚠️ CAMBIOS REALIZADOS PARA COMPATIBILIDAD CON EASYPANEL

**Fecha**: 2026-03-06

Se han realizado las siguientes modificaciones en `docker/docker-compose.yml`:

1. **Nombres de Contenedores**: Todos los `container_name` han sido comentados para evitar conflictos con otros servicios en Easypanel
2. **Puertos Expuestos**: 
   - Solo se expone el puerto HTTP de Kong (8000) para el acceso principal
   - Los puertos de Supavisor (5432, 6543) están comentados para evitar conflictos
   - El puerto HTTPS de Kong (8443) está comentado - Easypanel maneja el SSL
3. **Networking**: Los servicios se comunican internamente usando la red de Docker Compose

### Puntos Críticos
1. **Puertos**: Solo Kong expone el puerto 8000. Easypanel debe configurarse para enrutar a este puerto
2. **Variables de Entorno**: Configurar correctamente las variables de entorno en Easypanel (ver sección abajo)
3. **Volúmenes**: Asegurar persistencia de datos en el VPS
4. **Recursos**: Monitorear uso de CPU y memoria del VPS (mínimo 4GB RAM recomendado)
5. **Networking**: Configurar correctamente el proxy inverso de Easypanel hacia Kong:8000

### Variables de Entorno Importantes

**CRÍTICO**: Antes de desplegar, debes copiar `docker/.env.example` a `docker/.env` y configurar:

#### Secrets (CAMBIAR OBLIGATORIAMENTE)
- `POSTGRES_PASSWORD`: Contraseña de la base de datos (mínimo 32 caracteres)
- `JWT_SECRET`: Secret para tokens JWT (mínimo 32 caracteres)
- `ANON_KEY`: API key anónima (generar con script)
- `SERVICE_ROLE_KEY`: API key con privilegios de servicio (generar con script)
- `DASHBOARD_USERNAME`: Usuario del dashboard
- `DASHBOARD_PASSWORD`: Contraseña del dashboard
- `SECRET_KEY_BASE`: Para Realtime y Supavisor
- `VAULT_ENC_KEY`: Clave de encriptación (32 caracteres)
- `PG_META_CRYPTO_KEY`: Clave de encriptación para meta (32 caracteres)
- `LOGFLARE_PUBLIC_ACCESS_TOKEN`: Token público de Logflare
- `LOGFLARE_PRIVATE_ACCESS_TOKEN`: Token privado de Logflare

#### URLs (Configurar según tu dominio)
- `SUPABASE_PUBLIC_URL`: URL pública (ej: https://liec-web-supabase.wxeifq.easypanel.host)
- `API_EXTERNAL_URL`: URL externa de la API (misma que SUPABASE_PUBLIC_URL)
- `SITE_URL`: URL del sitio frontend

#### Puertos (Usar valores por defecto)
- `KONG_HTTP_PORT`: 8000 (puerto principal de acceso)
- `POSTGRES_PORT`: 5432
- `POOLER_PROXY_PORT_TRANSACTION`: 6543

#### Generar Secrets
Ejecutar en el directorio docker:
```bash
sh ./utils/generate-keys.sh
```

---

## Flujo de Trabajo Recomendado

### Antes de Realizar Cambios
1. ✅ Consultar este archivo (PROJECT_CONTEXT.md)
2. ✅ Verificar el estado actual del VPS y Easypanel
3. ✅ Hacer backup de la base de datos si es necesario
4. ✅ Probar cambios localmente con Docker primero
5. ✅ Hacer commit y push a GitHub
6. ✅ Verificar que Easypanel detecte y despliegue los cambios
7. ✅ Revisar logs de Easypanel antes y después del despliegue

### Para Realizar Cambios en Producción

```bash
# 1. Hacer cambios localmente
# 2. Probar localmente (opcional pero recomendado)
docker compose -f docker/docker-compose.yml up

# 3. Commit de cambios
git add .
git commit -m "Descripción del cambio"

# 4. Push a GitHub
git push origin master

# 5. Easypanel detectará automáticamente y re-desplegará
# 6. Monitorear logs en Easypanel
# 7. Verificar que el servicio funcione correctamente
```

### Para Actualizaciones
1. Revisar `docker/CHANGELOG.md` y `docker/versions.md`
2. Actualizar versiones en `docker-compose.yml`
3. Probar en entorno local
4. Desplegar en Easypanel con estrategia de rollback

### Para Desarrollo Local
```bash
# 1. Iniciar servicios de Supabase
supabase start

# 2. Generar tipos TypeScript
pnpm generate:types

# 3. Iniciar desarrollo
pnpm dev:studio
```

---

## Recursos y Documentación

### Documentación Oficial
- Docs: https://supabase.com/docs
- Self-Hosting: https://supabase.com/docs/guides/hosting/overview
- Local Development: https://supabase.com/docs/guides/local-development

### Archivos de Referencia en el Proyecto
- `DEVELOPERS.md`: Guía para contribuidores
- `CONTRIBUTING.md`: Guía de contribución
- `docker/README.md`: Documentación de Docker
- `apps/studio/README.md`: Documentación de Studio

### Soporte
- GitHub Issues: https://github.com/supabase/supabase/issues
- Discord: https://discord.supabase.com
- Community Forum: https://github.com/supabase/supabase/discussions

---

## Notas Importantes

### ⚠️ Advertencias
- **NO usar npm o yarn**: El proyecto requiere pnpm exclusivamente
- **Recursos del VPS**: Monitorear constantemente el uso de recursos
- **Backups**: Realizar backups regulares de la base de datos
- **Seguridad**: Cambiar todas las claves y secrets por defecto
- **Updates**: Probar actualizaciones en staging antes de producción

### 🔧 Mantenimiento
- Revisar logs de Easypanel regularmente
- Monitorear métricas de rendimiento
- Actualizar dependencias de seguridad
- Limpiar volúmenes Docker no utilizados
- Optimizar queries de base de datos

---

## Historial de Cambios del Proyecto

### 2026-03-06 - Scripts de Deploy Automatizados
- **Cambio**: Creación de scripts de deploy automatizados
- **Archivos**:
  - `deploy.sh` - Script para Linux/Mac
  - `deploy.ps1` - Script para Windows PowerShell
  - `README_DEPLOY.md` - Guía rápida
  - `INSTRUCCIONES_DEPLOY.md` - Instrucciones detalladas
  - `INICIO_AQUI.md` - Punto de inicio para nuevos usuarios
- **Motivo**: Facilitar el proceso de commit y push a GitHub para despliegue en Easypanel
- **Impacto**: El proceso de deploy ahora es más simple y guiado

### 2026-03-06 - Corrección de Conflictos en Easypanel
- **Cambio**: Modificación de `docker/docker-compose.yml` para compatibilidad con Easypanel
- **Detalles**:
  - Comentados todos los `container_name` para evitar conflictos de nombres
  - Comentados puertos de Supavisor para evitar conflictos de puertos
  - Comentado puerto HTTPS de Kong (Easypanel maneja SSL)
  - Solo se expone Kong:8000 como punto de entrada principal
- **Motivo**: Resolver errores de "container_name is used in X" y "ports is used in X"
- **Impacto**: Los servicios ahora usan nombres generados automáticamente por Docker Compose
- **Repositorio**: https://github.com/ticliec/supabase

### 2026-03-06 - Creación del Contexto
- **Cambio**: Creación del archivo de contexto del proyecto
- **Motivo**: Documentar la infraestructura de self-hosting en Hostinger VPS con Easypanel

---

**Fecha de creación**: 2026-03-06  
**Última modificación**: 2026-03-06  
**Mantenido por**: Equipo de desarrollo

> 💡 **Tip**: Mantén este archivo actualizado con cada cambio significativo en la infraestructura o configuración del proyecto.
