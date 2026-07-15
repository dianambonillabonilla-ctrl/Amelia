# Dilana OS

Dilana OS es una aplicación interna para Amelia Café / La Wafflería que ayuda a controlar inventario, recetas, producción, conteos, traslados, conciliación con FUDO, disponibilidad y usuarios.

## Arquitectura

- **Frontend estático:** archivos HTML en la raíz del repositorio, con estilos y utilidades compartidas en `assets/`.
- **Backend:** Google Apps Script en `apps-script/`, desplegado como Web App.
- **Base de datos:** un Google Sheet vinculado al Apps Script.
- **Integración FUDO:** importación de archivos/exportaciones FUDO hacia hojas del spreadsheet.

El frontend llama al despliegue `/exec` de Apps Script mediante `fetch()` y envía un `token` de sesión en cada solicitud autenticada.

## Requisitos

- Node.js y npm para correr pruebas locales.
- Cuenta Google con acceso al spreadsheet de operación.
- [`clasp`](https://github.com/google/clasp) para sincronizar el proyecto Apps Script. El repo ya lo declara como dependencia de desarrollo.

## Instalación local

```bash
npm install
npm test
```

## Configuración de Apps Script

1. Copia el ejemplo de configuración de clasp:

   ```bash
   cp apps-script/.clasp.json.example apps-script/.clasp.json
   ```

2. Reemplaza `PEGA_AQUI_TU_SCRIPT_ID` por el ID real del proyecto Apps Script.
3. Autentícate con Google si todavía no lo hiciste:

   ```bash
   npm run clasp:login
   ```

4. Sube los cambios del backend cuando corresponda:

   ```bash
   npm run clasp:push
   ```

5. En Apps Script, despliega como **Aplicación web** y copia la URL que termina en `/exec`.

## Configuración del frontend

La URL del backend se configura en `assets/config.js`:

```js
const API_URL = 'https://script.google.com/macros/s/TU_DEPLOYMENT_ID/exec';
```

Recomendaciones:

- Mantén una URL de Apps Script por ambiente si usas pruebas y producción.
- No pegues tokens, contraseñas ni credenciales en archivos del frontend.
- Si necesitas preparar un nuevo ambiente, usa `assets/config.example.js` como plantilla.

## Primera configuración del spreadsheet

Después de vincular Apps Script al Google Sheet, ejecuta manualmente desde el editor:

1. `configurarHojas()` para crear o actualizar las hojas esperadas.
2. `crearAdministradorInicial_(nombre, usuario, password, email)` para crear el primer administrador.
3. `configurarTriggers()` para activar limpieza de sesiones y alertas programadas.

No se crea una contraseña predeterminada por seguridad.

## Hojas principales

El backend crea o actualiza estas hojas:

- `Usuarios`
- `Catalogo_Maestro`
- `Recetas`
- `Conteos_Manuales`
- `Movimientos_FUDO`
- `Ventas_FUDO`
- `Sesiones`
- `Producciones`
- `AlertasEnviadas`
- `Traslados`

## Desarrollo

Comandos útiles:

```bash
npm test
npm run clasp:status
npm run clasp:pull
npm run clasp:push
npm run clasp:open
npm run clasp:deploy
```

## Seguridad y buenas prácticas

- Los datos del backend que se insertan con `innerHTML` deben pasar por `escapeHtml()`.
- No agregues credenciales reales al repositorio.
- `apps-script/.clasp.json` está ignorado porque contiene el `scriptId` real.
- Revisa manualmente los cambios antes de desplegar a producción con `clasp`.

## Pruebas

El comando principal es:

```bash
npm test
```

Actualmente ejecuta:

- `tests/recipe-engine.test.js`
- `tests/syntax.test.js`
