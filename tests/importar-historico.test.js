const fs = require('fs');
const vm = require('vm');
const assert = require('assert');

function cargar(extras = {}) {
  const ctx = Object.assign({ console }, extras);
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync('apps-script/ImportarHistorico.gs', 'utf8'), ctx, { filename: 'ImportarHistorico.gs' });
  return ctx;
}

// Espejo de contadorClaves_ (Fudo.gs) — en Apps Script real todos los .gs comparten scope global,
// pero aquí ImportarHistorico.gs se carga aislado, así que hace falta pasarla como mock (mismo
// patrón que el resto de la suite, ver tests/inventory-controls.test.js).
function contadorClavesMock_() {
  const estado = {};
  return {
    marcarPrevio: function (clave) {
      if (!estado[clave]) estado[clave] = { previos: 0, usados: 0 };
      estado[clave].previos++;
    },
    esDuplicadaPrevia: function (clave) {
      if (!estado[clave]) estado[clave] = { previos: 0, usados: 0 };
      const duplicada = estado[clave].usados < estado[clave].previos;
      estado[clave].usados++;
      return duplicada;
    }
  };
}

function normalizarMock_(v) {
  return String(v == null ? '' : v).trim().toLowerCase();
}
function formatearFechaMock_(v) {
  return String(v || '').slice(0, 10);
}
function lockLibreMock_() {
  return { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }) };
}
function lockOcupadoMock_() {
  return { getScriptLock: () => ({ tryLock: () => false, releaseLock: () => {} }) };
}

const usuario = { nombre: 'Diana', sede: 'Ambas' };

function spreadsheetMock_(hojas) {
  return {
    getActiveSpreadsheet: () => ({
      getSheetByName: (nombre) => {
        const filas = hojas[nombre];
        if (!filas) return null;
        return { getDataRange: () => ({ getValues: () => filas }) };
      }
    })
  };
}

// --- historicoLeerPestana_ ----------------------------------------------------------------------

(function () {
  const ctx = cargar({ contadorClaves_: contadorClavesMock_, normalizar_: normalizarMock_, formatearFecha_: formatearFechaMock_, LockService: lockLibreMock_(), SHEET_NAMES: {}, leerTabla_: () => [], SpreadsheetApp: spreadsheetMock_({}) });
  assert.equal(ctx.historicoLeerPestana_('').ok, false, 'debe exigir un nombre de pestaña');
  assert.equal(ctx.historicoLeerPestana_('No existe').ok, false, 'debe avisar si la pestaña no existe en el Sheet');
  console.log('historicoLeerPestana_ valida nombre y existencia de la pestaña: OK');
})();

(function () {
  const ctx = cargar({
    contadorClaves_: contadorClavesMock_, normalizar_: normalizarMock_, formatearFecha_: formatearFechaMock_, LockService: lockLibreMock_(), SHEET_NAMES: {}, leerTabla_: () => [],
    SpreadsheetApp: spreadsheetMock_({ 'Compras 2026': [['Fecha', 'Producto', 'Cantidad']] })
  });
  const resultado = ctx.historicoLeerPestana_('Compras 2026');
  assert.equal(resultado.ok, false, 'una pestaña solo con encabezados (sin filas) debe avisar, no devolver vacío en silencio');
  console.log('historicoLeerPestana_ avisa si la pestaña no tiene filas de datos: OK');
})();

(function () {
  const filasCrudas = [
    ['Fecha', 'Producto', '', 'Cantidad'],
    ['2026-07-01', 'Costilla', 'sobra', 5],
    ['', '', '', ''], // fila completamente vacía (común al final de una hoja pegada a mano) -> se descarta
    ['2026-07-02', 'Aceite', '', 2]
  ];
  const ctx = cargar({
    contadorClaves_: contadorClavesMock_, normalizar_: normalizarMock_, formatearFecha_: formatearFechaMock_, LockService: lockLibreMock_(), SHEET_NAMES: {}, leerTabla_: () => [],
    SpreadsheetApp: spreadsheetMock_({ 'Compras 2026': filasCrudas })
  });
  const resultado = ctx.historicoLeerPestana_('Compras 2026');
  assert.equal(resultado.ok, true);
  assert.deepEqual(resultado.columnas, ['Fecha', 'Producto', 'Cantidad'], 'la columna con encabezado vacío no debe listarse');
  assert.equal(resultado.filas.length, 2, 'la fila completamente vacía debe descartarse');
  assert.equal(resultado.filas[0]['Fecha'], '2026-07-01');
  assert.equal(resultado.filas[0]['Producto'], 'Costilla');
  assert.equal(resultado.filas[0][''], undefined, 'el valor bajo la columna sin nombre no debe colarse en el objeto de la fila');
  assert.equal(resultado.filas[1]['Producto'], 'Aceite');
  console.log('historicoLeerPestana_ lee filas de una pestaña existente, ignora columnas sin nombre y filas vacías: OK');
})();

// --- historicoTiposListar_ ------------------------------------------------------------------------

(function () {
  const ctx = cargar({ contadorClaves_: contadorClavesMock_, normalizar_: normalizarMock_, formatearFecha_: formatearFechaMock_, LockService: lockLibreMock_(), SHEET_NAMES: {}, leerTabla_: () => [] });
  const tipos = ctx.historicoTiposListar_();
  assert.deepEqual(tipos.map((t) => t.tipo).sort(), ['compras', 'conteos', 'mermas_ajustes', 'producciones', 'traslados']);
  tipos.forEach((t) => {
    assert.ok(t.campos.some((c) => c.clave === 'fecha' && c.obligatorio), `${t.tipo} debe exigir fecha`);
  });
  console.log('historicoTiposListar_ expone los 5 tipos con sus campos: OK');
})();

// --- historicoImportarFilas_: validación básica -----------------------------------------------

(function () {
  const ctx = cargar({ contadorClaves_: contadorClavesMock_, normalizar_: normalizarMock_, formatearFecha_: formatearFechaMock_, LockService: lockLibreMock_(), SHEET_NAMES: {}, leerTabla_: () => [] });
  assert.equal(ctx.historicoImportarFilas_('no_existe', [{ a: 1 }], usuario).ok, false, 'debe rechazar un tipo de destino desconocido');
  assert.equal(ctx.historicoImportarFilas_('compras', [], usuario).ok, false, 'debe exigir al menos una fila');
  console.log('historicoImportarFilas_ valida tipo de destino y filas vacías: OK');
})();

(function () {
  const ctx = cargar({
    contadorClaves_: contadorClavesMock_, normalizar_: normalizarMock_, formatearFecha_: formatearFechaMock_,
    LockService: lockOcupadoMock_(), SHEET_NAMES: { AJUSTES_INVENTARIO: 'ajustes' }, leerTabla_: () => [],
    ajusteInventarioRegistrar_: () => { throw new Error('no debe llegar a registrar con el lock ocupado'); }
  });
  const resultado = ctx.historicoImportarFilas_('compras', [{ fecha: '2026-07-01' }], usuario);
  assert.equal(resultado.ok, false);
  assert.match(resultado.error, /espera un momento/);
  console.log('historicoImportarFilas_ no sigue si el lock ya está tomado: OK');
})();

// --- Compras / Mermas y ajustes (Ajustes_Inventario) --------------------------------------------

(function () {
  const existentes = [
    { fecha: '2026-07-01', sede: 'Capri', tipo: 'Compra cruda', producto: 'Costilla', cantidad: 5, proveedor: 'Mercamio', numero_factura: 'F-1' }
  ];
  const llamadas = [];
  const ctx = cargar({
    contadorClaves_: contadorClavesMock_, normalizar_: normalizarMock_, formatearFecha_: formatearFechaMock_,
    LockService: lockLibreMock_(),
    SHEET_NAMES: { AJUSTES_INVENTARIO: 'ajustes' },
    leerTabla_: (h) => h === 'ajustes' ? existentes : [],
    ajusteInventarioRegistrar_: (item) => { llamadas.push(item); return { ok: true, id: 'id-' + llamadas.length }; }
  });

  const filas = [
    { fecha: '2026-07-01', sede: 'Capri', producto: 'Costilla', unidad: 'kg', cantidad: 5, proveedor: 'Mercamio', numero_factura: 'F-1' }, // igual a la existente -> duplicada
    { fecha: '2026-07-02', sede: 'Capri', producto: 'Costilla', unidad: 'kg', cantidad: 3, proveedor: 'Mercamio', numero_factura: 'F-2' }, // nueva
    { fecha: '2026-07-02', sede: 'Capri', producto: 'Costilla', unidad: 'kg', cantidad: 3, proveedor: 'Mercamio', numero_factura: 'F-2' }  // repetida DENTRO del mismo archivo -> sí se acepta (no había una previa de antes)
  ];
  const resultado = ctx.historicoImportarFilas_('compras', filas, usuario);
  assert.equal(resultado.ok, true);
  assert.equal(resultado.importados, 2, 'las dos filas nuevas (aunque iguales entre sí) deben importarse — solo la que ya existía de antes se omite');
  assert.equal(resultado.omitidos_duplicados, 1);
  assert.equal(llamadas.length, 2);
  assert.ok(llamadas.every((it) => it.tipo === 'Compra cruda'), 'el destino "compras" siempre debe forzar tipo=Compra cruda, venga o no esa columna en el Excel');
  console.log('historicoImportarAjustes_ (compras) fuerza tipo y dedupea contra lo ya existente: OK');
})();

(function () {
  const llamadas = [];
  const ctx = cargar({
    contadorClaves_: contadorClavesMock_, normalizar_: normalizarMock_, formatearFecha_: formatearFechaMock_,
    LockService: lockLibreMock_(),
    SHEET_NAMES: { AJUSTES_INVENTARIO: 'ajustes' },
    leerTabla_: () => [],
    ajusteInventarioRegistrar_: (item) => { llamadas.push(item); return { ok: item.tipo !== 'Tipo inválido', error: 'Tipo de ajuste no válido: ' + item.tipo }; }
  });
  const filas = [
    { fecha: '2026-07-01', sede: 'San Antonio', producto: 'Aceite', unidad: 'l', cantidad: 2, tipo: 'Merma / desperdicio', motivo: 'se derramó' },
    { fecha: '2026-07-01', sede: 'San Antonio', producto: 'Aceite', unidad: 'l', cantidad: 1, tipo: 'Tipo inválido' }
  ];
  const resultado = ctx.historicoImportarFilas_('mermas_ajustes', filas, usuario);
  assert.equal(resultado.importados, 1);
  assert.equal(resultado.total_errores, 1, 'una fila con tipo inválido debe quedar como error, no tumbar el resto del lote');
  assert.match(resultado.errores[0], /Fila 2/);
  assert.equal(llamadas[0].tipo, 'Merma / desperdicio', 'mermas_ajustes debe respetar el tipo que traiga cada fila, no forzar uno solo');
  console.log('historicoImportarAjustes_ (mermas_ajustes) respeta el tipo por fila y aísla errores por fila: OK');
})();

// --- Producciones ----------------------------------------------------------------------------

(function () {
  const llamadas = [];
  const ctx = cargar({
    contadorClaves_: contadorClavesMock_, normalizar_: normalizarMock_, formatearFecha_: formatearFechaMock_,
    LockService: lockLibreMock_(),
    SHEET_NAMES: { PRODUCCIONES: 'producciones' },
    leerTabla_: () => [],
    produccionRegistrar_: (items) => { llamadas.push(items); return { ok: true }; }
  });
  const filas = [
    { fecha: '2026-07-05', sede: 'Capri', item: 'Costilla Preparada', unidad: 'kg', cantidad: 8, insumo_producto: 'Costilla cruda', insumo_cantidad: 10, insumo_unidad: 'kg', merma_cantidad: 2 }
  ];
  const resultado = ctx.historicoImportarFilas_('producciones', filas, usuario);
  assert.equal(resultado.importados, 1);
  assert.equal(llamadas.length, 1, 'debe llamar produccionRegistrar_ una vez por fila, no todo el lote junto');
  assert.equal(llamadas[0].length, 1);
  assert.equal(llamadas[0][0].insumo_producto, 'Costilla cruda', 'debe pasar el insumo/merma opcional cuando el Excel lo trae');
  assert.equal(llamadas[0][0].merma_cantidad, 2);
  console.log('historicoImportarProducciones_ registra fila por fila con insumo/merma opcionales: OK');
})();

(function () {
  // Dedupe: no debe volver a registrar una producción con la misma fecha/sede/item/cantidad/unidad
  // que ya existe en la hoja — evita duplicar si el mismo Excel se sube dos veces.
  const existentes = [{ fecha: '2026-07-05', sede: 'Capri', item: 'Costilla Preparada', cantidad: 8, unidad: 'kg' }];
  let llamadas = 0;
  const ctx = cargar({
    contadorClaves_: contadorClavesMock_, normalizar_: normalizarMock_, formatearFecha_: formatearFechaMock_,
    LockService: lockLibreMock_(),
    SHEET_NAMES: { PRODUCCIONES: 'producciones' },
    leerTabla_: (h) => h === 'producciones' ? existentes : [],
    produccionRegistrar_: () => { llamadas++; return { ok: true }; }
  });
  const resultado = ctx.historicoImportarFilas_('producciones', [
    { fecha: '2026-07-05', sede: 'Capri', item: 'Costilla Preparada', unidad: 'kg', cantidad: 8 }
  ], usuario);
  assert.equal(resultado.importados, 0);
  assert.equal(resultado.omitidos_duplicados, 1);
  assert.equal(llamadas, 0, 'no debe llamar produccionRegistrar_ para una fila ya presente en la hoja');
  console.log('historicoImportarProducciones_ dedupea contra lo ya existente: OK');
})();

// --- Traslados --------------------------------------------------------------------------------

(function () {
  const llamadasCrear = [];
  const llamadasConfirmar = [];
  const ctx = cargar({
    contadorClaves_: contadorClavesMock_, normalizar_: normalizarMock_, formatearFecha_: formatearFechaMock_,
    LockService: lockLibreMock_(),
    SHEET_NAMES: { TRASLADOS: 'traslados' },
    leerTabla_: () => [],
    trasladoCrear_: (item) => { llamadasCrear.push(item); return { ok: true, id: 'id-' + llamadasCrear.length }; },
    trasladoConfirmar_: (id, cantidad) => { llamadasConfirmar.push({ id, cantidad }); return { ok: true }; }
  });
  const filas = [
    { fecha: '2026-07-10', producto: 'Panceta', unidad: 'kg', cantidad: 4, sede_origen: 'Centro de Producción', sede_destino: 'Capri' }, // sin recibido -> queda "Enviado"
    { fecha: '2026-07-11', producto: 'Panceta', unidad: 'kg', cantidad: 2, sede_origen: 'Centro de Producción', sede_destino: 'San Antonio', cantidad_recibida: 2 } // con recibido -> confirma
  ];
  const resultado = ctx.historicoImportarFilas_('traslados', filas, usuario);
  assert.equal(resultado.importados, 2);
  assert.equal(llamadasCrear.length, 2);
  assert.equal(llamadasConfirmar.length, 1, 'solo debe confirmar la fila que trajo cantidad_recibida');
  assert.equal(llamadasConfirmar[0].id, 'id-2');
  assert.equal(llamadasConfirmar[0].cantidad, 2);
  console.log('historicoImportarTraslados_ crea todos y confirma solo los que ya traían cantidad recibida: OK');
})();

(function () {
  const llamadasConfirmar = [];
  const ctx = cargar({
    contadorClaves_: contadorClavesMock_, normalizar_: normalizarMock_, formatearFecha_: formatearFechaMock_,
    LockService: lockLibreMock_(),
    SHEET_NAMES: { TRASLADOS: 'traslados' },
    leerTabla_: () => [],
    trasladoCrear_: () => ({ ok: false, error: 'Faltan datos del traslado' }),
    trasladoConfirmar_: (id, cantidad) => { llamadasConfirmar.push({ id, cantidad }); return { ok: true }; }
  });
  const resultado = ctx.historicoImportarFilas_('traslados', [
    { fecha: '2026-07-10', producto: '', unidad: 'kg', cantidad: 4, sede_origen: 'Capri', sede_destino: 'San Antonio' }
  ], usuario);
  assert.equal(resultado.importados, 0);
  assert.equal(resultado.total_errores, 1);
  assert.equal(llamadasConfirmar.length, 0, 'si trasladoCrear_ falla, no debe intentar confirmar nada');
  console.log('historicoImportarTraslados_ no confirma un traslado que no se pudo crear: OK');
})();

// --- Conteos ------------------------------------------------------------------------------------

(function () {
  const llamadas = [];
  const ctx = cargar({
    contadorClaves_: contadorClavesMock_, normalizar_: normalizarMock_, formatearFecha_: formatearFechaMock_,
    LockService: lockLibreMock_(),
    SHEET_NAMES: { CONTEOS: 'conteos' },
    leerTabla_: () => [],
    conteoRegistrar_: (items, usuarioReg, opciones) => {
      llamadas.push({ items, opciones });
      return { ok: true, registrados: items.length, actualizados: 0 };
    }
  });
  const filas = [
    { fecha: '2026-07-01', sede: 'Capri', producto: 'Harina', unidad: 'kg', cantidad: 10 },
    { fecha: '2026-07-08', sede: 'San Antonio', producto: 'Harina', unidad: 'kg', cantidad: 6 }
  ];
  const resultado = ctx.historicoImportarFilas_('conteos', filas, usuario);
  assert.equal(resultado.importados, 2);
  assert.equal(llamadas.length, 2, 'cada fila histórica puede ser de una fecha/sede distinta — debe registrarse una por una, no como un solo envío');
  assert.ok(llamadas.every((l) => l.opciones.omitir_obligatorios_del_dia === true), 'no debe bloquear un conteo histórico parcial por productos obligatorios del día real');
  console.log('historicoImportarConteos_ registra fila por fila sin exigir productos obligatorios del día: OK');
})();

console.log('importar-historico: OK');
