/**
 * CajaV2.gs: al cerrar con una diferencia (efectivo o caja fuerte), solo un Administrador puede
 * hacerlo — Encargado/Cocina deben poder cerrar libremente cuando todo cuadra, pero una descuadre
 * necesita que alguien con ese rol lo revise antes de dar el turno por cerrado.
 *
 * CajaV2.gs depende de funciones definidas en CajaTurno.gs (cajaTurnoFila_, cajaBaseEsperada_,
 * cajaMovimientosDelDia_, cajaTurnoActualizarFila_) — en el deployment real ambos archivos
 * comparten un mismo scope global de Apps Script, así que aquí se cargan los dos en el mismo
 * contexto, en el mismo orden (CajaTurno.gs primero), para que CajaV2.gs redefina cajaAbrir_/
 * cajaEstado_/cajaCerrar_ igual que en producción.
 */
const fs = require('fs');
const vm = require('vm');
const assert = require('assert');

const TURNO_HEADERS = [
  'id', 'fecha', 'sede', 'estado',
  'base_esperada', 'base_inicial', 'diferencia_apertura', 'observacion_apertura',
  'caja_fuerte_esperada_apertura', 'caja_fuerte_inicial', 'diferencia_caja_fuerte_apertura',
  'hora_apertura', 'usuario_apertura_id', 'usuario_apertura', 'efectivo_fudo_al_abrir',
  'rappi_encendido', 'rappi_confirmado_por', 'rappi_confirmado_en',
  'efectivo_contado', 'efectivo_esperado', 'diferencia',
  'caja_fuerte_contada', 'caja_fuerte_esperada', 'diferencia_caja_fuerte', 'caja_fuerte_siguiente',
  'entrega_cierre', 'persona_recibe_cierre', 'base_siguiente',
  'usuario_cierre', 'hora_cierre', 'observacion_cierre', 'timestamp_cierre'
];
const MOVIMIENTOS_HEADERS = [
  'id', 'fecha', 'sede', 'tipo', 'valor', 'persona_entrega', 'persona_recibe',
  'hora', 'motivo', 'evidencia_url', 'usuario_id', 'usuario', 'timestamp'
];

// Hoja falsa que vive sobre un array de OBJETOS (no arrays crudos): leerTabla_ lee ese mismo
// array directamente, y sh.getRange(fila, col).setValue(v) (cajaTurnoActualizarFila_ escribe
// celda por celda, no por lotes) escribe de vuelta en el objeto correspondiente.
function fakeHojaObjetos_(headers, filas) {
  return {
    getDataRange: () => ({
      getValues: () => [headers].concat(filas.map((o) => headers.map((h) => (o[h] !== undefined ? o[h] : ''))))
    }),
    getRange: (fila, col) => ({
      setValue: (v) => { filas[fila - 2][headers[col - 1]] = v; }
    })
  };
}

function construirEntorno_() {
  const turnos = [];
  const movimientos = [];
  const SHEET_NAMES = { CAJA_TURNO: 'caja_turno', CAJA_MOVIMIENTOS: 'caja_movimientos' };
  const hojas = {
    [SHEET_NAMES.CAJA_TURNO]: () => fakeHojaObjetos_(TURNO_HEADERS, turnos),
    [SHEET_NAMES.CAJA_MOVIMIENTOS]: () => fakeHojaObjetos_(MOVIMIENTOS_HEADERS, movimientos)
  };
  const tablas = { [SHEET_NAMES.CAJA_TURNO]: turnos, [SHEET_NAMES.CAJA_MOVIMIENTOS]: movimientos };

  const ctx = {
    console,
    SHEET_NAMES,
    sheet_: (nombre) => hojas[nombre](),
    leerTabla_: (nombre) => tablas[nombre] || [],
    appendRowFromObj_: (nombre, fila) => { if (tablas[nombre]) tablas[nombre].push(fila); },
    asegurarColumnas_: () => {},
    formatearFecha_: (v) => String(v).slice(0, 10),
    neutralizarObjetoFormulas_: (obj) => obj,
    sedeEscrituraPermitida_: () => true,
    auditoriaRegistrar_: () => {},
    Utilities: { getUuid: () => 'caja-turno-' + (turnos.length + movimientos.length + 1) }
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync('apps-script/CajaTurno.gs', 'utf8'), ctx, { filename: 'CajaTurno.gs' });
  vm.runInContext(fs.readFileSync('apps-script/CajaV2.gs', 'utf8'), ctx, { filename: 'CajaV2.gs' });
  return { ctx, turnos, movimientos };
}

function abrirTurno_(ctx, turnos, overrides) {
  turnos.push(Object.assign({
    id: 't1', fecha: '2026-08-06', sede: 'San Antonio', estado: 'Abierto',
    base_esperada: 0, base_inicial: 100000, efectivo_fudo_al_abrir: 0,
    caja_fuerte_inicial: 0
  }, overrides));
}

const administrador = { nombre: 'Diana', rol: 'Administrador' };
const encargada = { nombre: 'Ana', rol: 'Encargado' };
const cocina = { nombre: 'Luis', rol: 'Cocina' };

// --- Sin ninguna diferencia: Encargado/Cocina cierran sin problema -------------------------------
{
  const { ctx, turnos } = construirEntorno_();
  abrirTurno_(ctx, turnos, { base_inicial: 100000, caja_fuerte_inicial: 0 });
  const r = ctx.cajaCerrar_({ fecha: '2026-08-06', sede: 'San Antonio', efectivo_contado: 100000, caja_fuerte_contada: 0 }, encargada);
  assert.equal(r.ok, true, 'Encargado debe poder cerrar cuando lo contado coincide exactamente con lo esperado');
  assert.equal(r.diferencia, 0);
}

// --- Diferencia en efectivo: Encargado NO puede cerrar --------------------------------------------
{
  const { ctx, turnos } = construirEntorno_();
  abrirTurno_(ctx, turnos, { base_inicial: 100000, caja_fuerte_inicial: 0 });
  const r = ctx.cajaCerrar_({ fecha: '2026-08-06', sede: 'San Antonio', efectivo_contado: 90000, caja_fuerte_contada: 0, observacion: 'faltan 10.000' }, encargada);
  assert.equal(r.ok, false, 'Encargado NO debe poder cerrar con diferencia en efectivo, ni con observación');
  assert.match(r.error, /Solo un Administrador puede cerrarla/);
  assert.equal(turnos[0].estado, 'Abierto', 'la caja debe seguir abierta: el intento bloqueado no debe cerrarla');
}

// --- Diferencia en efectivo: Cocina tampoco puede cerrar -------------------------------------------
{
  const { ctx, turnos } = construirEntorno_();
  abrirTurno_(ctx, turnos, { base_inicial: 100000, caja_fuerte_inicial: 0 });
  const r = ctx.cajaCerrar_({ fecha: '2026-08-06', sede: 'San Antonio', efectivo_contado: 90000, caja_fuerte_contada: 0 }, cocina);
  assert.equal(r.ok, false, 'Cocina tampoco debe poder cerrar con diferencia');
}

// --- Diferencia solo en caja fuerte (efectivo cuadra): tampoco puede un Encargado -----------------
{
  const { ctx, turnos } = construirEntorno_();
  abrirTurno_(ctx, turnos, { base_inicial: 100000, caja_fuerte_inicial: 500000 });
  const r = ctx.cajaCerrar_({ fecha: '2026-08-06', sede: 'San Antonio', efectivo_contado: 100000, caja_fuerte_contada: 400000 }, encargada);
  assert.equal(r.ok, false, 'una diferencia SOLO en caja fuerte también debe bloquear a Encargado');
  assert.match(r.error, /Solo un Administrador puede cerrarla/);
}

// --- Administrador SÍ puede cerrar con diferencia --------------------------------------------------
{
  const { ctx, turnos } = construirEntorno_();
  abrirTurno_(ctx, turnos, { base_inicial: 100000, caja_fuerte_inicial: 0 });
  const r = ctx.cajaCerrar_({ fecha: '2026-08-06', sede: 'San Antonio', efectivo_contado: 90000, caja_fuerte_contada: 0, observacion: 'faltan 10.000, reportado a gerencia' }, administrador);
  assert.equal(r.ok, true, 'Administrador debe poder cerrar aunque haya diferencia');
  assert.equal(r.diferencia, -10000);
  assert.equal(turnos[0].estado, 'Cerrado');
}

console.log('caja-v2: OK');
