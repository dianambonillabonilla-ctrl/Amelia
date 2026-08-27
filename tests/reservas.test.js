/**
 * RESERVAS — flujo completo contra el router real (doPost), Sheet simulado en memoria.
 * Cubre: código automático, mesa obligatoria solo en San Antonio, choque de mesa, estado
 * automático (incluida decoración pendiente/pagada), validación antes de "Confirmada", y
 * el mapa de mesas reflejando el estado por fecha+hora.
 */
const assert = require('assert');
const { crearEntorno } = require('./helpers/entorno-apps-script.js');

const env = crearEntorno();
env.ctx.configurarHojas();
env.ctx.crearAdministradorInicial_('Diana', 'diana', 'contrasegura1', 'diana@example.com');
const login = env.post({ action: 'login', usuario: 'diana', password: 'contrasegura1' });
assert.strictEqual(login.ok, true);
const token = login.token;

// --- Mesas de San Antonio se siembran solas (11), Capri arranca sin mesas -----------------------
const mesasSA = env.post({ action: 'mesas_listar', token, sede: 'San Antonio' });
assert.strictEqual(mesasSA.data.length, 11);
assert.strictEqual(mesasSA.data[4].numero, '5');
const mesasCapri = env.post({ action: 'mesas_listar', token, sede: 'Capri' });
assert.strictEqual(mesasCapri.data.length, 0);
console.log('mesas: San Antonio siembra 11, Capri arranca vacía: OK');

// --- Crear reserva completa con mesa -> Confirmada, código SA-DDMMYY-001 -------------------------
const item1 = {
  sede: 'San Antonio', fecha: '2026-09-03', hora: '18:00', personas: 2,
  nombre_cliente: 'Karol Alegrias', telefono: '3015566878', motivo: 'Cumpleaños', mesas: ['5']
};
const r1 = env.post({ action: 'reserva_crear', token, item: item1 });
assert.strictEqual(r1.ok, true, JSON.stringify(r1));
assert.strictEqual(r1.item.codigo, 'SA-030926-001');
assert.strictEqual(r1.item.estado, 'Confirmada');
assert.strictEqual(r1.item.hora_limite, '18:15');
assert.strictEqual(r1.validacion.completa, true);
console.log('reserva_crear: completa con mesa queda Confirmada con código SA-030926-001: OK');

// --- Segunda reserva el mismo día, mesa distinta -> consecutivo 002 ------------------------------
const r2 = env.post({ action: 'reserva_crear', token, item: Object.assign({}, item1, { nombre_cliente: 'Laura Gómez', hora: '17:30', mesas: ['3'] }) });
assert.strictEqual(r2.item.codigo, 'SA-030926-002');

// --- San Antonio sin mesa -> Pendiente de asignar mesa, nunca bloquea el guardado ----------------
const r3 = env.post({ action: 'reserva_crear', token, item: Object.assign({}, item1, { nombre_cliente: 'Juan Pérez', hora: '19:30', personas: 8, mesas: [] }) });
assert.strictEqual(r3.ok, true);
assert.strictEqual(r3.item.estado, 'Pendiente de asignar mesa');
assert.strictEqual(r3.validacion.completa, false);
assert(r3.validacion.faltantes.includes('Falta asignar una mesa.'));
console.log('reserva_crear: sin mesa en San Antonio no bloquea, queda Pendiente de asignar mesa: OK');

// --- Choque de mesa: misma mesa 5, horario que se solapa (18:00 y 19:00, ventana de 2h) ----------
const choque = env.post({ action: 'reserva_crear', token, item: Object.assign({}, item1, { nombre_cliente: 'Otra Persona', hora: '19:00', mesas: ['5'] }) });
assert.strictEqual(choque.ok, false);
assert.match(choque.error, /ya tiene una reserva para esta fecha y horario/);
assert.strictEqual(choque.conflicto.codigo, 'SA-030926-001');
console.log('reserva_crear: choque de mesa se rechaza con el código en conflicto: OK');

// Un horario bien separado de la mesa 5 (mismo día) sí se puede reservar.
const rLibre = env.post({ action: 'reserva_crear', token, item: Object.assign({}, item1, { nombre_cliente: 'Ana Ruiz', hora: '21:30', mesas: ['5'] }) });
assert.strictEqual(rLibre.ok, true);

// --- Capri no exige mesa ---------------------------------------------------------------------
const rCapri = env.post({ action: 'reserva_crear', token, item: { sede: 'Capri', fecha: '2026-09-03', hora: '18:00', personas: 4, nombre_cliente: 'Cliente Capri', telefono: '3000000000', motivo: 'Cena' } });
assert.strictEqual(rCapri.ok, true);
assert.strictEqual(rCapri.item.codigo, 'CP-030926-001');
assert.strictEqual(rCapri.item.estado, 'Confirmada');
console.log('reserva_crear: Capri no exige mesa y queda Confirmada: OK');

// --- Decoración: Pendiente de pago hasta que se registre el pago --------------------------------
const rDeco = env.post({ action: 'reserva_crear', token, item: Object.assign({}, item1, { nombre_cliente: 'Con Torta', hora: '12:00', mesas: ['7'], decoracion: true }) });
assert.strictEqual(rDeco.ok, true);
assert.strictEqual(rDeco.item.decoracion_valor, 40000);
assert.strictEqual(rDeco.item.decoracion_estado_pago, 'Pendiente');
assert.strictEqual(rDeco.item.estado, 'Pendiente de pago');

// Marcar "Pagado" sin fecha/medio de pago no bloquea el guardado, pero el estado vuelve a decir que faltan datos.
const rDecoSinDatos = env.post({ action: 'reserva_actualizar', token, id: rDeco.item.id, cambios: { decoracion: true, decoracion_estado_pago: 'Pagado' } });
assert.strictEqual(rDecoSinDatos.ok, true);
assert.strictEqual(rDecoSinDatos.item.estado, 'Pendiente de información');
assert(rDecoSinDatos.validacion.faltantes.some(f => /fecha de pago/.test(f)));

// Completar fecha y medio de pago sí deja la reserva Confirmada.
const rDecoCompleta = env.post({ action: 'reserva_actualizar', token, id: rDeco.item.id, cambios: { decoracion: true, decoracion_estado_pago: 'Pagado', decoracion_fecha_pago: '2026-09-01', decoracion_medio_pago: 'Efectivo' } });
assert.strictEqual(rDecoCompleta.item.estado, 'Confirmada');
console.log('decoración: Pendiente de pago -> bloquea Confirmada sin fecha/medio -> Confirmada al completarlos: OK');

// --- Confirmar manualmente una reserva incompleta debe fallar con la lista de qué falta ----------
const confirmarIncompleta = env.post({ action: 'reserva_cambiar_estado', token, id: r3.item.id, estado: 'Confirmada' });
assert.strictEqual(confirmarIncompleta.ok, false);
assert(confirmarIncompleta.faltantes.includes('Falta asignar una mesa.'));
console.log('reserva_cambiar_estado: no se puede Confirmar si faltan datos: OK');

// Asignar mesa a esa reserva y ahora sí se puede confirmar.
const asignarMesa = env.post({ action: 'reserva_actualizar', token, id: r3.item.id, cambios: { mesas: ['9'] } });
assert.strictEqual(asignarMesa.item.estado, 'Confirmada');

// --- Cliente llegó / Cancelada -------------------------------------------------------------------
const llego = env.post({ action: 'reserva_cambiar_estado', token, id: r1.item.id, estado: 'Cliente llegó' });
assert.strictEqual(llego.ok, true);
const cancelSinMotivo = env.post({ action: 'reserva_cancelar', token, id: r2.item.id, motivo: '' });
assert.strictEqual(cancelSinMotivo.ok, false);
const cancelOk = env.post({ action: 'reserva_cancelar', token, id: r2.item.id, motivo: 'Cliente avisó que no puede venir' });
assert.strictEqual(cancelOk.ok, true);
assert.strictEqual(cancelOk.item.estado, 'Cancelada');
console.log('reserva_cambiar_estado / reserva_cancelar: Cliente llegó y Cancelada (con motivo obligatorio): OK');

// --- Mapa de mesas refleja lo anterior ------------------------------------------------------------
const mapa = env.post({ action: 'mesas_estado', token, sede: 'San Antonio', fecha: '2026-09-03', hora: '18:00' });
const mesa5 = mapa.data.find(m => m.numero === '5');
assert.strictEqual(mesa5.estado, 'llego');
const mesa3 = mapa.data.find(m => m.numero === '3'); // se canceló -> vuelve a libre
assert.strictEqual(mesa3.estado, 'libre');
// 08:00 no se solapa con ninguna reserva de la mesa 5 ese día (18:00 y 21:30, ventana de 2h cada una).
const mesaFueraDeHorario = env.post({ action: 'mesas_estado', token, sede: 'San Antonio', fecha: '2026-09-03', hora: '08:00' });
assert.strictEqual(mesaFueraDeHorario.data.find(m => m.numero === '5').estado, 'libre');
console.log('mesas_estado: refleja Cliente llegó, cancelación liberando mesa y ventana horaria: OK');

// --- Buscar y calendario ---------------------------------------------------------------------
const busqueda = env.post({ action: 'reservas_buscar', token, query: 'SA-030926-001' });
assert.strictEqual(busqueda.data.length, 1);
assert.strictEqual(busqueda.data[0].nombre_cliente, 'Karol Alegrias');

const calendario = env.post({ action: 'reservas_calendario', token, sede: 'San Antonio', fecha_desde: '2026-09-01', fecha_hasta: '2026-09-30' });
// r2 se canceló y no cuenta; quedan r1, r3, rLibre, rDeco = 4 activas ese día.
assert.strictEqual(calendario.dias['2026-09-03'], 4);
console.log('reservas_buscar / reservas_calendario: OK');

// --- Historial de cliente ---------------------------------------------------------------------
const historial = env.post({ action: 'reserva_historial_cliente', token, telefono: item1.telefono });
assert.strictEqual(historial.cancelaciones, 1);
assert(historial.celebraciones.some(c => c.motivo === 'Cumpleaños'));
console.log('reserva_historial_cliente: cuenta cancelaciones y celebraciones: OK');

// --- Mesa fuera de servicio no se puede asignar -------------------------------------------------
const mesa11 = mesasSA.data.find(m => m.numero === '11');
const desactivar = env.post({ action: 'mesas_guardar', token, item: Object.assign({}, mesa11, { activa: false }) });
assert.strictEqual(desactivar.ok, true);
const rFueraServicio = env.post({ action: 'reserva_crear', token, item: Object.assign({}, item1, { nombre_cliente: 'X', hora: '10:00', mesas: ['11'] }) });
assert.strictEqual(rFueraServicio.ok, false);
assert.match(rFueraServicio.error, /fuera de servicio/);
console.log('mesas_guardar / reserva_crear: una mesa fuera de servicio no se puede asignar: OK');

console.log('reservas: OK');
