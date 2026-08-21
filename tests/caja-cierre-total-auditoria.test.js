const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { crearEntorno } = require('./helpers/entorno-apps-script.js');

const inicio = fs.readFileSync(path.join(__dirname,'..','apps-script','CajaInicioOperacion20260820.gs'),'utf8');
const caja = fs.readFileSync(path.join(__dirname,'..','apps-script','ZZ_ReactivacionCajaFinal.gs'),'utf8');

// 1) El corte 20/08 debe marcarse como terminado después del archivado, no antes.
const idxArchTurnos = inicio.indexOf("turnos = cajaArchivarFilasAnterioresInicio_");
const idxArchMovs = inicio.indexOf("movimientos = cajaArchivarFilasAnterioresInicio_");
const idxMarca = inicio.indexOf("props.setProperty(CAJA_INICIO_OPERACION_PROP_, 'true')");
assert.ok(idxArchTurnos > 0 && idxArchMovs > idxArchTurnos && idxMarca > idxArchMovs,
  'La marca de inicio oficial debe escribirse después de archivar turnos y movimientos.');
assert.match(inicio,/props\.setProperty\('CAJA_MIGRACION_HISTORICA_HECHA', 'true'\)/,
  'La migración histórica vieja debe quedar desactivada tras el corte.');
assert.match(inicio,/props\.deleteProperty\(CAJA_INICIO_OPERACION_PROP_\)/,
  'Si la inicialización falla, la marca de éxito debe quedar borrada.');

// 2) Pagos FUDO: Caja debe consultar pagos incluyendo cancelados y no usar el filtro neq.true.
assert.match(caja,/function cajaSincronizarPagosFudoIncluyendoCancelados_/);
const bloquePagos = caja.slice(caja.indexOf('function cajaSincronizarPagosFudoIncluyendoCancelados_'), caja.indexOf('function cajaSincronizarFudo_'));
assert.doesNotMatch(bloquePagos,/canceled\s*:\s*['"]neq\.true/,
  'La sincronización completa de Caja no debe excluir pagos cancelados.');
assert.match(caja,/res\.pagos=cajaSincronizarPagosFudoIncluyendoCancelados_/);

// 3) El efectivo del turno se clasifica por paidAt/createdAt, no solo por delta de snapshots.
assert.match(caja,/function cajaPagosEfectivoTurnoPorMomento_/);
assert.match(caja,/porMomento\.disponible\s*\?\s*porMomento\.total/);
assert.match(caja,/p\.creacion\|\|p\.paid_at\|\|p\.paidAt/);

// 4) El estado FUDO de HOY deja de ser confiable si envejece más de 30 minutos.
assert.match(caja,/CAJA_FUDO_ESTADO_MAX_EDAD_MS_\s*=\s*30 \* 60 \* 1000/);
assert.match(caja,/desactualizado:true/);
assert.match(caja,/más de 30 minutos/);

// 5) Las correcciones reproducen cronológicamente movimientos posteriores y detectan negativos intermedios.
assert.match(caja,/\.sort\(function\(a,b\)\{return cajaFechaMs_\(a\.timestamp\|\|a\.hora\)-cajaFechaMs_\(b\.timestamp\|\|b\.hora\);\}\)/);
assert.match(caja,/if\(!custodiaPosterior\.valida/);

// Prueba dinámica del clasificador por momento: un pago anterior a abrir NO se vuelve a sumar;
// uno posterior sí. Se usa la tabla normalizada Fudo_Pagos que consume Caja cuando está disponible.
(function(){
  const env = crearEntorno({ reactivacionReal:true });
  env.ctx.configurarHojas();
  env.fijarReloj('2026-08-20T18:00:00-05:00');
  const shName = env.ctx.SHEET_NAMES.FUDO_PAGOS;
  env.ctx.appendRowFromObj_(shName,{
    id_pago:'p-antes',id_venta:'v-1',fecha:'2026-08-20',creacion:new Date('2026-08-20T16:50:00-05:00'),
    monto:30000,cancelado:false,metodo_pago:'Efectivo',metodo_tipo:'cash',sede:'San Antonio',es_efectivo:true
  });
  env.ctx.appendRowFromObj_(shName,{
    id_pago:'p-despues',id_venta:'v-2',fecha:'2026-08-20',creacion:new Date('2026-08-20T17:10:00-05:00'),
    monto:40000,cancelado:false,metodo_pago:'Efectivo',metodo_tipo:'cash',sede:'San Antonio',es_efectivo:true
  });
  const r = env.ctx.cajaPagosEfectivoTurnoPorMomento_({hora_apertura:new Date('2026-08-20T17:00:00-05:00'),estado:'Abierto'},'2026-08-20','San Antonio');
  assert.strictEqual(r.disponible,true,JSON.stringify(r));
  assert.strictEqual(r.total,40000,JSON.stringify(r));
  assert.strictEqual(r.cantidad,1,JSON.stringify(r));
})();

console.log('caja-cierre-total-auditoria: OK');
