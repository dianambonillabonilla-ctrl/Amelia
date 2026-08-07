/**
 * CajaTurno.gs (consolidado — antes esta prueba cargaba CajaTurno.gs + CajaV2.gs por separado,
 * hasta que ambos archivos declaraban las mismas funciones globales y competían entre sí según el
 * orden de carga; CajaV2.gs se eliminó y todo quedó en un solo archivo): al abrir o cerrar con una
 * diferencia (efectivo o caja fuerte), solo un Administrador puede aprobarlo — Encargado/Cocina
 * deben poder hacerlo libremente cuando todo cuadra, pero una descuadre necesita que alguien con
 * ese rol lo revise antes de dar el turno por abierto/cerrado.
 *
 * Sin FUDO_API_KEY/SECRET configuradas (como en esta prueba), cajaSincronizarFudo_ no aplica —
 * cajaAbrir_/cajaCerrar_/cajaEstado_ se comportan exactamente igual que si esa validación no
 * existiera, así que estas pruebas no necesitan simular CacheService ni la API de FUDO.
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
  // cajaMigrarHistorico_ inyecta, la primera vez que no encuentra su propio id ya guardado, tres
  // movimientos históricos fijos (San Antonio y Capri, agosto 2026). Son correcciones de hechos
  // reales (una migración de datos, no algo que estas pruebas deban ejercitar), así que se
  // pre-cargan sus IDs para que la migración los vea como "ya existentes" y no los repita — igual
  // que en el deployment real después de la primera vez que corrió.
  const movimientos = [
    { id: 'migracion-caja-fuerte-sa-20260802', fecha: '2026-08-02', sede: 'San Antonio', tipo: 'Envío a caja fuerte', valor: 1000000 },
    { id: 'migracion-entrega-admin-capri-20260803', fecha: '2026-08-03', sede: 'Capri', tipo: 'Entrega administrador desde caja', valor: 550000 },
    { id: 'migracion-retiro-fuerte-sa-20260803', fecha: '2026-08-03', sede: 'San Antonio', tipo: 'Entrega administrador desde caja fuerte', valor: 1000000 }
  ];
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
    // cajaPuedeCerrar_ solo cae aquí cuando el rol no es Administrador/Encargado (Cocina) — se
    // simula que sí tiene el sector "Caja" asignado hoy, para que estas pruebas ejerciten la regla
    // de diferencia (lo que de verdad les interesa) y no la de asignación de sector.
    turnoSectorDeHoy_: () => ({ sector: 'Caja' }),
    Utilities: { getUuid: () => 'caja-turno-' + (turnos.length + movimientos.length + 1) },
    // Sin FUDO_API_KEY/SECRET: cajaFudoCredencialesConfiguradas_ da false y cajaSincronizarFudo_
    // nunca llega a tocar la API real — pero cajaLeerEstadoFudo_ (para leer lo último en caché) sí
    // toca CacheService siempre, así que necesita un mock mínimo aunque nunca se le escriba nada.
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => null }) },
    CacheService: { getScriptCache: () => ({ get: () => null, put: () => {} }) }
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync('apps-script/CajaTurno.gs', 'utf8'), ctx, { filename: 'CajaTurno.gs' });
  return { ctx, turnos, movimientos };
}

function abrirTurno_(ctx, turnos, overrides) {
  turnos.push(Object.assign({
    id: 't1', fecha: '2026-07-15', sede: 'San Antonio', estado: 'Abierto',
    base_esperada: 0, base_inicial: 100000, efectivo_fudo_al_abrir: 0,
    caja_fuerte_inicial: 0
  }, overrides));
}

const administrador = { nombre: 'Diana', rol: 'Administrador' };
const encargada = { nombre: 'Ana', rol: 'Encargado' };
const cocina = { nombre: 'Luis', rol: 'Cocina' };

// --- cajaCerrar_ ----------------------------------------------------------------------------------

// Sin ninguna diferencia: Encargado/Cocina cierran sin problema.
{
  const { ctx, turnos } = construirEntorno_();
  abrirTurno_(ctx, turnos, { base_inicial: 100000, caja_fuerte_inicial: 0 });
  const r = ctx.cajaCerrar_({ fecha: '2026-07-15', sede: 'San Antonio', efectivo_contado: 100000, caja_fuerte_contada: 0 }, encargada);
  assert.equal(r.ok, true, 'Encargado debe poder cerrar cuando lo contado coincide exactamente con lo esperado');
  assert.equal(r.diferencia, 0);
}

// Diferencia en efectivo: Encargado NO puede cerrar.
{
  const { ctx, turnos } = construirEntorno_();
  abrirTurno_(ctx, turnos, { base_inicial: 100000, caja_fuerte_inicial: 0 });
  const r = ctx.cajaCerrar_({ fecha: '2026-07-15', sede: 'San Antonio', efectivo_contado: 90000, caja_fuerte_contada: 0, observacion: 'faltan 10.000' }, encargada);
  assert.equal(r.ok, false, 'Encargado NO debe poder cerrar con diferencia en efectivo, ni con observación');
  assert.match(r.error, /Solo un Administrador puede cerrar/);
  assert.equal(turnos[0].estado, 'Abierto', 'la caja debe seguir abierta: el intento bloqueado no debe cerrarla');
}

// Diferencia en efectivo: Cocina tampoco puede cerrar.
{
  const { ctx, turnos } = construirEntorno_();
  abrirTurno_(ctx, turnos, { base_inicial: 100000, caja_fuerte_inicial: 0 });
  const r = ctx.cajaCerrar_({ fecha: '2026-07-15', sede: 'San Antonio', efectivo_contado: 90000, caja_fuerte_contada: 0 }, cocina);
  assert.equal(r.ok, false, 'Cocina tampoco debe poder cerrar con diferencia');
}

// Diferencia solo en caja fuerte (efectivo cuadra): tampoco puede un Encargado.
{
  const { ctx, turnos } = construirEntorno_();
  abrirTurno_(ctx, turnos, { base_inicial: 100000, caja_fuerte_inicial: 500000 });
  const r = ctx.cajaCerrar_({ fecha: '2026-07-15', sede: 'San Antonio', efectivo_contado: 100000, caja_fuerte_contada: 400000 }, encargada);
  assert.equal(r.ok, false, 'una diferencia SOLO en caja fuerte también debe bloquear a Encargado');
  assert.match(r.error, /Solo un Administrador puede cerrar/);
}

// Administrador SÍ puede cerrar con diferencia.
{
  const { ctx, turnos } = construirEntorno_();
  abrirTurno_(ctx, turnos, { base_inicial: 100000, caja_fuerte_inicial: 0 });
  const r = ctx.cajaCerrar_({ fecha: '2026-07-15', sede: 'San Antonio', efectivo_contado: 90000, caja_fuerte_contada: 0, observacion: 'faltan 10.000, reportado a gerencia' }, administrador);
  assert.equal(r.ok, true, 'Administrador debe poder cerrar aunque haya diferencia');
  assert.equal(r.diferencia, -10000);
  assert.equal(turnos[0].estado, 'Cerrado');
}

// --- cajaAbrir_: misma regla al ABRIR — con diferencia, solo un Administrador puede aprobar --------

// Sin ninguna diferencia (nada previo cerrado => esperado 0 y 0): Encargado abre sin problema.
{
  const { ctx, turnos } = construirEntorno_();
  const r = ctx.cajaAbrir_({ fecha: '2026-07-15', sede: 'San Antonio', base_inicial: 0, caja_fuerte_inicial: 0 }, encargada);
  assert.equal(r.ok, true, 'Encargado debe poder abrir cuando lo contado coincide con lo esperado');
  assert.equal(turnos.length, 1);
}

// Diferencia en base (efectivo): Encargado NO puede abrir.
{
  const { ctx, turnos } = construirEntorno_();
  const r = ctx.cajaAbrir_({ fecha: '2026-07-15', sede: 'San Antonio', base_inicial: 50000, caja_fuerte_inicial: 0, observacion_apertura: 'sobra efectivo' }, encargada);
  assert.equal(r.ok, false, 'Encargado NO debe poder abrir con diferencia en la base, ni con observación');
  assert.match(r.error, /Solo un Administrador puede aprobar la apertura/);
  assert.equal(turnos.length, 0, 'no debe quedar ninguna fila creada cuando se bloquea la apertura');
}

// Diferencia solo en caja fuerte (base cuadra): tampoco puede un Encargado ni Cocina.
{
  const { ctx, turnos } = construirEntorno_();
  const r = ctx.cajaAbrir_({ fecha: '2026-07-15', sede: 'San Antonio', base_inicial: 0, caja_fuerte_inicial: 100000 }, cocina);
  assert.equal(r.ok, false, 'una diferencia SOLO en caja fuerte también debe bloquear a Cocina al abrir');
  assert.match(r.error, /Solo un Administrador puede aprobar la apertura/);
  assert.equal(turnos.length, 0);
}

// Administrador SÍ puede abrir con diferencia, pero necesita observación.
{
  const { ctx, turnos } = construirEntorno_();
  const sinObs = ctx.cajaAbrir_({ fecha: '2026-07-15', sede: 'San Antonio', base_inicial: 50000, caja_fuerte_inicial: 100000 }, administrador);
  assert.equal(sinObs.ok, false, 'Administrador no debe poder abrir con diferencia sin observación');
  assert.match(sinObs.error, /observación/i);
  assert.equal(turnos.length, 0);

  const r = ctx.cajaAbrir_({ fecha: '2026-07-15', sede: 'San Antonio', base_inicial: 50000, caja_fuerte_inicial: 100000, observacion_apertura: 'caja fuerte vacía, reportado' }, administrador);
  assert.equal(r.ok, true, 'Administrador debe poder abrir aunque haya diferencia');
  assert.equal(turnos.length, 1);
  assert.equal(turnos[0].diferencia_apertura, 50000);
  assert.equal(turnos[0].diferencia_caja_fuerte_apertura, 100000);
}

// base_siguiente mayor al contado no debe aceptarse (corrupcía la base del día siguiente).
{
  const { ctx, turnos } = construirEntorno_();
  abrirTurno_(ctx, turnos, { base_inicial: 100000, caja_fuerte_inicial: 0 });
  const r = ctx.cajaCerrar_({ fecha: '2026-07-15', sede: 'San Antonio', efectivo_contado: 80000, base_siguiente: 100000, observacion: 'faltante' }, administrador);
  assert.equal(r.ok, false, 'base_siguiente > contado debe rechazarse');
  assert.match(r.error, /base siguiente/i);
  assert.equal(turnos[0].estado, 'Abierto');
}

// --- Sin credenciales de FUDO configuradas, cuadre_confiable no debe bloquear nada -----------------
{
  const { ctx, turnos } = construirEntorno_();
  const estado = ctx.cajaEstado_('2026-07-15', 'San Antonio', encargada);
  assert.equal(estado.cuadre_confiable, true, 'sin credenciales de FUDO, el cuadre debe considerarse confiable (la validación no aplica)');
}

console.log('caja-v2: OK');
