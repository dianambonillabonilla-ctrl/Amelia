/**
 * Endurecimiento de Caja V3 (ago 2026, segunda ronda): bloqueo de concurrencia, medianoche, entregas
 * y la unificación de cajaV3SincronizarFudo_ (antes duplicada entre Caja.gs y ZZ_CajaV3Compat.gs,
 * ya eliminado). El propio bloqueo de concurrencia no es probable de reproducir en este entorno
 * síncrono de un solo hilo (el mock de LockService siempre concede el lock) — lo que sí se prueba
 * aquí es que abrir/registrar/cerrar siguen funcionando normalmente con el lock ya puesto.
 */
const assert = require('assert');
const { crearEntorno } = require('./helpers/entorno-apps-script.js');

const SEDE = 'San Antonio';

function nuevo() {
  const env = crearEntorno();
  env.ctx.configurarHojas();
  env.ctx.crearAdministradorInicial_('Diana', 'diana', 'contrasegura1', 'diana@example.com');
  const login = env.post({ action: 'login', usuario: 'diana', password: 'contrasegura1' });
  assert.ok(login.ok, JSON.stringify(login));
  return { env, token: login.token };
}

function abrir(env, token, fecha, base, fuerte, observacion) {
  return env.post({
    action: 'caja_abrir', token,
    item: { fecha, sede: SEDE, base_inicial: base, caja_fuerte_inicial: fuerte, observacion_apertura: observacion || '' }
  });
}

// --- Entregas: quién entrega/quién recibe vuelve a ser obligatorio -------------------------------
(function () {
  const { env, token } = nuevo();
  env.fijarReloj('2026-08-22T09:00:00-05:00');
  const a = abrir(env, token, '2026-08-22', 0, 0);
  assert.ok(a.ok, JSON.stringify(a));

  const sinRecibe = env.post({
    action: 'caja_movimiento_registrar', token,
    item: { fecha: '2026-08-22', sede: SEDE, tipo: 'Entrega administración desde caja', valor: 10000, motivo: 'prueba' }
  });
  assert.strictEqual(sinRecibe.ok, false, JSON.stringify(sinRecibe));
  assert.match(String(sinRecibe.error), /quién entrega y quién recibe/);

  const conRecibe = env.post({
    action: 'caja_movimiento_registrar', token,
    item: { fecha: '2026-08-22', sede: SEDE, tipo: 'Entrega administración desde caja', valor: 10000, motivo: 'prueba', persona_recibe: 'Diana' }
  });
  assert.ok(conRecibe.ok, JSON.stringify(conRecibe));
  assert.strictEqual(conRecibe.item.persona_entrega, 'Diana', 'persona_entrega se completa sola con el usuario que registra');

  // Un tipo que no es entrega no exige persona_recibe.
  const otroIngreso = env.post({
    action: 'caja_movimiento_registrar', token,
    item: { fecha: '2026-08-22', sede: SEDE, tipo: 'Otro ingreso', valor: 5000, motivo: 'propina' }
  });
  assert.ok(otroIngreso.ok, JSON.stringify(otroIngreso));

  console.log('caja-v3-endurecida: entregas exigen quién entrega/quién recibe, otros movimientos no: OK');
})();

// --- Medianoche: el efectivo se atribuye por MOMENTO real, no por fecha de calendario ------------
(function () {
  const { env, token } = nuevo();
  // Turno abre 22/08 a las 23:00 y cierra 23/08 a la 01:00 — cruza la medianoche.
  env.fijarReloj('2026-08-22T23:00:00-05:00');
  const a = abrir(env, token, '2026-08-22', 0, 0);
  assert.ok(a.ok, JSON.stringify(a));

  function pago(id, creacionIso, fechaCalendario, monto) {
    env.agregar('Fudo_Pagos', [{
      id_pago: id, id_venta: id, fecha: fechaCalendario, creacion: new env.ctx.Date(creacionIso),
      monto, cancelado: false, metodo_pago: 'Efectivo', metodo_tipo: 'cash', sede: SEDE,
      es_efectivo: true, archivo_origen: '', importado_por: 'test', importado_en: new env.ctx.Date()
    }]);
  }
  // Antes de que abriera el turno (22/08, 20:00) — NO debe contar.
  pago('p1', '2026-08-22T20:00:00-05:00', '2026-08-22', 100000);
  // Ya con el turno abierto, todavía 22/08 (23:30) — sí debe contar.
  pago('p2', '2026-08-22T23:30:00-05:00', '2026-08-22', 50000);
  // Después de medianoche, ya calendario 23/08, pero el turno sigue abierto — sí debe contar.
  pago('p3', '2026-08-23T00:30:00-05:00', '2026-08-23', 30000);

  env.fijarReloj('2026-08-23T01:00:00-05:00');
  const estado = env.post({ action: 'caja_estado', token, fecha: '2026-08-22', sede: SEDE });
  assert.ok(estado.ok, JSON.stringify(estado));
  assert.strictEqual(estado.calculo.fudo.efectivo, 80000, 'debe sumar p2+p3 (50000+30000) e ignorar p1, sin importar en qué día calendario cayó cada pago');
  assert.strictEqual(estado.calculo.fudo.por_ventana, true);

  const cierre = env.post({
    action: 'caja_cerrar', token,
    item: { fecha: '2026-08-22', sede: SEDE, efectivo_contado: 80000, caja_fuerte_contada: 0, observacion: '' }
  });
  assert.ok(cierre.ok, JSON.stringify(cierre));
  assert.strictEqual(cierre.calculo.fudo.efectivo, 80000);

  console.log('caja-v3-endurecida: un turno que cruza medianoche atribuye el efectivo por momento real, no por fecha de calendario: OK');
})();

// --- Referencia de apertura trae lo que dijo FUDO en el cierre anterior (para el Administrador) --
(function () {
  const { env, token } = nuevo();
  env.fijarReloj('2026-08-20T09:00:00-05:00');
  abrir(env, token, '2026-08-20', 100000, 0);
  const cierre = env.post({
    action: 'caja_cerrar', token,
    item: { fecha: '2026-08-20', sede: SEDE, efectivo_contado: 100000, caja_fuerte_contada: 0, observacion: '' }
  });
  assert.ok(cierre.ok, JSON.stringify(cierre));

  env.fijarReloj('2026-08-21T09:00:00-05:00');
  const estado = env.post({ action: 'caja_estado', token, fecha: '2026-08-21', sede: SEDE });
  assert.ok(estado.ok, JSON.stringify(estado));
  assert.strictEqual(estado.referencia_apertura.es_inicio_cero, false);
  assert.strictEqual(estado.referencia_apertura.fudo_neto_cierre_anterior, cierre.calculo.fudo.neto, 'debe traer el mismo FUDO neto que quedó guardado en el cierre del 20, para comparar contra lo que quedó físico');

  console.log('caja-v3-endurecida: la referencia de apertura expone el FUDO del cierre anterior: OK');
})();

// --- cajaV3SincronizarFudo_ sin credenciales FUDO configuradas no rompe (unificada, ya sin ZZ_CajaV3Compat.gs) ---
(function () {
  const { env, token } = nuevo();
  env.fijarReloj('2026-08-22T09:00:00-05:00');
  const sync = env.post({ action: 'caja_sincronizar_ahora', token, fecha: '2026-08-22', sede: SEDE });
  assert.ok(sync.ok, JSON.stringify(sync));
  assert.strictEqual(sync.aplica, false, 'sin FUDO_API_KEY/SECRET, debe decir que FUDO no aplica, no fallar');

  console.log('caja-v3-endurecida: sincronizar sin credenciales FUDO no falla: OK');
})();

console.log('caja-v3-endurecida: OK');
