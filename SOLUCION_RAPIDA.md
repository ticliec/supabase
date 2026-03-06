# ⚡ SOLUCIÓN RÁPIDA

## 🎯 El Problema

El campo **"Servicio Compose"** está vacío en la configuración del dominio.

Easypanel no sabe a qué contenedor enrutar las peticiones.

---

## ✅ LA SOLUCIÓN (30 segundos)

### En Easypanel:

1. **Edita el dominio** (el que ya tienes configurado)

2. **En el campo "Servicio Compose"**, escribe:
   ```
   kong
   ```

3. **Guarda**

4. **Espera 1 minuto**

5. **Refresca el navegador**

---

## 📸 Configuración Correcta

```
┌─────────────────────────────────────────────┐
│ HTTPS: ✓                                    │
│ Host: liec-web-supabase.wxeifq.easypanel... │
│ Ruta: /                                     │
│                                             │
│ Destino:                                    │
│ Protocolo: HTTP                             │
│ Puerto: 8000                                │
│ Ruta: /                                     │
│                                             │
│ Servicio Compose: kong  ← ¡AGREGAR ESTO!   │
│                                             │
│ [Guardar]                                   │
└─────────────────────────────────────────────┘
```

---

## ❓ ¿Por Qué "kong"?

Kong es el API Gateway que:
- Recibe todas las peticiones
- Las distribuye a los servicios correctos
- Maneja el routing a Studio, Auth, REST, etc.

Es el punto de entrada de toda la arquitectura de Supabase.

---

## 🔄 Si Aún No Funciona

### Opción A: Verificar Logs de Kong

1. Ve a Easypanel → Servicio `supabase` → Logs
2. Busca el contenedor con "kong" en el nombre
3. Debe mostrar: `Kong started`

### Opción B: Intentar con Studio Directamente

Si Kong no funciona, prueba:
```
Servicio Compose: studio
Puerto: 3000
```

Esto mostrará solo el Dashboard (sin APIs).

---

## ⏰ Tiempo Estimado

```
Ahora
  ↓ 10 seg: Editar dominio
  ↓ 5 seg: Agregar "kong"
  ↓ 5 seg: Guardar
  ↓ 60 seg: Esperar propagación
  ↓ 5 seg: Refrescar navegador
= 85 segundos total
```

---

## 🎊 Resultado Esperado

Después de agregar "kong" y esperar 1 minuto, deberías ver:

```
✅ Supabase Studio Dashboard
✅ Pantalla de login o bienvenida
✅ Sin error "Service is not reachable"
```

---

**¡Hazlo ahora!** Solo toma 30 segundos. 🚀
