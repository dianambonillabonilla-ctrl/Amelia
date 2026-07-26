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

  // Real Sheets nunca guarda la comilla que antepone neutralizarFormula_ — es solo la marca de
  // "esto es texto plano, no fórmula" (setValue/appendRow se comportan igual que teclear en la
  // UI). Sin este despojo, un hash/salt en base64 que por azar empiece con +/-/=/@ (~6% de las
  // veces) queda con la comilla PEGADA en la fila simulada pero NO en el valor recién calculado
  // para comparar — password_hash nunca vuelve a coincidir y el login falla al azar en las
  // pruebas, algo que no pasa contra un Sheet real.
  function despojarApostrofeSiEsTexto_(v) {
    return (typeof v === 'string' && v.charAt(0) === "'") ? v.slice(1) : v;
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
        st.values.push(fila.map(despojarApostrofeSiEsTexto_));
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
              st.values[fila - 1 + r][col - 1 + c] = despojarApostrofeSiEsTexto_(v);
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
    console, Math, Date, JSON, String, Number, Boolean, Object, Array, RegExp, Error, Promise,
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
  const dir = path.join(__dirname, '..', '..', 'apps-script');
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

  return { ctx, hojas, spreadsheet, post, hoja, agregar, stats, reiniciarStats, evaluar };
}

module.exports = { crearEntorno };
