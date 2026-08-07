/**
 * DIAGNÓSTICO DE CAJA CONTRA UNA API DE FUDO SIMULADA
 *
 * No es una prueba de `npm test`: es una herramienta de diagnóstico que se corre a mano con
 * `npm run diagnostico:caja`. Está fuera de la suite a propósito, porque hoy reporta dos fallas que
 * son bugs reales del módulo todavía sin corregir (ver docs/diagnostico-caja.md) — meterla en CI
 * dejaría el repositorio en rojo permanente sin aportar información nueva. Cuando esos dos bugs se
 * corrijan, esto debería pasar a `tests/caja-fudo.test.js` y entrar a la suite.
 *
 * Qué la hace distinta de tests/caja-v2.test.js: aquí la API de FUDO se simula a nivel de
 * `UrlFetchApp`, no con un mock de alto nivel. Es decir, se ejercita FudoApi.gs de verdad —
 * autenticación, token, paginación, `include`, formato JSON:API — y se comprueba que el efectivo que
 * FUDO reporta termina en el cálculo de la caja correcta. Las pruebas de la suite corren sin
 * credenciales configuradas, así que nunca llegan a tocar esa cadena.
 *
 * Cubre: flujo completo con FUDO al día, encadenamiento entre días, caja fuerte, pagos sin sede,
 * clasificación de efectivo, API caída, API lenta, caché, dos aperturas y dos cierres simultáneos,
 * permisos, Rappi, auditoría, presupuesto de lecturas al Sheet y contrato con caja.html.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { crearEntorno } = require('./helpers/entorno-apps-script.js');

const RAIZ = path.join(__dirname, '..');
const HOY = '2026-08-07';
const AYER = '2026-08-06';
const SA = 'San Antonio';
const CAPRI = 'Capri';

const fallos = [];
let oks = 0;
function check(nombre, fn) {
  try { fn(); oks++; console.log('  ok    ' + nombre); }
  catch (e) { fallos.push(nombre + ' -> ' + e.message); console.log('  FALLA ' + nombre + '\n          ' + e.message); }
}
function seccion(t) { console.log('\n=== ' + t + ' ==='); }
function info(t) { console.log('  info  ' + t); }

// --- Simulador de la API de FUDO a nivel UrlFetchApp ----------------------------------------------

function respuestaHttp(codigo, texto) {
  return { getResponseCode: () => codigo, getContentText: () => texto };
}

function crearFudoSimulado(opciones) {
  opciones = opciones || {};
  const estado = {
    llamadas: [],
    caido: !!opciones.caido,
    lentoMs: opciones.lentoMs || 0,
    ventas: opciones.ventas || [],
    pagos: opciones.pagos || [],
    incluidosVentas: opciones.incluidosVentas || [],
    incluidosPagos: opciones.incluidosPagos || []
  };
  estado.fetch = function (url) {
    estado.llamadas.push(String(url));
    if (String(url).indexOf('auth.fu.do') !== -1) {
      return respuestaHttp(200, JSON.stringify({ token: 'token-de-prueba', exp: Math.floor(Date.now() / 1000) + 86400 }));
    }
    if (estado.caido) return respuestaHttp(503, '<html>Service Unavailable</html>');
    if (estado.lentoMs) {
      // Bloquea, igual que UrlFetchApp esperando la red: así se mide si la pantalla se contagia.
      const fin = Date.now() + estado.lentoMs;
      while (Date.now() < fin) { /* espera activa */ }
    }
    if (String(url).indexOf('/sales') !== -1) {
      return respuestaHttp(200, JSON.stringify({ data: estado.ventas, included: estado.incluidosVentas }));
    }
    if (String(url).indexOf('/payments') !== -1) {
      return respuestaHttp(200, JSON.stringify({ data: estado.pagos, included: estado.incluidosPagos }));
    }
    return respuestaHttp(404, '{}');
  };
  return estado;
}

/** Venta cerrada. Sin `sala` simula un domicilio/para llevar: sin mesa no hay sede que inferir. */
function venta(id, sala, monto) {
  const rel = {
    items: { data: [{ type: 'Item', id: 'i' + id }] },
    payments: { data: [{ type: 'Payment', id: 'p' + id }] }
  };
  if (sala) rel.table = { data: { type: 'Table', id: 't' + id } };
  return {
    id: String(id), type: 'Sale',
    attributes: {
      createdAt: HOY + 'T12:00:00.000Z', closedAt: HOY + 'T12:30:00.000Z',
      total: monto, saleState: 'CLOSED', saleType: sala ? 'EAT-IN' : 'DELIVERY'
    },
    relationships: rel
  };
}

function incluidosDeVenta(id, sala, monto) {
  const inc = [
    {
      type: 'Item', id: 'i' + id,
      attributes: { quantity: 1, price: monto, canceled: false, createdAt: HOY + 'T12:00:00.000Z' },
      relationships: { product: { data: { type: 'Product', id: 'prod1' } } }
    },
    { type: 'Product', id: 'prod1', attributes: { name: 'Waffle' } }
  ];
  if (sala) {
    inc.push({ type: 'Table', id: 't' + id, attributes: { number: 1 }, relationships: { room: { data: { type: 'Room', id: 'r-' + sala } } } });
    inc.push({ type: 'Room', id: 'r-' + sala, attributes: { name: sala } });
  }
  return inc;
}

function pago(id, idVenta, monto, kind) {
  return {
    id: String(id), type: 'Payment',
    attributes: { amount: monto, canceled: false, createdAt: HOY + 'T12:25:00.000Z', paidAt: HOY + 'T12:25:00.000Z' },
    relationships: {
      sale: { data: { type: 'Sale', id: String(idVenta) } },
      paymentMethod: { data: { type: 'PaymentMethod', id: 'pm-' + kind } }
    }
  };
}

/** `kind` es el enum real de FUDO: CASH, DEBIT-CARD, CREDIT-CARD, HOUSE-ACCOUNT, PIX, OTHER... */
function metodoPago(kind, nombre) {
  return { type: 'PaymentMethod', id: 'pm-' + kind, attributes: { name: nombre, kind: kind } };
}

function nuevoEntorno(fudo, relojISO) {
  const env = crearEntorno();
  env.fijarReloj((relojISO || HOY + 'T14:00:00'));
  env.ctx.configurarHojas();
  env.ctx.crearAdministradorInicial_('Diana', 'diana', 'contrasegura1', 'diana@example.com');
  const props = env.ctx.PropertiesService.getScriptProperties();
  props.setProperty('FUDO_API_KEY', 'clave-de-prueba');
  props.setProperty('FUDO_API_SECRET', 'secreto-de-prueba');
  if (fudo) env.ctx.UrlFetchApp = { fetch: fudo.fetch };
  const login = env.post({ action: 'login', usuario: 'diana', password: 'contrasegura1' });
  assert.ok(login.ok, 'el login del administrador inicial debe funcionar: ' + JSON.stringify(login));
  return { env, token: login.token };
}
const P = (token, cuerpo) => Object.assign({ token }, cuerpo);

// =================================================================================================
seccion('1. FLUJO COMPLETO CON FUDO RESPONDIENDO BIEN');

(function () {
  const fudo = crearFudoSimulado({
    ventas: [venta(1001, 'Salón SA', 50000)],
    incluidosVentas: incluidosDeVenta(1001, 'Salón SA', 50000),
    pagos: [pago(9001, 1001, 50000, 'CASH')],
    incluidosPagos: [metodoPago('CASH', 'Efectivo')]
  });
  const { env, token } = nuevoEntorno(fudo);

  const est0 = env.post(P(token, { action: 'caja_estado', fecha: HOY, sede: SA }));
  check('caja_estado responde y reporta la caja sin abrir', () => {
    assert.equal(est0.ok, true, JSON.stringify(est0));
    assert.equal(est0.abierta, false);
  });
  check('caja_estado NO llama a la API de FUDO (la pantalla abre rápido)', () => {
    assert.equal(fudo.llamadas.length, 0, 'hizo ' + fudo.llamadas.length + ' llamadas HTTP');
  });
  check('caja_estado avisa que FUDO está pendiente de actualizar', () => {
    assert.equal(est0.fudo_sync.pendiente, true, JSON.stringify(est0.fudo_sync));
  });

  const sync = env.post(P(token, { action: 'caja_sincronizar_ahora', fecha: HOY, sede: SA }));
  check('caja_sincronizar_ahora sí llama a la API real', () => {
    assert.equal(sync.ok, true, JSON.stringify(sync).slice(0, 400));
    assert.ok(fudo.llamadas.length > 0, 'no hubo ninguna llamada HTTP');
  });
  check('la venta queda con la sede resuelta por mesa → sala', () => {
    const v = env.ctx.leerTabla_('Ventas_FUDO');
    assert.ok(v.length, 'no se importó ninguna venta');
    assert.equal(v[0].sede, SA, 'la sede quedó en "' + v[0].sede + '"');
  });
  check('el pago hereda la sede de su venta y se clasifica por el kind real', () => {
    const p = env.ctx.leerTabla_('Pagos_FUDO');
    assert.ok(p.length, 'no se importó ningún pago');
    assert.equal(p[0].sede, SA, 'la sede del pago quedó en "' + p[0].sede + '"');
    assert.equal(p[0].metodo_tipo, 'CASH');
  });

  const abrir = env.post(P(token, { action: 'caja_abrir', item: { fecha: HOY, sede: SA, base_inicial: 0, caja_fuerte_inicial: 0 } }));
  check('abrir la caja con el conteo escrito funciona', () => assert.equal(abrir.ok, true, JSON.stringify(abrir)));
  check('efectivo_fudo_al_abrir guarda como línea base el efectivo que ya existía', () => {
    assert.equal(Number(abrir.item.efectivo_fudo_al_abrir), 50000, 'quedó ' + abrir.item.efectivo_fudo_al_abrir);
  });

  const est1 = env.post(P(token, { action: 'caja_estado', fecha: HOY, sede: SA }));
  check('el efectivo FUDO anterior a la apertura NO se le reclama a este turno', () => {
    assert.equal(est1.pagos_efectivo_esperado, 0, 'quedó ' + est1.pagos_efectivo_esperado);
    assert.equal(est1.efectivo_esperado, 0, 'el esperado quedó en ' + est1.efectivo_esperado);
  });

  // Una venta nueva, ya con la caja abierta.
  fudo.ventas.push(venta(1002, 'Terraza SA', 30000));
  fudo.incluidosVentas.push.apply(fudo.incluidosVentas, incluidosDeVenta(1002, 'Terraza SA', 30000));
  fudo.pagos.push(pago(9002, 1002, 30000, 'CASH'));
  env.post(P(token, { action: 'caja_sincronizar_ahora', fecha: HOY, sede: SA }));
  const est2 = env.post(P(token, { action: 'caja_estado', fecha: HOY, sede: SA }));
  check('el efectivo FUDO generado después de abrir sí entra al esperado', () => {
    assert.equal(est2.pagos_efectivo_esperado, 30000, 'quedó ' + est2.pagos_efectivo_esperado);
    assert.equal(est2.efectivo_esperado, 30000, 'el esperado quedó en ' + est2.efectivo_esperado);
  });

  const cerrar = env.post(P(token, {
    action: 'caja_cerrar',
    item: { fecha: HOY, sede: SA, efectivo_contado: 30000, caja_fuerte_contada: 0, base_siguiente: 20000, persona_recibe_cierre: 'Giselle' }
  }));
  check('cerrar contando justo lo esperado funciona y no deja diferencia', () => {
    assert.equal(cerrar.ok, true, JSON.stringify(cerrar));
    assert.equal(cerrar.diferencia, 0);
  });
  check('cuadre_confiable = true cuando FUDO sincronizó y todo el efectivo tiene sede', () => {
    assert.equal(cerrar.cuadre_confiable, true, JSON.stringify(cerrar.efectivo_fudo_sin_sede));
  });
})();

// =================================================================================================
seccion('2. ENCADENAMIENTO ENTRE DÍAS  (aquí está el bug 1 de docs/diagnostico-caja.md)');

/** Cierra el turno de `fechaTurno` con el reloj en `relojAlCerrar` y devuelve la base esperada del día siguiente. */
function baseEsperadaTrasCerrar(relojAlCerrar, fechaTurno, fechaConsulta) {
  const { env, token } = nuevoEntorno(crearFudoSimulado({}), relojAlCerrar);
  env.post(P(token, { action: 'caja_abrir', item: { fecha: fechaTurno, sede: SA, base_inicial: 0, caja_fuerte_inicial: 0 } }));
  env.post(P(token, { action: 'caja_movimiento_registrar', item: { fecha: fechaTurno, sede: SA, tipo: 'Otro ingreso', valor: 100000, motivo: 'ventas del día' } }));
  const c = env.post(P(token, {
    action: 'caja_cerrar',
    item: { fecha: fechaTurno, sede: SA, efectivo_contado: 100000, caja_fuerte_contada: 0, base_siguiente: 40000, persona_recibe_cierre: 'Giselle' }
  }));
  assert.ok(c.ok, 'el cierre debía funcionar: ' + JSON.stringify(c));
  return env.post(P(token, { action: 'caja_estado', fecha: fechaConsulta, sede: SA })).base_esperada;
}

(function () {
  const antesDeMedianoche = baseEsperadaTrasCerrar(AYER + 'T23:30:00', AYER, HOY);
  info('turno del ' + AYER + ' cerrado a las 23:30 → base esperada del ' + HOY + ': $' + antesDeMedianoche);
  check('cerrando antes de medianoche, la base del día siguiente se encadena bien', () => {
    assert.equal(antesDeMedianoche, 40000, 'quedó ' + antesDeMedianoche);
  });

  const despuesDeMedianoche = baseEsperadaTrasCerrar(HOY + 'T00:20:00', AYER, HOY);
  info('turno del ' + AYER + ' cerrado a las 00:20 del ' + HOY + ' → base esperada del ' + HOY + ': $' + despuesDeMedianoche);
  check('cerrando DESPUÉS de medianoche, la base del día siguiente NO se pierde', () => {
    assert.equal(despuesDeMedianoche, 40000,
      'quedó ' + despuesDeMedianoche + ' — cajaUltimoCierreAntes_ ordena por timestamp_cierre (cuándo se pulsó ' +
      'el botón) en vez de por la fecha del turno, así que no encuentra el cierre de ayer');
  });
})();

// =================================================================================================
seccion('3. CAJA FUERTE Y MOVIMIENTOS');

(function () {
  const { env, token } = nuevoEntorno(crearFudoSimulado({}));
  env.post(P(token, { action: 'caja_abrir', item: { fecha: HOY, sede: SA, base_inicial: 0, caja_fuerte_inicial: 0 } }));
  env.post(P(token, { action: 'caja_movimiento_registrar', item: { fecha: HOY, sede: SA, tipo: 'Otro ingreso', valor: 500000, motivo: 'efectivo del turno' } }));
  env.post(P(token, { action: 'caja_movimiento_registrar', item: { fecha: HOY, sede: SA, tipo: 'Envío a caja fuerte', valor: 300000, motivo: 'guardar' } }));
  const est = env.post(P(token, { action: 'caja_estado', fecha: HOY, sede: SA }));
  check('enviar a caja fuerte mueve el dinero sin cambiar el total bajo custodia', () => {
    assert.equal(est.efectivo_esperado, 200000, 'operativa: ' + est.efectivo_esperado);
    assert.equal(est.caja_fuerte_esperada, 300000, 'fuerte: ' + est.caja_fuerte_esperada);
    assert.equal(est.total_bajo_custodia, 500000, 'total: ' + est.total_bajo_custodia);
  });

  env.post(P(token, {
    action: 'caja_movimiento_registrar',
    item: { fecha: HOY, sede: SA, tipo: 'Entrega administrador desde caja fuerte', valor: 300000, persona_entrega: 'Giselle', persona_recibe: 'Diana', motivo: 'entrega' }
  }));
  const est2 = env.post(P(token, { action: 'caja_estado', fecha: HOY, sede: SA }));
  check('entregar desde caja fuerte sí reduce el total bajo custodia', () => {
    assert.equal(est2.caja_fuerte_esperada, 0, 'fuerte: ' + est2.caja_fuerte_esperada);
    assert.equal(est2.total_bajo_custodia, 200000, 'total: ' + est2.total_bajo_custodia);
  });

  env.post(P(token, { action: 'caja_movimiento_registrar', item: { fecha: HOY, sede: SA, tipo: 'Gasto', valor: 15000, motivo: 'hielo' } }));
  env.post(P(token, { action: 'caja_movimiento_registrar', item: { fecha: HOY, sede: SA, tipo: 'Retiro de caja fuerte', valor: 50000, motivo: 'cambio' } }));
  const est3 = env.post(P(token, { action: 'caja_estado', fecha: HOY, sede: SA }));
  check('un gasto resta de la caja operativa y un retiro de caja fuerte le suma', () => {
    assert.equal(est3.efectivo_esperado, 200000 - 15000 + 50000, 'operativa: ' + est3.efectivo_esperado);
    assert.equal(est3.caja_fuerte_esperada, -50000, 'fuerte: ' + est3.caja_fuerte_esperada);
  });
})();

// =================================================================================================
seccion('4. AISLAMIENTO ENTRE SEDES');

(function () {
  const ventas = [];
  const incluidos = [];
  const pagos = [];
  const fudo = crearFudoSimulado({ ventas, incluidosVentas: incluidos, pagos, incluidosPagos: [metodoPago('CASH', 'Efectivo')] });
  const { env, token } = nuevoEntorno(fudo);
  env.post(P(token, { action: 'caja_abrir', item: { fecha: HOY, sede: SA, base_inicial: 0, caja_fuerte_inicial: 0 } }));
  env.post(P(token, { action: 'caja_abrir', item: { fecha: HOY, sede: CAPRI, base_inicial: 0, caja_fuerte_inicial: 0 } }));

  ventas.push(venta(2101, 'Salón SA', 100000), venta(2102, 'Terraza Capri', 80000));
  incluidos.push.apply(incluidos, incluidosDeVenta(2101, 'Salón SA', 100000).concat(incluidosDeVenta(2102, 'Terraza Capri', 80000)));
  pagos.push(pago(2901, 2101, 100000, 'CASH'), pago(2902, 2102, 80000, 'CASH'));
  env.post(P(token, { action: 'caja_sincronizar_ahora', fecha: HOY, sede: SA }));

  const a = env.post(P(token, { action: 'caja_estado', fecha: HOY, sede: SA }));
  const b = env.post(P(token, { action: 'caja_estado', fecha: HOY, sede: CAPRI }));
  check('cada sede espera solo su propio efectivo, sin contaminarse con la otra', () => {
    assert.equal(a.efectivo_esperado, 100000, 'San Antonio: ' + a.efectivo_esperado);
    assert.equal(b.efectivo_esperado, 80000, 'Capri: ' + b.efectivo_esperado);
  });
})();

// =================================================================================================
seccion('5. PAGOS EN EFECTIVO SIN SEDE IDENTIFICADA');

(function () {
  const fudo = crearFudoSimulado({
    ventas: [venta(3101, 'Salón SA', 40000), venta(3102, null, 60000)],
    incluidosVentas: incluidosDeVenta(3101, 'Salón SA', 40000).concat(incluidosDeVenta(3102, null, 60000)),
    pagos: [pago(3901, 3101, 40000, 'CASH'), pago(3902, 3102, 60000, 'CASH')],
    incluidosPagos: [metodoPago('CASH', 'Efectivo')]
  });
  const { env, token } = nuevoEntorno(fudo);
  env.post(P(token, { action: 'caja_sincronizar_ahora', fecha: HOY, sede: SA }));
  env.post(P(token, { action: 'caja_abrir', item: { fecha: HOY, sede: SA, base_inicial: 0, caja_fuerte_inicial: 0 } }));

  check('una venta sin mesa (domicilio) queda "Sin identificar"', () => {
    const v = env.ctx.leerTabla_('Ventas_FUDO').filter(x => String(x.id_venta) === '3102');
    assert.ok(v.length, 'no se importó la venta 3102');
    assert.equal(v[0].sede, 'Sin identificar', 'quedó "' + v[0].sede + '"');
  });

  const est = env.post(P(token, { action: 'caja_estado', fecha: HOY, sede: SA }));
  check('Caja detecta y cuantifica el efectivo sin sede', () => {
    assert.ok(est.efectivo_fudo_sin_sede, 'no vino el campo efectivo_fudo_sin_sede');
    assert.equal(est.efectivo_fudo_sin_sede.cantidad, 1, JSON.stringify(est.efectivo_fudo_sin_sede));
    assert.equal(est.efectivo_fudo_sin_sede.total, 60000, JSON.stringify(est.efectivo_fudo_sin_sede));
  });
  check('el cuadre NO se declara confiable, aunque la sincronización fue exitosa', () => {
    assert.equal(est.fudo_sincronizado, true, 'FUDO sí sincronizó');
    assert.equal(est.cuadre_confiable, false, 'no debería declararse confiable habiendo efectivo sin sede');
  });
  check('ese efectivo sin sede no se le atribuye a San Antonio', () => {
    assert.equal(est.pagos_efectivo_dia, 40000, 'quedó ' + est.pagos_efectivo_dia);
  });
})();

// =================================================================================================
seccion('6. CLASIFICACIÓN DE EFECTIVO  (aquí está el bug 2 de docs/diagnostico-caja.md)');

(function () {
  const fudo = crearFudoSimulado({
    ventas: [venta(4101, 'Salón SA', 100000), venta(4102, 'Salón SA', 70000), venta(4103, 'Salón SA', 50000)],
    incluidosVentas: incluidosDeVenta(4101, 'Salón SA', 100000)
      .concat(incluidosDeVenta(4102, 'Salón SA', 70000), incluidosDeVenta(4103, 'Salón SA', 50000)),
    pagos: [pago(4901, 4101, 100000, 'CASH'), pago(4902, 4102, 70000, 'HOUSE-ACCOUNT'), pago(4903, 4103, 50000, 'OTHER')],
    incluidosPagos: [
      metodoPago('CASH', 'Efectivo'),
      metodoPago('HOUSE-ACCOUNT', 'Fiado efectivo'),
      metodoPago('OTHER', 'Efectivo Rappi')
    ]
  });
  const { env, token } = nuevoEntorno(fudo);
  env.post(P(token, { action: 'caja_sincronizar_ahora', fecha: HOY, sede: SA }));
  env.post(P(token, { action: 'caja_abrir', item: { fecha: HOY, sede: SA, base_inicial: 0, caja_fuerte_inicial: 0 } }));
  const est = env.post(P(token, { action: 'caja_estado', fecha: HOY, sede: SA }));
  env.ctx.leerTabla_('Pagos_FUDO').forEach(function (p) {
    info('pago "' + p.metodo_pago + '" kind=' + p.metodo_tipo + ' $' + p.monto);
  });
  info('Caja cree que en el cajón hay $' + est.pagos_efectivo_dia + '; solo hay $100000 (el único CASH)');
  check('un método cuyo kind NO es CASH no debe contar como dinero en el cajón', () => {
    assert.equal(est.pagos_efectivo_dia, 100000,
      'quedó ' + est.pagos_efectivo_dia + ' — pagosFudoEsEfectivo_ ignora el kind y adivina por el nombre, ' +
      'así que "Fiado efectivo" (HOUSE-ACCOUNT) y "Efectivo Rappi" (OTHER) entran como efectivo');
  });
})();

// =================================================================================================
seccion('7. API DE FUDO CAÍDA');

(function () {
  const fudo = crearFudoSimulado({ caido: true });
  const { env, token } = nuevoEntorno(fudo);

  const est = env.post(P(token, { action: 'caja_estado', fecha: HOY, sede: SA }));
  check('con la API caída, caja_estado igual responde', () => assert.equal(est.ok, true, JSON.stringify(est)));

  const sync = env.post(P(token, { action: 'caja_sincronizar_ahora', fecha: HOY, sede: SA }));
  check('la sincronización reporta el fallo sin lanzar excepción', () => {
    assert.equal(sync.ok, false, JSON.stringify(sync));
    assert.ok(sync.error, 'sin mensaje de error');
  });

  const abrir = env.post(P(token, { action: 'caja_abrir', item: { fecha: HOY, sede: SA, base_inicial: 0, caja_fuerte_inicial: 0 } }));
  check('con la API caída SÍ se puede abrir la caja (abrir no depende de FUDO)', () => {
    assert.equal(abrir.ok, true, JSON.stringify(abrir));
  });

  const est2 = env.post(P(token, { action: 'caja_estado', fecha: HOY, sede: SA }));
  check('el estado marca fudo_sincronizado = false', () => {
    assert.equal(est2.fudo_sincronizado, false, JSON.stringify(est2.fudo_sync));
  });

  const cierreBase = { fecha: HOY, sede: SA, efectivo_contado: 0, caja_fuerte_contada: 0, base_siguiente: 0, persona_recibe_cierre: 'Giselle' };
  const sinObs = env.post(P(token, { action: 'caja_cerrar', item: cierreBase }));
  check('cerrar sin observación se bloquea con código FUDO_NO_SINCRONIZADO', () => {
    assert.equal(sinObs.ok, false, JSON.stringify(sinObs));
    assert.equal(sinObs.codigo, 'FUDO_NO_SINCRONIZADO');
  });
  const conObs = env.post(P(token, { action: 'caja_cerrar', item: Object.assign({}, cierreBase, { observacion: 'FUDO caído, cierro bajo mi responsabilidad' }) }));
  check('con observación, el Administrador sí puede cerrar', () => assert.equal(conObs.ok, true, JSON.stringify(conObs)));
})();

// =================================================================================================
seccion('8. CACHÉ DE SINCRONIZACIÓN');

(function () {
  const fudo = crearFudoSimulado({
    ventas: [venta(5101, 'Salón SA', 10000)],
    incluidosVentas: incluidosDeVenta(5101, 'Salón SA', 10000),
    pagos: [pago(5901, 5101, 10000, 'CASH')],
    incluidosPagos: [metodoPago('CASH', 'Efectivo')]
  });
  const { env, token } = nuevoEntorno(fudo);
  env.post(P(token, { action: 'caja_sincronizar_ahora', fecha: HOY, sede: SA }));
  const llamadasTrasSync = fudo.llamadas.length;

  for (let i = 0; i < 5; i++) env.post(P(token, { action: 'caja_estado', fecha: HOY, sede: SA }));
  check('5 consultas de estado seguidas no generan ni una llamada a FUDO', () => {
    assert.equal(fudo.llamadas.length, llamadasTrasSync,
      'se hicieron ' + (fudo.llamadas.length - llamadasTrasSync) + ' llamadas de más');
  });
  const est = env.post(P(token, { action: 'caja_estado', fecha: HOY, sede: SA }));
  check('el estado guardado en caché se sigue leyendo como sincronizado', () => {
    assert.equal(est.fudo_sincronizado, true, JSON.stringify(est.fudo_sync));
  });
})();

// =================================================================================================
seccion('9. DOS DISPOSITIVOS A LA VEZ');

(function () {
  const { env, token } = nuevoEntorno(crearFudoSimulado({}));
  const a = env.post(P(token, { action: 'caja_abrir', item: { fecha: HOY, sede: SA, base_inicial: 0, caja_fuerte_inicial: 0 } }));
  const b = env.post(P(token, { action: 'caja_abrir', item: { fecha: HOY, sede: SA, base_inicial: 999999, caja_fuerte_inicial: 0, observacion_apertura: 'otro dispositivo' } }));
  check('dos aperturas del mismo día no crean dos turnos', () => {
    assert.equal(a.ok, true, JSON.stringify(a));
    assert.ok(b.ya_abierta, 'la segunda debía reconocer la existente: ' + JSON.stringify(b));
    assert.equal(env.ctx.leerTabla_('Caja_Turno').length, 1);
  });

  const cierre = { fecha: HOY, sede: SA, efectivo_contado: 0, caja_fuerte_contada: 0, base_siguiente: 0, persona_recibe_cierre: 'Giselle' };
  const c1 = env.post(P(token, { action: 'caja_cerrar', item: cierre }));
  const c2 = env.post(P(token, { action: 'caja_cerrar', item: Object.assign({}, cierre, { efectivo_contado: 555555, observacion: 'segundo cierre' }) }));
  check('el segundo cierre no recalcula ni pisa el conteo del primero', () => {
    assert.equal(c1.ok, true, JSON.stringify(c1));
    assert.ok(c2.ya_cerrado, 'el segundo debía responder ya_cerrado: ' + JSON.stringify(c2));
    assert.equal(Number(env.ctx.leerTabla_('Caja_Turno')[0].efectivo_contado), 0);
  });

  // Con el lock tomado por otra ejecución, no se debe escribir nada a ciegas.
  const { env: env2, token: token2 } = nuevoEntorno(crearFudoSimulado({}));
  env2.ctx.LockService = { getScriptLock: () => ({ tryLock: () => false, releaseLock: () => {} }) };
  const ocupada = env2.post(P(token2, { action: 'caja_abrir', item: { fecha: HOY, sede: SA, base_inicial: 0, caja_fuerte_inicial: 0 } }));
  check('si otra ejecución tiene el lock, se responde CAJA_OCUPADA sin escribir', () => {
    assert.equal(ocupada.ok, false, JSON.stringify(ocupada));
    assert.equal(ocupada.codigo, 'CAJA_OCUPADA');
    assert.equal(env2.ctx.leerTabla_('Caja_Turno').length, 0);
  });
})();

// =================================================================================================
seccion('10. PERMISOS POR ROL Y POR SECTOR');

(function () {
  const { env } = nuevoEntorno(crearFudoSimulado({}));
  const cocinaSA = { id: 'u-cocina', nombre: 'Luis', rol: 'Cocina', sede: SA };
  check('Cocina de San Antonio no puede abrir la caja de Capri', () => {
    const r = env.ctx.cajaAbrir_({ fecha: HOY, sede: CAPRI, base_inicial: 0, caja_fuerte_inicial: 0 }, cocinaSA);
    assert.equal(r.ok, false, JSON.stringify(r));
  });
  check('Cocina sin el sector "Caja" asignado hoy no puede cerrar', () => {
    env.ctx.cajaAbrir_({ fecha: HOY, sede: SA, base_inicial: 0, caja_fuerte_inicial: 0 }, cocinaSA);
    const r = env.ctx.cajaCerrar_({ fecha: HOY, sede: SA, efectivo_contado: 0, caja_fuerte_contada: 0, base_siguiente: 0 }, cocinaSA);
    assert.equal(r.ok, false, JSON.stringify(r));
  });
  check('con el sector "Caja" asignado, Cocina sí puede cerrar', () => {
    env.ctx.turnoSectorElegir_(HOY, 'Caja', cocinaSA);
    const r = env.ctx.cajaCerrar_({ fecha: HOY, sede: SA, efectivo_contado: 0, caja_fuerte_contada: 0, base_siguiente: 0 }, cocinaSA);
    assert.equal(r.ok, true, JSON.stringify(r));
  });
})();

// =================================================================================================
seccion('11. RAPPI Y AUDITORÍA');

(function () {
  const { env, token } = nuevoEntorno(crearFudoSimulado({}));
  env.post(P(token, { action: 'caja_abrir', item: { fecha: HOY, sede: SA, base_inicial: 0, caja_fuerte_inicial: 0 } }));
  const r = env.post(P(token, { action: 'caja_rappi_marcar', fecha: HOY, sede: SA }));
  check('marcar Rappi funciona', () => assert.equal(r.ok, true, JSON.stringify(r)));
  check('queda registrado quién confirmó Rappi y cuándo', () => {
    const t = env.ctx.leerTabla_('Caja_Turno')[0];
    assert.equal(t.rappi_confirmado_por, 'Diana', 'quedó "' + t.rappi_confirmado_por + '"');
    assert.ok(t.rappi_confirmado_en, 'sin fecha de confirmación');
  });

  env.post(P(token, { action: 'caja_cerrar', item: { fecha: HOY, sede: SA, efectivo_contado: 0, caja_fuerte_contada: 0, base_siguiente: 0, persona_recibe_cierre: 'Giselle' } }));
  check('apertura y cierre dejan rastro en auditoría', () => {
    const eventos = env.ctx.leerTabla_('Auditoria_Eventos').map(e => e.accion);
    assert.ok(eventos.indexOf('caja_abrir') !== -1, 'falta caja_abrir');
    assert.ok(eventos.indexOf('caja_cerrar') !== -1, 'falta caja_cerrar');
  });
})();

// =================================================================================================
seccion('12. RENDIMIENTO: LECTURAS AL SHEET Y CONTAGIO DE UNA API LENTA');

(function () {
  const fudo = crearFudoSimulado({
    ventas: [venta(6101, 'Salón SA', 10000)],
    incluidosVentas: incluidosDeVenta(6101, 'Salón SA', 10000),
    pagos: [pago(6901, 6101, 10000, 'CASH')],
    incluidosPagos: [metodoPago('CASH', 'Efectivo')]
  });
  const { env, token } = nuevoEntorno(fudo);
  env.post(P(token, { action: 'caja_abrir', item: { fecha: HOY, sede: SA, base_inicial: 0, caja_fuerte_inicial: 0 } }));
  env.reiniciarStats();
  env.post(P(token, { action: 'caja_estado', fecha: HOY, sede: SA }));
  info('caja_estado con la caja abierta: ' + env.stats.lecturas + ' lecturas al Sheet → ' + JSON.stringify(env.stats.porHoja));
  check('caja_estado se mantiene por debajo de 60 lecturas al Sheet', () => {
    assert.ok(env.stats.lecturas < 60, 'costó ' + env.stats.lecturas + ' lecturas');
  });
})();

(function () {
  const fudo = crearFudoSimulado({ lentoMs: 700 });
  const { env, token } = nuevoEntorno(fudo);
  let t0 = Date.now();
  env.post(P(token, { action: 'caja_estado', fecha: HOY, sede: SA }));
  const msEstado = Date.now() - t0;
  t0 = Date.now();
  env.post(P(token, { action: 'caja_sincronizar_ahora', fecha: HOY, sede: SA }));
  const msSync = Date.now() - t0;
  info('con una API que tarda 700 ms por llamada → caja_estado: ' + msEstado + ' ms | caja_sincronizar_ahora: ' + msSync + ' ms');
  check('la pantalla no se contagia de la lentitud de la API', () => {
    assert.ok(msEstado < 300, 'caja_estado tardó ' + msEstado + ' ms: está esperando a la API');
  });
  check('la lentitud queda confinada a la acción de sincronizar', () => {
    assert.ok(msSync >= 700, 'sincronizar tardó ' + msSync + ' ms: no parece haber llamado a la API');
  });
})();

// =================================================================================================
seccion('13. CONTRATO ENTRE caja.html Y Code.gs');

(function () {
  const html = fs.readFileSync(path.join(RAIZ, 'caja.html'), 'utf8');
  const code = fs.readFileSync(path.join(RAIZ, 'apps-script', 'Code.gs'), 'utf8');
  const acciones = [...html.matchAll(/llamar\('([a-z_]+)'/g)].map(m => m[1]);
  const rutas = new Set([...code.matchAll(/case '([a-z0-9_]+)':/g)].map(m => m[1]));
  check('toda acción que usa caja.html tiene ruta en Code.gs', () => {
    const faltan = acciones.filter(a => !rutas.has(a));
    assert.deepEqual(faltan, [], 'sin ruta: ' + faltan.join(', '));
  });
  check('caja.html no precarga los campos de conteo físico', () => {
    assert.ok(!/base-contada'\)\.value\s*=\s*[^';]*base_esperada/.test(html), 'base-contada sigue precargada');
    assert.ok(!/cierre-contado'\)\.value\s*=\s*Math\.max/.test(html), 'cierre-contado sigue precargado');
    assert.ok(!/fuerte-contada-apertura'\)\.value\s*=\s*[^';]*caja_fuerte_esperada/.test(html), 'caja fuerte de apertura sigue precargada');
  });
})();

// =================================================================================================
console.log('\n' + '='.repeat(70));
console.log('Comprobaciones que pasan: ' + oks);
console.log('Fallas: ' + fallos.length);
fallos.forEach(f => console.log('  - ' + f));
if (fallos.length) {
  console.log('\nLas fallas esperadas hoy son los dos bugs descritos en docs/diagnostico-caja.md.');
  console.log('Cualquier falla ADICIONAL a esas dos es una regresión nueva.');
}
process.exit(fallos.length ? 1 : 0);
