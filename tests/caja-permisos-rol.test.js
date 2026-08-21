/**
 * PERMISOS POR ROL EN CAJA (auditoría externa, ago 2026) — Cocina no debe tener ningún acceso al
 * módulo Caja (Diana, ago 2026: "cocina no tiene que ver nada con caja"). El router de Code.gs ya
 * lo cumple hoy, pero ninguna prueba lo confirmaba pasando por el camino real (doPost ->
 * requiereRol_) con un usuario Cocina de verdad — la única prueba parecida (caja-turno.test.js)
 * llama a cajaAbrir_/cajaCerrar_ DIRECTAMENTE sobre CajaTurno.gs aislado, saltándose Code.gs por
 * completo, así que no protege contra una futura regresión en el router. Esta prueba cierra ese
 * hueco: crea un usuario Cocina de verdad, hace login, y confirma por env.post (el mismo camino que
 * usa el frontend) que cada acción de Caja lo rechaza.
 */
const assert = require('assert');
const { crearEntorno } = require('./helpers/entorno-apps-script.js');

const SEDE = 'San Antonio';
const HOY = '2026-08-21';

function preparar() {
  const env = crearEntorno({ reactivacionReal: true });
  env.fijarReloj(HOY + 'T12:00:00-05:00');
  env.ctx.configurarHojas();
  env.ctx.crearAdministradorInicial_('Diana', 'diana', 'contrasegura1', 'diana@example.com');
  const loginAdmin = env.post({ action: 'login', usuario: 'diana', password: 'contrasegura1' });
  assert.ok(loginAdmin.ok, JSON.stringify(loginAdmin));
  // Caja exige que ya se haya corrido la inicialización oficial del 20/08/2026 — sin esto, todo se
  // rechazaría por "fecha no permitida" y no probaría nada sobre el ROL, que es lo que interesa aquí.
  env.ctx.cajaInicializarOperacionDesde20Agosto2026();

  const crearCocina = env.post({ token: loginAdmin.token, action: 'usuarios_guardar', item: {
    nombre: 'Juan Cocina', usuario: 'juancocina', password: 'claveSegura99', rol: 'Cocina', sede: SEDE, activo: true, sectores_permitidos: 'Cocina'
  }});
  assert.ok(crearCocina.ok, JSON.stringify(crearCocina));
  const loginCocina = env.post({ action: 'login', usuario: 'juancocina', password: 'claveSegura99' });
  assert.ok(loginCocina.ok, JSON.stringify(loginCocina));

  const crearEncargado = env.post({ token: loginAdmin.token, action: 'usuarios_guardar', item: {
    nombre: 'Ana Encargada', usuario: 'anaenc', password: 'claveSegura99', rol: 'Encargado', sede: SEDE, activo: true
  }});
  assert.ok(crearEncargado.ok, JSON.stringify(crearEncargado));
  const loginEncargado = env.post({ action: 'login', usuario: 'anaenc', password: 'claveSegura99' });
  assert.ok(loginEncargado.ok, JSON.stringify(loginEncargado));

  return { env, tokenCocina: loginCocina.token, tokenEncargado: loginEncargado.token, tokenAdmin: loginAdmin.token };
}

function rechazaCocina(env, token, body, etiqueta) {
  const r = env.post(Object.assign({ token }, body));
  assert.strictEqual(r.ok, false, etiqueta + ' no debería tener éxito con rol Cocina: ' + JSON.stringify(r));
}

// Acciones que un Encargado sí puede hacer, pero Cocina no: abrir, ver estado, registrar
// movimiento, cerrar. Todas exigen ['Administrador','Encargado'] en Code.gs.
(function () {
  const { env, tokenCocina } = preparar();
  rechazaCocina(env, tokenCocina, { action: 'caja_abrir', item: { fecha: HOY, sede: SEDE, base_inicial: 0, caja_fuerte_inicial: 0, observacion_apertura: '' } }, 'caja_abrir');
  rechazaCocina(env, tokenCocina, { action: 'caja_estado', fecha: HOY, sede: SEDE }, 'caja_estado');
  rechazaCocina(env, tokenCocina, { action: 'caja_rappi_marcar', fecha: HOY, sede: SEDE }, 'caja_rappi_marcar');
  rechazaCocina(env, tokenCocina, { action: 'caja_movimiento_registrar', item: { fecha: HOY, sede: SEDE, tipo: 'Otro ingreso', valor: 5000, motivo: 'prueba' } }, 'caja_movimiento_registrar');
  rechazaCocina(env, tokenCocina, { action: 'caja_cerrar', item: { fecha: HOY, sede: SEDE, efectivo_contado: 0, caja_fuerte_contada: 0 } }, 'caja_cerrar');
  rechazaCocina(env, tokenCocina, { action: 'caja_sincronizar_ahora', fecha: HOY, sede: SEDE }, 'caja_sincronizar_ahora');
  rechazaCocina(env, tokenCocina, { action: 'caja_historial_listar', fecha_desde: HOY, fecha_hasta: HOY, sede: SEDE }, 'caja_historial_listar');
  console.log('Cocina rechazada en toda acción de Caja que exige Administrador/Encargado: OK');
})();

// Acciones exclusivas de Administrador: Cocina y también un Encargado deben quedar afuera.
(function () {
  const { env, tokenCocina, tokenEncargado } = preparar();
  ['caja_resumen_admin', 'caja_novedades_listar'].forEach((accion) => {
    rechazaCocina(env, tokenCocina, { action: accion, fecha: HOY }, accion + ' (Cocina)');
    rechazaCocina(env, tokenEncargado, { action: accion, fecha: HOY }, accion + ' (Encargado)');
  });
  rechazaCocina(env, tokenCocina, { action: 'caja_novedad_conciliar', fecha: HOY, sede: SEDE, nota: '' }, 'caja_novedad_conciliar (Cocina)');
  rechazaCocina(env, tokenEncargado, { action: 'caja_novedad_conciliar', fecha: HOY, sede: SEDE, nota: '' }, 'caja_novedad_conciliar (Encargado)');
  rechazaCocina(env, tokenCocina, { action: 'caja_corregir', item: { fecha: HOY, sede: SEDE, efectivo_contado: 0, caja_fuerte_contada: 0, motivo_correccion: 'x' } }, 'caja_corregir (Cocina)');
  rechazaCocina(env, tokenEncargado, { action: 'caja_corregir', item: { fecha: HOY, sede: SEDE, efectivo_contado: 0, caja_fuerte_contada: 0, motivo_correccion: 'x' } }, 'caja_corregir (Encargado)');
  console.log('Solo Administrador puede usar las acciones exclusivas de Caja: OK');
})();

// Confirma, por contraste, que un Encargado sí puede — para que esta prueba falle si algún día se
// bloquea por error también al rol que SÍ debe tener acceso.
(function () {
  const { env, tokenEncargado } = preparar();
  const abrir = env.post({ token: tokenEncargado, action: 'caja_abrir', item: { fecha: HOY, sede: SEDE, base_inicial: 0, caja_fuerte_inicial: 0, observacion_apertura: '' } });
  assert.ok(abrir.ok, 'un Encargado sí debe poder abrir la caja de su sede: ' + JSON.stringify(abrir));
  console.log('Encargado sigue pudiendo operar Caja con normalidad: OK');
})();

console.log('caja-permisos-rol: OK');
