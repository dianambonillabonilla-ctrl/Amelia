# Dilana OS

Sistema de control de inventario, recetas y conciliación para **Amelia Café / La Wafflería**
(sedes San Antonio, Capri y Centro de Producción).

## Arquitectura

- **Backend**: Google Apps Script (`apps-script/`), vinculado a un Google Sheet que actúa como
  base de datos. Se despliega como Web App y expone un único endpoint (`/exec`) que recibe
  `action` + `token` + parámetros en cada solicitud (`doGet`/`doPost` en `Code.gs`).
- **Frontend**: páginas HTML estáticas (raíz del repo) + `assets/config.js` (llamadas al backend,
  sesión en `localStorage`, helpers compartidos). Se pueden servir desde cualquier hosting estático
  (ej. GitHub Pages); no dependen de Apps Script salvo para las llamadas `fetch()` a `/exec`.
- **Autenticación**: propia (usuario/contraseña + token de sesión), no usa el login de Google —
  por eso el despliegue es `ANYONE_ANONYMOUS` / `USER_DEPLOYING` (ver `apps-script/appsscript.json`):
  cualquiera puede llamar al script, pero toda acción salvo `login`/`logout` exige un token de
  sesión válido y, según el caso, un rol específico (`requiereAdmin_`/`requiereRol_` en `Code.gs`).

## Hojas requeridas

`configurarHojas()` (en `Code.gs`) las crea/actualiza automáticamente: `Usuarios`,
`Catalogo_Maestro`, `Recetas`, `Conteos_Manuales`, `Movimientos_FUDO`, `Ventas_FUDO`, `Sesiones`,
`Producciones`, `AlertasEnviadas`, `Traslados`.

## Puesta en marcha (instalación nueva)

1. Crea un Google Sheet nuevo y, desde el editor de Apps Script vinculado a esa hoja, pega el
   contenido de `apps-script/*.gs` y `apps-script/appsscript.json` (o usa `clasp`, ver abajo).
2. Corre `configurarHojas()` una vez desde el editor. Crea las hojas y columnas necesarias.
3. Corre `crearAdministradorInicial_(nombre, usuario, password, email)` una vez, con una
   contraseña propia de al menos 10 caracteres. Nunca se crea una credencial por defecto.
4. Corre `configurarTriggers()` una vez, para activar la tarea diaria (limpieza de sesiones
   vencidas y alertas de stock bajo).
5. Implementar > Nueva implementación > Aplicación web (acceso "Cualquier usuario", ejecutar
   "como yo"). Copia la URL `/exec` resultante.
6. Pega esa URL en `API_URL` (`assets/config.js`) y despliega los `.html`/`assets/` en tu hosting
   estático de preferencia.

Para actualizar un script ya desplegado, después de subir cambios corre de nuevo
`configurarHojas()` (agrega columnas nuevas sin tocar datos existentes) y crea una nueva
implementación web si cambiaste `doGet`/`doPost`.

## Desarrollo local con clasp

```bash
cp apps-script/.clasp.json.example apps-script/.clasp.json   # y pon tu scriptId real
npm run clasp:login   # una vez, autentica con tu cuenta de Google
npm run clasp:pull    # trae el estado actual del script
npm run clasp:push    # sube tus cambios locales
npm run clasp:open    # abre el editor de Apps Script en el navegador
npm run clasp:deploy  # crea una nueva implementación
```

`apps-script/.clasp.json` está en `.gitignore` (contiene tu `scriptId`, específico de cada
instalación) — nunca se commitea.

## Roles

| Rol            | Puede |
|----------------|-------|
| Administrador  | Todo: gestionar usuarios, catálogo, recetas, importar de FUDO, diagnóstico. |
| Encargado      | Registrar conteos/producción/traslados, ver Disponible Hoy y Conciliación, resolver observaciones de traslados. |
| Cocina         | Registrar conteos/producción/traslados. |
| Lectura        | Solo consulta (dashboards), no puede registrar nada. |

La sede del usuario (`Ambas` o una sede específica) limita para qué sede puede registrar
conteos/producción; los traslados entre sedes son la excepción (ver comentarios en
`apps-script/Traslados.gs`).

## Tests

```bash
npm test
```

Corre dos suites sin dependencias externas (`tests/recipe-engine.test.js` valida la lógica de
explosión de recetas/disponibilidad; `tests/syntax.test.js` verifica que todo `.gs` y cada
`<script>` inline de los `.html` sea JS válido).

## Notas de seguridad

- Las contraseñas se guardan con salt + SHA-256 iterado (`HASH_ITERACIONES` en `Code.gs`); Apps
  Script no ofrece bcrypt/scrypt/argon2, así que el número de iteraciones está acotado por el
  overhead de cada llamada nativa de `Utilities`.
- `login_` bloquea temporalmente los intentos tras varios fallos consecutivos para un mismo
  usuario (`LOGIN_INTENTOS_MAXIMOS`/`LOGIN_BLOQUEO_SEGUNDOS` en `Code.gs`).
- Todas las acciones que modifican datos exigen rol vía `requiereAdmin_`/`requiereRol_` en el
  propio backend (no solo en la UI) — el frontend además oculta/bloquea las opciones que un rol no
  puede usar (`data-solo-rol` + `ocultarNavSegunRol_`/`requerirRol_` en `assets/config.js`), pero
  esa capa es solo de UX: la autorización real vive en `Code.gs` y en cada función `*_`.
