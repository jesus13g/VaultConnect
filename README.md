# obsidianConnect — Plugin

> Sincronización incremental de tu vault de Obsidian con Google Drive, gestionada desde dentro del propio editor.

![Obsidian](https://img.shields.io/badge/Obsidian-Plugin-7C3AED?logo=obsidian&logoColor=white)
![JavaScript](https://img.shields.io/badge/JavaScript-ES2020-F7DF1E?logo=javascript&logoColor=black)
![Platform](https://img.shields.io/badge/Platform-Windows%20%7C%20macOS%20%7C%20Linux-blue)

---

## ¿Qué hace?

El plugin actúa como cliente ligero que conecta Obsidian con el backend de obsidianConnect. Toda la lógica de almacenamiento y sincronización reside en el servidor; el plugin se encarga de detectar cambios locales, empujarlos y traer los remotos, sin salir del editor.

---

## Funcionalidades principales

### Sincronización incremental inteligente
El plugin no sube ni descarga tu vault completo cada vez. Compara tamaño de archivo, fecha de modificación y metadatos remotos para transferir únicamente lo que ha cambiado. En vaults grandes, esto reduce el tiempo de sync a segundos.

- **Push** — detecta archivos nuevos o modificados localmente y los envía al backend en lotes configurables (por defecto 50 archivos por lote).
- **Pull** — obtiene solo los archivos remotos que el dispositivo actual no tiene o que han cambiado desde la última sincronización.

### Sincronización por dispositivo
Cada instancia del plugin registra su propio dispositivo. El backend lleva un seguimiento de qué dispositivo sincronizó por última vez cada archivo, lo que permite que múltiples máquinas trabajen sobre el mismo vault sin pisarse.

### Selector visual de vaults
Un modal dentro de Obsidian lista todos los vaults registrados en el backend. Desde ahí se puede seleccionar, crear o cambiar de vault sin abrir el navegador.

### Conexión OAuth con Google Drive desde el editor
El flujo de autorización de Google Drive se inicia directamente desde el panel de ajustes del plugin. Abre el navegador, completa el OAuth y vuelve; el plugin sondea el backend hasta confirmar que la conexión está activa (ventana de 120 segundos).

### Creación de vault desde la bóveda abierta
Registra la bóveda activa de Obsidian como un vault nuevo en el backend con un solo clic, sin tener que abrir el panel web.

### Panel web integrado
Botón de acceso directo al panel web del backend para gestión avanzada: historial de sincronizaciones, explorador de archivos remotos, búsqueda de contenido y logs de actividad.

---

## Puntos fuertes

| Característica | Detalle |
|---|---|
| **Sin dependencias de framework** | Plugin puro en JavaScript sobre la API de Obsidian — ligero y sin overhead |
| **Transferencias mínimas** | Algoritmo de detección de cambios evita re-subir archivos sin modificar |
| **Multi-dispositivo** | Seguimiento por dispositivo para convivencia de varias máquinas |
| **Autenticación segura** | Bearer token con sesión gestionada por el backend |
| **Rutas excluidas automáticamente** | `.obsidian/`, `.trash/` y `.git/` quedan fuera del sync por defecto |
| **Flujo OAuth embebido** | La autorización de Drive no saca al usuario del flujo de trabajo |

---

## Comandos disponibles

Los comandos se pueden invocar desde la paleta de comandos de Obsidian (`Ctrl/Cmd + P`):

| Comando | Acción |
|---|---|
| `obsidianConnect: iniciar sesión en backend` | Autenticarse con email y contraseña |
| `obsidianConnect: selector visual de vaults` | Abrir el modal de selección de vault |
| `obsidianConnect: crear vault en backend desde la bóveda actual` | Registrar la bóveda abierta como vault nuevo |
| `obsidianConnect: conectar Google Drive para el vault actual` | Iniciar el flujo OAuth de Drive |
| `obsidianConnect: sincronización incremental hacia el backend` | Push de cambios locales |
| `obsidianConnect: descargar solo cambios remotos` | Pull de cambios remotos |

---

## Arquitectura

```
Obsidian (local)
    │
    ├── Detecta cambios (tamaño / fecha / metadatos)
    ├── Agrupa en lotes de N archivos
    │
    ▼
Plugin (HTTP REST + Bearer Token)
    │
    ▼
obsidianConnect Backend  ──►  Google Drive
```

El plugin es stateless entre sesiones excepto por el snapshot de metadatos que mantiene localmente para el cálculo incremental.

---

## Tecnologías

- **Obsidian Plugin API** — acceso al sistema de archivos y UI nativa del editor
- **Fetch API** — comunicación HTTP con el backend
- **JavaScript ES2020** — sin transpilación, ejecuta directo en el entorno de Obsidian
