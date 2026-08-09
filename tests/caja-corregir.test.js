/**
 * CORRECCIÓN DE UN CIERRE YA HECHO (cajaCorregir_) — Diana (ago 2026): "reapertura o corrección de
 * caja ya hecha, solo por administrador". Un día cerrado sigue siendo inmutable en el sentido de
 * que nunca vuelve a "Abierto" ni admite más movimientos — pero un Administrador sí puede corregir
 * lo contado si el número original estaba mal, con auditoría completa.
 */
const assert = require('assert');
const { crearEntorno } = require('./helpers/entorno-apps-script.js');

const HOY = '2026-07-26';
const AYER = '2026-07-25';
const SEDE = 'San Antonio';

function nuevoEntornoConAdmin() {
  const env = crearEntorno();
  env.ctx.configurarHojas();
  env.ctx.crearAdministradorInicial_('Diana', 'diana', 'contrasegura1', 'diana@example.com');
  const login = env.post({ action: 'login', usuario: 'diana', password: 'contrasegura1' });
  assert.ok(login.ok, 'el administrador inicial debe poder entrar: ' + JSON.stringify(login));
  return { env, token: login.token };
}

function abrirYCerrar(env, token, fecha, contado) {
  const p = (cuerpo) => Object.assign({ token }, cuerpo);
  const abrir = env.post(p({ action: 'caja_abrir', item: { fecha, sede: SEDE, base_inicial: 0, caja_fuerte_inicial: 0 } }));
  assert.ok(abrir.ok, 'abrir debió funcionar: ' + JSON.stringify(abrir));
  const cerrar = env.post(p({ action: 'caja_cerrar', item: { fecha, sede: SEDE, efectivo_contado: contado, caja_fuerte_contada: 0, base_siguiente: 0, observacion: 'diferencia esperada en esta prueba' } }));
  assert.ok(cerrar.ok, 'cerrar debió funcionar: ' + JSON.stringify(cerrar));
  return cerrar;
}

(function soloUnAdministradorPuedeCorregir() {
  const { env, token } = nuevoEntornoConAdmin();
  abrirYCerrar(env, token, HOY, 100000);

  // A nivel de función (no hace falta un login real de Encargado para esta prueba).
  const usuarioEncargado = { rol: 'Encargado', nombre: 'Giselle', sede: SEDE, id: 'u2' };
  const r = env.ctx.cajaCorregir_({ fecha: HOY, sede: SEDE, efectivo_contado: 120000, caja_fuerte_contada: 0, motivo_correccion: 'probar' }, usuarioEncargado);
  assert.strictEqual(r.ok, false);
  assert.match(r.error, /Solo un Administrador/);
  console.log('solo un Administrador puede corregir: OK');
})();

(function noSePuedeCorregirUnaCajaQueNoEstaCerrada() {
  const { env, token } = nuevoEntornoConAdmin();
  env.post({ token, action: 'caja_abrir', item: { fecha: HOY, sede: SEDE, base_inicial: 0, caja_fuerte_inicial: 0 } });
  const r = env.post({ token, action: 'caja_corregir', item: { fecha: HOY, sede: SEDE, efectivo_contado: 1000, caja_fuerte_contada: 0, motivo_correccion: 'x' } });
  assert.strictEqual(r.ok, false);
  assert.match(r.error, /no está cerrada/);
  console.log('no se puede corregir una caja que no está cerrada: OK');
})();

(function exigeElMotivoDeLaCorreccion() {
  const { env, token } = nuevoEntornoConAdmin();
  abrirYCerrar(env, token, HOY, 100000);
  const r = env.post({ token, action: 'caja_corregir', item: { fecha: HOY, sede: SEDE, efectivo_contado: 120000, caja_fuerte_contada: 0 } });
  assert.strictEqual(r.ok, false);
  assert.match(r.error, /motivo/);
  console.log('exige el motivo de la corrección: OK');
})();

(function corrigeYRecalculaLaDiferenciaConAuditoria() {
  const { env, token } = nuevoEntornoConAdmin();
  const cierre = abrirYCerrar(env, token, HOY, 100000);
  assert.strictEqual(cierre.diferencia, 100000, 'sin ventas ni movimientos, lo esperado es 0 y lo contado 100000');

  const r = env.post({ token, action: 'caja_corregir', item: {
    fecha: HOY, sede: SEDE, efectivo_contado: 95000, caja_fuerte_contada: 0, base_siguiente: 5000,
    observacion_cierre: 'se había leído mal el billete de $5.000', motivo_correccion: 'el cajero contó de más por error'
  } });
  assert.ok(r.ok, 'la corrección debió funcionar: ' + JSON.stringify(r));
  assert.strictEqual(r.efectivo_contado, 95000);
  assert.strictEqual(r.diferencia, 95000, 'sigue comparando contra el mismo efectivo_esperado original (0)');
  assert.strictEqual(r.base_siguiente, 5000);

  const historial = env.post({ token, action: 'caja_historial_listar', fecha_desde: HOY, fecha_hasta: HOY, sede: SEDE });
  const fila = historial.historial[0];
  assert.strictEqual(Number(fila.efectivo_contado), 95000);
  assert.strictEqual(fila.observacion_cierre, 'se había leído mal el billete de $5.000');

  const eventos = env.ctx.leerTabla_(env.evaluar('SHEET_NAMES.AUDITORIA'));
  const evento = eventos.find(e => e.accion === 'caja_corregir');
  assert.ok(evento, 'debe quedar un evento de auditoría de la corrección');
  assert.strictEqual(evento.usuario_nombre, 'Diana');
  assert.match(evento.motivo, /contó de más/);
  const anterior = JSON.parse(evento.valor_anterior);
  assert.strictEqual(Number(anterior.efectivo_contado), 100000, 'el antes/después debe guardar el valor original');
  console.log('corrige y recalcula la diferencia, con auditoría: OK');
})();

(function noSePuedeCorregirSiHayUnCierrePosteriorEnEsaSede() {
  const { env, token } = nuevoEntornoConAdmin();
  abrirYCerrar(env, token, AYER, 100000);
  abrirYCerrar(env, token, HOY, 100000);

  const r = env.post({ token, action: 'caja_corregir', item: { fecha: AYER, sede: SEDE, efectivo_contado: 90000, caja_fuerte_contada: 0, motivo_correccion: 'x' } });
  assert.strictEqual(r.ok, false);
  assert.match(r.error, /más reciente/);

  // El día más reciente sí se puede corregir.
  const r2 = env.post({ token, action: 'caja_corregir', item: { fecha: HOY, sede: SEDE, efectivo_contado: 90000, caja_fuerte_contada: 0, motivo_correccion: 'x' } });
  assert.ok(r2.ok, 'el cierre más reciente sí debe poder corregirse: ' + JSON.stringify(r2));
  console.log('no se puede corregir si hay un cierre posterior en esa sede: OK');
})();

(function unEncargadoNoPuedeLlamarLaAccionAunSiendoElMismoUsuarioDeLaSede() {
  const { env, token: tokenAdmin } = nuevoEntornoConAdmin();
  abrirYCerrar(env, tokenAdmin, HOY, 100000);

  const nuevoUsuario = env.post({ token: tokenAdmin, action: 'usuarios_guardar', item: { nombre: 'Giselle', usuario: 'giselle', password: 'contrasegura2', rol: 'Encargado', sede: SEDE, email: 'giselle@example.com' } });
  assert.ok(nuevoUsuario.ok, 'crear el usuario Encargado debió funcionar: ' + JSON.stringify(nuevoUsuario));
  const loginEncargado = env.post({ action: 'login', usuario: 'giselle', password: 'contrasegura2' });
  assert.ok(loginEncargado.ok);

  // requiereRol_ (Code.gs) rechaza esto con una excepción — igual que CUALQUIER otra acción
  // restringida a Administrador (ej. requiereAdmin_) — que el router enmascara como "Error de
  // servidor" con código de incidente (ver security-api.test.js), sin revelar el motivo exacto.
  // Lo que importa aquí es que un Encargado nunca reciba ok:true.
  const r = env.post({ token: loginEncargado.token, action: 'caja_corregir', item: { fecha: HOY, sede: SEDE, efectivo_contado: 1, caja_fuerte_contada: 0, motivo_correccion: 'x' } });
  assert.strictEqual(r.ok, false);
  console.log('un Encargado no puede llamar la acción aunque sea de la misma sede: OK');
})();
