const fs = require('fs');
const vm = require('vm');
const assert = require('assert');

function cargar(path, extras = {}) {
  const ctx = Object.assign({ console }, extras);
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path, 'utf8'), ctx, { filename: path });
  return ctx;
}

const usuario = { id: 'u1', nombre: 'Ana', rol: 'Administrador', sede: 'Capri' };
let libro = [];
let props = {};
let auditLog = [];

function reiniciar_() {
  libro = [];
  props = {};
  auditLog = [];
}

function cargarModulo_() {
  reiniciar_();
  const appendCalls = [];
  return cargar('apps-script/InventarioMovimientos.gs', {
    SHEET_NAMES: { MOVIMIENTOS_INVENTARIO: 'Movimientos_Inventario', AJUSTES_INVENTARIO: 'ajustes', PRODUCCIONES: 'producciones', TRASLADOS: 'traslados' },
    MOVIMIENTO_TIPOS_SIGNO_: {
      'Compra recibida': 1,
      'Entrada por producción': 1,
      'Consumo de producción': -1,
      'Merma de producción': -1,
      'Traslado enviado': -1,
      'Traslado recibido': 1,
      'Merma en sede': -1,
      'Ajuste autorizado': 1,
      'Devolución': 1
    },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k) => props[k] || null,
        setProperty: (k, v) => { props[k] = v; }
      })
    },
    Utilities: {
      getUuid: (() => { let n = 0; return () => 'uuid-' + (++n); })()
    },
    formatearFecha_: (v) => String(v).slice(0, 10),
    neutralizarObjetoFormulas_: (o) => Object.assign({}, o),
    neutralizarFormula_: (v) => v,
    movimientoUbicacion_: (sede, punto) => punto ? sede + ' / ' + punto : sede,
    movimientosDesdeProduccion_: () => [],
    movimientosDesdeTraslados_: () => [],
    indiceCatalogo_: () => ({}),
    claveProducto_: (t) => String(t || '').trim().toLowerCase(),
    leerTabla_: (hoja) => {
      if (hoja === 'Movimientos_Inventario') return libro.slice();
      if (hoja === 'ajustes') return [];
      if (hoja === 'producciones') return [];
      if (hoja === 'traslados') return [];
      return [];
    },
    appendRowFromObj_: (hoja, obj) => {
      appendCalls.push({ hoja, obj });
      if (hoja === 'Movimientos_Inventario') libro.push(Object.assign({}, obj));
    },
    sheet_: () => ({
      getDataRange: () => ({
        getValues: () => {
          const headers = Object.keys(libro[0] || { id: '', estado: '' });
          return [headers].concat(libro.map(r => headers.map(h => r[h])));
        }
      }),
      getRange: (row, col) => ({
        setValue: (v) => {
          const headers = Object.keys(libro[0] || {});
          const idx = row - 2;
          if (libro[idx] && headers[col - 1]) libro[idx][headers[col - 1]] = v;
        }
      })
    }),
    auditoriaRegistrar_: (...args) => { auditLog.push(args); }
  });
}

function itemBase_(overrides) {
  return Object.assign({
    fecha: '2026-07-10',
    producto: 'Costilla',
    cantidad: 5,
    unidad: 'kg',
    tipo_movimiento: 'Compra recibida',
    sede: 'Capri',
    entidad_tipo: 'Ajuste',
    entidad_id: 'aj-1',
    clave_idempotencia: 'Ajuste|aj-1|Compra recibida|0'
  }, overrides || {});
}

(function () {
  const mod = cargarModulo_();
  const r = mod.inventarioMovimientoCrear_(itemBase_(), usuario);
  assert.equal(r.ok, true);
  assert.equal(libro.length, 1);
  assert.ok(libro[0].cantidad > 0);
  assert.equal(libro[0].signo, 1);
  console.log('crear entrada: OK');
})();

(function () {
  const mod = cargarModulo_();
  const r = mod.inventarioMovimientoCrear_(itemBase_({
    tipo_movimiento: 'Merma en sede',
    cantidad: 2,
    clave_idempotencia: 'Ajuste|aj-2|Merma en sede|0'
  }), usuario);
  assert.equal(r.ok, true);
  assert.ok(libro[0].cantidad < 0);
  assert.equal(libro[0].signo, -1);
  console.log('crear salida: OK');
})();

(function () {
  const mod = cargarModulo_();
  const r = mod.inventarioMovimientoCrear_(itemBase_({ cantidad: 0 }), usuario);
  assert.equal(r.ok, false);
  assert.equal(libro.length, 0);
  console.log('rechazar cantidad cero: OK');
})();

(function () {
  const mod = cargarModulo_();
  const r = mod.inventarioMovimientoCrear_(itemBase_({ tipo_movimiento: 'Tipo inventado' }), usuario);
  assert.equal(r.ok, false);
  console.log('rechazar tipo inválido: OK');
})();

(function () {
  const mod = cargarModulo_();
  const item = itemBase_();
  const r1 = mod.inventarioMovimientoCrear_(item, usuario);
  const r2 = mod.inventarioMovimientoCrear_(item, usuario);
  assert.equal(r1.ok, true);
  assert.equal(r2.ok, true);
  assert.equal(r2.repetido, true);
  assert.equal(libro.length, 1);
  console.log('evitar movimiento duplicado: OK');
})();

(function () {
  const mod = cargarModulo_();
  const lote = mod.inventarioMovimientoCrearLote_([
    itemBase_({ clave_idempotencia: 'k1' }),
    itemBase_({ clave_idempotencia: 'k2', tipo_movimiento: 'Merma en sede', cantidad: 1 })
  ], usuario);
  assert.equal(lote.ok, true);
  assert.equal(lote.creados, 2);
  assert.equal(libro.length, 2);
  console.log('crear movimientos por lote: OK');
})();

(function () {
  const mod = cargarModulo_();
  const creado = mod.inventarioMovimientoCrear_(itemBase_(), usuario);
  const rev = mod.inventarioMovimientoRevertir_(creado.id, usuario, 'corrección');
  assert.equal(rev.ok, true);
  assert.equal(libro.length, 2);
  assert.ok(libro[1].cantidad < 0);
  assert.equal(libro[0].estado, 'Revertido');
  console.log('revertir movimiento: OK');
})();

(function () {
  const mod = cargarModulo_();
  const creado = mod.inventarioMovimientoCrear_(itemBase_(), usuario);
  mod.inventarioMovimientoRevertir_(creado.id, usuario, 'una vez');
  const rev2 = mod.inventarioMovimientoRevertir_(creado.id, usuario, 'otra vez');
  assert.equal(rev2.ok, false);
  console.log('impedir reversión duplicada: OK');
})();

(function () {
  const mod = cargarModulo_();
  props.INVENTARIO_LIBRO_ACTIVO = 'false';
  assert.equal(mod.inventarioLibroActivo_(), false);
  mod.inventarioLibroConfigurarActivo_(true);
  assert.equal(mod.inventarioLibroActivo_(), true);
  console.log('bandera de activación: OK');
})();

(function () {
  reiniciar_();
  const movimientosVista = [
    { fecha: '2026-07-01', producto: 'Aceite', cantidad: 3, unidad: 'L', sede: 'Capri', tipo_movimiento: 'Compra recibida', documento_relacionado: 'a1', usuario: 'Ana', estado: 'Registrado' },
    { fecha: '2026-07-02', producto: 'Aioli', cantidad: 2, unidad: 'kg', sede: 'Capri', tipo_movimiento: 'Entrada por producción', documento_relacionado: 'p1', usuario: 'Ana', estado: 'Registrado' },
    { fecha: '2026-07-03', producto: 'Costilla', cantidad: -4, unidad: 'kg', sede: 'Centro de Producción', tipo_movimiento: 'Traslado enviado', documento_relacionado: 't1', usuario: 'Juan', estado: 'Confirmado' },
    { fecha: '2026-07-03', producto: 'Costilla', cantidad: 4, unidad: 'kg', sede: 'Capri', tipo_movimiento: 'Traslado recibido', documento_relacionado: 't1', usuario: 'Ana', estado: 'Confirmado' }
  ];
  const escritos = [];
  const mod = cargar('apps-script/InventarioMovimientos.gs', {
    SHEET_NAMES: { MOVIMIENTOS_INVENTARIO: 'Movimientos_Inventario' },
    MOVIMIENTO_TIPOS_SIGNO_: { 'Compra recibida': 1, 'Traslado enviado': -1, 'Traslado recibido': 1, 'Entrada por producción': 1 },
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => null, setProperty: () => {} }) },
    Utilities: { getUuid: () => 'x' },
    formatearFecha_: (v) => String(v).slice(0, 10),
    leerTabla_: (hoja) => hoja === 'Movimientos_Inventario' ? escritos : [],
    inventarioLibroClave_: (t, id, tipo, s) => [t, id, tipo, s].join('|'),
    movimientosInventarioListar_: () => movimientosVista.slice(),
    inventarioLibroItemDesdeVista_: (vista, meta) => Object.assign({}, vista, meta)
  });
  mod.inventarioMovimientoCrear_ = (item) => {
    escritos.push({ clave_idempotencia: item.clave_idempotencia, producto: item.producto });
    return { ok: true, id: 'm' + escritos.length };
  };
  const sim = mod.migracionInventarioSimular_();
  assert.equal(sim.ok, true);
  assert.equal(sim.reporte.encontrados, 4);
  assert.equal(sim.reporte.migrables, 4);
  const sim2 = mod.migracionInventarioSimular_();
  assert.equal(sim2.reporte.omitidos_duplicado, 0, 'simular dos veces sin escribir no debe marcar duplicados');
  const ejec = mod.migracionInventarioEjecutar_({ id: 'admin', nombre: 'Admin' });
  assert.equal(ejec.ok, true);
  assert.equal(ejec.reporte.creados, 4);
  assert.equal(escritos.length, 4);
  const sim3 = mod.migracionInventarioSimular_();
  assert.equal(sim3.reporte.omitidos_duplicado, 4, 'tras ejecutar, todo debe figurar como ya migrado');
  console.log('migración simulación y ejecución: OK');
})();

(function () {
  const mod = cargarModulo_();
  const payload = '=SUM(A1:A9)';
  const fila = mod.inventarioMovimientoFila_(itemBase_({ observacion: payload }), usuario);
  assert.equal(fila.observacion, payload);
  console.log('neutralización en fila (delegada a neutralizarObjetoFormulas_): OK');
})();

(function () {
  const mod = cargarModulo_();
  mod.inventarioMovimientoCrear_(itemBase_(), usuario);
  assert.equal(auditLog.length, 1);
  assert.equal(auditLog[0][1], 'inventario_movimiento_creado');
  console.log('registro de auditoría: OK');
})();

console.log('inventario-movimientos: OK');
