/** CAJA UNIFICADA — caja operativa, caja fuerte, movimientos y validación FUDO. */

const CAJA_TIPOS_MOVIMIENTO_ = [
  'Envío a caja fuerte','Retiro de caja fuerte',
  'Entrega administrador desde caja','Entrega administrador desde caja fuerte',
  'Entrega administrador','Gasto','Otro ingreso'
];
const CAJA_FUDO_CACHE_SEGUNDOS_ = 300;

const CAJA_COLUMNAS_TURNO_ = [
  'id','fecha','sede','estado','base_esperada','base_inicial','diferencia_apertura','observacion_apertura',
  'caja_fuerte_esperada_apertura','caja_fuerte_inicial','diferencia_caja_fuerte_apertura',
  'hora_apertura','usuario_apertura_id','usuario_apertura','efectivo_fudo_al_abrir',
  'rappi_encendido','rappi_confirmado_por','rappi_confirmado_en',
  'efectivo_contado','efectivo_esperado','diferencia',
  'caja_fuerte_contada','caja_fuerte_esperada','diferencia_caja_fuerte','caja_fuerte_siguiente',
  'entrega_cierre','persona_recibe_cierre','base_siguiente','usuario_cierre','hora_cierre',
  'observacion_cierre','timestamp_cierre'
];
const CAJA_COLUMNAS_MOVIMIENTOS_ = [
  'id','fecha','sede','tipo','valor','persona_entrega','persona_recibe','hora','motivo',
  'evidencia_url','usuario_id','usuario','timestamp'
];

function cajaAsegurarEstructura_() {
  asegurarColumnas_(sheet_(SHEET_NAMES.CAJA_TURNO), CAJA_COLUMNAS_TURNO_);
  asegurarColumnas_(sheet_(SHEET_NAMES.CAJA_MOVIMIENTOS), CAJA_COLUMNAS_MOVIMIENTOS_);
  cajaMigrarHistorico_();
}

/**
 * Correcciones puntuales de historia real (venían de CajaV2.gs, antes de consolidar todo aquí):
 * el millón que se guardó en la caja fuerte de San Antonio el 2026-08-02, la entrega de $550.000
 * hecha en Capri el mismo rango de fechas, y la devolución de ese millón (ya lo tiene la
 * administradora, la caja fuerte física de San Antonio está en cero) — fechada el mismo día que la
 * de Capri porque cajaSaldoFuerteAntes_ solo cuenta movimientos ANTERIORES a la fecha consultada:
 * si se fecha el mismo día que "hoy", ese día todavía muestra la diferencia vieja.
 */
function cajaMigrarHistorico_() {
  const filas = leerTabla_(SHEET_NAMES.CAJA_MOVIMIENTOS);
  const ids = {};
  filas.forEach(function (r) { ids[String(r.id || '')] = true; });
  const migraciones = [
    { id: 'migracion-caja-fuerte-sa-20260802', fecha: '2026-08-02', sede: 'San Antonio', tipo: 'Envío a caja fuerte', valor: 1000000, persona_entrega: 'Giselle', persona_recibe: 'Caja fuerte', motivo: 'Migrado desde observación histórica: guardé un millón en caja fuerte' },
    { id: 'migracion-entrega-admin-capri-20260803', fecha: '2026-08-03', sede: 'Capri', tipo: 'Entrega administrador desde caja', valor: 550000, persona_entrega: 'Giselle', persona_recibe: 'Diana', motivo: 'Migrado desde observación histórica: entregué 550 en efectivo a Diana' },
    { id: 'migracion-retiro-fuerte-sa-20260803', fecha: '2026-08-03', sede: 'San Antonio', tipo: 'Entrega administrador desde caja fuerte', valor: 1000000, persona_entrega: 'Caja fuerte', persona_recibe: 'Diana', motivo: 'Migrado desde observación histórica: el millón que estaba en la caja fuerte de San Antonio ya lo tiene Diana, la caja fuerte física está en cero' }
  ];
  migraciones.forEach(function (m) {
    if (ids[m.id]) return;
    m.hora = new Date(m.fecha + 'T20:00:00');
    m.usuario = 'Migración histórica';
    m.timestamp = new Date();
    appendRowFromObj_(SHEET_NAMES.CAJA_MOVIMIENTOS, m);
  });
}

function cajaPuedeCerrar_(usuario, fecha) {
  if (usuario.rol === 'Administrador' || usuario.rol === 'Encargado') return true;
  return turnoSectorDeHoy_(usuario, fecha).sector === 'Caja';
}

function cajaFechaMs_(valor) {
  if (!valor) return 0;
  const d = valor instanceof Date ? valor : new Date(valor);
  return isNaN(d.getTime()) ? 0 : d.getTime();
}

function cajaFudoCacheKey_(fecha, sede) {
  return 'CAJA_FUDO_SYNC|' + fecha + '|' + sede;
}

function cajaLeerEstadoFudo_(fecha, sede) {
  const guardado = CacheService.getScriptCache().get(cajaFudoCacheKey_(fecha, sede));
  if (!guardado) return { ok:false, pendiente:true, error:'FUDO aún no se ha actualizado desde Caja.' };
  try { return JSON.parse(guardado); }
  catch (e) { return { ok:false, pendiente:true, error:'No se pudo leer el último estado de FUDO.' }; }
}

/**
 * Sin credenciales de la API configuradas (instalación sin la integración activa, o pruebas) el
 * cuadre con FUDO no aplica — se sigue exactamente como antes de que existiera esta validación, sin
 * bloquear ni exigir observaciones de más por algo que aquí ni siquiera está prendido.
 */
function cajaFudoCredencialesConfiguradas_() {
  if (typeof PropertiesService === 'undefined') return false;
  const props = PropertiesService.getScriptProperties();
  return !!(props.getProperty('FUDO_API_KEY') && props.getProperty('FUDO_API_SECRET'));
}

/** Sincronización pesada: solo se ejecuta al abrir, cerrar o solicitarla expresamente. */
function cajaSincronizarFudo_(fecha, sede, usuario, forzar) {
  const fechaFmt = formatearFecha_(fecha);
  if (!cajaFudoCredencialesConfiguradas_()) {
    return { ok: true, aplica: false, fecha: fechaFmt, sede: sede, sincronizado_en: '', error: '' };
  }
  const cache = CacheService.getScriptCache();
  const key = cajaFudoCacheKey_(fechaFmt, sede);
  if (!forzar) return cajaLeerEstadoFudo_(fechaFmt, sede);

  const resultado = { ok:false, aplica: true, fecha:fechaFmt, sede:sede, sincronizado_en:new Date(), ventas:null, pagos:null, error:'' };
  try {
    if (typeof fudoApiSincronizarVentas_ !== 'function' || typeof fudoApiSincronizarPagos_ !== 'function') {
      throw new Error('La integración API de FUDO no está disponible.');
    }
    resultado.ventas = fudoApiSincronizarVentas_(fechaFmt, fechaFmt, usuario, { sede:'Automática' });
    if (!resultado.ventas || resultado.ventas.ok === false) throw new Error(resultado.ventas?.error || 'No se sincronizaron las ventas.');
    resultado.pagos = fudoApiSincronizarPagos_(fechaFmt, fechaFmt, usuario, { sede:'Automática' });
    if (!resultado.pagos || resultado.pagos.ok === false) throw new Error(resultado.pagos?.error || 'No se sincronizaron los pagos.');
    resultado.ok = true;
    resultado.sincronizado_en = new Date();
  } catch (error) {
    resultado.error = error?.message || String(error);
    resultado.sincronizado_en = new Date();
  }
  // Solo se cachea un sync exitoso. Un fallo no debe "congelar" el cuadre como no confiable
  // durante 5 minutos: al pulsar Actualizar (o volver a consultar) tiene que poder reintentar.
  if (resultado.ok) cache.put(key, JSON.stringify(resultado), CAJA_FUDO_CACHE_SEGUNDOS_);
  return resultado;
}

function cajaTurnoFila_(fecha, sede) {
  cajaAsegurarEstructura_();
  return leerTabla_(SHEET_NAMES.CAJA_TURNO).find(r => formatearFecha_(r.fecha) === fecha && r.sede === sede);
}

function cajaUltimoCierreAntes_(fecha, sede) {
  const limite = new Date(fecha + 'T00:00:00').getTime();
  return leerTabla_(SHEET_NAMES.CAJA_TURNO)
    .filter(r => r.sede === sede && r.estado === 'Cerrado' && cajaFechaMs_(r.timestamp_cierre || r.hora_cierre || r.fecha) < limite)
    .sort((a,b) => cajaFechaMs_(b.timestamp_cierre || b.hora_cierre || b.fecha) - cajaFechaMs_(a.timestamp_cierre || a.hora_cierre || a.fecha))[0] || null;
}

function cajaBaseEsperada_(fecha, sede) {
  const ultimo = cajaUltimoCierreAntes_(fecha, sede);
  return ultimo && ultimo.base_siguiente !== '' && ultimo.base_siguiente != null ? Number(ultimo.base_siguiente) || 0 : 0;
}

function cajaMovimientosDelDia_(fecha, sede) {
  return leerTabla_(SHEET_NAMES.CAJA_MOVIMIENTOS).filter(r => formatearFecha_(r.fecha) === fecha && r.sede === sede);
}

function cajaTipoReal_(m) {
  const tipo = String(m.tipo || '');
  const texto = (String(m.persona_recibe || '') + ' ' + String(m.motivo || '')).toLowerCase();
  if (tipo === 'Entrega administrador' && texto.includes('caja fuerte')) return 'Envío a caja fuerte';
  if (tipo === 'Entrega administrador') return 'Entrega administrador desde caja';
  return tipo;
}

function cajaMovimientosResumen_(movimientos) {
  const r = { envios_caja_fuerte:0, retiros_caja_fuerte:0, entregas_admin_caja:0, entregas_admin_caja_fuerte:0, gastos:0, otros_ingresos:0 };
  movimientos.forEach(m => {
    const valor = Number(m.valor) || 0;
    const tipo = cajaTipoReal_(m);
    if (tipo === 'Envío a caja fuerte') r.envios_caja_fuerte += valor;
    else if (tipo === 'Retiro de caja fuerte') r.retiros_caja_fuerte += valor;
    else if (tipo === 'Entrega administrador desde caja') r.entregas_admin_caja += valor;
    else if (tipo === 'Entrega administrador desde caja fuerte') r.entregas_admin_caja_fuerte += valor;
    else if (tipo === 'Gasto') r.gastos += valor;
    else if (tipo === 'Otro ingreso') r.otros_ingresos += valor;
  });
  r.entregas_administrador = r.entregas_admin_caja + r.entregas_admin_caja_fuerte;
  Object.keys(r).forEach(k => r[k] = Number(r[k].toFixed(2)));
  return r;
}

function cajaSaldoFuerteAntes_(fecha, sede) {
  const ultimo = cajaUltimoCierreAntes_(fecha, sede);
  if (ultimo && ultimo.caja_fuerte_siguiente !== '' && ultimo.caja_fuerte_siguiente != null) {
    return Number(ultimo.caja_fuerte_siguiente) || 0;
  }
  const limite = new Date(fecha + 'T00:00:00').getTime();
  const movimientos = leerTabla_(SHEET_NAMES.CAJA_MOVIMIENTOS).filter(m => m.sede === sede && new Date(formatearFecha_(m.fecha) + 'T00:00:00').getTime() < limite);
  const r = cajaMovimientosResumen_(movimientos);
  return Number((r.envios_caja_fuerte - r.retiros_caja_fuerte - r.entregas_admin_caja_fuerte).toFixed(2));
}

function cajaEfectivoFudoDia_(fecha, sede) {
  const fudo = typeof turnoResumenCierre_ === 'function' ? turnoResumenCierre_(fecha, sede) : { pagos_efectivo_esperado:0 };
  return Number(fudo.pagos_efectivo_esperado) || 0;
}

function cajaEfectivoEsperado_(apertura, movimientos, fecha, sede) {
  const r = cajaMovimientosResumen_(movimientos);
  const efectivoFudoActual = cajaEfectivoFudoDia_(fecha, sede);
  const efectivoFudoTurno = Math.max(0, efectivoFudoActual - (Number(apertura.efectivo_fudo_al_abrir) || 0));
  const esperado = Number(apertura.base_inicial || 0) + efectivoFudoTurno + r.otros_ingresos + r.retiros_caja_fuerte - r.envios_caja_fuerte - r.entregas_admin_caja - r.gastos;
  const fuerte = Number(apertura.caja_fuerte_inicial || 0) + r.envios_caja_fuerte - r.retiros_caja_fuerte - r.entregas_admin_caja_fuerte;
  return {
    esperado:Number(esperado.toFixed(2)), caja_fuerte_esperada:Number(fuerte.toFixed(2)),
    pagos_efectivo_esperado:Number(efectivoFudoTurno.toFixed(2)), pagos_efectivo_dia:Number(efectivoFudoActual.toFixed(2)), resumen:r
  };
}

function cajaTurnoActualizarFila_(fecha, sede, cambios) {
  const sh = sheet_(SHEET_NAMES.CAJA_TURNO);
  const data = sh.getDataRange().getValues();
  const headers = data[0];
  const f = headers.indexOf('fecha'), s = headers.indexOf('sede');
  const limpio = neutralizarObjetoFormulas_(cambios);
  for (let r=1; r<data.length; r++) {
    if (formatearFecha_(data[r][f]) === fecha && data[r][s] === sede) {
      headers.forEach((h,c) => { if (limpio[h] !== undefined) sh.getRange(r+1,c+1).setValue(limpio[h]); });
      return true;
    }
  }
  return false;
}

function cajaAbrir_(item, usuario) {
  cajaAsegurarEstructura_();
  if (!item || !item.fecha || !item.sede) return {ok:false,error:'Falta la fecha o la sede'};
  if (!sedeEscrituraPermitida_(usuario,item.sede)) return {ok:false,error:'No puedes abrir la caja de otra sede'};
  const fecha = formatearFecha_(item.fecha);
  const existente = cajaTurnoFila_(fecha,item.sede);
  if (existente) return existente.estado === 'Cerrado' ? {ok:false,error:'La caja ya se cerró'} : {ok:true,ya_abierta:true,item:existente};

  // Abrir NO depende de los pagos de HOY: la base esperada viene del cierre anterior, no de FUDO
  // (solo cerrar sí lo necesita, ver cajaCerrar_). Se intenta sincronizar para que el aviso en
  // pantalla esté al día, pero un fallo de la API nunca debe impedir abrir la caja — antes esto
  // bloqueaba a cualquiera, incluida la Administradora, aunque el conteo físico coincidiera
  // exactamente con lo esperado.
  const syncFudo = cajaSincronizarFudo_(fecha,item.sede,usuario,true);

  const baseEsperada = cajaBaseEsperada_(fecha,item.sede);
  const fuerteEsperada = cajaSaldoFuerteAntes_(fecha,item.sede);
  const baseInicial = Number(item.base_inicial)||0;
  const fuerteInicial = Number(item.caja_fuerte_inicial)||0;
  const difApertura = Number((baseInicial-baseEsperada).toFixed(2));
  const difFuerteApertura = Number((fuerteInicial-fuerteEsperada).toFixed(2));
  // Con diferencia (en efectivo o en caja fuerte), solo un Administrador puede aprobar la
  // apertura — el frontend ya bloquea el botón, pero eso solo protege el navegador.
  if ((difApertura !== 0 || difFuerteApertura !== 0) && usuario.rol !== 'Administrador') {
    return {ok:false,error:'Hay una diferencia al abrir la caja. Solo un Administrador puede aprobar la apertura.',diferencia_apertura:difApertura,diferencia_caja_fuerte_apertura:difFuerteApertura};
  }
  if ((difApertura !== 0 || difFuerteApertura !== 0) && !String(item.observacion_apertura || '').trim()) {
    return {ok:false,error:'Hay una diferencia al abrir. Debes escribir una observación.',diferencia_apertura:difApertura,diferencia_caja_fuerte_apertura:difFuerteApertura};
  }
  const fila = {
    id:Utilities.getUuid(),fecha,sede:item.sede,estado:'Abierto',base_esperada:baseEsperada,base_inicial:baseInicial,
    diferencia_apertura:difApertura,observacion_apertura:item.observacion_apertura||'',
    caja_fuerte_esperada_apertura:fuerteEsperada,caja_fuerte_inicial:fuerteInicial,
    diferencia_caja_fuerte_apertura:difFuerteApertura,
    hora_apertura:new Date(),usuario_apertura_id:usuario.id,usuario_apertura:usuario.nombre,
    efectivo_fudo_al_abrir:cajaEfectivoFudoDia_(fecha,item.sede),rappi_encendido:false
  };
  appendRowFromObj_(SHEET_NAMES.CAJA_TURNO,fila);
  auditoriaRegistrar_(usuario,'caja_abrir','CajaTurno',fecha+'|'+item.sede,null,fila,item.sede,item.observacion_apertura||'');
  return {ok:true,item:fila,fudo_sync:syncFudo};
}

/**
 * Al abrir la pantalla de Caja o pulsar "Actualizar" (ambos llegan aquí): si la última
 * sincronización conocida ya expiró del caché (CAJA_FUDO_CACHE_SEGUNDOS_) o nunca se hizo, se
 * sincroniza ahora mismo contra la API real antes de calcular nada — así el cuadre nunca se
 * calcula contra un dato de FUDO que ya lleva rato desactualizado sin que nadie se entere.
 */
function cajaEstado_(fecha, sede, usuario) {
  cajaAsegurarEstructura_();
  if (!fecha || !sede) return {ok:false,error:'Falta la fecha o la sede'};
  const fechaFmt = formatearFecha_(fecha);
  let syncFudo = cajaLeerEstadoFudo_(fechaFmt,sede);
  if (syncFudo.pendiente) syncFudo = cajaSincronizarFudo_(fechaFmt,sede,usuario,true);
  const apertura = cajaTurnoFila_(fechaFmt,sede);
  if (!apertura) return {
    ok:true,abierta:false,base_esperada:cajaBaseEsperada_(fechaFmt,sede),caja_fuerte_esperada:cajaSaldoFuerteAntes_(fechaFmt,sede),
    puede_cerrar:cajaPuedeCerrar_(usuario,fechaFmt),fudo_sync:syncFudo,cuadre_confiable:syncFudo.ok
  };
  const calculo = cajaEfectivoEsperado_(apertura,cajaMovimientosDelDia_(fechaFmt,sede),fechaFmt,sede);
  return {
    ok:true,abierta:apertura.estado==='Abierto',apertura,movimientos_resumen:calculo.resumen,
    pagos_efectivo_esperado:calculo.pagos_efectivo_esperado,pagos_efectivo_dia:calculo.pagos_efectivo_dia,
    efectivo_esperado:calculo.esperado,caja_fuerte_esperada:calculo.caja_fuerte_esperada,
    total_bajo_custodia:calculo.esperado+calculo.caja_fuerte_esperada,puede_cerrar:cajaPuedeCerrar_(usuario,fechaFmt),
    fudo_sync:syncFudo,cuadre_confiable:syncFudo.ok
  };
}

function cajaSincronizarAhora_(fecha,sede,usuario) {
  if (!fecha || !sede) return {ok:false,error:'Falta la fecha o la sede'};
  return cajaSincronizarFudo_(fecha,sede,usuario,true);
}

function cajaRappiMarcar_(fecha,sede,usuario) {
  const fechaFmt=formatearFecha_(fecha), turno=cajaTurnoFila_(fechaFmt,sede);
  if(!turno)return {ok:false,error:'Primero hay que abrir la caja.'};
  if(turno.estado==='Cerrado')return {ok:false,error:'La caja ya está cerrada.'};
  cajaTurnoActualizarFila_(fechaFmt,sede,{rappi_encendido:true,rappi_confirmado_por:usuario?.nombre||'',rappi_confirmado_en:new Date()});
  return {ok:true};
}

function cajaMovimientoRegistrar_(item,usuario) {
  cajaAsegurarEstructura_();
  if(!item||!item.fecha||!item.sede)return {ok:false,error:'Falta fecha o sede'};
  if(!sedeEscrituraPermitida_(usuario,item.sede))return {ok:false,error:'No puedes registrar movimientos de otra sede'};
  const fecha=formatearFecha_(item.fecha), apertura=cajaTurnoFila_(fecha,item.sede);
  if(!apertura||apertura.estado==='Cerrado')return {ok:false,error:'La caja no está abierta'};
  if(CAJA_TIPOS_MOVIMIENTO_.indexOf(item.tipo)===-1)return {ok:false,error:'Tipo de movimiento inválido'};
  const valor=Number(item.valor);if(!valor||valor<=0)return {ok:false,error:'El valor debe ser mayor a cero'};
  if(!item.motivo)return {ok:false,error:'Falta el motivo'};
  if(String(item.tipo).indexOf('Entrega administrador')===0&&(!item.persona_entrega||!item.persona_recibe))return {ok:false,error:'La entrega necesita quién entrega y quién recibe'};
  const fila={id:Utilities.getUuid(),fecha,sede:item.sede,tipo:item.tipo,valor,persona_entrega:item.persona_entrega||usuario.nombre,persona_recibe:item.persona_recibe||'',hora:new Date(),motivo:item.motivo,evidencia_url:item.evidencia_url||'',usuario_id:usuario.id,usuario:usuario.nombre,timestamp:new Date()};
  appendRowFromObj_(SHEET_NAMES.CAJA_MOVIMIENTOS,fila);
  auditoriaRegistrar_(usuario,'caja_movimiento_registrar','CajaMovimientos',fila.id,null,{tipo:fila.tipo,valor:fila.valor},item.sede,item.motivo);
  return {ok:true,item:fila};
}

function cajaMovimientosListar_(fecha,sede) {
  if(!fecha||!sede)return [];
  return cajaMovimientosDelDia_(formatearFecha_(fecha),sede).sort((a,b)=>new Date(b.timestamp)-new Date(a.timestamp));
}

function cajaCerrar_(item,usuario) {
  cajaAsegurarEstructura_();
  if(!item||!item.fecha||!item.sede)return {ok:false,error:'Falta fecha o sede'};
  if(!sedeEscrituraPermitida_(usuario,item.sede))return {ok:false,error:'No puedes cerrar la caja de otra sede'};
  const fecha=formatearFecha_(item.fecha), apertura=cajaTurnoFila_(fecha,item.sede);
  if(!apertura)return {ok:false,error:'La caja no está abierta'};
  if(apertura.estado==='Cerrado')return {ok:true,ya_cerrado:true};
  if(!cajaPuedeCerrar_(usuario,fecha))return {ok:false,error:'No tienes permiso para cerrar la caja.'};

  // El efectivo esperado SÍ depende de los pagos de HOY, así que aquí (a diferencia de abrir) una
  // sincronización que no se pudo confirmar sí importa: un Encargado/Cocina no puede declarar el
  // cierre "cuadrado" con un número que podría estar mal; un Administrador sí puede, pero dejando
  // una observación explícita de que cerró sin esa confirmación (mismo patrón que una diferencia
  // de dinero, más abajo).
  const syncFudo=cajaSincronizarFudo_(fecha,item.sede,usuario,true);
  const fudoConfiable=syncFudo.ok;
  if(!fudoConfiable&&usuario.rol!=='Administrador'){
    return {ok:false,codigo:'FUDO_NO_SINCRONIZADO',error:'No se pudo confirmar los pagos de FUDO al día. Espera a que sincronice o pide a un Administrador que autorice el cierre.',fudo_sync:syncFudo};
  }
  if(!fudoConfiable&&!String(item.observacion||'').trim()){
    return {ok:false,codigo:'FUDO_NO_SINCRONIZADO',error:'FUDO no está sincronizado. Escribe una observación para cerrar de todas formas.',fudo_sync:syncFudo};
  }

  const calculo=cajaEfectivoEsperado_(apertura,cajaMovimientosDelDia_(fecha,item.sede),fecha,item.sede);
  const contado=Number(item.efectivo_contado)||0, fuerteContada=Number(item.caja_fuerte_contada)||0;
  const baseSiguiente=item.base_siguiente!==''&&item.base_siguiente!=null?Number(item.base_siguiente)||0:contado;
  if(baseSiguiente>contado)return {ok:false,error:'La base siguiente no puede ser mayor que el efectivo contado.'};
  const dif=Number((contado-calculo.esperado).toFixed(2)), difFuerte=Number((fuerteContada-calculo.caja_fuerte_esperada).toFixed(2));
  if((dif!==0||difFuerte!==0)&&usuario.rol!=='Administrador')return {ok:false,error:'Hay una diferencia. Solo un Administrador puede cerrar.',diferencia:dif,diferencia_caja_fuerte:difFuerte};
  if((dif!==0||difFuerte!==0)&&!String(item.observacion||'').trim())return {ok:false,error:'Hay una diferencia. Debes escribir una observación.'};

  const entregaCierre=Number((contado-baseSiguiente).toFixed(2));
  cajaTurnoActualizarFila_(fecha,item.sede,{estado:'Cerrado',efectivo_contado:contado,efectivo_esperado:calculo.esperado,diferencia:dif,caja_fuerte_contada:fuerteContada,caja_fuerte_esperada:calculo.caja_fuerte_esperada,diferencia_caja_fuerte:difFuerte,entrega_cierre:entregaCierre,persona_recibe_cierre:item.persona_recibe_cierre||'',base_siguiente:baseSiguiente,caja_fuerte_siguiente:fuerteContada,usuario_cierre:usuario.nombre,hora_cierre:new Date(),observacion_cierre:item.observacion||'',timestamp_cierre:new Date()});
  auditoriaRegistrar_(usuario,'caja_cerrar','CajaTurno',fecha+'|'+item.sede,null,{efectivo_esperado:calculo.esperado,efectivo_contado:contado,diferencia:dif,caja_fuerte_esperada:calculo.caja_fuerte_esperada,caja_fuerte_contada:fuerteContada,diferencia_caja_fuerte:difFuerte,fudo_sync:syncFudo.sincronizado_en},item.sede,item.observacion||'');
  return {ok:true,efectivo_esperado:calculo.esperado,efectivo_contado:contado,diferencia:dif,caja_fuerte_esperada:calculo.caja_fuerte_esperada,caja_fuerte_contada:fuerteContada,diferencia_caja_fuerte:difFuerte,entrega_cierre:entregaCierre,base_siguiente:baseSiguiente,fudo_sync:syncFudo,cuadre_confiable:fudoConfiable};
}
