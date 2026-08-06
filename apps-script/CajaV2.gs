/** CAJA V2 — caja operativa, caja fuerte y entregas al administrador. */

const CAJA_V2_TIPOS_ = [
  'Envío a caja fuerte','Retiro de caja fuerte',
  'Entrega administrador desde caja','Entrega administrador desde caja fuerte',
  'Entrega administrador','Gasto','Otro ingreso'
];

function cajaV2Asegurar_() {
  asegurarColumnas_(sheet_(SHEET_NAMES.CAJA_TURNO), [
    'caja_fuerte_esperada_apertura','caja_fuerte_inicial','diferencia_caja_fuerte_apertura',
    'caja_fuerte_contada','caja_fuerte_esperada','diferencia_caja_fuerte','caja_fuerte_siguiente'
  ]);
  cajaV2MigrarHistorico_();
}

function cajaV2MigrarHistorico_() {
  const filas = leerTabla_(SHEET_NAMES.CAJA_MOVIMIENTOS);
  const ids = {};
  filas.forEach(function(r){ ids[String(r.id || '')] = true; });
  const migraciones = [
    {id:'migracion-caja-fuerte-sa-20260802',fecha:'2026-08-02',sede:'San Antonio',tipo:'Envío a caja fuerte',valor:1000000,persona_entrega:'Giselle',persona_recibe:'Caja fuerte',motivo:'Migrado desde observación histórica: guardé un millón en caja fuerte'},
    {id:'migracion-entrega-admin-capri-20260803',fecha:'2026-08-03',sede:'Capri',tipo:'Entrega administrador desde caja',valor:550000,persona_entrega:'Giselle',persona_recibe:'Diana',motivo:'Migrado desde observación histórica: entregué 550 en efectivo a Diana'}
  ];
  migraciones.forEach(function(m){
    if (ids[m.id]) return;
    m.hora = new Date(m.fecha + 'T20:00:00');
    m.usuario = 'Migración histórica';
    m.timestamp = new Date();
    appendRowFromObj_(SHEET_NAMES.CAJA_MOVIMIENTOS,m);
  });
}

function cajaV2TipoReal_(m) {
  const tipo = String(m.tipo || '');
  const texto = (String(m.persona_recibe || '') + ' ' + String(m.motivo || '')).toLowerCase();
  if (tipo === 'Entrega administrador' && texto.indexOf('caja fuerte') >= 0) return 'Envío a caja fuerte';
  if (tipo === 'Entrega administrador') return 'Entrega administrador desde caja';
  return tipo;
}

function cajaMovimientosResumen_(movimientos) {
  const r = {envios_caja_fuerte:0,retiros_caja_fuerte:0,entregas_admin_caja:0,entregas_admin_caja_fuerte:0,gastos:0,otros_ingresos:0};
  movimientos.forEach(function(m){
    const valor = Number(m.valor) || 0;
    const tipo = cajaV2TipoReal_(m);
    if (tipo === 'Envío a caja fuerte') r.envios_caja_fuerte += valor;
    else if (tipo === 'Retiro de caja fuerte') r.retiros_caja_fuerte += valor;
    else if (tipo === 'Entrega administrador desde caja') r.entregas_admin_caja += valor;
    else if (tipo === 'Entrega administrador desde caja fuerte') r.entregas_admin_caja_fuerte += valor;
    else if (tipo === 'Gasto') r.gastos += valor;
    else if (tipo === 'Otro ingreso') r.otros_ingresos += valor;
  });
  r.entregas_administrador = r.entregas_admin_caja + r.entregas_admin_caja_fuerte;
  Object.keys(r).forEach(function(k){ r[k] = Number(r[k].toFixed(2)); });
  return r;
}

function cajaV2SaldoFuerteAntes_(fecha,sede) {
  cajaV2Asegurar_();
  const limite = new Date(fecha + 'T00:00:00').getTime();
  const movimientos = leerTabla_(SHEET_NAMES.CAJA_MOVIMIENTOS).filter(function(m){
    return m.sede === sede && new Date(formatearFecha_(m.fecha) + 'T00:00:00').getTime() < limite;
  });
  const r = cajaMovimientosResumen_(movimientos);
  return Number((r.envios_caja_fuerte-r.retiros_caja_fuerte-r.entregas_admin_caja_fuerte).toFixed(2));
}

function cajaEfectivoEsperado_(apertura,movimientos,fecha,sede) {
  cajaV2Asegurar_();
  const r = cajaMovimientosResumen_(movimientos);
  const efectivoFudoActual = cajaEfectivoFudoDia_(fecha,sede);
  const efectivoFudoTurno = Math.max(0,efectivoFudoActual-(Number(apertura.efectivo_fudo_al_abrir)||0));
  const esperado = Number(apertura.base_inicial||0)+efectivoFudoTurno+r.otros_ingresos+r.retiros_caja_fuerte-r.envios_caja_fuerte-r.entregas_admin_caja-r.gastos;
  const fuerte = Number(apertura.caja_fuerte_inicial||0)+r.envios_caja_fuerte-r.retiros_caja_fuerte-r.entregas_admin_caja_fuerte;
  return {esperado:Number(esperado.toFixed(2)),caja_fuerte_esperada:Number(fuerte.toFixed(2)),pagos_efectivo_esperado:Number(efectivoFudoTurno.toFixed(2)),pagos_efectivo_dia:Number(efectivoFudoActual.toFixed(2)),resumen:r};
}

function cajaAbrir_(item,usuario) {
  cajaV2Asegurar_();
  if (!item || !item.fecha || !item.sede) return {ok:false,error:'Falta la fecha o la sede'};
  if (!sedeEscrituraPermitida_(usuario,item.sede)) return {ok:false,error:'No puedes abrir la caja de otra sede'};
  const fecha = formatearFecha_(item.fecha);
  const existente = cajaTurnoFila_(fecha,item.sede);
  if (existente) return existente.estado === 'Cerrado' ? {ok:false,error:'La caja ya se cerró'} : {ok:true,ya_abierta:true,item:existente};
  const baseEsperada = cajaBaseEsperada_(fecha,item.sede);
  const fuerteEsperada = cajaV2SaldoFuerteAntes_(fecha,item.sede);
  const baseInicial = Number(item.base_inicial)||0;
  const fuerteInicial = Number(item.caja_fuerte_inicial)||0;
  const fila = {id:Utilities.getUuid(),fecha:fecha,sede:item.sede,estado:'Abierto',base_esperada:baseEsperada,base_inicial:baseInicial,diferencia_apertura:Number((baseInicial-baseEsperada).toFixed(2)),observacion_apertura:item.observacion_apertura||'',caja_fuerte_esperada_apertura:fuerteEsperada,caja_fuerte_inicial:fuerteInicial,diferencia_caja_fuerte_apertura:Number((fuerteInicial-fuerteEsperada).toFixed(2)),hora_apertura:new Date(),usuario_apertura_id:usuario.id,usuario_apertura:usuario.nombre,efectivo_fudo_al_abrir:cajaEfectivoFudoDia_(fecha,item.sede),rappi_encendido:false};
  appendRowFromObj_(SHEET_NAMES.CAJA_TURNO,fila);
  auditoriaRegistrar_(usuario,'caja_abrir','CajaTurno',fecha+'|'+item.sede,null,fila,item.sede,item.observacion_apertura||'');
  return {ok:true,item:fila};
}

function cajaEstado_(fecha,sede,usuario) {
  cajaV2Asegurar_();
  if (!fecha || !sede) return {ok:false,error:'Falta la fecha o la sede'};
  const apertura = cajaTurnoFila_(fecha,sede);
  if (!apertura) return {ok:true,abierta:false,base_esperada:cajaBaseEsperada_(fecha,sede),caja_fuerte_esperada:cajaV2SaldoFuerteAntes_(fecha,sede),puede_cerrar:cajaPuedeCerrar_(usuario,fecha)};
  const calculo = cajaEfectivoEsperado_(apertura,cajaMovimientosDelDia_(fecha,sede),fecha,sede);
  return {ok:true,abierta:apertura.estado==='Abierto',apertura:apertura,movimientos_resumen:calculo.resumen,pagos_efectivo_esperado:calculo.pagos_efectivo_esperado,pagos_efectivo_dia:calculo.pagos_efectivo_dia,efectivo_esperado:calculo.esperado,caja_fuerte_esperada:calculo.caja_fuerte_esperada,total_bajo_custodia:calculo.esperado+calculo.caja_fuerte_esperada,puede_cerrar:cajaPuedeCerrar_(usuario,fecha)};
}

function cajaMovimientoRegistrar_(item,usuario) {
  cajaV2Asegurar_();
  if (!item || !item.fecha || !item.sede) return {ok:false,error:'Falta fecha o sede'};
  const fecha = formatearFecha_(item.fecha), apertura = cajaTurnoFila_(fecha,item.sede);
  if (!apertura || apertura.estado === 'Cerrado') return {ok:false,error:'La caja no está abierta'};
  if (CAJA_V2_TIPOS_.indexOf(item.tipo) === -1) return {ok:false,error:'Tipo de movimiento inválido'};
  const valor = Number(item.valor); if (!valor || valor <= 0) return {ok:false,error:'El valor debe ser mayor a cero'};
  if (!item.motivo) return {ok:false,error:'Falta el motivo'};
  if (String(item.tipo).indexOf('Entrega administrador') === 0 && (!item.persona_entrega || !item.persona_recibe)) return {ok:false,error:'La entrega necesita quién entrega y quién recibe'};
  const fila = {id:Utilities.getUuid(),fecha:fecha,sede:item.sede,tipo:item.tipo,valor:valor,persona_entrega:item.persona_entrega||usuario.nombre,persona_recibe:item.persona_recibe||'',hora:new Date(),motivo:item.motivo,evidencia_url:item.evidencia_url||'',usuario_id:usuario.id,usuario:usuario.nombre,timestamp:new Date()};
  appendRowFromObj_(SHEET_NAMES.CAJA_MOVIMIENTOS,fila);
  auditoriaRegistrar_(usuario,'caja_movimiento_registrar','CajaMovimientos',fila.id,null,{tipo:fila.tipo,valor:fila.valor},item.sede,item.motivo);
  return {ok:true,item:fila};
}

function cajaCerrar_(item,usuario) {
  cajaV2Asegurar_();
  if (!item || !item.fecha || !item.sede) return {ok:false,error:'Falta fecha o sede'};
  const fecha = formatearFecha_(item.fecha), apertura = cajaTurnoFila_(fecha,item.sede);
  if (!apertura) return {ok:false,error:'La caja no está abierta'};
  if (apertura.estado === 'Cerrado') return {ok:true,ya_cerrado:true};
  const calculo = cajaEfectivoEsperado_(apertura,cajaMovimientosDelDia_(fecha,item.sede),fecha,item.sede);
  const contado = Number(item.efectivo_contado)||0, fuerteContada = Number(item.caja_fuerte_contada)||0;
  const baseSiguiente = item.base_siguiente !== '' && item.base_siguiente != null ? Number(item.base_siguiente)||0 : contado;
  const dif = Number((contado-calculo.esperado).toFixed(2)), difFuerte = Number((fuerteContada-calculo.caja_fuerte_esperada).toFixed(2));
  cajaTurnoActualizarFila_(fecha,item.sede,{estado:'Cerrado',efectivo_contado:contado,efectivo_esperado:calculo.esperado,diferencia:dif,caja_fuerte_contada:fuerteContada,caja_fuerte_esperada:calculo.caja_fuerte_esperada,diferencia_caja_fuerte:difFuerte,entrega_cierre:0,persona_recibe_cierre:item.persona_recibe_cierre||'',base_siguiente:baseSiguiente,caja_fuerte_siguiente:fuerteContada,usuario_cierre:usuario.nombre,hora_cierre:new Date(),observacion_cierre:item.observacion||'',timestamp_cierre:new Date()});
  return {ok:true,efectivo_esperado:calculo.esperado,efectivo_contado:contado,diferencia:dif,caja_fuerte_esperada:calculo.caja_fuerte_esperada,caja_fuerte_contada:fuerteContada,diferencia_caja_fuerte:difFuerte,base_siguiente:baseSiguiente};
}
