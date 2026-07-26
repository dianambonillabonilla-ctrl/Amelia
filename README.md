# Dilana OS

Dilana OS es una aplicación interna para Amelia Café / La Wafflería que ayuda a controlar inventario, recetas, producción, conteos, traslados, conciliación con FUDO, disponibilidad y usuarios.

## Arquitectura

- **Frontend estático:** archivos HTML en la raíz del repositorio, con estilos y utilidades compartidas en `assets/`.
- **Backend:** Google Apps Script en `apps-script/`, desplegado como Web App.
- **Base de datos:** un Google Sheet vinculado al Apps Script.
- **Integración FUDO:** sincronización automática de ventas y pagos vía la API real de FUDO
  (`apps-script/FudoApi.gs`, cada 15 min una vez configuradas las credenciales — ver abajo), más
  importación manual de archivos/exportaciones FUDO como respaldo.

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
3. `configurarTriggers()` para activar limpieza de sesiones, alertas programadas y, si ya corriste
   `fudoApiConfigurarCredenciales_(apiKey, apiSecret)`, la sincronización automática de ventas/pagos
   de FUDO cada 15 minutos (`fudoSincronizacionAutomatica_`) y el snapshot diario de stock. Sin
   credenciales de FUDO configuradas todavía, estos triggers no hacen nada — no falla, solo esperan.
   Vuelve a correr `configurarTriggers()` una vez si actualizas una instalación que ya existía, para
   que el trigger de sincronización automática quede activo.

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
- `Ajustes_Inventario`
- `Turnos_Sector`
- `Cierres_Turno`
- `Fudo_Mapeo_Sedes`

`MovimientosInventario.gs` no crea hojas nuevas: lee `Ajustes_Inventario`, `Producciones`,
`Traslados` y `Conteos_Manuales` (ya existentes) y las normaliza a un único formato de movimiento
con signo (ver `docs/modelo-inventario.md`). Los puntos de conteo/traslado por sede viven en
`PUNTOS_POR_SEDE` (`assets/config.js`), no en una hoja aparte.

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

## Cuando algo no funciona: `verificarInstalacion()`

Antes de investigar datos, revisa la instalación. Hay dos formas de correr el mismo autodiagnóstico
(no modifica nada, solo lee):

- **Desde la app:** Diagnóstico → *Estado de la instalación* → **Revisar instalación**.
- **Desde el editor de Apps Script:** elige `verificarInstalacion` en la lista de funciones, Ejecutar,
  y mira *Registro de ejecución*. Sirve incluso si la app web no carga.

Informa: si el `Code.gs` desplegado está al día con el resto de los archivos, si existe cada hoja que
el código espera, cuántas filas tiene cada una, **cuánto tarda de verdad "Disponible Hoy" en cada
sede** (Apps Script corta a los 6 minutos) y el estado de la sincronización con FUDO.

Los dos síntomas más comunes y qué significan:

| Lo que ves | Qué pasa realmente | Qué hacer |
| --- | --- | --- |
| `No existe la hoja "undefined"` | Un módulo usa una constante de `SHEET_NAMES` que el `Code.gs` desplegado no declara. No falta ninguna hoja llamada "undefined". | `npm run clasp:push` de **todo** el proyecto y volver a desplegar la Web App. |
| `No existe la hoja "Nombre_Real"` | Esa hoja no está creada en el Sheet. | `configurarHojas()` desde el editor. |

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

Corre entero sin red y sin Google: cada prueba carga los `.gs` de verdad y les inyecta
`SpreadsheetApp`, `PropertiesService`, etc. simulados. La lista completa está en el script `test` de
`package.json`; hay tres grupos:

- **Por módulo** (la mayoría): cargan uno o dos `.gs` con datos de ejemplo y comprueban una regla de
  negocio concreta (recetas, conteos, traslados, conciliación FUDO, auditoría, seguridad…).
- **`tests/integracion-api.test.js`**: carga TODOS los `.gs` en un mismo espacio global, como los une
  Apps Script, sobre un Google Sheet simulado en memoria. Ejerce `configurarHojas()` (instalación
  nueva y actualización de un Sheet viejo con columnas de antes), el login por `doPost` y las ~53
  acciones de lectura del router. Detecta lo que las pruebas por módulo no pueden ver: una hoja o una
  constante de `SHEET_NAMES` que un módulo usa y `Code.gs` no declara — la causa real del error
  `No existe la hoja "undefined"`.
- **`tests/flujo-escritura.test.js`**: recorre un día entero de operación por `doPost`, como lo haría
  la app — crear productos y recetas, contar, comprar, producir, trasladar y recibir, registrar una
  merma, abrir y resolver una gestión, cerrar turno — y comprueba que "Disponible Hoy" refleje todo
  lo registrado. Es la contraparte necesaria de las otras dos: `integracion-api` solo lee, y la
  prueba contra el despliegue real tampoco escribe a propósito, así que sin esto la mitad que más
  usa el personal quedaría sin cubrir. Incluye idempotencia (doble clic no duplica), permisos por
  sede y por rol, validaciones y neutralización de fórmulas.
- **`tests/rendimiento-lecturas.test.js`**: fija un presupuesto de llamadas al Sheet por cálculo.
  Cada `leerTabla_` es una llamada a la API de Sheets y Apps Script corta cualquier ejecución a los 6
  minutos, así que un cálculo que pide el Sheet una vez por día de calendario deja la pantalla sin
  poder abrir aunque el resultado sea correcto. Si tocas `DisponibleHoy.gs`, `MovimientosInventario.gs`
  o `FudoLectores.gs`, esta prueba es la que avisa.

### Probar contra el despliegue real: `npm run test:api`

`npm test` corre offline sobre un Sheet simulado, así que nunca puede decir si el despliegue de
Google está bien ni si una pantalla aguanta el volumen real de datos. Para eso hay una prueba aparte
que sí usa red y habla con la Web App publicada (toma la URL de `assets/config.js`, o de `API_URL`
si se pasa por entorno). Solo llama acciones de **lectura** — una lista blanca explícita — así que se
puede correr contra producción sin riesgo.

```bash
npm run test:api                                             # nivel 1
DILANA_USUARIO=usuario DILANA_PASSWORD=clave npm run test:api  # niveles 1, 2 y 3
```

- **Nivel 1 (sin credenciales)** — el despliegue está vivo y respeta el contrato: `GET` rechazado
  (para que nunca viajen credenciales en la URL), `login` procesado, cuerpo mal formado manejado, y
  ninguna lectura permitida sin token. Si esto falla, el problema es el despliegue, no los datos.
- **Nivel 2 (con usuario y contraseña)** — inicia sesión y recorre las ~49 acciones de lectura contra
  los datos reales, midiendo cuánto tarda cada una. Avisa por encima de 10 s y falla por encima de
  30 s, porque Apps Script corta la ejecución a los 6 minutos. Incluye el informe de
  `verificarInstalacion()` con el tiempo de "Disponible Hoy" medido dentro de Apps Script, sin el
  ida y vuelta de red.
- **Nivel 3** — estado real de FUDO: credenciales, antigüedad de la última sincronización de
  ventas/pagos/stock, ventas sin sede identificada y productos de FUDO que no están en el catálogo.

Conviene crear un usuario dedicado con rol **Lectura** en vez de usar un Administrador. Las acciones
que exigen Administrador se reportan como "sin permiso (esperado)", no como fallo.

### Rendimiento: por qué se cuentan las lecturas

En Apps Script el coste dominante no es el cálculo, son las llamadas a Sheets. Dos reglas que
conviene respetar al agregar código:

- No recorras un rango de fechas día por día pidiendo tablas dentro del bucle. Usa
  `fudoFechasConVentas_` / `fechasConVentasParaRango_` (`FudoLectores.gs`,
  `MovimientosInventario.gs`), que leen una vez y devuelven solo los días con datos.
- Si un cálculo de **solo lectura** consulta varias veces las mismas hojas, envuélvelo en
  `conCacheDeTablas_` (`Code.gs`). No lo uses en funciones que escriben: varias actualizan una celda
  y releen la hoja enseguida para devolver la fila ya actualizada (ej. `trasladoConfirmar_`).
