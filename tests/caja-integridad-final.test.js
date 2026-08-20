const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { crearEntorno } = require('./helpers/entorno-apps-script.js');

const SEDE = 'San Antonio';
const DIA1 = '2026-08-18';
const DIA2 = '2026-08-19';

function preparar(fechaAhora) {
  const env = crearEntorno();
  env.ctx.configurarHojas();
  env.ctx.crearAdministradorInicial_('Diana', 'diana', 'contrasegura1', 'diana@example.com');
  const login = env.post({ action:'login', usuario:'diana', password:'contrasegura1' });
  assert.ok(login.ok);
  if (fechaAhora) env.fijarReloj(fechaAhora);
  return { env, token:login.token };
}

function abrir(env, token, fecha, caja, fuerte, observacion) {
  const r = env.post({ token, action:'caja_abrir', item:{
    fecha, sede:SEDE, base_inicial:caja, caja_fuerte_inicial:fuerte,
    observacion_apertura:observacion || ''
  }});
  assert.ok(r.ok, JSON.stringify(r));
  return r;
}

function cerrar(env, token, fecha, caja, fuerte, observacion) {
  const r = env.post({ token, action:'caja_cerrar', item:{
    fecha, sede:SEDE, efectivo_contado:caja, caja_fuerte_contada:fuerte,
    base_siguiente:caja, observacion:observacion || ''
  }});
  assert.ok(r.ok, JSON.stringify(r));
  return r;
}

// 1) Nunca se aceptan movimientos fechados en el futuro.
(function () {
  const { env, token } = preparar('2026-08-19T15:00:00-05:00');
  const r = env.post({ token, action:'caja_movimiento_registrar', item:{
    fecha:'2026-08-20', sede:SEDE, tipo:'Entrega administrador desde caja', valor:10000,
    persona_entrega:'Diana', persona_recibe:'Proveedor', motivo:'No debe poder anticiparse',
    idempotency_key:'futuro-1'
  }});
  assert.strictEqual(r.ok, false, JSON.stringify(r));
  assert.match(String(r.error), /fecha futura/i);
})();

// 2) Un cierre no se corrige si ya existe cualquier turno posterior, aunque siga ABIERTO.
(function () {
  const { env, token } = preparar('2026-08-18T17:00:00-05:00');
  abrir(env, token, DIA1, 100000, 0, 'fixture día 1');
  cerrar(env, token, DIA1, 100000, 0, 'fixture día 1');

  env.fijarReloj('2026-08-19T17:00:00-05:00');
  abrir(env, token, DIA2, 100000, 0, 'fixture día 2 abierto');

  const r = env.post({ token, action:'caja_corregir', item:{
    fecha:DIA1, sede:SEDE, efectivo_contado:90000, caja_fuerte_contada:0,
    motivo_correccion:'intento de corregir historia con turno posterior abierto'
  }});
  assert.strictEqual(r.ok, false, JSON.stringify(r));
  assert.match(String(r.error), /turno posterior/i);
})();

// 3) Una corrección no puede volver imposible una entrega ya validada después del cierre.
(function () {
  const { env, token } = preparar('2026-08-18T17:00:00-05:00');
  abrir(env, token, DIA1, 40000, 60000, 'fixture custodia');
  env.avanzarReloj(60 * 60 * 1000);
  cerrar(env, token, DIA1, 40000, 60000, 'fixture custodia');

  env.avanzarReloj(10 * 60 * 1000);
  const entrega = env.post({ token, action:'caja_movimiento_registrar', item:{
    fecha:DIA1, sede:SEDE, tipo:'Entrega administrador desde caja fuerte', valor:20000,
    persona_entrega:'Caja fuerte', persona_recibe:'Diana', motivo:'Entrega posterior al cierre',
    idempotency_key:'post-cierre-integridad-1'
  }});
  assert.ok(entrega.ok, JSON.stringify(entrega));

  const imposible = env.post({ token, action:'caja_corregir', item:{
    fecha:DIA1, sede:SEDE, efectivo_contado:40000, caja_fuerte_contada:10000,
    motivo_correccion:'dejaría negativa la caja fuerte tras la entrega posterior'
  }});
  assert.strictEqual(imposible.ok, false, JSON.stringify(imposible));
  assert.match(String(imposible.error), /custodia|saldo negativo|movimientos/i);

  const posible = env.post({ token, action:'caja_corregir', item:{
    fecha:DIA1, sede:SEDE, efectivo_contado:40000, caja_fuerte_contada:30000,
    motivo_correccion:'mantiene saldo suficiente para la entrega posterior'
  }});
  assert.ok(posible.ok, JSON.stringify(posible));
  const turno = env.ctx.cajaTurnoFila_(DIA1, SEDE);
  assert.strictEqual(Number(turno.caja_fuerte_siguiente), 30000);
})();

// 4) Historial puede abrir caja.html en la fecha/sede seleccionadas y Caja consume esos parámetros.
(function () {
  const html = fs.readFileSync(path.join(__dirname, '..', 'caja.html'), 'utf8');
  assert.match(html, /new URLSearchParams\(window\.location\.search\)/);
  assert.match(html, /fechaSolicitada/);
  assert.match(html, /sedeSolicitada/);
  assert.match(html, /Array\.from\(sedeEl\.options\)\.some/);
})();

console.log('caja-integridad-final: OK');
