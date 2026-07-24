const fs = require('fs');
const vm = require('vm');
const assert = require('assert');

// Auditoría de seguridad, jul 2026: el backend acepta muchos campos de texto libre (producto,
// proveedor, número de factura, motivo, observaciones, notas, nombres recibidos de FUDO...) y los
// escribía directo en Sheets sin neutralizar cadenas que empiecen con =, +, - o @ — esos caracteres
// hacen que Google Sheets interprete el valor como una fórmula al abrir la hoja, en vez de guardarlo
// como texto. neutralizarFormula_/neutralizarObjetoFormulas_ (Code.gs) anteponen una comilla simple
// a esos valores antes de escribirlos.

function cargar(path, extras = {}) {
  const ctx = Object.assign({ console }, extras);
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path, 'utf8'), ctx, { filename: path });
  return ctx;
}

const PAYLOADS_PELIGROSOS = ['=1+1', '+SUM(A1:A2)', '-1+2', '@SUM(A1:A2)'];

// --- neutralizarFormula_ --------------------------------------------------------------------------

(function () {
  const code = cargar('apps-script/Code.gs', {});
  PAYLOADS_PELIGROSOS.forEach((payload) => {
    const resultado = code.neutralizarFormula_(payload);
    assert.equal(resultado, "'" + payload, `"${payload}" debe quedar con comilla simple adelante`);
    assert.ok(!/^[=+\-@]/.test(resultado), `"${resultado}" ya NO debe empezar con un carácter de fórmula`);
  });

  assert.equal(code.neutralizarFormula_('Costilla Preparada'), 'Costilla Preparada', 'texto normal no debe tocarse');
  assert.equal(code.neutralizarFormula_(''), '', 'string vacío no debe tocarse');
  assert.equal(code.neutralizarFormula_(5), 5, 'números no son strings — no se tocan');
  assert.equal(code.neutralizarFormula_(true), true, 'booleanos no son strings — no se tocan');
  const fecha = new Date('2026-07-24');
  assert.equal(code.neutralizarFormula_(fecha), fecha, 'fechas no son strings — no se tocan');
  assert.equal(code.neutralizarFormula_(null), null);
  assert.equal(code.neutralizarFormula_(undefined), undefined);
  console.log('neutralizarFormula_: OK');
})();

// --- neutralizarObjetoFormulas_ -------------------------------------------------------------------

(function () {
  const code = cargar('apps-script/Code.gs', {});
  const limpio = code.neutralizarObjetoFormulas_({
    producto: '=HYPERLINK("https://malicioso.com","Costilla")',
    proveedor: 'Mercamio',
    cantidad: 5,
    motivo: '+SUM(A1:A99)'
  });
  assert.equal(limpio.producto, '\'=HYPERLINK("https://malicioso.com","Costilla")');
  assert.equal(limpio.proveedor, 'Mercamio');
  assert.equal(limpio.cantidad, 5);
  assert.equal(limpio.motivo, "'+SUM(A1:A99)");
  console.log('neutralizarObjetoFormulas_: OK');
})();

// --- appendRowFromObj_ / appendRowsFromObjs_ (los dos helpers genéricos de escritura) -------------

function fakeSheetParaAppend_(headers) {
  const filasEscritas = [];
  let lastRow = 1;
  const sh = {
    getLastColumn: () => headers.length,
    getLastRow: () => lastRow,
    getRange: (r, c, numRows) => {
      if (r === 1 && c === 1 && numRows === 1) {
        return { getValues: () => [headers] };
      }
      return { setValues: (matriz) => { matriz.forEach((fila) => { filasEscritas.push(fila); lastRow++; }); } };
    },
    appendRow: (fila) => { filasEscritas.push(fila); lastRow++; }
  };
  return { sh, filasEscritas };
}

(function () {
  const headers = ['producto', 'proveedor', 'cantidad'];
  const { sh, filasEscritas } = fakeSheetParaAppend_(headers);
  const code = cargar('apps-script/Code.gs', { SpreadsheetApp: { getActiveSpreadsheet: () => ({ getSheetByName: () => sh }) } });
  code.appendRowFromObj_('cualquiera', { producto: '=1+1', proveedor: 'Mercamio', cantidad: 3 });
  assert.equal(filasEscritas.length, 1);
  assert.equal(filasEscritas[0][0], "'=1+1", 'appendRowFromObj_ debe neutralizar antes de escribir');
  assert.equal(filasEscritas[0][1], 'Mercamio');
  console.log('appendRowFromObj_ neutraliza fórmulas: OK');
})();

(function () {
  const headers = ['producto', 'proveedor', 'cantidad'];
  const { sh, filasEscritas } = fakeSheetParaAppend_(headers);
  const code = cargar('apps-script/Code.gs', { SpreadsheetApp: { getActiveSpreadsheet: () => ({ getSheetByName: () => sh }) } });
  code.appendRowsFromObjs_('cualquiera', [
    { producto: '@SUM(A1:A2)', proveedor: 'Mercamio', cantidad: 1 },
    { producto: 'Aceite', proveedor: '-1+2', cantidad: 2 }
  ]);
  assert.equal(filasEscritas.length, 2);
  assert.equal(filasEscritas[0][0], "'@SUM(A1:A2)");
  assert.equal(filasEscritas[1][1], "'-1+2");
  console.log('appendRowsFromObjs_ neutraliza fórmulas: OK');
})();

// --- Traslados.gs: trasladoActualizar_ neutraliza "Observaciones" (el ejemplo textual de la
// auditoría) — este camino escribe directo con setValue, NO pasa por appendRowFromObj_/
// appendRowsFromObjs_, así que necesita su propia protección. -------------------------------------

(function () {
  const headers = ['id', 'sede_origen', 'sede_destino', 'estado', 'cantidad_enviada', 'cantidad_recibida', 'observacion', 'usuario_recibe', 'timestamp_recibe'];
  const fila = ['t1', 'San Antonio', 'San Antonio', 'Enviado', 5, '', '', '', ''];
  const data = [headers, fila];
  const ctx = cargar('apps-script/Traslados.gs', {
    SHEET_NAMES: { TRASLADOS: 'traslados' },
    leerTabla_: () => [],
    requiereRol_: () => {},
    sedeEscrituraPermitida_: () => true,
    destinatariosAlerta_: () => [],
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }) },
    neutralizarObjetoFormulas_: (obj) => {
      const limpio = {};
      Object.keys(obj || {}).forEach((k) => {
        const v = obj[k];
        limpio[k] = (typeof v === 'string' && /^[=+\-@]/.test(v)) ? "'" + v : v;
      });
      return limpio;
    },
    sheet_: () => ({
      getDataRange: () => ({ getValues: () => data }),
      getRange: (r, c) => ({ setValue: (v) => { data[r - 1][c - 1] = v; } })
    })
  });
  const observacionCol = headers.indexOf('observacion');
  const resultado = ctx.trasladoObservar_('t1', 2, '=HYPERLINK("https://malicioso.com","clic aquí")', { nombre: 'Ana', sede: 'San Antonio' });
  assert.equal(resultado.ok, true);
  assert.equal(data[1][observacionCol], '\'=HYPERLINK("https://malicioso.com","clic aquí")',
    'la "observación" de un traslado (texto libre) debe quedar neutralizada en la hoja');
  console.log('trasladoActualizar_ (Traslados.gs) neutraliza la observación: OK');
})();

console.log('formula-injection: OK');
