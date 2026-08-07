/**
 * CajaTurno.gs: cajaUltimoCierreAntes_ (usada por cajaBaseEsperada_/cajaSaldoFuerteAntes_) decidía
 * si un cierre contaba como "anterior a hoy" comparando timestamp_cierre/hora_cierre (la hora REAL
 * en que se dio clic en "Cerrar caja") contra la medianoche del día consultado. Un cierre tarde en
 * la noche — común en un restaurante, cerrando después de medianoche el turno de "ayer" — quedaba
 * con un timestamp_cierre que ya pertenece al día calendario siguiente: comparado contra la
 * medianoche de "hoy", ese cierre real dejaba de contar como anterior, y cajaEstado_/cajaAbrir_ del
 * día siguiente mostraban $0 de base y caja fuerte esperadas, como si el cierre de ayer nunca
 * hubiera pasado. Reporte real: "por qué me sale efectivo esperado en cero como si no contara lo
 * que se hizo ayer".
 *
 * La corrección: decidir "anterior" por la fecha DE NEGOCIO del turno (r.fecha), nunca por la hora
 * real del clic — timestamp_cierre/hora_cierre solo desempatan entre cierres de una misma fecha.
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
  'entrega_cierre', 'persona_recibe_cierre', 'base_siguiente', 'usuario_cierre', 'hora_cierre',
  'observacion_cierre', 'timestamp_cierre'
];

function fakeHoja_(headers, filas) {
  return {
    getDataRange: () => ({
      getValues: () => [headers].concat(filas.map((o) => headers.map((h) => (o[h] !== undefined ? o[h] : ''))))
    }),
    getRange: (fila, col) => ({ setValue: (v) => { filas[fila - 2][headers[col - 1]] = v; } })
  };
}

function construirEntorno_() {
  const turnos = [];
  const movimientos = [];
  const SHEET_NAMES = { CAJA_TURNO: 'caja_turno', CAJA_MOVIMIENTOS: 'caja_movimientos' };

  // Reloj controlable — igual patrón que tests/helpers/entorno-apps-script.js: `new Date()` dentro
  // del código cargado debe poder moverse a mano, porque esta prueba compara justo el momento REAL
  // del cierre contra la fecha de negocio consultada.
  let desplazamiento = 0;
  const DateReal = Date;
  class FechaControlada extends DateReal {
    constructor(...args) { if (args.length === 0) super(DateReal.now() + desplazamiento); else super(...args); }
    static now() { return DateReal.now() + desplazamiento; }
  }
  function fijarReloj(instante) { desplazamiento = new DateReal(instante).getTime() - DateReal.now(); }

  const ctx = {
    console,
    SHEET_NAMES,
    Date: FechaControlada,
    sheet_: (nombre) => (nombre === SHEET_NAMES.CAJA_TURNO ? fakeHoja_(TURNO_HEADERS, turnos) : fakeHoja_([], movimientos)),
    leerTabla_: (nombre) => (nombre === SHEET_NAMES.CAJA_TURNO ? turnos : movimientos),
    appendRowFromObj_: (nombre, fila) => { (nombre === SHEET_NAMES.CAJA_TURNO ? turnos : movimientos).push(fila); },
    asegurarColumnas_: () => {},
    formatearFecha_: (v) => {
      if (v instanceof Date) {
        const p = (n) => String(n).padStart(2, '0');
        return `${v.getFullYear()}-${p(v.getMonth() + 1)}-${p(v.getDate())}`;
      }
      return String(v).slice(0, 10);
    },
    neutralizarObjetoFormulas_: (obj) => obj,
    sedeEscrituraPermitida_: () => true,
    auditoriaRegistrar_: () => {},
    turnoSectorDeHoy_: () => ({ sector: 'Caja' }),
    Utilities: { getUuid: () => 'caja-turno-' + Math.random() },
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => null }) },
    CacheService: { getScriptCache: () => ({ get: () => null, put: () => {} }) }
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync('apps-script/CajaTurno.gs', 'utf8'), ctx, { filename: 'CajaTurno.gs' });
  return { ctx, turnos, fijarReloj };
}

const administrador = { nombre: 'Diana', rol: 'Administrador', id: 'u1' };

// --- Cierre normal, mismo día calendario: la base pasa correctamente al día siguiente -------------
{
  const { ctx, fijarReloj } = construirEntorno_();
  fijarReloj(new Date(2026, 7, 6, 8, 0, 0));
  ctx.cajaAbrir_({ fecha: '2026-08-06', sede: 'San Antonio', base_inicial: 100000, caja_fuerte_inicial: 0 }, administrador);
  fijarReloj(new Date(2026, 7, 6, 22, 0, 0));
  const cierre = ctx.cajaCerrar_({ fecha: '2026-08-06', sede: 'San Antonio', efectivo_contado: 100000, caja_fuerte_contada: 0, base_siguiente: 120000, persona_recibe_cierre: 'Diana' }, administrador);
  assert.equal(cierre.ok, true);

  fijarReloj(new Date(2026, 7, 7, 8, 0, 0));
  const estado = ctx.cajaEstado_('2026-08-07', 'San Antonio', administrador);
  assert.equal(estado.base_esperada, 120000, 'un cierre normal (mismo día) debe pasar la base al día siguiente');
}

// --- Cierre después de medianoche real, para el turno de "ayer": debe seguir contando -------------
{
  const { ctx, fijarReloj } = construirEntorno_();
  fijarReloj(new Date(2026, 7, 6, 8, 0, 0));
  ctx.cajaAbrir_({ fecha: '2026-08-06', sede: 'San Antonio', base_inicial: 100000, caja_fuerte_inicial: 0 }, administrador);

  // El clic en "Cerrar caja" ocurre a las 00:15 del 7 de agosto (después de medianoche real), pero
  // el turno que se cierra sigue siendo el del 6 de agosto (fecha de negocio).
  fijarReloj(new Date(2026, 7, 7, 0, 15, 0));
  const cierre = ctx.cajaCerrar_({ fecha: '2026-08-06', sede: 'San Antonio', efectivo_contado: 100000, caja_fuerte_contada: 0, base_siguiente: 120000, persona_recibe_cierre: 'Diana' }, administrador);
  assert.equal(cierre.ok, true, 'debe poder cerrarse el turno de ayer aunque el reloj real ya haya cruzado la medianoche');

  fijarReloj(new Date(2026, 7, 7, 8, 0, 0));
  const estado = ctx.cajaEstado_('2026-08-07', 'San Antonio', administrador);
  assert.equal(estado.base_esperada, 120000, 'un cierre tarde en la noche (después de medianoche real) para el turno de ayer debe seguir contando al consultar hoy — no debe verse como si nunca hubiera pasado');

  const abrir = ctx.cajaAbrir_({ fecha: '2026-08-07', sede: 'San Antonio', base_inicial: 120000, caja_fuerte_inicial: 0 }, administrador);
  assert.equal(abrir.ok, true);
  assert.equal(abrir.item.diferencia_apertura, 0, 'contando exactamente lo que dejó el cierre de ayer, no debe verse ninguna diferencia');
}

console.log('caja-cierre-medianoche: OK');
