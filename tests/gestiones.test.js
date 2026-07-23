const fs = require('fs');
const vm = require('vm');
const assert = require('assert');

function cargar(path, extras = {}) {
  const ctx = Object.assign({ console }, extras);
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path, 'utf8'), ctx, { filename: path });
  return ctx;
}

// Espejo de sedeEscrituraPermitida_ en Code.gs (ver mismo mock en inventory-controls.test.js).
function sedeEscrituraPermitidaMock_(usuario, sede) {
  return usuario.rol === 'Administrador' || usuario.sede === 'Ambas' ||
    sede === usuario.sede || sede === 'Centro de Producción';
}

const HEADERS = ['id', 'fecha', 'producto', 'sede', 'estado', 'nota', 'creado_por', 'timestamp_creado',
  'actualizado_por', 'timestamp_actualizado', 'factura_id'];

// Sheet falsa en memoria — mismo patrón de fila 0 = headers que usa Sheets real, para que
// gestionBuscarFila_/gestionActualizarEstado_ (que leen filas y columnas por índice con
// getRange().setValue()) funcionen igual que contra la hoja de verdad.
let filas;
function objFromRow_(row) {
  const obj = {};
  HEADERS.forEach((h, i) => { obj[h] = row[i] !== undefined ? row[i] : ''; });
  return obj;
}
function reiniciar_() {
  filas = [HEADERS.slice()];
}
reiniciar_();

const fakeSheet = {
  getDataRange: () => ({ getValues: () => filas }),
  getRange: (r, c) => ({
    setValue: (v) => {
      while (filas.length <= r - 1) filas.push(new Array(HEADERS.length).fill(''));
      filas[r - 1][c - 1] = v;
    }
  })
};

const gestiones = cargar('apps-script/Gestiones.gs', {
  SHEET_NAMES: { GESTIONES: 'Gestiones' },
  Utilities: { getUuid: () => 'g-' + filas.length },
  formatearFecha_: () => '2026-07-23',
  normalizar_: (s) => String(s || '').trim().toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' '),
  sheet_: (name) => name === 'Gestiones' ? fakeSheet : null,
  leerTabla_: (name) => name === 'Gestiones'
    ? filas.slice(1).filter(r => r.some(v => v !== '' && v !== null)).map(objFromRow_)
    : [],
  appendRowFromObj_: (name, obj) => { if (name === 'Gestiones') filas.push(HEADERS.map(h => obj[h] !== undefined ? obj[h] : '')); },
  sedeEscrituraPermitida_: sedeEscrituraPermitidaMock_
});

const admin = { nombre: 'Diana', rol: 'Administrador', sede: 'Ambas' };
const capri = { nombre: 'Juan', rol: 'Cocina', sede: 'Capri' };
const sanAntonio = { nombre: 'Ana', rol: 'Cocina', sede: 'San Antonio' };

// --- gestionCrear_: validaciones -----------------------------------------------------------
assert.equal(gestiones.gestionCrear_({ sede: 'Capri' }, admin).ok, false, 'debe exigir producto');
assert.equal(gestiones.gestionCrear_({ producto: 'Banano' }, admin).ok, false, 'debe exigir sede');
assert.equal(
  gestiones.gestionCrear_({ producto: 'Banano', sede: 'San Antonio' }, capri).ok, false,
  'Capri no debe poder abrir una gestión para San Antonio'
);
assert.equal(
  gestiones.gestionCrear_({ producto: 'Banano', sede: 'Centro de Producción' }, capri).ok, true,
  'cualquier sede puede abrir gestión para Centro de Producción'
);

// --- gestionCrear_ + gestionesListar_: caso feliz ------------------------------------------
const creado = gestiones.gestionCrear_({ producto: 'Banano', sede: 'Capri', nota: 'ya se va a comprar' }, capri);
assert.equal(creado.ok, true);
assert.ok(creado.id);

const listadoAdmin = gestiones.gestionesListar_({}, admin);
const nueva = listadoAdmin.find(g => g.id === creado.id);
assert.ok(nueva, 'la gestión creada debe aparecer en el listado');
assert.equal(nueva.estado, 'Pendiente', 'una gestión nueva siempre empieza en Pendiente');
assert.equal(nueva.creado_por, 'Juan');

// --- gestionesListar_: filtros --------------------------------------------------------------
gestiones.gestionCrear_({ producto: 'Aioli', sede: 'San Antonio' }, sanAntonio);
assert.equal(
  gestiones.gestionesListar_({ sede: 'Capri' }, admin).every(g => g.sede === 'Capri'), true,
  'filtro por sede debe respetarse'
);
assert.equal(
  gestiones.gestionesListar_({}, capri).some(g => g.sede === 'San Antonio'), false,
  'Capri no debe ver gestiones de San Antonio en el listado'
);
assert.equal(
  gestiones.gestionesListar_({}, admin).length >= 2, true,
  'Administrador debe ver gestiones de todas las sedes'
);

// --- gestionActualizarEstado_: validaciones --------------------------------------------------
assert.equal(gestiones.gestionActualizarEstado_(creado.id, 'Rara', '', admin).ok, false, 'estado inválido debe rechazarse');
assert.equal(gestiones.gestionActualizarEstado_('no-existe', 'Resuelto', '', admin).ok, false, 'id inexistente debe rechazarse');
assert.equal(
  gestiones.gestionActualizarEstado_(creado.id, 'Resuelto', '', sanAntonio).ok, false,
  'San Antonio no debe poder actualizar una gestión de Capri'
);

// --- gestionActualizarEstado_: flujo completo ------------------------------------------------
const pasoPedido = gestiones.gestionActualizarEstado_(creado.id, 'Pedido realizado', 'pedido a Mercamío', capri);
assert.equal(pasoPedido.ok, true);
let actualizada = gestiones.gestionesListar_({}, admin).find(g => g.id === creado.id);
assert.equal(actualizada.estado, 'Pedido realizado');
assert.equal(actualizada.nota, 'pedido a Mercamío');
assert.equal(actualizada.actualizado_por, 'Juan');

const pasoResuelto = gestiones.gestionActualizarEstado_(creado.id, 'Resuelto', '', capri);
assert.equal(pasoResuelto.ok, true);
actualizada = gestiones.gestionesListar_({}, admin).find(g => g.id === creado.id);
assert.equal(actualizada.estado, 'Resuelto');

assert.equal(
  gestiones.gestionesListar_({ estado: 'abiertas' }, admin).some(g => g.id === creado.id), false,
  'una gestión resuelta no debe salir en el filtro "abiertas"'
);

// --- gestionAutoResolverPorCompra_: cierre automático al registrar una compra ---------------
reiniciar_();
const gPendiente = gestiones.gestionCrear_({ producto: 'Banano', sede: 'Capri' }, capri);
const gOtraSede = gestiones.gestionCrear_({ producto: 'Banano', sede: 'San Antonio' }, sanAntonio);

// Nombre con tilde/mayúscula distinta a propósito — debe igual encontrarla (normalizar_).
gestiones.gestionAutoResolverPorCompra_([{ producto: 'BANANÓ', sede: 'Capri' }], 'factura-1', admin);

const trasCompra = gestiones.gestionesListar_({}, admin);
const capriCerrada = trasCompra.find(g => g.id === gPendiente.id);
const sanAntonioSigue = trasCompra.find(g => g.id === gOtraSede.id);
assert.equal(capriCerrada.estado, 'Resuelto', 'la gestión de Capri debe cerrarse sola al llegar la compra');
assert.equal(capriCerrada.factura_id, 'factura-1');
assert.equal(sanAntonioSigue.estado, 'Pendiente', 'la gestión de San Antonio no debe verse afectada por una compra de Capri');

// No debe explotar si no hay nada que resolver.
assert.doesNotThrow(() => gestiones.gestionAutoResolverPorCompra_([{ producto: 'Algo que no existe', sede: 'Capri' }], 'factura-2', admin));

console.log('gestiones: OK');
