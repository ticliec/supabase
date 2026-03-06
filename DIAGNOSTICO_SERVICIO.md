# 🔍 Diagnóstico del Servicio

## Estado Actual

✅ Configuración del dominio en Easypanel:
- Host: `liec-web-supabase.wxeifq.easypanel.host`
- Puerto: `8000`
- Protocolo: `HTTP`
- HTTPS: Activado

❌ Resultado: "Service is not reachable"

---

## 🔎 Posibles Causas

### 1. Campo "Servicio Compose" Vacío

En la captura de pantalla veo que el campo **"Servicio Compose"** está vacío. Este campo es CRÍTICO.

**Solución**: Debes especificar el nombre del servicio de Docker Compose al que enrutar.

### 2. Nombre del Servicio Incorrecto

Easypanel necesita saber a qué contenedor específico enrutar las peticiones.

---

## ✅ SOLUCIÓN

### Paso 1: Completar el Campo "Servicio Compose"

En la configuración del dominio en Easypanel:

```
Servicio Compose: kong
```

**IMPORTANTE**: El nombre debe ser exactamente `kong` (sin prefijos ni sufijos).

### Configuración Completa

```
┌─────────────────────────────────────────────┐
│ HTTPS: ✓ Activado                           │
│ Host: liec-web-supabase.wxeifq.easypanel... │
│ Ruta: /                                     │
│                                             │
│ Destino:                                    │
│ Protocolo: HTTP                             │
│ Puerto: 8000                                │
│ Ruta: /                                     │
│                                             │
│ Servicio Compose: kong  ← AGREGAR ESTO     │
└─────────────────────────────────────────────┘
```

---

## 🔧 Pasos Detallados

### 1. Editar el Dominio

1. En Easypanel, ve al servicio `supabase`
2. Click en "Dominios"
3. Click en el dominio existente para editarlo

### 2. Completar "Servicio Compose"

En el campo **"Servicio Compose"**, escribe:
```
kong
```

Este es el nombre del servicio en tu `docker-compose.yml` que actúa como API Gateway.

### 3. Guardar y Esperar

1. Click en "Guardar"
2. Espera 30-60 segundos
3. Refresca la página en el navegador

---

## 📋 Verificación de Nombres de Servicios

En tu `docker-compose.yml`, los servicios se llaman:

```yaml
services:
  studio:      # Dashboard UI
  kong:        # API Gateway ← ESTE ES EL CORRECTO
  auth:        # Autenticación
  rest:        # API REST
  realtime:    # Realtime
  storage:     # Storage
  # ... etc
```

**Kong** es el punto de entrada correcto porque:
- Es el API Gateway
- Distribuye las peticiones a todos los demás servicios
- Escucha en el puerto 8000
- Maneja el routing a Studio, Auth, REST, etc.

---

## 🌐 Arquitectura de Routing

```
Internet (HTTPS)
    ↓
Easypanel Proxy
    ↓
Servicio: "kong" (puerto 8000) ← Debe estar especificado
    ↓
Kong distribuye a:
    ├── /studio → Studio (Dashboard)
    ├── /auth → Auth
    ├── /rest → REST API
    ├── /realtime → Realtime
    └── /storage → Storage
```

---

## 🆘 Si Aún No Funciona

### Verificar Logs de Kong

1. En Easypanel, ve al servicio `supabase`
2. Click en "Logs"
3. Busca el contenedor que contiene "kong" en el nombre
4. Deberías ver:
   ```
   Kong started
   ```

### Verificar que Kong Está Corriendo

En los logs, busca:
```
[kong] Kong started
```

Si no ves esto, Kong no ha iniciado correctamente.

### Verificar Dependencias

Kong depende de `analytics`. Verifica que `analytics` esté "healthy":

1. En Easypanel, revisa los logs de analytics
2. Debe mostrar:
   ```
   [info] Running LogflareWeb.Endpoint
   ```

### Verificar Variables de Entorno

Asegúrate de tener configuradas estas variables en Easypanel:

```env
KONG_HTTP_PORT=8000
ANON_KEY=tu-anon-key
SERVICE_ROLE_KEY=tu-service-role-key
DASHBOARD_USERNAME=tu-usuario
DASHBOARD_PASSWORD=tu-password
```

---

## 🔄 Alternativa: Usar Studio Directamente

Si Kong no funciona, puedes intentar enrutar directamente a Studio:

```
Servicio Compose: studio
Puerto: 3000
Protocolo: HTTP
```

**Nota**: Esto solo mostrará el Dashboard, pero no tendrás acceso a las APIs.

---

## 📊 Checklist de Diagnóstico

- [ ] Campo "Servicio Compose" completado con "kong"
- [ ] Puerto configurado en 8000
- [ ] Protocolo configurado en HTTP
- [ ] Kong está corriendo (verificar logs)
- [ ] Analytics está "healthy" (Kong depende de él)
- [ ] Variables de entorno configuradas
- [ ] Esperado 1-2 minutos después de guardar

---

## 🎯 Acción Inmediata

**AHORA MISMO**:
1. Edita el dominio en Easypanel
2. En "Servicio Compose" escribe: `kong`
3. Guarda
4. Espera 1 minuto
5. Refresca el navegador

---

## 📞 Información Adicional

Si después de agregar "kong" en el campo "Servicio Compose" aún no funciona, necesitaremos revisar:

1. Los logs de Kong
2. Los logs de Analytics (dependencia de Kong)
3. Las variables de entorno
4. El estado de todos los contenedores

---

**Última actualización**: 2026-03-06 17:30  
**Acción requerida**: Agregar "kong" en el campo "Servicio Compose"
