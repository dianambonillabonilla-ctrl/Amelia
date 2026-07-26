/**
 * ENTORNO SIMULADO DE APPS SCRIPT (compartido por las pruebas de integración)
 *
 * Carga TODOS los .gs en un mismo espacio global, como los une Apps Script de verdad, contra un
 * Google Sheet en memoria. Cuenta cada lectura al Sheet, porque en Apps Script cada `getValues()` es
 * una llamada a la API de Sheets y el límite de ejecución son 6 minutos: el número de lecturas es la
 * métrica que de verdad decide si una pantalla puede abrir.
 *
 * Devuelve, además del contexto:
 *   post(cuerpo)      — llama doPost como lo haría el frontend, y devuelve el JSON ya parseado.
 *   evaluar(expr)     — evalúa una expresión dentro del contexto. Necesario para leer los `const` de
 *                       nivel superior (ej. SHEET_NAMES), que viven en el ámbito léxico global y no
 *                       como propiedad del objeto de contexto.
 *   hoja(nombre)      — la hoja simulada, para inspeccionarla o prepararla a mano.
 *   agregar(hoja,objs)— inserta filas mapeando por nombre de columna.
 *   stats             — { lecturas, porHoja }.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

function crearEntorno() {
  const stats = { lecturas: 0, porHoja: {} };
  const hojas = [];

  /**
   * Reloj controlable: `avanzarReloj(ms)` mueve hacia adelante lo que ve `new Date()` dentro del
   * código cargado. Necesario porque varias reglas comparan la HORA de dos hechos del mismo día —
   * por ejemplo, una compra solo suma al inventario si ocurrió después del último conteo físico
   * (eventoCubiertoPorConteo_ en DisponibleHoy.gs). Una prueba que registra conteo y compra seguidos
   * los deja en el mismo milisegundo, y entonces el resultado depende de la suerte. Con esto el orden
   * de los hechos es explícito.
   */
  let desplazamientoReloj = 0;
  const DateReal = Date;
  class FechaControlada extends DateReal {
    constructor(...args) {
      if (args.length === 0) super(DateReal.now() + desplazamientoReloj);
      else super(...args);
    }
    static now() { return DateReal.now() + desplazamientoReloj; }
  }
  function avanzarReloj(ms) { desplazamientoReloj += Number(ms) || 0; }
  /**
   * Fija la hora que verá el código a un instante concreto. Conviene usarlo en cualquier prueba con
   * fechas escritas a mano: si el código guarda `new Date()` y la prueba compara contra un
   * '2026-07-26' fijo, correr la prueba a las 11 de la noche (o sumarle horas con avanzarReloj) mueve
   * el día y el resultado cambia según cuándo se ejecute.
   */
  function fijarReloj(instante) {
    desplazamientoReloj = new DateReal(instante).getTime() - DateReal.now();
  }

  /**
   * Google Sheets trata una comilla simple al inicio de un texto como marca de "guardar esto como
   * texto, no lo evalúes": no forma parte del valor, y `getValues()` devuelve el texto sin ella. Eso
   * es justo lo que hace `neutralizarFormula_` al escribir algo que empieza con =, +, - o @.
   *
   * Sin emular esto, la simulación devolvía la comilla pegada al valor y cualquier dato que
   * empezara con uno de esos caracteres se leía distinto a como se guardó. Se notó con las
   * contraseñas: `generarSalt_` produce base64, que ~1 de cada 64 veces empieza con "+", así que un
   * usuario nuevo no podía entrar de forma intermitente — un fallo de la simulación, no del
   * programa, pero que habría escondido problemas reales de ida y vuelta.
   */
  function comoLoGuardaSheets(valor) {
    return typeof valor === 'string' && valor.charAt(0) === "'" ? valor.slice(1) : valor;
  }

  function crearHoja(nombre) {
    const st = { nombre, values: [], maxCols: 0 };
    function asegurar(filas, cols) {
      while (st.values.length < filas) st.values.push([]);
      if (cols > st.maxCols) st.maxCols = cols;
      st.values.forEach((f) => { while (f.length < cols) f.push(''); });
    }
    const sh = {
      getName: () => st.nombre,
      setName: (n) => { st.nombre = n; return sh; },
      getLastRow: () => st.values.length,
      getLastColumn: () => st.maxCols,
      setFrozenRows: () => sh,
      autoResizeColumns: () => sh,
      insertColumnsAfter: () => sh,
      copyTo: () => crearHoja(st.nombre + ' copia'),
      getDataRange: () => sh.getRange(1, 1, Math.max(st.values.length, 1), Math.max(st.maxCols, 1)),
      appendRow: (fila) => {
        st.values.push(fila.map(comoLoGuardaSheets));
        if (fila.length > st.maxCols) st.maxCols = fila.length;
        return sh;
      },
      deleteRow: (r) => { st.values.splice(r - 1, 1); return sh; },
      getRange: (fila, col, nFilas = 1, nCols = 1) => {
        const rng = {
          getValues: () => {
            stats.lecturas++;
            stats.porHoja[st.nombre] = (stats.porHoja[st.nombre] || 0) + 1;
            const salida = [];
            for (let r = 0; r < nFilas; r++) {
              const origen = st.values[fila - 1 + r] || [];
              const linea = [];
              for (let c = 0; c < nCols; c++) {
                linea.push(origen[col - 1 + c] === undefined ? '' : origen[col - 1 + c]);
              }
              salida.push(linea);
            }
            return salida;
          },
          setValues: (vals) => {
            asegurar(fila - 1 + vals.length, col - 1 + (vals[0] ? vals[0].length : 0));
            vals.forEach((linea, r) => linea.forEach((v, c) => {
              st.values[fila - 1 + r][col - 1 + c] = comoLoGuardaSheets(v);
            }));
            return rng;
          },
          setValue: (v) => rng.setValues([[v]]),
          getValue: () => rng.getValues()[0][0],
          setFontWeight: () => rng, setBackground: () => rng, setFontColor: () => rng,
          setNumberFormat: () => rng, clearContent: () => rng
        };
        return rng;
      }
    };
    return sh;
  }

  const spreadsheet = {
    getSheetByName: (n) => hojas.find((h) => h.getName() === n) || null,
    getSheets: () => hojas.slice(),
    insertSheet: (n) => { const h = crearHoja(n); hojas.push(h); return h; },
    deleteSheet: (h) => { const i = hojas.indexOf(h); if (i >= 0) hojas.splice(i, 1); },
    getId: () => 'sheet-de-prueba',
    getName: () => 'Dilana OS (prueba)'
  };

  const props = new Map();
  const cache = new Map();
  const ctx = {
    console, Math, Date: FechaControlada, JSON, String, Number, Boolean, Object, Array, RegExp, Error, Promise,
    isNaN, isFinite, parseFloat, parseInt, encodeURIComponent, decodeURIComponent,
    SpreadsheetApp: { getActiveSpreadsheet: () => spreadsheet, openById: () => spreadsheet, flush: () => {} },
    Utilities: {
      getUuid: () => crypto.randomUUID(),
      computeDigest: (alg, valor) => Array.from(crypto.createHash('sha256').update(String(valor)).digest())
        .map((b) => (b > 127 ? b - 256 : b)),
      DigestAlgorithm: { SHA_256: 'SHA_256' },
      base64Encode: (v) => Buffer.from(Array.isArray(v) ? Buffer.from(v.map((b) => b & 0xff)) : String(v)).toString('base64'),
      base64Decode: (v) => Array.from(Buffer.from(String(v), 'base64')),
      formatDate: (d, tz, fmt) => {
        const dt = new Date(d);
        const p = (n) => String(n).padStart(2, '0');
        if (fmt === 'yyyy-MM-dd') return `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())}`;
        if (fmt === 'HH:mm') return `${p(dt.getHours())}:${p(dt.getMinutes())}`;
        return dt.toISOString();
      },
      newBlob: (bytes, mime, nombre) => ({
        getBytes: () => bytes, getContentType: () => mime, getName: () => nombre,
        setName() { return this; }
      }),
      sleep: () => {}
    },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k) => (props.has(k) ? props.get(k) : null),
        setProperty: (k, v) => { props.set(k, String(v)); },
        deleteProperty: (k) => { props.delete(k); },
        getProperties: () => Object.fromEntries(props)
      })
    },
    CacheService: {
      getScriptCache: () => ({
        get: (k) => (cache.has(k) ? cache.get(k) : null),
        put: (k, v) => { cache.set(k, String(v)); },
        remove: (k) => { cache.delete(k); }
      })
    },
    Logger: { log: () => {} },
    Session: {
      getActiveUser: () => ({ getEmail: () => 'prueba@example.com' }),
      getEffectiveUser: () => ({ getEmail: () => 'prueba@example.com' }),
      getScriptTimeZone: () => 'America/Bogota'
    },
    ContentService: {
      MimeType: { JSON: 'application/json' },
      createTextOutput: (s) => ({ _t: s, setMimeType() { return this; }, getContent() { return this._t; } })
    },
    MailApp: { sendEmail: () => {} },
    GmailApp: { sendEmail: () => {} },
    UrlFetchApp: { fetch: () => { throw new Error('sin red en pruebas'); } },
    DriveApp: {
      getFoldersByName: () => ({ hasNext: () => false }),
      createFolder: (n) => ({ getId: () => 'carpeta', getName: () => n }),
      getFolderById: () => ({ getId: () => 'carpeta', getName: () => 'carpeta' })
    },
    ScriptApp: {
      getProjectTriggers: () => [],
      deleteTrigger: () => {},
      newTrigger: () => {
        const b = { timeBased: () => b, everyDays: () => b, everyMinutes: () => b, atHour: () => b, create: () => ({}) };
        return b;
      }
    },
    LockService: { getScriptLock: () => ({ tryLock: () => true, waitLock: () => {}, releaseLock: () => {} }) },
    HtmlService: { createHtmlOutput: (s) => ({ getContent: () => s }) }
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);

  // Igual que Apps Script: todos los .gs comparten un único espacio global. La ruta se resuelve
  // desde este archivo, no desde el directorio de trabajo, para no depender de cómo se lance node.
  // APPS_SCRIPT_DIR permite apuntar a otra copia del backend (ej. una versión anterior extraída con
  // `git archive`) para medir el mismo escenario contra las dos y comparar.
  const dir = process.env.APPS_SCRIPT_DIR || path.join(__dirname, '..', '..', 'apps-script');
  fs.readdirSync(dir).filter((f) => f.endsWith('.gs')).sort().forEach((f) => {
    vm.runInContext(fs.readFileSync(path.join(dir, f), 'utf8'), ctx, { filename: f });
  });

  // Los `const` de nivel superior (ej. SHEET_NAMES) viven en el ámbito léxico global del contexto,
  // no como propiedad del objeto de contexto — se leen evaluando la expresión ahí dentro.
  function evaluar(expresion) {
    return vm.runInContext(expresion, ctx, { filename: 'evaluar' });
  }

  function post(cuerpo) {
    return JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify(cuerpo) } }).getContent());
  }
  function hoja(n) { return hojas.find((h) => h.getName() === n); }
  function agregar(nombre, objs) {
    const sh = hoja(nombre);
    const cabeceras = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
    objs.forEach((o) => sh.appendRow(cabeceras.map((c) => (o[c] !== undefined ? o[c] : ''))));
  }
  function reiniciarStats() { stats.lecturas = 0; stats.porHoja = {}; }

  return { ctx, hojas, spreadsheet, post, hoja, agregar, stats, reiniciarStats, evaluar, avanzarReloj, fijarReloj };
}

module.exports = { crearEntorno };
