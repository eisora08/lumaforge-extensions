// Steam UI language detection + tiny translation layer.
//
// Steam sets document.documentElement lang from TS.LANGUAGE (library.js:
// `document.documentElement.setAttribute("lang", y[TS.LANGUAGE])` where
// y = { english:"en", spanish:"es", latam:"es-419", ... }). We key the
// dictionary by the English literal so untranslated strings fall through
// unchanged and call sites stay readable: t('Close').

let cached: 'es' | 'en' | null = null;

export function steamLang(): 'es' | 'en' {
  if (cached) return cached;
  var attr = (document.documentElement.getAttribute('lang') || '').toLowerCase();
  if (attr) {
    // Once Steam has resolved the language we never re-read: the attribute
    // is set on config load and does not change mid-session.
    cached = attr.indexOf('es') === 0 ? 'es' : 'en';
    return cached;
  }
  // Injected before config load (or non-root document): fall back to the
  // browser locale, which Steam keeps in sync with the OS/launch locale.
  var nav = ((navigator.language || navigator.language as string) || '').toLowerCase();
  if (nav.indexOf('es') === 0) return 'es';
  return 'en';
}

export function t(en: string): string {
  if (steamLang() !== 'es') return en;
  var es = ES[en];
  return es !== undefined ? es : en;
}

const ES: Record<string, string> = {
  // Sidebar chrome
  Dashboard: 'Panel',
  Providers: 'Proveedores',
  Downloads: 'Descargas',
  Tools: 'Herramientas',
  'Cloud Saves': 'Guardados',
  Fixes: 'Correcciones',
  Settings: 'Ajustes',
  'Refresh current tab': 'Actualizar pesta\u00f1a actual',
  Close: 'Cerrar',

  // Section titles
  'Active Downloads': 'Descargas activas',
  'Third-Party Tools': 'Herramientas de terceros',
  'Applied Fixes': 'Correcciones aplicadas',
  'Steam Account': 'Cuenta de Steam',
  'Key Generator': 'Generador de claves',
  About: 'Acerca de',
  'Keyboard Shortcuts': 'Atajos de teclado',
  'Stats Sync': 'Sincronizaci\u00f3n de estad\u00edsticas',
  'Content Downloaded': 'Contenido descargado',
  Notes: 'Notas',
  'Steam Integration': 'Integraci\u00f3n con Steam',
  Deleted: 'Eliminado',

  // Common buttons / states
  'Save Settings': 'Guardar ajustes',
  'Saving\u2026': 'Guardando\u2026',
  Save: 'Guardar',
  'Save failed': 'Error al guardar',
  'Test All': 'Probar todo',
  'Testing\u2026': 'Probando\u2026',
  Test: 'Probar',
  'Restart Steam': 'Reiniciar Steam',
  'Restarting\u2026': 'Reiniciando\u2026',
  'Restarted!': '\u00a1Reiniciado!',
  Restarted: 'Reiniciado',
  Failed: 'Fall\u00f3',
  Error: 'Error',
  Loading: 'Cargando',
  'Loading providers\u2026': 'Cargando proveedores\u2026',
  'No active downloads': 'No hay descargas activas',
  'Start a download from any game page': 'Inicia una descarga desde la p\u00e1gina de cualquier juego',
  'No tools available': 'No hay herramientas disponibles',
  'No Lua scripts installed': 'No hay scripts Lua instalados',
  'No matches': 'Sin coincidencias',
  'Bridge not available': 'Puente (bridge) no disponible',
  'Make sure the CDP proxy is running': 'Aseg\u00farate de que el proxy CDP est\u00e9 en ejecuci\u00f3n',
  'No provider configured': 'Ning\u00fan proveedor configurado',
  'No synced games yet': 'A\u00fan no hay juegos sincronizados',
  'No key set': 'Sin clave configurada',
  'Unpin All Manifests': 'Desfijar todos los manifiestos',
  'Unpinning\u2026': 'Desfijando\u2026',
  'Deleting\u2026': 'Eliminando\u2026',
  'Confirm?': '\u00bfConfirmar?',
  Delete: 'Eliminar',
  'Delete failed': 'Error al eliminar',
  'Opening\u2026': 'Abriendo\u2026',
  'Failed to open URL': 'No se pudo abrir la URL',
  'Signed out': 'Sesi\u00f3n cerrada',
  'Waiting for browser\u2026': 'Esperando al navegador\u2026',
  'Installing\u2026': 'Instalando\u2026',
  'Failed to load settings': 'Error al cargar los ajustes',
  'Local provider (no API key)': 'Proveedor local (sin clave API)',
  'API key configured': 'Clave API configurada',
  'No API key': 'Sin clave API',
  'Enter API key': 'Introduce la clave API',

  // Game Fixes modal
  'Game Fixes': 'Correcciones de juegos',
  'Fixes back up original files (.bak) and write a fix log':
    'Las correcciones crean copias de seguridad (.bak) de los archivos originales y escriben un registro',
  'Detecting game fixes\u2026': 'Detectando correcciones\u2026',
  'Failed to load fix info': 'Error al cargar la informaci\u00f3n de las correcciones',
  'Failed to load fix status': 'Error al cargar el estado de las correcciones',
  'Failed to start apply': 'Error al iniciar la aplicaci\u00f3n',
  'Install failed': 'Error al instalar',
  'Unfix failed': 'Error al deshacer',
  'Tool install timed out': 'La instalaci\u00f3n de la herramienta agot\u00f3 el tiempo de espera',
  'Network error': 'Error de red',
  'Unknown error': 'Error desconocido',
  'Online-Fix available': 'Online-Fix disponible',
  'Installing': 'Instalando',

  // Provider settings modal
  'Provider Settings': 'Ajustes de proveedores',
  'Configure download providers and API keys':
    'Configura los proveedores de descarga y las claves API',

  // Source modal
  'Select Download Source': 'Selecciona la fuente de descarga',
  'Choose a trusted provider for this package': 'Elige un proveedor de confianza para este paquete',
  'No package sources available.': 'No hay fuentes de paquetes disponibles.',
  'No enabled provider currently has a package for this App ID.':
    'Ning\u00fan proveedor activo tiene actualmente un paquete para este ID de aplicaci\u00f3n.',
  'Unavailable Sources': 'Fuentes no disponibles',
  'Download failed': 'Error al descargar',
  'Download rejected': 'Descarga rechazada',
  'Invalid response from bridge': 'Respuesta no v\u00e1lida del puente',
  'Package available': 'Paquete disponible',
  'Package not available': 'Paquete no disponible',

  // Manage menu (context submenu items)
  'Pin to Current Version': 'Fijar a versi\u00f3n actual',
  'Pin to Latest Version': 'Fijar a \u00faltima versi\u00f3n',
  'Unpin Manifest': 'Desfijar manifiesto',
  'Delete Lua\u2026': 'Eliminar Lua\u2026',
  'Confirm delete?': '\u00bfEliminar Lua?',

  // Dashboard / Lua Scripts
  'Active Providers': 'Proveedores activos',
  'Active Now': 'Activos ahora',
  'Lua Scripts': 'Scripts Lua',
  'Search\u2026': 'Buscar\u2026',
  Show: 'Mostrar',
  Sort: 'Ordenar',
  All: 'Todos',
  Installed: 'Instalado',
  'Not installed': 'No instalado',
  'Name A-Z': 'Nombre A-Z',
  'Name Z-A': 'Nombre Z-A',
  Newest: 'M\u00e1s recientes',
  Oldest: 'M\u00e1s antiguos',
  Pinned: 'Fijado',
  Unpin: 'Desfijar',
  'Unpin manifest': 'Desfijar manifiesto',
  'Manifest pins': 'Fijados de manifiestos',
  'Remove Lua script': 'Eliminar script Lua',

  // Generic buttons / states
  Cancel: 'Cancelar',
  Retry: 'Reintentar',
  Saved: 'Guardado',
  CLOSE: 'CERRAR',
  'RESTART STEAM': 'REINICIAR STEAM',
  'RESTART LATER': 'REINICIAR DESPU\u00c1S',
  'VIEW IN LIBRARY': 'VER EN LA BIBLIOTECA',
  'TOOL NEEDED': 'HERRAMIENTA NECESARIA',
  'Loading\u2026': 'Cargando\u2026',
  Key: 'Clave',

  // Restart-steam prompt
  'Game content has been downloaded and registered in Steam.':
    'El contenido del juego se ha descargado y registrado en Steam.',
  'Steam needs to be restarted to detect the new game.':
    'Steam necesita reiniciarse para detectar el juego nuevo.',
  'Would you like to restart now?': '\u00bfQuieres reiniciar ahora?',

  // Source modal
  Provider: 'Proveedor',
  'Not available': 'No disponible',
  Unavailable: 'No disponible',
  'API Expired': 'Clave API caducada',
  'API Key Expired': 'Clave API caducada',
  'No API Key': 'Sin clave API',
  'API key expired': 'La clave API ha caducado',
  'API key expired or invalid': 'La clave API ha caducado o no es v\u00e1lida',
  'API key expired or invalid \u2014 update it in Providers':
    'La clave API ha caducado o no es v\u00e1lida \u2014 actual\u00edzala en Proveedores',
  'No API key configured': 'Sin clave API configurada',
  'Unknown provider error': 'Error desconocido del proveedor',
  'Could not check package sources.': 'No se pudieron consultar las fuentes de paquetes.',
  'The provider check took too long. Please try again.':
    'La comprobaci\u00f3n del proveedor tard\u00f3 demasiado. Int\u00e9ntalo de nuevo.',
  'Requests unavailable': 'Solicitudes no disponibles',
  'Select Ryuu to download the package': 'Selecciona Ryuu para descargar el paquete',
  'Package Added Successfully': 'Paquete a\u00f1adido correctamente',
  'The package has been downloaded and installed to your Steam library.':
    'El paquete se ha descargado e instalado en tu biblioteca de Steam.',
  'Download Failed': 'Error al descargar',
  'Download Failed to Start': 'No se pudo iniciar la descarga',
  'Packages are installed through LumaForge':
    'Los paquetes se instalan a trav\u00e9s de LumaForge',

  // Provider settings modal
  'Loading settings\u2026': 'Cargando ajustes\u2026',
  'Local provider \u2014 no URL and no API key required':
    'Proveedor local \u2014 no requiere URL ni clave API',
  'Local provider \u2014 no URL and no API key required (lua generation + manifest fetch)':
    'Proveedor local \u2014 no requiere URL ni clave API (generaci\u00f3n de Lua y obtenci\u00f3n de manifiestos)',

  // Game Fixes modal
  'Failed to Load Fixes': 'No se pudieron cargar las correcciones',
  'Game Not Installed': 'Juego no instalado',
  'Install the game to apply fixes.': 'Instala el juego para aplicar las correcciones.',
  'No fixes available for this game.': 'No hay correcciones disponibles para este juego.',
  'Install tool': 'Instalar herramienta',
  Unfix: 'Deshacer',
  Apply: 'Aplicar',

  // Depot download modal
  'Download Content': 'Descargar contenido',
  'Select depots to download game content':
    'Selecciona los depots para descargar el contenido del juego',
  'Resolving depots\u2026': 'Resolviendo depots\u2026',
  'Content is downloaded through DepotDownloaderMod':
    'El contenido se descarga mediante DepotDownloaderMod',
  'Select All': 'Seleccionar todo',
  'Base Game': 'Juego base',
  Shared: 'Compartidos',
  'Download Location': 'Ubicaci\u00f3n de descarga',
  'DepotDownloaderMod Not Installed': 'DepotDownloaderMod no est\u00e1 instalado',
  'No Depot Keys Found': 'No se encontraron claves de depot',
  'Failed to Resolve Depots': 'No se pudieron resolver los depots',

  // Store page button / badges
  'Game fixes for app': 'Correcciones de juegos para la app',
  'Apply SmokeAPI, Steamless, Goldberg or Online-Fix':
    'Aplicar SmokeAPI, Steamless, Goldberg u Online-Fix',
  'Add app': 'A\u00f1adir app',
  'via LumaForge': 'v\u00eda LumaForge',
  'Select a download source for app': 'Seleccionar una fuente de descarga para la app',
  FIXES: 'CORRECCIONES',
  'BRIDGE ERROR': 'ERROR DE PUENTE',
  'ADD VIA LUMAFORGE': 'A\u00d1ADIR VIA LUMAFORGE',
  'ADDED TO LUMAFORGE': 'A\u00d1ADIDO EN LUMAFORGE',
  'ADDING\u2026': 'A\u00d1ADIENDO\u2026',
  'CHECKING\u2026': 'COMPROBANDO\u2026',
  'TRY AGAIN': 'REINTENTAR',
  'START DOWNLOAD': 'INICIAR DESCARGA',
  'DOWNLOAD CONTENT': 'DESCARGAR CONTENIDO',
  'CONTINUE BROWSING': 'SEGUIR NAVEGANDO',

  // Source modal badges / tooltips
  Ready: 'Listo',
  Available: 'Disponible',
  Download: 'Descargar',
  Queued: 'En cola',
  APPLIED: 'APLICADO',
  COMPLETED: 'COMPLETADO',
  FAILED: 'FALLIDO',
  PAUSED: 'PAUSADO',
  CANCELLED: 'CANCELADO',
  Expired: 'Caducada',
  'FAILED \u2014 RETRY': 'FALLIDO \u2014 REINTENTAR',
  'Generating\u2026': 'Generando\u2026',
  'Downloading\u2026': 'Descargando\u2026',
  'Key expires in': 'La clave caduca en',
  'downloads left': 'descargas restantes',
  'remaining today': 'restantes hoy',
  remaining: 'restantes',
  'API key': 'Clave API',

  // Depot modal
  'No manifest': 'Sin manifiesto',
  'No key': 'Sin clave',

  // Fixes modal rows
  'No fixes applied yet': 'A\u00fan no hay correcciones aplicadas',
  'Scanning fix logs\u2026': 'Analizando registros de correcciones\u2026',
  'Unfixing\u2026': 'Deshaciendo\u2026',
  'Fixes are tracked per game in <code style="background:rgba(255,255,255,.06);padding:1px 4px;border-radius:3px;">lumaforge-fix-log-&lt;appid&gt;.log</code>.':
    'Las correcciones se registran por juego en <code style="background:rgba(255,255,255,.06);padding:1px 4px;border-radius:3px;">lumaforge-fix-log-&lt;appid&gt;.log</code>.',
  'Unfix removes the pasted files and restores any <code style="background:rgba(255,255,255,.06);padding:1px 4px;border-radius:3px;">.bak</code> backups.':
    'Unfix elimina los archivos pegados y restaura las copias de seguridad <code style="background:rgba(255,255,255,.06);padding:1px 4px;border-radius:3px;">.bak</code>.',
  'SmokeAPI is a tool for Steamworks DLC ownership emulation in games that are legitimately owned in Steam':
    'SmokeAPI es una herramienta para la emulaci\u00f3n de propiedad de DLC de Steamworks en juegos leg\u00edtimamente adquiridos en Steam',
  'Removes SteamStub DRM from the game executable. The backend verifies SteamStub on apply and reports if unpacking is not needed.':
    'Elimina la protecci\u00f3n SteamStub DRM del ejecutable del juego. Al aplicarla, el backend verifica SteamStub e informa si no es necesario desempaquetar.',
  'Steam emulator (fork): steam_api wrapper, achievements and LAN support.':
    'Emulador de Steam (fork): wrapper de steam_api, logros y soporte de LAN.',
  'Online-Fix.net crack for multiplayer/online games (requires a RAR extractor).':
    'Crack de Online-Fix.net para juegos multijugador/en l\u00ednea (requiere un extractor de RAR).',

  // Fix descriptions / fixed labels
  Catalog: 'Cat\u00e1logo',
  'Catalog fix': 'Correcci\u00f3n de cat\u00e1logo',

  // Downloads tab / history
  History: 'Historial',
  'Clear History': 'Borrar historial',
  Clear: 'Borrar',
  Remove: 'Eliminar',
  Resume: 'Reanudar',
  Pause: 'Pausar',
  ACTIVE: 'ACTIVO',
  Speed: 'Velocidad',
  Peak: 'M\u00e1x',
  'App ID': 'ID de app',
  game: 'juego',
  games: 'juegos',
  file: 'archivo',
  files: 'archivos',
  Account: 'Cuenta',

  // Tools tab
  'Loading tools\u2026': 'Cargando herramientas\u2026',
  Install: 'Instalar',
  Update: 'Actualizar',
  Uninstall: 'Desinstalar',
  saved: 'guardado',
  'SteamStub DRM unpacker for game executables': 'Desempaqueta la protecci\u00f3n SteamStub DRM de los ejecutables de juegos',
  'Goldberg Steam Emu fork by Detanup01 + config tools':
    'Fork de Goldberg Steam Emu de Detanup01 + herramientas de configuraci\u00f3n',
  'Open-source Steam unlocker with Lua scripting':
    'Desbloqueador de Steam de c\u00f3digo abierto con scripting Lua',
  'Anonymous Steam depot downloader \u2014 downloads game files directly from Steam':
    'Descargador an\u00f3nimo de depots de Steam \u2014 descarga los archivos del juego directamente de Steam',
  'Redirect Steam Cloud saves to Google Drive, OneDrive, S3, R2, or local folder':
    'Redirige los guardados de Steam Cloud a Google Drive, OneDrive, S3, R2 o una carpeta local',
  'Steam client modification for Linux \u2014 enables playing unowned games via LD_AUDIT':
    'Modificaci\u00f3n del cliente de Steam para Linux \u2014 permite jugar juegos no adquiridos mediante LD_AUDIT',

  // Settings tab
  'Steam Web API Key': 'Clave API de Steam Web',
  '(Goldberg achievements)': '(logros de Goldberg)',
  '(Voices38 / catalog fixes)': '(correcciones Voices38 / cat\u00e1logo)',
  '(Account ID)': '(ID de cuenta)',
  'Enter your Steam Web API key': 'Introduce tu clave API de Steam Web',
  'Get API key': 'Obtener clave API',
  'Detect Steam account': 'Detectar cuenta de Steam',
  'Detect failed': 'Error al detectar',
  'No accounts found in loginusers.vdf': 'No se encontraron cuentas en loginusers.vdf',
  'Scanning loginusers.vdf\u2026': 'Analizando loginusers.vdf\u2026',
  'Opening steamcommunity.com\u2026': 'Abriendo steamcommunity.com\u2026',
  Hide: 'Ocultar',
  Version: 'Versi\u00f3n',
  'Close sidebar': 'Cerrar barra lateral',
  'Manifest pinning for generated Lua scripts':
    'Fijado de manifiestos para los scripts Lua generados',

  // Cloud Saves tab
  Cloud: 'Nube',
  'Cloud Redirect is not installed': 'Cloud Redirect no est\u00e1 instalado',
  'Cloud save sync runs inside Steam through the Cloud Redirect DLL. Install it to back up your saves to the cloud.':
    'La sincronizaci\u00f3n de guardados en la nube funciona dentro de Steam mediante la DLL Cloud Redirect. Inst\u00e1lala para respaldar tus guardados en la nube.',
  'Install Cloud Redirect': 'Instalar Cloud Redirect',
  'Sign out': 'Cerrar sesi\u00f3n',
  'Storage provider': 'Proveedor de almacenamiento',
  'Local Folder': 'Carpeta local',
  'Local folder': 'Carpeta local',
  'Sign in with Google': 'Iniciar sesi\u00f3n con Google',
  'Sign in with Microsoft': 'Iniciar sesi\u00f3n con Microsoft',
  Use: 'Usar',
  'not signed in': 'sin iniciar sesi\u00f3n',
  'Save R2': 'Guardar R2',
  'Save S3': 'Guardar S3',
  'Save Folder': 'Guardar carpeta',
  'Folder path': 'Ruta de la carpeta',
  'Saved \u2014 leave blank to keep': 'Guardado \u2014 deja en blanco para conservarlo',
  'Key Prefix (optional)': 'Prefijo de clave (opcional)',
  'Endpoint (optional)': 'Endpoint (opcional)',
  Achievements: 'Logros',
  'Sync achievement progress with the cloud': 'Sincronizar el progreso de logros con la nube',
  Playtime: 'Tiempo de juego',
  'Sync playtime counters with the cloud':
    'Sincronizar los contadores de tiempo de juego con la nube',
  'Changes apply after restarting Steam.': 'Los cambios se aplican tras reiniciar Steam.',
  'Synced Games': 'Juegos sincronizados',
  'Sign-in could not be started': 'No se pudo iniciar el inicio de sesi\u00f3n',
  'Complete the sign-in in your browser\u2026': 'Completa el inicio de sesi\u00f3n en tu navegador\u2026',
  'Provider activated': 'Proveedor activado',
  'Could not activate provider': 'No se pudo activar el proveedor',
  'Could not save stats setting': 'No se pudo guardar el ajuste de estad\u00edsticas',
  'Sign-out failed': 'Error al cerrar la sesi\u00f3n',
  'Saved \u2014 restart Steam to apply': 'Guardado \u2014 reinicia Steam para aplicar',
  'Delete request failed': 'La solicitud de eliminaci\u00f3n fall\u00f3',
  'Auto-fetch manifests after generating': 'Obtener manifiestos autom\u00e1ticamente tras generar',
  'Account ID': 'ID de cuenta',
  'Access Key ID': 'ID de clave de acceso',
  'Secret Access Key': 'Clave secreta de acceso',
  Region: 'Regi\u00f3n',
};
