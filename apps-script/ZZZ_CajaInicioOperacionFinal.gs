/**
 * CAPA FINAL DE ARRANQUE DE CAJA DESDE 20/08/2026.
 * Se carga después de ZZ_ReactivacionCajaFinal.gs y especializa únicamente el arranque oficial
 * y la persistencia del estado de sincronización FUDO.
 */

function cajaFudoEstadoPropKey_(fecha, sede) {
  return 'CAJA_FUDO_ESTADO|' + formatearFecha_(fecha) + '|' + sede;
}

function cajaGuardarEstadoFudoPersistente_(fecha, sede, estado) {
  const limpio = Object.assign({}, estado || {}, {
    fecha:formatearFecha_(fecha), sede:sede,
    sincronizado_en:(estado && estado.sincronizado_en) || new Date()
  });
  PropertiesService.getScriptProperties().setProperty(cajaFudoEstadoPropKey_(fecha,sede), JSON.stringify(limpio));
  CacheService.getScriptCache().put(cajaFudoCacheKey_(formatearFecha_(fecha),sede), JSON.stringify(limpio), 3600);
  return limpio;
}

cajaLeerEstadoFudo_ = function(fecha, sede) {
  const f = formatearFecha_(fecha);
  const persistido = PropertiesService.getScriptProperties().getProperty(cajaFudoEstadoPropKey_(f,sede));
  if (persistido) {
    try { return JSON.parse(persistido); } catch (e) {}
  }
  const guardado = CacheService.getScriptCache().get(cajaFudoCacheKey_(f,sede));
  if (guardado) {
    try { return JSON.parse(guardado); } catch (e) {}
  }
  return { ok:false, pendiente:true, aplica:true, fecha:f, sede:sede, error:'FUDO todavía no tiene una sincronización registrada para esta fecha y sede.' };
};

cajaSincronizarFudo_ = function(fecha,sede,usuario,forzar) {
  const f=formatearFecha_(fecha);
  if(!cajaFudoCredencialesConfiguradas_()) {
    return cajaGuardarEstadoFudoPersistente_(f,sede,{ok:true,aplica:false,fecha:f,sede:sede,sincronizado_en:'',ventas:null,pagos:null,gastos:null,error:''});
  }
  if(!forzar) return cajaLeerEstadoFudo_(f,sede);
  const res={ok:false,aplica:true,fecha:f,sede:sede,sincronizado_en:new Date(),ventas:null,pagos:null,gastos:null,error:''},errores=[];
  try{res.ventas=fudoApiSincronizarVentas_(f,f,usuario,{sede:'Automática'});if(!res.ventas||res.ventas.ok===false)errores.push('Ventas: '+((res.ventas&&res.ventas.error)||'falló'));}catch(e){errores.push('Ventas: '+(e.message||e));}
  try{res.pagos=fudoApiSincronizarPagos_(f,f,usuario,{sede:'Automática'});if(!res.pagos||res.pagos.ok===false)errores.push('Pagos: '+((res.pagos&&res.pagos.error)||'falló'));}catch(e){errores.push('Pagos: '+(e.message||e));}
  try{res.gastos=fudoApiSincronizarGastosArqueo_(f,f,usuario);if(!res.gastos||res.gastos.ok===false)errores.push('Gastos: '+((res.gastos&&res.gastos.error)||'falló'));}catch(e){errores.push('Gastos: '+(e.message||e));}
  res.ok=errores.length===0;res.error=errores.join(' | ');res.sincronizado_en=new Date();
  return cajaGuardarEstadoFudoPersistente_(f,sede,res);
};

function cajaReferenciaInicialSincronizar_(fecha,sede,usuario) {
  const fechaFmt=formatearFecha_(fecha), fechaRef=cajaDiaAnteriorReactivacion_(fechaFmt);
  const sync=cajaSincronizarFudo_(fechaRef,sede,usuario,true);
  const ref=cajaReferenciaFudoDiaAnterior_(fechaFmt,sede);
  ref.sincronizacion=sync;
  ref.confirmado=!!(sync&&sync.ok&&sync.aplica!==false);
  return ref;
}

cajaAbrir_ = function(item,usuario) {
  cajaAsegurarEstructura_(); cajaAsegurarColumnasCustodia_(); cajaAsegurarColumnasInicioOperacion_();
  if (!item || !item.fecha || !item.sede) return {ok:false,error:'Falta la fecha o la sede'};
  if (CAJA_SEDES_VALIDAS_.indexOf(item.sede)===-1) return {ok:false,error:'Caja solo existe en San Antonio y Capri.'};
  if (!sedeEscrituraPermitida_(usuario,item.sede)) return {ok:false,error:'No puedes abrir la caja de otra sede'};
  const fecha=formatearFecha_(item.fecha);
  if (!cajaFechaOperacionPermitida_(fecha)) return {ok:false,error:'La operación oficial de Caja inicia el 20/08/2026. Las fechas anteriores quedaron archivadas.'};
  if (fecha>formatearFecha_(new Date())) return {ok:false,error:'No puedes abrir la caja de una fecha futura.'};
  if (cajaExisteTurnoPosteriorA_(fecha,item.sede)) return {ok:false,error:'No puedes abrir una caja retroactiva porque ya existe un turno posterior de esta sede.'};
  const existente=cajaTurnoFila_(fecha,item.sede);
  if (existente) return existente.estado==='Cerrado'?{ok:false,error:'La caja ya se cerró'}:{ok:true,ya_abierta:true,item:existente};

  const baseValida=cajaValorContadoValido_(item.base_inicial); if(!baseValida.ok)return {ok:false,error:'Efectivo contado al abrir: '+baseValida.error};
  const fuerteValida=cajaValorContadoValido_(item.caja_fuerte_inicial); if(!fuerteValida.ok)return {ok:false,error:'Caja fuerte contada al abrir: '+fuerteValida.error};
  const baseInicial=baseValida.valor, fuerteInicial=fuerteValida.valor, totalFisico=Number((baseInicial+fuerteInicial).toFixed(2));

  const usaReferenciaInicial=cajaUsaReferenciaFudoInicial_(fecha,item.sede);
  let referenciaInicial=null, syncFudo=null, baseEsperada=0, fuerteEsperada=0, difApertura=0, difFuerte=0, difTotal=0;
  if(usaReferenciaInicial){
    referenciaInicial=cajaReferenciaInicialSincronizar_(fecha,item.sede,usuario);
    syncFudo=referenciaInicial.sincronizacion;
    difTotal=Number((totalFisico-referenciaInicial.referencia_total).toFixed(2));
    difApertura=difTotal; difFuerte=0;
  } else {
    syncFudo=cajaSincronizarFudo_(fecha,item.sede,usuario,false);
    baseEsperada=cajaBaseEsperada_(fecha,item.sede); fuerteEsperada=cajaSaldoFuerteAntes_(fecha,item.sede);
    difApertura=Number((baseInicial-baseEsperada).toFixed(2)); difFuerte=Number((fuerteInicial-fuerteEsperada).toFixed(2));
    difTotal=Number((difApertura+difFuerte).toFixed(2));
  }

  if ((Math.abs(difTotal)>0.01) && !String(item.observacion_apertura||'').trim()) {
    return {ok:false,error:usaReferenciaInicial?
      'El total físico contado no coincide con la referencia de efectivo de FUDO del día anterior. Escribe una observación para dejar registrada la diferencia inicial.':
      'Hay una diferencia al abrir la caja. Escribe una observación explicando qué pasó.',
      diferencia_apertura:difApertura,diferencia_caja_fuerte_apertura:difFuerte,diferencia_total_apertura:difTotal,
      referencia_total_apertura:referenciaInicial?referenciaInicial.referencia_total:Number((baseEsperada+fuerteEsperada).toFixed(2))};
  }

  const fila={id:Utilities.getUuid(),fecha:fecha,sede:item.sede,estado:'Abierto',base_esperada:baseEsperada,base_inicial:baseInicial,
    diferencia_apertura:difApertura,observacion_apertura:item.observacion_apertura||'',caja_fuerte_esperada_apertura:fuerteEsperada,
    caja_fuerte_inicial:fuerteInicial,diferencia_caja_fuerte_apertura:difFuerte,hora_apertura:new Date(),usuario_apertura_id:usuario.id,
    usuario_apertura:usuario.nombre,efectivo_fudo_al_abrir:cajaEfectivoFudoDia_(fecha,item.sede),rappi_encendido:false,
    tipo_referencia_apertura:usaReferenciaInicial?'FUDO_DIA_ANTERIOR':'CIERRE_DILANA',
    fecha_referencia_apertura:referenciaInicial?referenciaInicial.fecha_referencia:'',
    referencia_total_apertura:referenciaInicial?referenciaInicial.referencia_total:Number((baseEsperada+fuerteEsperada).toFixed(2)),
    efectivo_fudo_referencia_apertura:referenciaInicial?referenciaInicial.efectivo_fudo:'',
    gastos_fudo_referencia_apertura:referenciaInicial?referenciaInicial.gastos_fudo_efectivo:'',
    referencia_fudo_confirmada_apertura:referenciaInicial?referenciaInicial.confirmado:'',
    diferencia_total_apertura:difTotal};

  const lock=LockService.getScriptLock(); if(!lock.tryLock(10000))return {ok:false,error:'Otra apertura de caja está en curso ahora mismo.'};
  try {
    const ahora=cajaTurnoFila_(fecha,item.sede); if(ahora)return ahora.estado==='Cerrado'?{ok:false,error:'La caja ya se cerró'}:{ok:true,ya_abierta:true,item:ahora};
    appendRowFromObj_(SHEET_NAMES.CAJA_TURNO,fila);
    auditoriaRegistrar_(usuario,'caja_abrir','CajaTurno',fecha+'|'+item.sede,null,fila,item.sede,item.observacion_apertura||'');
  } finally { lock.releaseLock(); }
  return {ok:true,item:fila,fudo_sync:syncFudo,referencia_inicial:referenciaInicial};
};

cajaConciliacionApertura_ = function(fecha,sede) {
  const fechaFmt=formatearFecha_(fecha), ultimo=cajaUltimoCierreAntes_(fechaFmt,sede);
  if(!ultimo && cajaUsaReferenciaFudoInicial_(fechaFmt,sede)){
    const ref=cajaReferenciaFudoDiaAnterior_(fechaFmt,sede);
    return {
      disponible:true,tiene_cierre_dilana:false,modo_referencia_inicial_fudo:true,
      fecha_referencia:ref.fecha_referencia,fudo_confirmado:ref.confirmado,
      estado_conciliacion:ref.confirmado?'REFERENCIA_INICIAL_FUDO':'NO_CONFIRMADA_FUDO',
      mensaje:ref.confirmado?'Inicio oficial de Caja: FUDO del día anterior es la referencia total. El conteo físico de hoy fija la primera distribución real entre caja y caja fuerte.':'No se pudo confirmar FUDO del día anterior; el conteo físico puede registrarse, pero la referencia inicial queda pendiente.',
      fudo:{ventas_total:ref.ventas_total,pagos_total:ref.pagos_total,efectivo:ref.efectivo_fudo,gastos_efectivo:ref.gastos_fudo_efectivo,referencia_neta:ref.referencia_total},
      dilana:null,custodia_esperada_hoy:{caja_operativa:null,caja_fuerte:null,total:ref.referencia_total},
      movimientos_posteriores:{cantidad:0,entregado_personas:0,enviado_caja_fuerte:0,retirado_caja_fuerte:0,otros_ingresos:0},
      cuadra_fudo_dilana:null,diferencia_fudo_dilana:null
    };
  }

  const fechaRef=ultimo?formatearFecha_(ultimo.fecha):cajaDiaAnteriorReactivacion_(fechaFmt);
  const syncRef=cajaLeerEstadoFudo_(fechaRef,sede);
  const fudoConfirmado=!!(syncRef&&syncRef.ok&&syncRef.aplica!==false);
  const resumen=typeof turnoResumenCierre_==='function'?turnoResumenCierre_(fechaRef,sede):{pagos_efectivo_esperado:0,pagos_fudo_total:0,ventas_fudo_total:0};
  if(!ultimo){
    return {disponible:true,tiene_cierre_dilana:false,fecha_referencia:fechaRef,fudo_confirmado:fudoConfirmado,
      estado_conciliacion:fudoConfirmado?'SIN_CIERRE_DILANA':'NO_CONFIRMADA_FUDO',
      mensaje:fudoConfirmado?'No existe un cierre DILANA anterior para comparar.':'No se pudo confirmar FUDO para la fecha de referencia; no se declara conciliación.',
      fudo:{ventas_total:Number(resumen.ventas_fudo_total)||0,pagos_total:Number(resumen.pagos_fudo_total)||0,efectivo:Number(resumen.pagos_efectivo_esperado)||0},
      dilana:null,custodia_esperada_hoy:{caja_operativa:0,caja_fuerte:0,total:0},cuadra_fudo_dilana:null,diferencia_fudo_dilana:null};
  }
  const movimientos=cajaMovimientosVentanaTurno_(ultimo,cajaMovimientosDelDia_(fechaRef,sede));
  const recalculo=cajaEfectivoEsperado_(ultimo,movimientos,fechaRef,sede),guardado=Number(ultimo.efectivo_esperado)||0;
  const cambio=fudoConfirmado?Number((recalculo.esperado-guardado).toFixed(2)):null;
  const cust=cajaCustodiaEsperadaTrasCierre_(ultimo,fechaFmt,sede);
  const contadoTotal=(Number(ultimo.efectivo_contado)||0)+(Number(ultimo.caja_fuerte_contada)||0);
  const esperadoTotal=(Number(recalculo.esperado)||0)+(Number(recalculo.caja_fuerte_esperada)||0);
  const diferenciaCustodia=fudoConfirmado?Number((contadoTotal-esperadoTotal).toFixed(2)):null;
  let estado='CUADRA';
  if(!fudoConfirmado)estado='NO_CONFIRMADA_FUDO'; else if(Math.abs(cambio)>0.01)estado='FUDO_CAMBIO_DESDE_CIERRE'; else if(Math.abs(diferenciaCustodia)>0.01)estado='DIFERENCIA_CUSTODIA';
  return {disponible:true,tiene_cierre_dilana:true,fecha_referencia:fechaRef,fudo_confirmado:fudoConfirmado,estado_conciliacion:estado,
    fudo:{ventas_total:Number(resumen.ventas_fudo_total)||0,pagos_total:Number(resumen.pagos_fudo_total)||0,efectivo:Number(recalculo.pagos_efectivo_esperado)||0,
      efectivo_dia:Number(recalculo.pagos_efectivo_dia)||0,descuentos:Number(resumen.descuentos_total)||0,propinas:Number(resumen.propinas_total)||0},
    dilana:{esperado_cierre_guardado:guardado,esperado_cierre_con_fudo_actual:Number(recalculo.esperado)||0,contado_cierre:Number(ultimo.efectivo_contado)||0,
      diferencia_fisica_cierre:Number(ultimo.diferencia)||0,caja_fuerte_esperada_cierre:Number(ultimo.caja_fuerte_esperada)||0,caja_fuerte_contada_cierre:Number(ultimo.caja_fuerte_contada)||0,
      diferencia_caja_fuerte_cierre:Number(ultimo.diferencia_caja_fuerte)||0,base_siguiente:Number(ultimo.base_siguiente)||0,caja_fuerte_siguiente:Number(ultimo.caja_fuerte_siguiente)||0,
      usuario_cierre:ultimo.usuario_cierre||'',hora_cierre:ultimo.hora_cierre||ultimo.timestamp_cierre||''},
    movimientos_posteriores:{cantidad:cust.movimientos.length,entregado_personas:Number(cust.resumen.entregas_administrador)||0,enviado_caja_fuerte:Number(cust.resumen.envios_caja_fuerte)||0,
      retirado_caja_fuerte:Number(cust.resumen.retiros_caja_fuerte)||0,otros_ingresos:Number(cust.resumen.otros_ingresos)||0},
    custodia_esperada_hoy:{caja_operativa:cust.caja_operativa,caja_fuerte:cust.caja_fuerte,total:cust.total},
    fudo_cambio_desde_cierre:cambio,diferencia_fudo_dilana:cambio,diferencia_custodia_cierre:diferenciaCustodia,
    cuadra_fudo_dilana:fudoConfirmado?Math.abs(cambio)<0.01:null,cuadra_fisico_cierre_anterior:fudoConfirmado?Math.abs(diferenciaCustodia)<0.01:null};
};

cajaSincronizarAhora_ = function(fecha,sede,usuario) {
  if(!fecha||!sede)return {ok:false,error:'Falta la fecha o la sede'};
  const f=formatearFecha_(fecha),actual=cajaSincronizarFudo_(f,sede,usuario,true),turno=cajaTurnoFila_(f,sede);let anterior=null,conc=null;
  if(!turno){
    const ultimo=cajaUltimoCierreAntes_(f,sede),ref=ultimo?formatearFecha_(ultimo.fecha):cajaDiaAnteriorReactivacion_(f);
    if(ref&&ref!==f)anterior=cajaSincronizarFudo_(ref,sede,usuario,true);
    conc=cajaConciliacionApertura_(f,sede);
  }
  return {ok:!!actual.ok&&(!anterior||!!anterior.ok),fecha:f,sede:sede,sincronizacion_actual:actual,sincronizacion_anterior:anterior,conciliacion_apertura:conc,
    error:!actual.ok?(actual.error||'No se pudo sincronizar FUDO actual.'):(anterior&&!anterior.ok?(anterior.error||'No se pudo sincronizar FUDO anterior.'):'')};
};

fudoSincronizacionCajaAutomatica_ = function() {
  const p=PropertiesService.getScriptProperties();
  if(!p.getProperty('FUDO_API_KEY')||!p.getProperty('FUDO_API_SECRET'))return {ok:true,omitida:'sin_credenciales'};
  const hoy=new Date(),ayer=new Date(hoy.getTime());ayer.setDate(ayer.getDate()-1);const desde=formatearFecha_(ayer),hasta=formatearFecha_(hoy);
  const u={id:'sistema-fudo',nombre:'Sincronización automática FUDO',rol:'Administrador',sede:'Ambas'},res={ok:true,fecha_desde:desde,fecha_hasta:hasta,ventas:null,pagos:null,gastos:null},errores=[];
  function fallo(tipo,error) {
    const mensaje=error&&error.message?error.message:String(error||'Falló la sincronización automática.');
    res.ok=false;errores.push(tipo+': '+mensaje);
    if(typeof fudoApiSyncRegistrar_==='function')fudoApiSyncRegistrar_(tipo,{ok:false,error:mensaje,fecha_desde:desde,fecha_hasta:hasta,origen:'caja_automatica'});
    return mensaje;
  }
  try{res.ventas=fudoApiSincronizarVentas_(desde,hasta,u,{});if(!res.ventas||res.ventas.ok===false)res.error_ventas=fallo('Ventas',(res.ventas&&res.ventas.error)||'Falló la sincronización automática de ventas.');}catch(e){res.error_ventas=fallo('Ventas',e);}
  try{res.pagos=fudoApiSincronizarPagos_(desde,hasta,u,{});if(!res.pagos||res.pagos.ok===false)res.error_pagos=fallo('Pagos',(res.pagos&&res.pagos.error)||'Falló la sincronización automática de pagos.');}catch(e){res.error_pagos=fallo('Pagos',e);}
  try{res.gastos=fudoApiSincronizarGastosArqueo_(desde,hasta,u);if(!res.gastos||res.gastos.ok===false)res.error_gastos=fallo('Gastos',(res.gastos&&res.gastos.error)||'Falló la sincronización automática de gastos de arqueo.');}catch(e){res.error_gastos=fallo('Gastos',e);}
  res.error=errores.join(' | ');res.sincronizado_en=new Date();
  [desde,hasta].forEach(function(fecha){CAJA_SEDES_VALIDAS_.forEach(function(sede){cajaGuardarEstadoFudoPersistente_(fecha,sede,res);});});
  return res;
};
