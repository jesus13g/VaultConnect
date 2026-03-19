# Plugin de Obsidian

Este plugin conecta la boveda abierta de Obsidian con el backend de
`obsidianConnect`.

## Que hace ahora

- iniciar sesion contra el backend;
- mostrar un selector visual de vaults del backend;
- crear un vault backend a partir de la boveda abierta;
- lanzar la conexion OAuth de Google Drive desde el propio plugin;
- esperar la confirmacion de la conexion del vault;
- subir solo archivos locales que han cambiado desde la ultima sincronizacion;
- descargar solo archivos remotos nuevos o modificados;
- abrir el panel web del backend cuando haga falta.

## Limitaciones actuales

- no hay resolucion avanzada de conflictos;
- el pull remoto puede sobrescribir archivos locales si el remoto ha cambiado;
- no se sincronizan borrados como operacion independiente;
- la cache incremental se basa en cambios de tamano, fecha y metadatos remotos.

## Instalacion recomendada

### Instalador .exe

La forma mas simple en Windows es usar:

- `plugin/dist/obsidianConnect-installer.exe`

Al abrirlo:

- pide la carpeta raiz del vault;
- crea `.obsidian/plugins/obsidian-connect/`;
- copia los archivos necesarios del plugin;
- deja `data.json` creado para que Obsidian lo detecte sin pasos extra;
- habilita `obsidian-connect` en la configuracion del vault;
- crea backup de la configuracion antes de modificarla;
- si `Restricted mode` esta activo, pide confirmacion antes de desactivarlo.

### Instalador para Windows

Desde la carpeta `plugin/` puedes usar:

- `install-obsidian-connect.bat`
- `install-obsidian-connect.ps1`
- `verify-obsidian-connect-install.ps1`

El instalador:

- permite seleccionar la carpeta del vault;
- crea `.obsidian/plugins/obsidian-connect/` si no existe;
- copia `manifest.json`, `main.js`, `versions.json` y `README.md`;
- crea `data.json` vacio para dejar el plugin listo;
- deja el plugin marcado como habilitado automaticamente;
- guarda backup de `app.json` y `community-plugins.json` si existen.

### Uso rapido

1. Ejecuta `plugin/dist/obsidianConnect-installer.exe`.
2. Selecciona la carpeta raiz de tu vault de Obsidian.
3. Abre Obsidian.
4. Si Obsidian estaba abierto, recarga los plugins o reinicia la app.

### Instalacion manual

1. Crea esta carpeta en tu vault:
   `<tu-vault>/.obsidian/plugins/obsidian-connect/`
2. Copia dentro:
   - `manifest.json`
   - `main.js`
   - `versions.json`
3. Reinicia Obsidian o recarga los plugins.
4. Activa `obsidianConnect` en `Community plugins`.

## Verificacion del vault

Puedes diagnosticar una instalacion existente con:

- `plugin/verify-obsidian-connect-install.ps1`

El script comprueba:

- la ruta real del vault;
- la carpeta del plugin y sus archivos requeridos;
- si `community-plugins.json` incluye `obsidian-connect`;
- si `Restricted mode` sigue activo.

## Flujo recomendado

1. Abre los ajustes del plugin.
2. Configura `Backend URL`, `Email` y `Contrasena`.
3. Pulsa `Login`.
4. Pulsa `Crear desde esta boveda` o abre el `Selector visual`.
5. Pulsa `Conectar Google Drive`.
6. Completa el flujo OAuth en el navegador.
7. Usa `Subir cambios` y `Descargar cambios`.

## Comandos disponibles

- `obsidianConnect: iniciar sesion en backend`
- `obsidianConnect: selector visual de vaults`
- `obsidianConnect: crear vault en backend desde la boveda actual`
- `obsidianConnect: conectar Google Drive para el vault actual`
- `obsidianConnect: sincronizacion incremental hacia el backend`
- `obsidianConnect: descargar solo cambios remotos`
