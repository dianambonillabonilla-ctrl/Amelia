/**
 * ANÁLISIS DE CAJA CONTRA LAS 36 REGLAS DEL CUESTIONARIO OPERATIVO
 *
 * No es una prueba de `npm test`: es una herramienta de diagnóstico (`npm run diagnostico:reglas`).
 * Toma como especificación el cuestionario de reglas de Caja y prueba una por una contra el código,
 * buscando el hueco entre "lo que se supone que hace" y "lo que de verdad hace". Cada bloque cita el
 * número de la regla que está poniendo a prueba.
 *
 * Los hallazgos que reporta están documentados en docs/diagnostico-caja.md, sección 4-bis. Todos
 * existen igual en `main`: ninguno lo introdujo una corrección. Imprime texto para leer, no assert —
 * la idea es ver el número concreto que queda guardado en cada caso.
 */
const { crearEntorno } = require('./helpers/entorno-apps-script.js');
const HOY = '2026-08-07';
const SA = 'San Antonio';
const CP = 'Centro de Producción';

function nuevo() {
  const env = crearEntorno();
  env.fijarReloj(HOY + 'T14:00:00');
  env.ctx.configurarHojas();
  env.ctx.crearAdministradorInicial_('Diana', 'diana', 'contrasegura1', 'd@e.com');
  const t = env.post({ action: 'login', usuario: 'diana', password: 'contrasegura1' }).token;
  return { env, t, P: (c) => Object.assign({ token: t }, c) };
}
function r(x) { return JSON.stringify(x).slice(0, 190); }

console.log('##### 19 — "un movimiento, una vez guardado, no se puede editar ni borrar" #####');
console.log('     ¿y si el MISMO movimiento se guarda dos veces (doble toque / dos dispositivos)?');
(function () {
  const { env, P } = nuevo();
  env.post(P({ action: 'caja_abrir', item: { fecha: HOY, sede: SA, base_inicial: 0, caja_fuerte_inicial: 0 } }));
  const mov = { fecha: HOY, sede: SA, tipo: 'Entrega administrador desde caja', valor: 500000, persona_entrega: 'Giselle', persona_recibe: 'Diana', motivo: 'entrega del mediodía' };
  const a = env.post(P({ action: 'caja_movimiento_registrar', item: mov }));
  const b = env.post(P({ action: 'caja_movimiento_registrar', item: mov }));
  const lista = env.post(P({ action: 'caja_movimientos_listar', fecha: HOY, sede: SA })).data;
  const est = env.post(P({ action: 'caja_estado', fecha: HOY, sede: SA }));
  console.log('  primer registro ok=' + a.ok + ' | segundo registro ok=' + b.ok);
  console.log('  movimientos guardados: ' + lista.length + ' (ids distintos: ' + new Set(lista.map(m => m.id)).size + ')');
  console.log('  entregas al administrador acumuladas: $' + est.movimientos_resumen.entregas_administrador);
  console.log(lista.length === 1
    ? '  >> OK, no se duplicó'
    : '  >> HALLAZGO: se registró dos veces. La caja ahora cree que entregó $' + est.movimientos_resumen.entregas_administrador + ' cuando salieron $500000.');
})();

console.log('\n##### 22 — "lo que debería haber en caja fuerte se calcula con los movimientos" #####');
console.log('     ¿se puede retirar de una caja fuerte vacía?');
(function () {
  const { env, P } = nuevo();
  env.post(P({ action: 'caja_abrir', item: { fecha: HOY, sede: SA, base_inicial: 0, caja_fuerte_inicial: 0 } }));
  const mov = env.post(P({ action: 'caja_movimiento_registrar', item: { fecha: HOY, sede: SA, tipo: 'Retiro de caja fuerte', valor: 300000, motivo: 'necesito cambio' } }));
  const est = env.post(P({ action: 'caja_estado', fecha: HOY, sede: SA }));
  console.log('  retiro de $300000 sobre una caja fuerte de $0: ok=' + mov.ok);
  console.log('  caja fuerte esperada queda en: $' + est.caja_fuerte_esperada);
  console.log('  efectivo operativo queda en:   $' + est.efectivo_esperado);
  console.log(est.caja_fuerte_esperada < 0
    ? '  >> HALLAZGO: la caja fuerte queda en negativo. Físicamente imposible, y nada lo impide.'
    : '  >> OK');
})();

console.log('\n##### 16 — "todo movimiento necesita valor mayor a cero y motivo" #####');
console.log('     ¿hay algún límite superior? ¿un gasto puede superar el efectivo que hay?');
(function () {
  const { env, P } = nuevo();
  env.post(P({ action: 'caja_abrir', item: { fecha: HOY, sede: SA, base_inicial: 50000, caja_fuerte_inicial: 0, observacion_apertura: 'base recibida' } }));
  const gasto = env.post(P({ action: 'caja_movimiento_registrar', item: { fecha: HOY, sede: SA, tipo: 'Gasto', valor: 900000000, motivo: 'dedo resbalado' } }));
  const est = env.post(P({ action: 'caja_estado', fecha: HOY, sede: SA }));
  console.log('  gasto de $900.000.000 con solo $50.000 en caja: ok=' + gasto.ok);
  console.log('  efectivo esperado queda en: $' + est.efectivo_esperado);
  console.log(est.efectivo_esperado < 0
    ? '  >> HALLAZGO: el esperado queda negativo y el movimiento no se puede borrar (regla 19).'
    : '  >> OK');
})();

console.log('\n##### 30 y 31 — "Centro de Producción no tiene Caja" / "solo San Antonio y Capri" #####');
console.log('     el selector lo esconde, pero ¿el backend lo rechaza?');
(function () {
  const { env, P } = nuevo();
  const ab = env.post(P({ action: 'caja_abrir', item: { fecha: HOY, sede: CP, base_inicial: 0, caja_fuerte_inicial: 0 } }));
  console.log('  abrir caja de "' + CP + '": ok=' + ab.ok + (ab.ok ? '' : ' -> ' + ab.error));
  if (ab.ok) {
    const mov = env.post(P({ action: 'caja_movimiento_registrar', item: { fecha: HOY, sede: CP, tipo: 'Gasto', valor: 1000, motivo: 'x' } }));
    console.log('  registrar movimiento en ' + CP + ': ok=' + mov.ok);
    console.log('  >> HALLAZGO: se creó un turno de caja para una sede que no debería tener Caja.');
  } else {
    console.log('  >> OK, el backend lo rechaza');
  }
  const sedes = env.ctx.leerTabla_('Caja_Turno').map(x => x.sede);
  console.log('  turnos existentes por sede: ' + JSON.stringify(sedes));
})();

console.log('\n##### 28 — "el Administrador puede operar cualquier fecha" #####');
console.log('     ¿incluye abrir una caja de una fecha que todavía no llegó?');
(function () {
  const { env, P } = nuevo();
  const futura = env.post(P({ action: 'caja_abrir', item: { fecha: '2027-06-15', sede: SA, base_inicial: 0, caja_fuerte_inicial: 0 } }));
  console.log('  abrir la caja del 2027-06-15 (dentro de 10 meses): ok=' + futura.ok + (futura.ok ? '' : ' -> ' + futura.error));
  console.log(futura.ok
    ? '  >> HALLAZGO: se puede abrir el turno de una fecha futura, y luego no hay forma de borrarlo (regla 14).'
    : '  >> OK');
})();

console.log('\n##### 20 — "no se puede registrar movimiento si la caja no está abierta" #####');
(function () {
  const { env, P } = nuevo();
  const antes = env.post(P({ action: 'caja_movimiento_registrar', item: { fecha: HOY, sede: SA, tipo: 'Gasto', valor: 1000, motivo: 'x' } }));
  env.post(P({ action: 'caja_abrir', item: { fecha: HOY, sede: SA, base_inicial: 0, caja_fuerte_inicial: 0 } }));
  env.post(P({ action: 'caja_cerrar', item: { fecha: HOY, sede: SA, efectivo_contado: 0, caja_fuerte_contada: 0, base_siguiente: 0, persona_recibe_cierre: 'G' } }));
  const despues = env.post(P({ action: 'caja_movimiento_registrar', item: { fecha: HOY, sede: SA, tipo: 'Gasto', valor: 1000, motivo: 'x' } }));
  console.log('  antes de abrir:  ok=' + antes.ok + ' -> ' + (antes.error || ''));
  console.log('  después de cerrar: ok=' + despues.ok + ' -> ' + (despues.error || ''));
  console.log((!antes.ok && !despues.ok) ? '  >> OK' : '  >> HALLAZGO');
})();

console.log('\n##### 12 y 14 — "entregado a X" y el cierre inmutable #####');
console.log('     si lo contado es MENOR que la base que se deja, ¿qué se guarda como entregado?');
(function () {
  const { env, P } = nuevo();
  env.post(P({ action: 'caja_abrir', item: { fecha: HOY, sede: SA, base_inicial: 100000, caja_fuerte_inicial: 0, observacion_apertura: 'base' } }));
  const c = env.post(P({ action: 'caja_cerrar', item: { fecha: HOY, sede: SA, efectivo_contado: 100000, caja_fuerte_contada: 0, base_siguiente: 100000, persona_recibe_cierre: 'Giselle' } }));
  const f = env.ctx.leerTabla_('Caja_Turno')[0];
  console.log('  contado $100000, base siguiente $100000 -> entregado guardado: $' + f.entrega_cierre);
  console.log('  persona_recibe_cierre guardada: "' + f.persona_recibe_cierre + '"');
  console.log('  >> Con entrega $0 se sigue exigiendo un nombre en el navegador, y ese nombre se');
  console.log('     muestra despues como "Entregado a Giselle: $0". Es el hallazgo #8.');
})();

console.log('\n##### 34 — "Rappi solo se marca con la caja abierta, no se puede desmarcar" #####');
console.log('     ¿se puede cerrar la caja sin haber confirmado Rappi?');
(function () {
  const { env, P } = nuevo();
  env.post(P({ action: 'caja_abrir', item: { fecha: HOY, sede: SA, base_inicial: 0, caja_fuerte_inicial: 0 } }));
  const c = env.post(P({ action: 'caja_cerrar', item: { fecha: HOY, sede: SA, efectivo_contado: 0, caja_fuerte_contada: 0, base_siguiente: 0, persona_recibe_cierre: 'G' } }));
  const f = env.ctx.leerTabla_('Caja_Turno')[0];
  console.log('  cerrar sin confirmar Rappi: ok=' + c.ok + ' | rappi_encendido=' + f.rappi_encendido);
  console.log('  >> El turno queda cerrado con Rappi sin confirmar y sin ninguna alerta.');
})();

console.log('\n##### 35 — "no existe lista de días anteriores" #####');
(function () {
  const fs = require('fs');
  const historiales = fs.readFileSync(require('path').join(__dirname,'..','historiales.html'), 'utf8');
  const code = fs.readFileSync(require('path').join(__dirname,'..','apps-script','Code.gs'), 'utf8');
  const hayAccionHistorial = /caja_turnos_listar|caja_historial/.test(code);
  console.log('  ¿"Caja" aparece en historiales.html? ' + (/caja/i.test(historiales) ? 'sí' : 'NO'));
  console.log('  ¿existe alguna acción de historial de Caja en Code.gs? ' + (hayAccionHistorial ? 'sí' : 'NO'));
  console.log('  >> Para ver un día viejo hay que escribir la fecha a mano, y no hay forma de saber');
  console.log('     qué días quedaron sin cerrar.');
})();

console.log('\n##### Extra: ¿se puede saber si una sede dejó un día SIN CERRAR? #####');
(function () {
  const { env, P } = nuevo();
  // Se abre el 5 y NUNCA se cierra. Se abre el 6, se le registra el efectivo del día y se cierra
  // bien (con su ingreso, para que no haya diferencia y el cierre no se bloquee). Se consulta el 7.
  env.post(P({ action: 'caja_abrir', item: { fecha: '2026-08-05', sede: SA, base_inicial: 0, caja_fuerte_inicial: 0 } }));
  env.post(P({ action: 'caja_abrir', item: { fecha: '2026-08-06', sede: SA, base_inicial: 0, caja_fuerte_inicial: 0 } }));
  env.post(P({ action: 'caja_movimiento_registrar', item: { fecha: '2026-08-06', sede: SA, tipo: 'Otro ingreso', valor: 80000, motivo: 'efectivo del día' } }));
  const cierre = env.post(P({ action: 'caja_cerrar', item: { fecha: '2026-08-06', sede: SA, efectivo_contado: 80000, caja_fuerte_contada: 0, base_siguiente: 30000, persona_recibe_cierre: 'Giselle' } }));
  const est = env.post(P({ action: 'caja_estado', fecha: HOY, sede: SA }));
  const turnos = env.ctx.leerTabla_('Caja_Turno').map(x => x.fecha + '=' + x.estado);
  console.log('  cierre del 6: ok=' + cierre.ok + (cierre.ok ? ' (dejó base_siguiente = $30000)' : ' -> ' + cierre.error));
  console.log('  turnos en la hoja: ' + JSON.stringify(turnos));
  console.log('  base esperada de hoy: $' + est.base_esperada + ' — debería ser $30000');
  console.log('  ¿el estado de hoy avisa que el 5 quedó abierto para siempre? ' +
    (/sin_cerrar|dias_abiertos|pendientes/.test(JSON.stringify(est)) ? 'sí' : 'NO'));
  console.log('  >> HALLAZGO 1: un día abierto y nunca cerrado queda invisible. Nadie se enteraría.');
  console.log('  >> HALLAZGO 2: la base de hoy sale en $0 aunque el 6 cerró dejando $30000. Es el');
  console.log('     Bug 1: el cierre se hizo HOY, así que su timestamp no es anterior a la');
  console.log('     medianoche de hoy y el filtro no lo encuentra.');
})();
