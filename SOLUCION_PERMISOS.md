# 🔐 Solución de Permisos de GitHub

## Problema Detectado

El usuario `lbobadillaLIEC` no tiene permisos de escritura en el repositorio `ticliec/supabase`.

**Credenciales actuales en Windows**:
- Usuario Git: `Charly` (carlos94bg@gmail.com)
- Usuario GitHub almacenado: `lbobadillaLIEC`
- Repositorio destino: `ticliec/supabase`

---

## ✅ Soluciones Disponibles

### Opción 1: Agregar Colaborador al Repositorio (Recomendado)

Si `ticliec` es tu organización o cuenta:

1. Ve a https://github.com/ticliec/supabase
2. Click en "Settings" → "Collaborators"
3. Agregar a `lbobadillaLIEC` como colaborador con permisos de "Write" o "Admin"
4. `lbobadillaLIEC` debe aceptar la invitación
5. Luego ejecutar:
   ```powershell
   git push upstream master
   ```

---

### Opción 2: Usar Token de Acceso Personal

Si no puedes agregar colaboradores, usa un token:

#### Paso 1: Generar Token
1. Ve a https://github.com/settings/tokens
2. Click en "Generate new token" → "Generate new token (classic)"
3. Nombre: "Supabase Deploy"
4. Permisos: Marca `repo` (acceso completo a repositorios)
5. Click en "Generate token"
6. **COPIA EL TOKEN** (solo se muestra una vez)

#### Paso 2: Usar el Token
```powershell
# Opción A: Push directo con token
git push https://TU_TOKEN_AQUI@github.com/ticliec/supabase.git master

# Opción B: Actualizar el remote
git remote set-url upstream https://TU_TOKEN_AQUI@github.com/ticliec/supabase.git
git push upstream master
```

---

### Opción 3: Cambiar Credenciales de Windows

Si tienes otra cuenta de GitHub con permisos:

#### Paso 1: Eliminar credenciales actuales
```powershell
# Eliminar credencial de GitHub
cmdkey /delete:LegacyGeneric:target=git:https://github.com

# O eliminar todas las de GitHub
cmdkey /delete:LegacyGeneric:target=git:https://lbobadillaLIEC@github.com
```

#### Paso 2: Intentar push de nuevo
```powershell
git push upstream master
```

Windows te pedirá nuevas credenciales. Ingresa las credenciales de una cuenta con permisos.

---

### Opción 4: Usar SSH en lugar de HTTPS

Si tienes configurada una clave SSH:

#### Paso 1: Verificar clave SSH
```powershell
# Ver si tienes claves SSH
ls ~/.ssh
```

#### Paso 2: Cambiar remote a SSH
```powershell
git remote set-url upstream git@github.com:ticliec/supabase.git
git push upstream master
```

Si no tienes clave SSH configurada, sigue esta guía:
https://docs.github.com/es/authentication/connecting-to-github-with-ssh

---

### Opción 5: Fork y Pull Request

Si no puedes obtener permisos directos:

1. Haz fork del repositorio `ticliec/supabase` a tu cuenta
2. Cambia el remote:
   ```powershell
   git remote set-url upstream https://github.com/lbobadillaLIEC/supabase.git
   ```
3. Push a tu fork:
   ```powershell
   git push upstream master
   ```
4. Crea un Pull Request desde tu fork hacia `ticliec/supabase`

---

## 🔍 Verificar Permisos Actuales

Para verificar si tienes permisos en el repositorio:

1. Ve a https://github.com/ticliec/supabase
2. Si ves un botón "Settings", tienes permisos de admin
3. Si solo ves "Watch", "Fork", "Star", NO tienes permisos de escritura

---

## 📋 Estado Actual de los Cambios

Los cambios están listos localmente:

```
✅ Commit creado: "Docs: Agregar scripts de deploy y documentación completa"
⏳ Pendiente: Push a GitHub
```

**Archivos modificados/creados**:
- docker/docker-compose.yml (modificado)
- PROJECT_CONTEXT.md (modificado)
- CAMBIOS_EASYPANEL.md (modificado)
- docker/EASYPANEL_DEPLOYMENT.md (modificado)
- INICIO_AQUI.md (nuevo)
- INSTRUCCIONES_DEPLOY.md (nuevo)
- README_DEPLOY.md (nuevo)
- deploy.sh (nuevo)
- deploy.ps1 (nuevo)

---

## 🚀 Después de Resolver los Permisos

Una vez que tengas permisos, ejecuta:

```powershell
git push upstream master
```

Easypanel detectará automáticamente los cambios y re-desplegará el servicio.

---

## 🆘 ¿Necesitas Ayuda?

### Verificar quién es el propietario del repositorio
```powershell
# Ver información del repositorio
git remote show upstream
```

### Contactar al propietario
Si `ticliec` es otra persona u organización, contacta al propietario para:
1. Que te agregue como colaborador, O
2. Que te proporcione un token de acceso personal, O
3. Que haga el push por ti

---

## 📝 Comandos Útiles

```powershell
# Ver remotes configurados
git remote -v

# Ver credenciales almacenadas en Windows
cmdkey /list | Select-String "github"

# Ver configuración de Git
git config --list

# Ver estado del repositorio
git status

# Ver commits pendientes de push
git log origin/master..HEAD
```

---

**Última actualización**: 2026-03-06
