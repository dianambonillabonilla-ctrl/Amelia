/**
 * CajaTurno.gs/CajaV2.gs: antes de mostrar el estado de caja o de dejar cerrar como "cuadrado",
 * se intenta refrescar FUDO si la última sincronización conocida está vieja o falló — ver
 * cajaFudoAsegurarFrescura_ (CajaTurno.gs). Reporte real: Caja solo miraba lo que ya hubiera en
 * Pagos_FUDO/Fudo_Pagos, sin forzar ni validar que estuviera al día, así que un cuadre podía
 * compararse contra datos atrasados sin que nadie se enterara.
 *
 * Aquí se prueba cajaFudoAsegurarFrescura_ y su efecto en cajaEstado_/cajaCerrar_ con FUDO_API_KEY/
 * SECRET falsos y fudoApiSincronizarVentas_/Pagos_ reemplazadas por versiones controlables — no
 * hace falta cargar el FudoApi.gs real (665 líneas, red incluida) para esto: cajaFudoAsegurarFrescura_
 * solo le pide a esas dos funciones (por nombre, via typeof) que existan y, si fallan, se comporta
 * igual que si la API real hubiera fallado.
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

/**
 * `comportamiento.credenciales` — si es false, FUDO_API_KEY/SECRET no existen (instalación sin la
 * integración activa). `comportamiento.sync` — registro que devuelve fudoApiSyncLeer_('pagos') tal
 * cual (o null si nunca sincronizó). `comportamiento.alSincronizar` — función que se ejecuta cuando
 * cajaFudoAsegurarFrescura_ intenta un sync en vivo: puede lanzar (simula que la API real falló) o
 * actualizar `comportamiento.sync` a un registro fresco (simula que sí funcionó).
 */
function construirEntorno_(comportamiento) {
  const turnos = [];
  const props = new Map();
  if (comportamiento.credenciales !== false) {
    props.set('FUDO_API_KEY', 'clave-de-prueba');
    props.set('FUDO_API_SECRET', 'secreto-de-prueba');
  }
  let intentosSincronizacion = 0;

  const SHEET_NAMES = { CAJA_TURNO: 'caja_turno', CAJA_MOVIMIENTOS: 'caja_movimientos' };
  const ctx = {
    console,
    SHEET_NAMES,
    sheet_: (nombre) => nombre === SHEET_NAMES.CAJA_TURNO ? fakeHojaObjetos_(TURNO_HEADERS, turnos) : fakeHojaObjetos_([], []),
    leerTabla_: (nombre) => (nombre === SHEET_NAMES.CAJA_TURNO ? turnos : []),
    appendRowFromObj_: (nombre, fila) => { if (nombre === SHEET_NAMES.CAJA_TURNO) turnos.push(fila); },
    asegurarColumnas_: () => {},
    formatearFecha_: (v) => String(v).slice(0, 10),
    neutralizarObjetoFormulas_: (obj) => obj,
    sedeEscrituraPermitida_: () => true,
    auditoriaRegistrar_: () => {},
    Utilities: { getUuid: () => 'caja-turno-' + (turnos.length + 1) },
    Logger: { log: () => {} },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => (props.has(k) ? props.get(k) : null) }) },
    fudoApiSyncLeer_: (tipo) => (tipo === 'pagos' ? comportamiento.sync || null : null),
    fudoApiSincronizarVentas_: () => {},
    fudoApiSincronizarPagos_: () => {
      intentosSincronizacion++;
      comportamiento.alSincronizar(comportamiento);
    }
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync('apps-script/CajaTurno.gs', 'utf8'), ctx, { filename: 'CajaTurno.gs' });
  vm.runInContext(fs.readFileSync('apps-script/CajaV2.gs', 'utf8'), ctx, { filename: 'CajaV2.gs' });
  return { ctx, turnos, intentos: () => intentosSincronizacion };
}

function abrirTurno_(turnos, overrides) {
  turnos.push(Object.assign({
    id: 't1', fecha: '2026-08-06', sede: 'San Antonio', estado: 'Abierto',
    base_esperada: 0, base_inicial: 100000, efectivo_fudo_al_abrir: 0,
    caja_fuerte_inicial: 0
  }, overrides));
}

const administrador = { nombre: 'Diana', rol: 'Administrador' };
const encargada = { nombre: 'Ana', rol: 'Encargado' };

// --- Sin credenciales de la API: no aplica, no bloquea nada (igual que antes de este cambio) -----
{
  const { ctx, turnos, intentos } = construirEntorno_({
    credenciales: false, sync: null, alSincronizar: () => { throw new Error('no debería llamarse'); }
  });
  abrirTurno_(turnos, { base_inicial: 100000, caja_fuerte_inicial: 0 });
  const estado = ctx.cajaEstado_('2026-08-06', 'San Antonio', encargada);
  assert.equal(estado.fudo_sync.aplica, false, 'sin credenciales, el chequeo de frescura no debe aplicar');
  const r = ctx.cajaCerrar_({ fecha: '2026-08-06', sede: 'San Antonio', efectivo_contado: 100000, caja_fuerte_contada: 0 }, encargada);
  assert.equal(r.ok, true, 'sin credenciales, un cuadre exacto debe poder cerrarse igual que siempre');
  assert.equal(intentos(), 0, 'sin credenciales no debe intentar ninguna sincronización en vivo');
}

// --- Con credenciales y una sincronización ya fresca: no reintenta contra la red -----------------
{
  const ahora = new Date().toISOString();
  const { ctx, turnos, intentos } = construirEntorno_({
    credenciales: true, sync: { timestamp: ahora, ok: true },
    alSincronizar: () => { throw new Error('no debería reintentar si ya está fresco'); }
  });
  abrirTurno_(turnos, { base_inicial: 100000, caja_fuerte_inicial: 0 });
  const estado = ctx.cajaEstado_('2026-08-06', 'San Antonio', encargada);
  assert.equal(estado.fudo_sync.aplica, true);
  assert.equal(estado.fudo_sync.confiable, true, 'una sincronización de hace un momento debe considerarse confiable');
  assert.equal(intentos(), 0, 'con una sincronización fresca no debe intentar otra en vivo');
}

// --- Con credenciales y sincronización vieja: intenta en vivo y, si funciona, queda confiable ----
{
  const comportamiento = {
    credenciales: true,
    sync: { timestamp: new Date(Date.now() - 60 * 60000).toISOString(), ok: true }, // hace 1 hora
    alSincronizar: (c) => { c.sync = { timestamp: new Date().toISOString(), ok: true }; }
  };
  const { ctx, turnos, intentos } = construirEntorno_(comportamiento);
  abrirTurno_(turnos, { base_inicial: 100000, caja_fuerte_inicial: 0 });
  const estado = ctx.cajaEstado_('2026-08-06', 'San Antonio', encargada);
  assert.equal(intentos(), 1, 'una sincronización vieja debe disparar un intento en vivo');
  assert.equal(estado.fudo_sync.confiable, true, 'si el intento en vivo funciona, queda confiable');
}

// --- Con credenciales y la sincronización en vivo FALLA: no confiable, bloquea a Encargado --------
{
  const comportamiento = {
    credenciales: true, sync: null,
    alSincronizar: () => { throw new Error('FUDO caído (simulado)'); }
  };
  const { ctx, turnos } = construirEntorno_(comportamiento);
  abrirTurno_(turnos, { base_inicial: 100000, caja_fuerte_inicial: 0 });

  const estado = ctx.cajaEstado_('2026-08-06', 'San Antonio', encargada);
  assert.equal(estado.fudo_sync.aplica, true);
  assert.equal(estado.fudo_sync.confiable, false, 'si el intento en vivo lanza una excepción, no queda confiable');

  const bloqueoEncargada = ctx.cajaCerrar_({ fecha: '2026-08-06', sede: 'San Antonio', efectivo_contado: 100000, caja_fuerte_contada: 0 }, encargada);
  assert.equal(bloqueoEncargada.ok, false, 'Encargado no debe poder cerrar si no se pudo confirmar FUDO');
  assert.match(bloqueoEncargada.error, /Administrador/);
  assert.equal(turnos[0].estado, 'Abierto');

  const bloqueoAdminSinObs = ctx.cajaCerrar_({ fecha: '2026-08-06', sede: 'San Antonio', efectivo_contado: 100000, caja_fuerte_contada: 0 }, administrador);
  assert.equal(bloqueoAdminSinObs.ok, false, 'un Administrador tampoco debe poder cerrar sin dejar una observación de la excepción');
  assert.match(bloqueoAdminSinObs.error, /observación/);

  const cierreAdminConObs = ctx.cajaCerrar_({ fecha: '2026-08-06', sede: 'San Antonio', efectivo_contado: 100000, caja_fuerte_contada: 0, observacion: 'FUDO no sincronizó, cierro con lo contado físicamente' }, administrador);
  assert.equal(cierreAdminConObs.ok, true, 'un Administrador con observación sí puede autorizar el cierre sin FUDO confiable');
  assert.equal(cierreAdminConObs.fudo_confiable, false);
  assert.equal(turnos[0].estado, 'Cerrado');
}

console.log('caja-fudo-frescura: OK');
