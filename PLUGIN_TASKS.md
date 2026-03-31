# obsidianConnect — Plugin Refactor Plan

Referencia completa para refactorizar el plugin de Obsidian. El backend actúa únicamente como intermediario entre el plugin y Google Drive. Toda la interfaz de usuario vive en el plugin.

---

## Tabla de contenidos

1. [Referencia de API del backend](#1-referencia-de-api-del-backend)
2. [Arquitectura del plugin](#2-arquitectura-del-plugin)
3. [Módulos a implementar](#3-módulos-a-implementar)
4. [Tareas de implementación](#4-tareas-de-implementación)
5. [Flujos completos](#5-flujos-completos)

---

## 1. Referencia de API del backend

Base URL: `http://localhost:8000/api/v1`

Todos los endpoints (excepto auth) requieren header: `Authorization: Bearer <token>`

---

### Auth — `/auth`

| Método | Ruta | Body | Respuesta | Descripción |
|--------|------|------|-----------|-------------|
| `POST` | `/auth/register` | `{email, password, name}` | `{access_token, expires_at, user}` | Registro |
| `POST` | `/auth/login` | `{email, password}` | `{access_token, expires_at, user}` | Login |
| `POST` | `/auth/logout` | — | `{message}` | Cerrar sesión |
| `GET`  | `/auth/me` | — | `User` | Perfil del usuario |
| `PATCH`| `/auth/me` | `{name?, email?}` | `User` | Actualizar perfil |
| `POST` | `/auth/forgot-password` | `{email}` | `{reset_token, expires_at}` | Recuperar contraseña |
| `POST` | `/auth/reset-password` | `{reset_token, new_password}` | `User` | Resetear contraseña |
| `GET`  | `/auth/google/url` | — | `{authorization_url}` | URL para conectar Drive (usuario ya autenticado) |
| `GET`  | `/auth/google/login-url?nonce=X` | — | `{authorization_url}` | URL para login con Google |
| `POST` | `/auth/google/login` | `{code, nonce}` | `{access_token, expires_at, user}` | Login/registro con Google |
| `GET`  | `/auth/google/login-token?nonce=X` | — | `{access_token, user}` | Polling token tras login Google |
| `GET`  | `/auth/google/status` | — | `StorageConnection` | Estado de la conexión con Drive |
| `POST` | `/auth/google/callback` | `{code}` | `StorageConnection` | Intercambiar código OAuth |

---

### Vaults — `/vaults`

| Método   | Ruta | Body | Respuesta | Descripción |
|----------|------|------|-----------|-------------|
| `GET`    | `/vaults` | — | `Vault[]` | Listar vaults del usuario |
| `POST`   | `/vaults` | `{name, slug, description?, local_path?, drive_folder_id?}` | `Vault` | Crear vault |
| `GET`    | `/vaults/{vault_id}` | — | `Vault` | Obtener vault |
| `PATCH`  | `/vaults/{vault_id}` | `{name?, description?, local_path?}` | `Vault` | Actualizar vault |
| `DELETE` | `/vaults/{vault_id}` | — | `204` | Eliminar vault |

**Vault:**
```json
{
  "id": "uuid",
  "user_id": "uuid",
  "name": "string",
  "slug": "string",
  "description": "string|null",
  "local_path": "string|null",
  "root_folder_id": "string|null",
  "sync_state": "idle|syncing|error|created",
  "created_at": "datetime",
  "updated_at": "datetime"
}
```

---

### Archivos — `/vaults/{vault_id}/files`

| Método   | Ruta | Descripción |
|----------|------|-------------|
| `GET`    | `/vaults/{vault_id}/files` | Listar archivos conocidos (DB local del backend) |
| `POST`   | `/vaults/{vault_id}/files` | Subir/actualizar un único archivo a Drive |
| `DELETE` | `/vaults/{vault_id}/files` | Eliminar un archivo de Drive y la DB |
| `PATCH`  | `/vaults/{vault_id}/files` | Renombrar/mover un archivo en Drive |
| `GET`    | `/vaults/{vault_id}/files/content?path=X` | Descargar contenido de un archivo |
| `GET`    | `/vaults/{vault_id}/files/remote-tree` | Árbol completo de Drive |

**POST body (upload):**
```json
{
  "path": "Notes/MyNote.md",
  "content": "texto plano",
  "base64_content": "base64...",
  "mime_type": "text/markdown",
  "modified_at": "datetime|null",
  "content_hash": "sha256|null"
}
```

**DELETE body:**
```json
{
  "path": "Notes/MyNote.md",
  "provider": "google_drive"
}
```

**PATCH body (rename/move):**
```json
{
  "old_path": "Notes/OldName.md",
  "new_path": "Archive/NewName.md",
  "provider": "google_drive"
}
```

**FileRead:**
```json
{
  "id": "uuid",
  "provider": "google_drive",
  "path": "Notes/MyNote.md",
  "name": "MyNote.md",
  "mime_type": "text/markdown",
  "content_hash": "sha256",
  "remote_file_id": "drive_id",
  "remote_version": "string",
  "size_bytes": 1024,
  "sync_status": "synced|remote|pending",
  "modified_at": "datetime"
}
```

---

### Sincronización — `/vaults/{vault_id}/sync`

| Método | Ruta | Body | Descripción |
|--------|------|------|-------------|
| `POST` | `/vaults/{vault_id}/sync/manual` | `{device_name, items: FileSyncItem[]}` | Push batch de archivos a Drive |
| `POST` | `/vaults/{vault_id}/sync/pull` | — | Pull: obtener metadatos de archivos remotos |
| `GET`  | `/vaults/{vault_id}/sync/jobs` | — | Historial de trabajos de sincronización |

**FileSyncItem:**
```json
{
  "path": "Notes/MyNote.md",
  "content": "texto|null",
  "base64_content": "base64|null",
  "mime_type": "text/markdown",
  "modified_at": "datetime|null",
  "size_bytes": 1024,
  "content_hash": "sha256|null"
}
```

**SyncJob:**
```json
{
  "id": "uuid",
  "provider": "google_drive",
  "direction": "push|pull",
  "status": "running|completed|failed",
  "started_at": "datetime",
  "finished_at": "datetime|null",
  "summary": {}
}
```

---

### Conexiones — `/vaults/{vault_id}/connection(s)`

| Método | Ruta | Descripción |
|--------|------|-------------|
| `GET`  | `/vaults/{vault_id}/connection` | Estado de conexión principal (google_drive) |
| `GET`  | `/vaults/{vault_id}/connections` | Todas las conexiones del vault |

---

### Drive — `/drive`

| Método | Ruta | Descripción |
|--------|------|-------------|
| `GET`  | `/drive/vaults` | Listar carpetas de vault en Google Drive |
| `POST` | `/drive/vaults/sync` | Sincronizar carpetas de Drive → crear vaults en backend |

---

### Actividad — `/activity`

| Método | Ruta | Query | Descripción |
|--------|------|-------|-------------|
| `GET`  | `/activity` | `vault_id?`, `limit?` | Historial de operaciones |

---

## 2. Arquitectura del plugin

```
src/
├── main.ts                    ← Plugin entry point, registra comandos y vistas
├── settings.ts                ← Configuración persistente (token, vault_id, server_url)
├── api/
│   ├── client.ts              ← HTTP client base (fetch wrapper con auth header)
│   ├── auth.ts                ← Llamadas a /auth/*
│   ├── vaults.ts              ← Llamadas a /vaults/*
│   ├── files.ts               ← Llamadas a /vaults/{id}/files/*
│   ├── sync.ts                ← Llamadas a /vaults/{id}/sync/*
│   └── drive.ts               ← Llamadas a /drive/*
├── services/
│   ├── authService.ts         ← Lógica de sesión, token storage, Google OAuth polling
│   ├── syncService.ts         ← Orquesta push/pull, detecta cambios locales
│   ├── fileService.ts         ← Operaciones individuales de archivo
│   └── conflictService.ts     ← Detección y resolución de conflictos
├── ui/
│   ├── views/
│   │   ├── MainSidebarView.ts ← Panel lateral principal
│   │   ├── VaultListView.ts   ← Lista de vaults y gestión
│   │   ├── FileBrowserView.ts ← Explorador de archivos remotos
│   │   ├── SyncStatusView.ts  ← Estado de sincronización y jobs
│   │   └── ActivityView.ts    ← Historial de actividad
│   ├── modals/
│   │   ├── LoginModal.ts      ← Modal de login (email/pass + Google)
│   │   ├── VaultCreateModal.ts← Crear/editar vault
│   │   ├── ConflictModal.ts   ← Resolver conflictos
│   │   └── SettingsTab.ts     ← Pestaña de ajustes del plugin
│   └── components/
│       ├── FileTreeItem.ts    ← Nodo de árbol de archivos
│       └── StatusBar.ts       ← Indicador en la barra de estado
└── utils/
    ├── hash.ts                ← SHA-256 de contenido de archivos
    ├── encoding.ts            ← Base64 encode/decode
    └── pathUtils.ts           ← Normalización de rutas
```

---

## 3. Módulos a implementar

### `api/client.ts`
- `get(path)`, `post(path, body)`, `patch(path, body)`, `delete(path, body)`
- Inyectar `Authorization: Bearer <token>` automáticamente
- Lanzar error con mensaje del backend en errores HTTP

### `api/auth.ts`
- `login(email, password)` → `AuthTokenResponse`
- `register(email, password, name)` → `AuthTokenResponse`
- `logout()`
- `getMe()` → `User`
- `getGoogleAuthUrl()` → `string`
- `getGoogleLoginUrl(nonce)` → `string`
- `pollGoogleLoginToken(nonce)` → `AuthTokenResponse | null`
- `getGoogleStatus()` → `StorageConnection`

### `api/vaults.ts`
- `listVaults()` → `Vault[]`
- `createVault(data)` → `Vault`
- `getVault(id)` → `Vault`
- `updateVault(id, data)` → `Vault`
- `deleteVault(id)`

### `api/files.ts`
- `listFiles(vaultId)` → `FileRead[]`
- `uploadFile(vaultId, item)` → `FileRead`
- `deleteFile(vaultId, path)` → `void`
- `renameFile(vaultId, oldPath, newPath)` → `FileRead`
- `downloadFile(vaultId, path, remoteFileId?)` → `FileDownloadResponse`
- `getRemoteTree(vaultId)` → `RemoteTreeResponse`

### `api/sync.ts`
- `pushSync(vaultId, items, deviceName?)` → `ManualSyncResponse`
- `pullSync(vaultId)` → `PullSyncResponse`
- `getSyncJobs(vaultId)` → `SyncJob[]`

### `services/authService.ts`
- Guardar/leer token de `localStorage` o `Plugin.loadData()`
- `isAuthenticated()` → `boolean`
- `startGoogleOAuthFlow()` → abre browser, polling hasta obtener token
- `saveSession(token, user)`
- `clearSession()`

### `services/syncService.ts`
- `pushAll(vault)` → lee todos los archivos del vault local, los envía en batch
- `pushFile(vault, file)` → sube un único archivo modificado
- `pullAndApply(vault)` → descarga metadatos remotos, descarga contenido, escribe archivos locales
- `detectLocalChanges(vault)` → compara hashes locales vs `FileRead[]` del backend

### `services/fileService.ts`
- `handleFileCreate(file)` → `uploadFile`
- `handleFileModify(file)` → `uploadFile` (upsert)
- `handleFileDelete(path)` → `deleteFile`
- `handleFileRename(oldPath, newPath)` → `renameFile`

### `services/conflictService.ts`
- Comparar `content_hash` local vs remoto
- Estrategias: `keep-local`, `keep-remote`, `ask-user`
- Generar nombre de archivo de conflicto (`NombreArchivo.conflicto.md`)

---

## 4. Tareas de implementación

### Fase 1 — Autenticación y sesión

- [ ] Implementar `api/client.ts` con manejo de token y errores
- [ ] Implementar `api/auth.ts` con todos los métodos
- [ ] Implementar `services/authService.ts` (token storage con `Plugin.loadData`)
- [ ] Crear `ui/modals/LoginModal.ts` con formulario email/password
- [ ] Agregar botón "Conectar con Google" en LoginModal con flujo OAuth:
  1. Generar `nonce` aleatorio
  2. Llamar `/auth/google/login-url?nonce=X`
  3. Abrir URL en navegador externo
  4. Iniciar polling a `/auth/google/login-token?nonce=X` cada 2s (timeout 5 min)
  5. Guardar token al obtenerlo
- [ ] Crear `ui/modals/SettingsTab.ts` con: server URL, token actual, botón logout

### Fase 2 — Gestión de vaults

- [ ] Implementar `api/vaults.ts`
- [ ] Crear `ui/views/VaultListView.ts`:
  - Listar vaults del usuario
  - Botón "Nuevo vault" → `VaultCreateModal`
  - Botón "Renombrar" → `PATCH /vaults/{id}`
  - Botón "Eliminar" → confirmación + `DELETE /vaults/{id}`
  - Indicador de `sync_state` por vault
- [ ] Crear `ui/modals/VaultCreateModal.ts`:
  - Campos: nombre, slug (auto-generado), descripción, ruta local
  - Selector de carpeta Drive existente (`GET /drive/vaults`)
- [ ] Botón "Sincronizar vaults desde Drive" → `POST /drive/vaults/sync`

### Fase 3 — Sincronización Push

- [ ] Implementar `api/sync.ts`
- [ ] Implementar `services/syncService.ts` — método `pushAll`:
  1. Leer todos los archivos `.md` del vault local con `app.vault.getFiles()`
  2. Para cada archivo: leer contenido, calcular SHA-256 (`utils/hash.ts`)
  3. Encodar a base64 (`utils/encoding.ts`)
  4. Enviar batch a `POST /vaults/{id}/sync/manual`
- [ ] Agregar comando Obsidian: `obsidianConnect: Push vault`
- [ ] Mostrar progreso en barra de estado (`ui/components/StatusBar.ts`)

### Fase 4 — Sincronización Pull

- [ ] Implementar `services/syncService.ts` — método `pullAndApply`:
  1. `POST /vaults/{id}/sync/pull` → obtener lista de archivos remotos
  2. Para cada archivo remoto: `GET /vaults/{id}/files/content?path=X`
  3. Escribir contenido en el vault local con `app.vault.create/modify`
- [ ] Implementar `services/conflictService.ts`:
  - Detectar conflicto: archivo existe localmente con hash diferente al remoto
  - Por defecto: `ask-user` (mostrar `ConflictModal`)
- [ ] Crear `ui/modals/ConflictModal.ts`:
  - Mostrar diff entre versión local y remota
  - Opciones: "Mantener local", "Usar remoto", "Guardar ambas"
- [ ] Agregar comando Obsidian: `obsidianConnect: Pull vault`

### Fase 5 — Operaciones individuales de archivo

- [ ] Implementar `api/files.ts`
- [ ] Implementar `services/fileService.ts`
- [ ] Registrar event listeners en `main.ts`:
  ```ts
  this.registerEvent(this.app.vault.on('create', (file) => fileService.handleFileCreate(file)));
  this.registerEvent(this.app.vault.on('modify', (file) => fileService.handleFileModify(file)));
  this.registerEvent(this.app.vault.on('delete', (file) => fileService.handleFileDelete(file.path)));
  this.registerEvent(this.app.vault.on('rename', (file, oldPath) => fileService.handleFileRename(oldPath, file.path)));
  ```
- [ ] Opción de configuración: "Sincronización automática al guardar" (on/off)

### Fase 6 — Explorador de archivos remotos

- [ ] Implementar `ui/views/FileBrowserView.ts`:
  - Árbol de archivos de Drive (`GET /vaults/{id}/files/remote-tree`)
  - Click en archivo → descarga y abre en Obsidian
  - Botón "Eliminar archivo" → `DELETE /vaults/{id}/files`
  - Botón "Renombrar" → input inline + `PATCH /vaults/{id}/files`
- [ ] Implementar `ui/components/FileTreeItem.ts` (nodo recursivo)

### Fase 7 — Panel de estado y actividad

- [ ] Implementar `ui/views/SyncStatusView.ts`:
  - Último job de sync (estado, archivos procesados, timestamp)
  - Historial de jobs (`GET /vaults/{id}/sync/jobs`)
  - Botones: "Push", "Pull"
- [ ] Implementar `ui/views/ActivityView.ts`:
  - Feed de operaciones (`GET /activity?vault_id=X&limit=50`)
  - Filtro por tipo de acción
- [ ] `ui/components/StatusBar.ts`:
  - Mostrar estado de sync en barra inferior de Obsidian
  - Spinner durante sync, check al completar, error con mensaje

---

## 5. Flujos completos

### Login con Google (desde el plugin)

```
Plugin                          Backend                     Browser
  │                               │                            │
  │── genera nonce aleatorio ─────▶                           │
  │── GET /auth/google/login-url?nonce=X ──▶                  │
  │◀── {authorization_url} ───────│                           │
  │── abre authorization_url ─────────────────────────────────▶
  │                               │◀── OAuth code ────────────│
  │                               │── POST /auth/google/login │
  │                               │── guarda token en memoria │
  │── polling GET /auth/google/login-token?nonce=X cada 2s ──▶│
  │◀── {access_token, user} cuando listo ─────────────────────│
  │── guarda token en Plugin.loadData() ──────────────────────│
```

### Push sincronización

```
Plugin                                    Backend              Google Drive
  │                                          │                      │
  │── app.vault.getFiles() ─────────────────▶ (local)             │
  │── por cada archivo: leer + SHA-256 ──────▶ (local)            │
  │── POST /vaults/{id}/sync/manual ─────────▶                    │
  │   { items: [{path, base64_content, ...}] }│                    │
  │                                          │── upload_bytes() ──▶│
  │                                          │◀── {id, version} ───│
  │◀── {job_id, status, processed_files} ────│                    │
```

### Pull con conflicto

```
Plugin                                    Backend              Google Drive
  │                                          │                      │
  │── POST /vaults/{id}/sync/pull ───────────▶                    │
  │                                          │── list_files() ────▶│
  │◀── {remote_files: [...]} ────────────────│                    │
  │                                          │                      │
  │── por cada archivo remoto:               │                      │
  │   comparar hash local vs remote_hash     │                      │
  │   si igual: skip                         │                      │
  │   si diferente Y existe local:           │                      │
  │     mostrar ConflictModal                │                      │
  │   si no existe local:                    │                      │
  │── GET /vaults/{id}/files/content?path=X ─▶                    │
  │◀── {content} ────────────────────────────│                    │
  │── app.vault.create/modify ───────────────▶ (local)            │
```

### Sincronización automática al guardar

```
Obsidian vault.on('modify', file)
  │
  ├── ¿sync automático habilitado? → no: salir
  ├── leer contenido del archivo
  ├── calcular SHA-256
  ├── comparar con último hash conocido (cache en memoria)
  ├── si igual: salir (sin cambios reales)
  └── POST /vaults/{id}/files  ← single file upload
        {path, base64_content, content_hash}
```

---

## Notas de implementación

- **Token storage**: usar `Plugin.loadData()` / `Plugin.saveData()` para persistir `{token, user, vault_id, server_url}` entre sesiones.
- **Device name**: enviar el nombre del dispositivo en push sync. Usar `os.hostname()` o un nombre configurable en ajustes.
- **Rate limiting**: para sync automático, usar debounce de 5s para no saturar el backend con cada pulsación de tecla.
- **Offline**: si el backend no responde, encolar operaciones pendientes y reintentar al reconectar.
- **Base64**: los archivos binarios (imágenes, PDFs) deben enviarse siempre como `base64_content`, nunca como `content`.
