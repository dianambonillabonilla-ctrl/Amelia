/**
 * REACTIVACIÓN FINAL — Usuarios + FUDO financiero + Caja.
 *
 * ÚNICA capa de compatibilidad sobre CajaTurno.gs mientras MODO_REACTIVACION_BACKEND=true.
 * Reúne aquí todas las reglas de Caja reactivada para no depender de varios archivos ZZ que
 * redefinan las mismas funciones entre sí.
 */
const ACCIONES_FUDO_PERMITIDAS_REACTIVACION_ = [
  'fudo_panel_estado','fudo_api_probar_conexion','fudo_api_sincronizar_ventas','fudo_api_sincronizar_pagos'
];
const ACCIONES_CAJA_PERMITIDAS_REACTIVACION_ = [
  'caja_estado','caja_abrir','caja_movimiento_registrar','caja_movimientos_listar','caja_cerrar','caja_sincronizar_ahora'
];

function accionPermitidaEnReactivacion_(action) {
  return !reactivacionBackendActiva_() ||
    ACCIONES_PERMITIDAS_REACTIVACION_BACKEND.indexOf(action) !== -1 ||
    ACCIONES_FUDO_PERMITIDAS_REACTIVACION_.indexOf(action) !== -1 ||
    ACCIONES_CAJA_PERMITIDAS_REACTIVACION_.indexOf(action) !== -1;
}

function requiereRol_(usuario, rolesPermitidos) {
  // En reactivación solo se conserva el alias necesario Caja -> Encargado. Gerencia/Lectura no
  // obtiene acceso indirecto a movimientos de Caja aunque el router histórico todavía enumere Lectura.
  const rolEfectivo = usuario.rol === 'Caja' ? 'Encargado' : usuario.rol;
  const esRutaCajaLecturaHistorica = reactivacionBackendActiva_() &&
    rolesPermitidos.indexOf('Administrador') !== -1 && rolesPermitidos.indexOf('Encargado') !== -1 &&
    rolesPermitidos.indexOf('Lectura') !== -1;
  if (esRutaCajaLecturaHistorica && (usuario.rol === 'Lectura' || usuario.rol === 'Gerencia')) {
    throw new Error('El perfil Gerencia/Lectura no tiene acceso al módulo Caja durante la reactivación.');
  }
  if (rolesPermitidos.indexOf(usuario.rol) === -1 && rolesPermitidos.indexOf(rolEfectivo) === -1) {
    throw new Error('Esta acción requiere uno de estos roles: ' + rolesPermitidos.join(', '));
  }
}

function cajaPuedeCerrar_(usuario) {
  return usuario.rol === 'Administrador' || usuario.rol === 'Caja' || usuario.rol === 'Encargado';
}

function cajaDiaAnteriorReactivacion_(fechaStr) {
  const p = String(fechaStr).slice(0,10).split('-').map(Number);
  const d = new Date(p[0],p[1]-1,p[2]);
  d.setDate(d.getDate()-1);
  return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
}

function cajaExisteTurnoPosteriorA_(fecha, sede) {
  return leerTabla_(SHEET_NAMES.CAJA_TURNO).some(function (r) {
    return r.sede === sede && formatearFecha_(r.fecha) > fecha;
  });
}

function cajaMovimientosVentanaTurno_(turno, movimientos) {
  if (!turno) return movimientos || [];
  const desde = cajaFechaMs_(turno.hora_apertura);
  const hasta = turno.estado === 'Cerrado' ? cajaFechaMs_(turno.timestamp_cierre || turno.hora_cierre) : 0;
  return (movimientos || []).filter(function (m) {
    const ts = cajaFechaMs_(m.timestamp || m.hora);
    if (!ts) return true;
    if (desde && ts < desde) return false;
    if (hasta && ts > hasta) return false;
    return true;
  });
}

function cajaMovimientoEsGastoFudo_(m) {
  const v = m && m.es_gasto_fudo;
  return v === true || String(v).toLowerCase() === 'true' || String(v).toLowerCase() === 'si';
}

function cajaMovimientosResumen_(movimientos) {
  const r = {
    envios_caja_fuerte:0,retiros_caja_fuerte:0,entregas_admin_caja:0,entregas_admin_caja_fuerte:0,
    entregas_gasto_fudo:0,gastos:0,otros_ingresos:0
  };
  (movimientos || []).forEach(function (m) {
    const valor = Number(m.valor) || 0;
    const tipo = cajaTipoReal_(m);
    if (tipo === 'Envío a caja fuerte') r.envios_caja_fuerte += valor;
    else if (tipo === 'Retiro de caja fuerte') r.retiros_caja_fuerte += valor;
    else if (tipo === 'Entrega administrador desde caja') {
      r.entregas_admin_caja += valor;
      if (cajaMovimientoEsGastoFudo_(m)) r.entregas_gasto_fudo += valor;
    }
    else if (tipo === 'Entrega administrador desde caja fuerte') r.entregas_admin_caja_fuerte += valor;
    else if (tipo === 'Gasto') r.gastos += valor;
    else if (tipo === 'Otro ingreso') r.otros_ingresos += valor;
  });
  r.entregas_administrador = r.entregas_admin_caja + r.entregas_admin_caja_fuerte;
  Object.keys(r).forEach(function (k) { r[k] = Number(r[k].toFixed(2)); });
  return r;
}

/**
 * Una entrega marcada "corresponde a gasto FUDO" siempre descuenta físicamente desde el momento
 * de la entrega. Cuando FUDO sincroniza ese mismo gasto, se compensa hasta ese monto para impedir
 * que el mismo efectivo salga dos veces del esperado.
 */
function cajaEfectivoEsperado_(apertura, movimientos, fecha, sede) {
  const movimientosTurno = cajaMovimientosVentanaTurno_(apertura, movimientos);
  const r = cajaMovimientosResumen_(movimientosTurno);
  const efectivoFudoActual = cajaEfectivoFudoDia_(fecha, sede);
  const efectivoFudoTurno = Math.max(0, efectivoFudoActual - (Number(apertura.efectivo_fudo_al_abrir) || 0));
  const gastosFudo = typeof fudoGastosArqueoTotalTurno_ === 'function'
    ? fudoGastosArqueoTotalTurno_(fecha,sede,apertura) : { total:0,cantidad:0 };
  const gastoFudoBruto = Number(gastosFudo.total) || 0;
  const compensadoPorEntrega = Math.min(gastoFudoBruto, Number(r.entregas_gasto_fudo) || 0);
  const gastoFudoNeto = Math.max(0, gastoFudoBruto - compensadoPorEntrega);

  const esperado = Number(apertura.base_inicial || 0) + efectivoFudoTurno - gastoFudoNeto +
    r.otros_ingresos + r.retiros_caja_fuerte - r.envios_caja_fuerte - r.entregas_admin_caja - r.gastos;
  const fuerte = Number(apertura.caja_fuerte_inicial || 0) + r.envios_caja_fuerte -
    r.retiros_caja_fuerte - r.entregas_admin_caja_fuerte;

  r.gastos_fudo_arqueo = gastoFudoBruto;
  r.gastos_fudo_compensados_por_entrega = Number(compensadoPorEntrega.toFixed(2));
  r.gastos_fudo_neto = Number(gastoFudoNeto.toFixed(2));
  r.gastos_fudo_arqueo_cantidad = Number(gastosFudo.cantidad) || 0;
  return {
    esperado:Number(esperado.toFixed(2)), caja_fuerte_esperada:Number(fuerte.toFixed(2)),
    pagos_efectivo_esperado:Number(efectivoFudoTurno.toFixed(2)), pagos_efectivo_dia:Number(efectivoFudoActual.toFixed(2)),
    gastos_fudo_arqueo:gastoFudoBruto, gastos_fudo_compensados_por_entrega:Number(compensadoPorEntrega.toFixed(2)),
    gastos_fudo_neto:Number(gastoFudoNeto.toFixed(2)), efectivo_fudo_neto:Number((efectivoFudoTurno-gastoFudoNeto).toFixed(2)),
    resumen:r
  };
}

function cajaMovimientosPosterioresAlCierre_(ultimoCierre, fechaActual, sede) {
  if (!ultimoCierre) return [];
  const fechaCierre = formatearFecha_(ultimoCierre.fecha);
  const limiteFecha = formatearFecha_(fechaActual);
  const tsCierre = cajaFechaMs_(ultimoCierre.timestamp_cierre || ultimoCierre.hora_cierre);
  return leerTabla_(SHEET_NAMES.CAJA_MOVIMIENTOS).filter(function (m) {
    if (m.sede !== sede) return false;
    const fm = formatearFecha_(m.fecha);
    if (!fm || fm > limiteFecha || fm < fechaCierre) return false;
    if (fm > fechaCierre) return true;
    return cajaFechaMs_(m.timestamp || m.hora) > tsCierre;
  });
}

function cajaCustodiaEsperadaTrasCierre_(ultimoCierre, fechaActual, sede) {
  if (!ultimoCierre) return { caja_operativa:0,caja_fuerte:0,total:0,movimientos:[],resumen:cajaMovimientosResumen_([]) };
  const movimientos = cajaMovimientosPosterioresAlCierre_(ultimoCierre,fechaActual,sede);
  const r = cajaMovimientosResumen_(movimientos);
  const base = Number(ultimoCierre.base_siguiente) || 0;
  const fuerte = Number(ultimoCierre.caja_fuerte_siguiente) || 0;
  const operativa = base + r.otros_ingresos + r.retiros_caja_fuerte - r.envios_caja_fuerte - r.entregas_admin_caja - r.gastos;
  const cajaFuerte = fuerte + r.envios_caja_fuerte - r.retiros_caja_fuerte - r.entregas_admin_caja_fuerte;
  return { caja_operativa:Number(operativa.toFixed(2)), caja_fuerte:Number(cajaFuerte.toFixed(2)),
    total:Number((operativa+cajaFuerte).toFixed(2)), movimientos:movimientos, resumen:r };
}

function cajaCierreReferenciaCustodia_(fecha,sede) {
  const turnoDia = cajaTurnoFila_(fecha,sede);
  if (turnoDia && turnoDia.estado === 'Cerrado') return turnoDia;
  if (!turnoDia) return cajaUltimoCierreAntes_(fecha,sede);
  return null;
}

function cajaBaseEsperada_(fecha,sede) {
  const ultimo = cajaUltimoCierreAntes_(fecha,sede);
  return ultimo ? cajaCustodiaEsperadaTrasCierre_(ultimo,fecha,sede).caja_operativa : 0;
}

function cajaSaldoFuerteAntes_(fecha,sede) {
  const ultimo = cajaUltimoCierreAntes_(fecha,sede);
  if (ultimo) return cajaCustodiaEsperadaTrasCierre_(ultimo,fecha,sede).caja_fuerte;
  const limite = new Date(fecha+'T00:00:00').getTime();
  const movimientos = leerTabla_(SHEET_NAMES.CAJA_MOVIMIENTOS).filter(function (m) {
    return m.sede===sede && new Date(formatearFecha_(m.fecha)+'T00:00:00').getTime()<limite;
  });
  const r = cajaMovimientosResumen_(movimientos);
  return Number((r.envios_caja_fuerte-r.retiros_caja_fuerte-r.entregas_admin_caja_fuerte).toFixed(2));
}

function cajaAsegurarColumnasCustodia_() {
  asegurarColumnas_(sheet_(SHEET_NAMES.CAJA_MOVIMIENTOS), [
    'turno_id','estado_turno_al_registrar','fuera_de_turno','saldo_validado','saldo_origen_antes','es_gasto_fudo','gasto_fudo_ref'
  ]);
}

function cajaAbrir_(item,usuario) {
  cajaAsegurarEstructura_(); cajaAsegurarColumnasCustodia_();
  if (!item || !item.fecha || !item.sede) return {ok:false,error:'Falta la fecha o la sede'};
  if (CAJA_SEDES_VALIDAS_.indexOf(item.sede)===-1) return {ok:false,error:'Caja solo existe en San Antonio y Capri.'};
  if (!sedeEscrituraPermitida_(usuario,item.sede)) return {ok:false,error:'No puedes abrir la caja de otra sede'};
  const fecha=formatearFecha_(item.fecha);
  if (fecha>formatearFecha_(new Date())) return {ok:false,error:'No puedes abrir la caja de una fecha futura.'};
  if (cajaExisteTurnoPosteriorA_(fecha,item.sede)) return {ok:false,error:'No puedes abrir una caja retroactiva porque ya existe un turno posterior de esta sede. Usa la corrección administrativa si necesitas ajustar historia.'};
  const existente=cajaTurnoFila_(fecha,item.sede);
  if (existente) return existente.estado==='Cerrado'?{ok:false,error:'La caja ya se cerró'}:{ok:true,ya_abierta:true,item:existente};
  const baseValida=cajaValorContadoValido_(item.base_inicial); if(!baseValida.ok)return {ok:false,error:'Efectivo contado al abrir: '+baseValida.error};
  const fuerteValida=cajaValorContadoValido_(item.caja_fuerte_inicial); if(!fuerteValida.ok)return {ok:false,error:'Caja fuerte contada al abrir: '+fuerteValida.error};
  const syncFudo=cajaSincronizarFudo_(fecha,item.sede,usuario,false);
  const baseEsperada=cajaBaseEsperada_(fecha,item.sede), fuerteEsperada=cajaSaldoFuerteAntes_(fecha,item.sede);
  const baseInicial=baseValida.valor, fuerteInicial=fuerteValida.valor;
  const difApertura=Number((baseInicial-baseEsperada).toFixed(2)), difFuerte=Number((fuerteInicial-fuerteEsperada).toFixed(2));
  if ((difApertura!==0 || difFuerte!==0) && !String(item.observacion_apertura||'').trim()) {
    return {ok:false,error:'Hay una diferencia al abrir la caja. Escribe una observación explicando qué pasó.',diferencia_apertura:difApertura,diferencia_caja_fuerte_apertura:difFuerte};
  }
  const fila={id:Utilities.getUuid(),fecha:fecha,sede:item.sede,estado:'Abierto',base_esperada:baseEsperada,base_inicial:baseInicial,
    diferencia_apertura:difApertura,observacion_apertura:item.observacion_apertura||'',caja_fuerte_esperada_apertura:fuerteEsperada,
    caja_fuerte_inicial:fuerteInicial,diferencia_caja_fuerte_apertura:difFuerte,hora_apertura:new Date(),usuario_apertura_id:usuario.id,
    usuario_apertura:usuario.nombre,efectivo_fudo_al_abrir:cajaEfectivoFudoDia_(fecha,item.sede),rappi_encendido:false};
  const lock=LockService.getScriptLock(); if(!lock.tryLock(10000))return {ok:false,error:'Otra apertura de caja está en curso ahora mismo.'};
  try {
    const ahora=cajaTurnoFila_(fecha,item.sede); if(ahora)return ahora.estado==='Cerrado'?{ok:false,error:'La caja ya se cerró'}:{ok:true,ya_abierta:true,item:ahora};
    if (cajaExisteTurnoPosteriorA_(fecha,item.sede)) return {ok:false,error:'Ya existe un turno posterior de esta sede.'};
    appendRowFromObj_(SHEET_NAMES.CAJA_TURNO,fila);
    auditoriaRegistrar_(usuario,'caja_abrir','CajaTurno',fecha+'|'+item.sede,null,fila,item.sede,item.observacion_apertura||'');
  } finally { lock.releaseLock(); }
  return {ok:true,item:fila,fudo_sync:syncFudo};
}

function cajaMovimientoRegistrar_(item,usuario) {
  cajaAsegurarEstructura_(); cajaAsegurarColumnasCustodia_();
  if(!item||!item.fecha||!item.sede)return {ok:false,error:'Falta fecha o sede'};
  if(!sedeEscrituraPermitida_(usuario,item.sede))return {ok:false,error:'No puedes registrar movimientos de otra sede'};
  const fecha=formatearFecha_(item.fecha);
  if(cajaExisteTurnoPosteriorA_(fecha,item.sede))return {ok:false,error:'No puedes insertar movimientos retroactivos porque ya existe un turno posterior de esta sede.'};
  if(CAJA_TIPOS_MOVIMIENTO_.indexOf(item.tipo)===-1)return {ok:false,error:'Tipo de movimiento inválido'};
  const valor=Number(item.valor); if(!valor||valor<=0)return {ok:false,error:'El valor debe ser mayor a cero'};
  if(!String(item.motivo||'').trim())return {ok:false,error:'Falta el motivo'};
  const esEntrega=String(item.tipo).indexOf('Entrega administrador')===0;
  if(esEntrega&&(!String(item.persona_entrega||'').trim()||!String(item.persona_recibe||'').trim()))return {ok:false,error:'La entrega necesita quién entrega y quién recibe'};
  const esGastoFudo=item.es_gasto_fudo===true||String(item.es_gasto_fudo).toLowerCase()==='true';
  if(esGastoFudo&&item.tipo!=='Entrega administrador desde caja')return {ok:false,error:'Solo una entrega desde caja operativa puede marcarse como gasto FUDO.'};
  const lock=LockService.getScriptLock(); if(!lock.tryLock(10000))return {ok:false,error:'Otro movimiento se está guardando ahora mismo.'};
  try {
    if(cajaExisteTurnoPosteriorA_(fecha,item.sede))return {ok:false,error:'Ya existe un turno posterior de esta sede.'};
    const turnoDia=cajaTurnoFila_(fecha,item.sede), abierta=!!turnoDia&&turnoDia.estado==='Abierto';
    if(!esEntrega&&!abierta)return {ok:false,error:'La caja no está abierta'};
    const movimientos=cajaMovimientosDelDia_(fecha,item.sede);
    if(item.idempotency_key){const rep=movimientos.find(function(m){return m.idempotency_key===item.idempotency_key;});if(rep)return {ok:true,item:rep,fuera_de_turno:rep.fuera_de_turno===true};}
    let saldoValidado=true,saldoOrigenAntes=null,turnoReferencia=turnoDia;
    if(abierta){
      const calc=cajaEfectivoEsperado_(turnoDia,movimientos,fecha,item.sede);
      if(CAJA_TIPOS_RESTAN_OPERATIVA_.indexOf(item.tipo)!==-1){saldoOrigenAntes=calc.esperado;if(valor>saldoOrigenAntes)return {ok:false,error:'No puedes registrar este movimiento: excede el efectivo disponible en caja operativa.'};}
      if(CAJA_TIPOS_RESTAN_FUERTE_.indexOf(item.tipo)!==-1){saldoOrigenAntes=calc.caja_fuerte_esperada;if(valor>saldoOrigenAntes)return {ok:false,error:'No puedes registrar este movimiento: excede lo disponible en caja fuerte.'};}
    } else if(esEntrega){
      turnoReferencia=cajaCierreReferenciaCustodia_(fecha,item.sede);
      if(turnoReferencia){const cust=cajaCustodiaEsperadaTrasCierre_(turnoReferencia,fecha,item.sede);saldoOrigenAntes=item.tipo==='Entrega administrador desde caja fuerte'?cust.caja_fuerte:cust.caja_operativa;if(valor>saldoOrigenAntes)return {ok:false,error:'No puedes registrar la entrega: excede el dinero bajo custodia en el origen.'};}
      else saldoValidado=false;
    }
    const estadoTurno=abierta?'Abierto':(turnoDia&&turnoDia.estado==='Cerrado'?'Cerrado':'Sin abrir');
    const fila={id:Utilities.getUuid(),fecha:fecha,sede:item.sede,tipo:item.tipo,valor:valor,persona_entrega:item.persona_entrega||usuario.nombre,
      persona_recibe:item.persona_recibe||'',hora:new Date(),motivo:item.motivo,evidencia_url:item.evidencia_url||'',idempotency_key:item.idempotency_key||'',
      usuario_id:usuario.id,usuario:usuario.nombre,timestamp:new Date(),turno_id:turnoReferencia&&turnoReferencia.id?turnoReferencia.id:'',
      estado_turno_al_registrar:estadoTurno,fuera_de_turno:!abierta,saldo_validado:saldoValidado,saldo_origen_antes:saldoOrigenAntes===null?'':saldoOrigenAntes,
      es_gasto_fudo:esGastoFudo,gasto_fudo_ref:item.gasto_fudo_ref||''};
    appendRowFromObj_(SHEET_NAMES.CAJA_MOVIMIENTOS,fila);
    auditoriaRegistrar_(usuario,'caja_movimiento_registrar','CajaMovimientos',fila.id,null,{tipo:fila.tipo,valor:fila.valor,fuera_de_turno:!abierta,es_gasto_fudo:esGastoFudo},item.sede,item.motivo);
    return {ok:true,item:fila,fuera_de_turno:!abierta,saldo_validado:saldoValidado,saldo_origen_antes:saldoOrigenAntes};
  } finally { lock.releaseLock(); }
}

function cajaCerrar_(item,usuario) {
  cajaAsegurarEstructura_(); cajaAsegurarColumnasCustodia_();
  if(!item||!item.fecha||!item.sede)return {ok:false,error:'Falta fecha o sede'};
  if(!sedeEscrituraPermitida_(usuario,item.sede))return {ok:false,error:'No puedes cerrar la caja de otra sede'};
  const fecha=formatearFecha_(item.fecha), apertura=cajaTurnoFila_(fecha,item.sede);
  if(!apertura)return {ok:false,error:'La caja no está abierta'}; if(apertura.estado==='Cerrado')return {ok:true,ya_cerrado:true};
  if(!cajaPuedeCerrar_(usuario,fecha))return {ok:false,error:'No tienes permiso para cerrar la caja.'};
  const syncFudo=cajaSincronizarFudo_(fecha,item.sede,usuario,true), fudoConfiable=syncFudo.ok;
  const contadoV=cajaValorContadoValido_(item.efectivo_contado); if(!contadoV.ok)return {ok:false,error:'Efectivo contado: '+contadoV.error};
  const fuerteV=cajaValorContadoValido_(item.caja_fuerte_contada); if(!fuerteV.ok)return {ok:false,error:'Caja fuerte contada: '+fuerteV.error};
  const contado=contadoV.valor,fuerteContada=fuerteV.valor;
  const baseSiguiente=item.base_siguiente!==''&&item.base_siguiente!=null?Number(item.base_siguiente):contado;
  if(!isFinite(baseSiguiente)||baseSiguiente<0)return {ok:false,error:'La base para el siguiente turno es inválida.'};
  // No existe salida implícita al cerrar. Todo lo que sale debe registrarse antes como entrega.
  if(Math.abs(baseSiguiente-contado)>0.01)return {ok:false,error:'La base siguiente debe ser exactamente el efectivo contado que queda en caja. Si vas a retirar dinero, registra primero la entrega a la persona (o muévelo a caja fuerte) y después vuelve a contar/cerrar.'};
  const lock=LockService.getScriptLock(); if(!lock.tryLock(10000))return {ok:false,error:'Otro cierre de caja está en curso ahora mismo.'};
  try {
    const aperturaAhora=cajaTurnoFila_(fecha,item.sede); if(!aperturaAhora)return {ok:false,error:'La caja no está abierta'}; if(aperturaAhora.estado==='Cerrado')return {ok:true,ya_cerrado:true};
    const calc=cajaEfectivoEsperado_(aperturaAhora,cajaMovimientosDelDia_(fecha,item.sede),fecha,item.sede);
    const dif=Number((contado-calc.esperado).toFixed(2)),difF=Number((fuerteContada-calc.caja_fuerte_esperada).toFixed(2));
    if((dif!==0||difF!==0)&&!String(item.observacion||'').trim())return {ok:false,error:'Hay una diferencia. Debes escribir una observación.'};
    cajaTurnoActualizarFila_(fecha,item.sede,{estado:'Cerrado',efectivo_contado:contado,efectivo_esperado:calc.esperado,diferencia:dif,
      caja_fuerte_contada:fuerteContada,caja_fuerte_esperada:calc.caja_fuerte_esperada,diferencia_caja_fuerte:difF,entrega_cierre:0,
      persona_recibe_cierre:'',persona_verifica_cierre:'',base_siguiente:contado,caja_fuerte_siguiente:fuerteContada,usuario_cierre:usuario.nombre,
      hora_cierre:new Date(),observacion_cierre:item.observacion||'',timestamp_cierre:new Date(),fudo_confiable_cierre:fudoConfiable});
    auditoriaRegistrar_(usuario,'caja_cerrar','CajaTurno',fecha+'|'+item.sede,null,{efectivo_esperado:calc.esperado,efectivo_contado:contado,diferencia:dif,
      caja_fuerte_esperada:calc.caja_fuerte_esperada,caja_fuerte_contada:fuerteContada,diferencia_caja_fuerte:difF,gastos_fudo_neto:calc.gastos_fudo_neto},item.sede,item.observacion||'');
    const sinId=cajaEfectivoSinIdentificarDia_(fecha);
    return {ok:true,efectivo_esperado:calc.esperado,efectivo_contado:contado,diferencia:dif,caja_fuerte_esperada:calc.caja_fuerte_esperada,
      caja_fuerte_contada:fuerteContada,diferencia_caja_fuerte:difF,base_siguiente:contado,fudo_sync:syncFudo,cuadre_confiable:fudoConfiable,
      efectivo_sin_identificar:sinId,nivel_confianza:cajaNivelConfianza_(fudoConfiable,sinId,dif!==0||difF!==0)};
  } finally { lock.releaseLock(); }
}

function cajaConciliacionApertura_(fecha,sede) {
  const fechaFmt=formatearFecha_(fecha), ultimo=cajaUltimoCierreAntes_(fechaFmt,sede);
  const fechaRef=ultimo?formatearFecha_(ultimo.fecha):cajaDiaAnteriorReactivacion_(fechaFmt);
  const syncRef=cajaLeerEstadoFudo_(fechaRef,sede);
  const fudoConfirmado=!!(syncRef&&syncRef.ok&&syncRef.aplica!==false);
  const resumen=typeof turnoResumenCierre_==='function'?turnoResumenCierre_(fechaRef,sede):{pagos_efectivo_esperado:0,pagos_fudo_total:0,ventas_fudo_total:0};
  if(!ultimo){
    const op=cajaBaseEsperada_(fechaFmt,sede),fu=cajaSaldoFuerteAntes_(fechaFmt,sede);
    return {disponible:true,tiene_cierre_dilana:false,fecha_referencia:fechaRef,fudo_confirmado:fudoConfirmado,
      estado_conciliacion:fudoConfirmado?'SIN_CIERRE_DILANA':'NO_CONFIRMADA_FUDO',
      mensaje:fudoConfirmado?'No existe un cierre DILANA anterior para comparar.':'No se pudo confirmar FUDO para la fecha de referencia; no se declara conciliación.',
      fudo:{ventas_total:Number(resumen.ventas_fudo_total)||0,pagos_total:Number(resumen.pagos_fudo_total)||0,efectivo:Number(resumen.pagos_efectivo_esperado)||0},
      dilana:null,custodia_esperada_hoy:{caja_operativa:op,caja_fuerte:fu,total:Number((op+fu).toFixed(2))},cuadra_fudo_dilana:null,diferencia_fudo_dilana:null};
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
}

function cajaFudoCambioTrasCierre_(turno) {
  if(turno.estado!=='Cerrado')return null;
  const fecha=formatearFecha_(turno.fecha),limite=new Date();limite.setDate(limite.getDate()-CAJA_FUDO_POST_CIERRE_DIAS_);
  if(fecha<formatearFecha_(limite))return null;
  const recalculo=cajaEfectivoEsperado_(turno,cajaMovimientosVentanaTurno_(turno,cajaMovimientosDelDia_(fecha,turno.sede)),fecha,turno.sede);
  const guardado=Number(turno.efectivo_esperado)||0,dif=Number((recalculo.esperado-guardado).toFixed(2));
  return dif===0?null:{esperado_guardado:guardado,esperado_actual:recalculo.esperado,diferencia:dif};
}

function cajaSincronizarFudo_(fecha,sede,usuario,forzar) {
  const f=formatearFecha_(fecha);
  if(!cajaFudoCredencialesConfiguradas_())return {ok:true,aplica:false,fecha:f,sede:sede,sincronizado_en:'',ventas:null,pagos:null,gastos:null,error:''};
  const cache=CacheService.getScriptCache(),key=cajaFudoCacheKey_(f,sede);if(!forzar)return cajaLeerEstadoFudo_(f,sede);
  const res={ok:false,aplica:true,fecha:f,sede:sede,sincronizado_en:new Date(),ventas:null,pagos:null,gastos:null,error:''},errores=[];
  try{res.ventas=fudoApiSincronizarVentas_(f,f,usuario,{sede:'Automática'});if(!res.ventas||res.ventas.ok===false)errores.push('Ventas: '+((res.ventas&&res.ventas.error)||'falló'));}catch(e){errores.push('Ventas: '+(e.message||e));}
  try{res.pagos=fudoApiSincronizarPagos_(f,f,usuario,{sede:'Automática'});if(!res.pagos||res.pagos.ok===false)errores.push('Pagos: '+((res.pagos&&res.pagos.error)||'falló'));}catch(e){errores.push('Pagos: '+(e.message||e));}
  try{res.gastos=fudoApiSincronizarGastosArqueo_(f,f,usuario);if(!res.gastos||res.gastos.ok===false)errores.push('Gastos: '+((res.gastos&&res.gastos.error)||'falló'));}catch(e){errores.push('Gastos: '+(e.message||e));}
  res.ok=errores.length===0;res.error=errores.join(' | ');res.sincronizado_en=new Date();cache.put(key,JSON.stringify(res),CAJA_FUDO_CACHE_SEGUNDOS_);return res;
}

function cajaSincronizarAhora_(fecha,sede,usuario) {
  if(!fecha||!sede)return {ok:false,error:'Falta la fecha o la sede'};
  const f=formatearFecha_(fecha),actual=cajaSincronizarFudo_(f,sede,usuario,true),turno=cajaTurnoFila_(f,sede);let anterior=null,conc=null;
  if(!turno){const ultimo=cajaUltimoCierreAntes_(f,sede),ref=ultimo?formatearFecha_(ultimo.fecha):cajaDiaAnteriorReactivacion_(f);if(ref&&ref!==f)anterior=cajaSincronizarFudo_(ref,sede,usuario,true);conc=cajaConciliacionApertura_(f,sede);}
  return {ok:!!actual.ok&&(!anterior||!!anterior.ok),fecha:f,sede:sede,sincronizacion_actual:actual,sincronizacion_anterior:anterior,conciliacion_apertura:conc,
    error:!actual.ok?(actual.error||'No se pudo sincronizar FUDO actual.'):(anterior&&!anterior.ok?(anterior.error||'No se pudo sincronizar FUDO anterior.'):'')};
}

function fudoSincronizacionCajaAutomatica_() {
  const p=PropertiesService.getScriptProperties();if(!p.getProperty('FUDO_API_KEY')||!p.getProperty('FUDO_API_SECRET'))return {ok:true,omitida:'sin_credenciales'};
  const hoy=new Date(),ayer=new Date(hoy.getTime());ayer.setDate(ayer.getDate()-1);const desde=formatearFecha_(ayer),hasta=formatearFecha_(hoy);
  const u={id:'sistema-fudo',nombre:'Sincronización automática FUDO',rol:'Administrador',sede:'Ambas'},res={ok:true,fecha_desde:desde,fecha_hasta:hasta,ventas:null,pagos:null,gastos:null};
  try{res.ventas=fudoApiSincronizarVentas_(desde,hasta,u,{});}catch(e){res.ok=false;res.error_ventas=e.message||String(e);}try{res.pagos=fudoApiSincronizarPagos_(desde,hasta,u,{});}catch(e){res.ok=false;res.error_pagos=e.message||String(e);}try{res.gastos=fudoApiSincronizarGastosArqueo_(desde,hasta,u);}catch(e){res.ok=false;res.error_gastos=e.message||String(e);}
  if(res.ventas&&res.ventas.ok===false)res.ok=false;if(res.pagos&&res.pagos.ok===false)res.ok=false;if(res.gastos&&res.gastos.ok===false)res.ok=false;return res;
}

function configurarTriggers() {
  let eliminados=0;ScriptApp.getProjectTriggers().forEach(function(t){const fn=t.getHandlerFunction();if(fn==='tareaDiaria_'||fn==='fudoSincronizacionAutomatica_'||fn==='fudoSincronizacionCajaAutomatica_'){ScriptApp.deleteTrigger(t);eliminados++;}});
  if(reactivacionBackendActiva_()){ScriptApp.newTrigger('fudoSincronizacionCajaAutomatica_').timeBased().everyMinutes(15).create();return {reactivacion:true,creados:1,eliminados:eliminados,handler:'fudoSincronizacionCajaAutomatica_'};}
  ScriptApp.newTrigger('tareaDiaria_').timeBased().everyDays(1).atHour(6).create();ScriptApp.newTrigger('fudoSincronizacionAutomatica_').timeBased().everyMinutes(15).create();return {reactivacion:false,creados:2,eliminados:eliminados};
}
