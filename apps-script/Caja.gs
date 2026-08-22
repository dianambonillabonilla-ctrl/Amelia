/**
 * CAJA DILANA — reconstrucción desde cero (ago 2026)
 *
 * Principio operativo:
 * 1) El cajero RECIBE lo que quedó físicamente en el cierre DILANA anterior.
 * 2) Durante el turno DILANA registra solo movimientos físicos de custodia.
 * 3) FUDO aporta el efectivo vendido y los gastos en efectivo que impactan arqueo.
 * 4) Al cerrar se compara lo esperado contra el conteo físico.
 * 5) El conteo físico del cierre pasa a ser la apertura esperada del siguiente turno.
 *
 * Para Administrador se muestran en paralelo FUDO y DILANA; FUDO nunca reemplaza silenciosamente
 * el conteo físico ni la cadena de custodia.
 */

const CAJA_V3_PROP_ = 'CAJA_DESDE_CERO_V3_INICIALIZADA';
const CAJA_V3_VERSION_ = 'CAJA_V3';
const CAJA_V3_SEDES_ = ['San Antonio', 'Capri'];
const CAJA_V3_TIPOS_ = [
  'Envío a caja fuerte',
  'Retiro de caja fuerte',
  'Entrega administración desde caja',
  'Entrega administración desde caja fuerte',
  'Otro ingreso'
];

const CAJA_V3_TURNO_COLUMNAS_ = [
  'id','version','fecha','sede','estado','es_inicio_cero',
  'turno_anterior_id','fecha_turno_anterior',
  'base_esperada','base_inicial','diferencia_apertura',
  'caja_fuerte_esperada_apertura','caja_fuerte_inicial','diferencia_caja_fuerte_apertura',
  'observacion_apertura','hora_apertura','usuario_apertura_id','usuario_apertura',
  'fudo_efectivo_cierre','fudo_gastos_cierre','fudo_neto_cierre','fudo_confiable_cierre',
  'efectivo_esperado','efectivo_contado','diferencia',
  'caja_fuerte_esperada','caja_fuerte_contada','diferencia_caja_fuerte',
  'base_siguiente','caja_fuerte_siguiente',
  'observacion_cierre','usuario_cierre','hora_cierre','timestamp_cierre',
  'estado_conciliacion','nota_conciliacion'
];

const CAJA_V3_MOV_COLUMNAS_ = [
  'id','version','turno_id','fecha','sede','tipo','valor',
  'persona_entrega','persona_recibe','motivo','hora',
  'usuario_id','usuario','timestamp','idempotency_key'
];

function cajaV3LimpiarFilas_(nombreHoja) {
  const sh = ss_().getSheetByName(nombreHoja);
  if (!sh || sh.getLastRow() <= 1) return;
  sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).clearContent();
}

function cajaV3AsegurarInicio_() {
  const ss = ss_();
  let turnos = ss.getSheetByName(SHEET_NAMES.CAJA_TURNO);
  let movs = ss.getSheetByName(SHEET_NAMES.CAJA_MOVIMIENTOS);
  if (!turnos) turnos = ss.insertSheet(SHEET_NAMES.CAJA_TURNO);
  if (!movs) movs = ss.insertSheet(SHEET_NAMES.CAJA_MOVIMIENTOS);

  if (turnos.getLastRow() === 0) turnos.getRange(1,1,1,CAJA_V3_TURNO_COLUMNAS_.length).setValues([CAJA_V3_TURNO_COLUMNAS_]);
  else asegurarColumnas_(turnos, CAJA_V3_TURNO_COLUMNAS_);
  if (movs.getLastRow() === 0) movs.getRange(1,1,1,CAJA_V3_MOV_COLUMNAS_.length).setValues([CAJA_V3_MOV_COLUMNAS_]);
  else asegurarColumnas_(movs, CAJA_V3_MOV_COLUMNAS_);
  turnos.setFrozenRows(1); movs.setFrozenRows(1);

  const props = PropertiesService.getScriptProperties();
  if (props.getProperty(CAJA_V3_PROP_) === 'true') return;

  // Autorizado por la propietaria: todo el histórico de Caja anterior se descarta y el sistema
  // comienza una cadena nueva. FUDO NO se borra.
  cajaV3LimpiarFilas_(SHEET_NAMES.CAJA_TURNO);
  cajaV3LimpiarFilas_(SHEET_NAMES.CAJA_MOVIMIENTOS);
  if (SHEET_NAMES.BASE_CAJA) cajaV3LimpiarFilas_(SHEET_NAMES.BASE_CAJA);

  ['Caja_Turno_Archivo_Pre20260820','Caja_Movimientos_Archivo_Pre20260820',
   'Caja_Conciliacion_Bancaria','Caja_Conciliacion_Detalle'].forEach(function(nombre){
    const sh = ss.getSheetByName(nombre);
    if (sh) ss.deleteSheet(sh);
  });

  const todas = props.getProperties();
  Object.keys(todas).forEach(function(k){
    if (k.indexOf('CAJA_') === 0 && k !== CAJA_V3_PROP_) props.deleteProperty(k);
  });
  props.setProperty(CAJA_V3_PROP_, 'true');
  props.setProperty('CAJA_VERSION_ACTIVA', CAJA_V3_VERSION_);
  SpreadsheetApp.flush();
}

function cajaAsegurarEstructura_() { cajaV3AsegurarInicio_(); }

function cajaV3Fecha_(v) { return formatearFecha_(v); }
function cajaV3Numero_(v) { const n = Number(v); return isFinite(n) ? n : 0; }
function cajaV3Bool_(v) { return v === true || normalizar_(v) === 'si' || normalizar_(v) === 'true'; }

function cajaV3ValidarSede_(sede) {
  if (CAJA_V3_SEDES_.indexOf(sede) === -1) throw new Error('Caja solo existe en San Antonio y Capri.');
}

/** Fecha/hora → milisegundos, tolerante a texto vacío o inválido (0 = "sin momento conocido"). */
function cajaFechaMs_(v) {
  if (!v) return 0;
  const d = v instanceof Date ? v : new Date(v);
  const t = d.getTime();
  return isFinite(t) ? t : 0;
}

function cajaV3Turnos_() {
  cajaV3AsegurarInicio_();
  return leerTabla_(SHEET_NAMES.CAJA_TURNO).filter(function(r){ return r.version === CAJA_V3_VERSION_; });
}

function cajaV3Movimientos_() {
  cajaV3AsegurarInicio_();
  return leerTabla_(SHEET_NAMES.CAJA_MOVIMIENTOS).filter(function(r){ return r.version === CAJA_V3_VERSION_; });
}

function cajaTurnoFila_(fecha, sede) {
  const f = cajaV3Fecha_(fecha);
  return cajaV3Turnos_().find(function(r){ return cajaV3Fecha_(r.fecha) === f && r.sede === sede; }) || null;
}

function cajaV3UltimoCierreAntes_(fecha, sede) {
  const f = cajaV3Fecha_(fecha);
  return cajaV3Turnos_()
    .filter(function(r){ return r.sede === sede && r.estado === 'Cerrado' && cajaV3Fecha_(r.fecha) < f; })
    .sort(function(a,b){ return cajaV3Fecha_(b.fecha).localeCompare(cajaV3Fecha_(a.fecha)); })[0] || null;
}

function cajaV3ReferenciaApertura_(fecha, sede) {
  const anterior = cajaV3UltimoCierreAntes_(fecha, sede);
  if (!anterior) {
    return {
      es_inicio_cero:true, turno_anterior:null, fecha_anterior:'', caja_operativa:0, caja_fuerte:0, total:0,
      fudo_efectivo_cierre_anterior:null, fudo_gastos_cierre_anterior:null, fudo_neto_cierre_anterior:null
    };
  }
  const caja = cajaV3Numero_(anterior.base_siguiente);
  const fuerte = cajaV3Numero_(anterior.caja_fuerte_siguiente);
  // Lo que FUDO decía al momento de ese cierre ya queda guardado en el turno (fudo_efectivo_cierre/
  // fudo_neto_cierre) — se reexpone aquí para que el Administrador pueda comparar, al abrir hoy,
  // "qué dijo FUDO" contra "qué quedó físico en DILANA" del cierre de ayer, sin mezclarlo con el
  // efectivo de FUDO de HOY (que es un dato distinto y no relacionado con la apertura).
  function numOn_(v) { return v === '' || v == null ? null : cajaV3Numero_(v); }
  return {
    es_inicio_cero:false,
    turno_anterior:anterior.id,
    fecha_anterior:cajaV3Fecha_(anterior.fecha),
    caja_operativa:caja,
    caja_fuerte:fuerte,
    total:Number((caja+fuerte).toFixed(2)),
    fudo_efectivo_cierre_anterior:numOn_(anterior.fudo_efectivo_cierre),
    fudo_gastos_cierre_anterior:numOn_(anterior.fudo_gastos_cierre),
    fudo_neto_cierre_anterior:numOn_(anterior.fudo_neto_cierre)
  };
}

function cajaV3FudoResumen_(fecha, sede) {
  const f = cajaV3Fecha_(fecha);
  let pagos = { pagos_fudo_total:0, pagos_efectivo_esperado:0, pagos_fudo_cantidad:0 };
  if (typeof fudoPagosTotalesSedeFecha_ === 'function') {
    pagos = fudoPagosTotalesSedeFecha_(f, sede) || pagos;
  } else if (typeof turnoResumenCierre_ === 'function') {
    pagos = turnoResumenCierre_(f, sede) || pagos;
  }
  const gastos = typeof fudoGastosArqueoTotalDia_ === 'function'
    ? (fudoGastosArqueoTotalDia_(f, sede) || {total:0,cantidad:0})
    : {total:0,cantidad:0};
  const efectivo = cajaV3Numero_(pagos.pagos_efectivo_esperado);
  const gastosEfectivo = cajaV3Numero_(gastos.total);
  return {
    fecha:f,
    sede:sede,
    pagos_total:Number(cajaV3Numero_(pagos.pagos_fudo_total).toFixed(2)),
    efectivo:Number(efectivo.toFixed(2)),
    gastos_efectivo:Number(gastosEfectivo.toFixed(2)),
    neto:Number((efectivo-gastosEfectivo).toFixed(2)),
    cantidad_pagos:Number(pagos.pagos_fudo_cantidad || pagos.registros || 0),
    cantidad_gastos:Number(gastos.cantidad || 0)
  };
}

/**
 * Ventana de pagos en efectivo por MOMENTO real (no por día de calendario) — evita que un turno que
 * cruza la medianoche pierda o le atribuya mal ventas en efectivo cercanas a las 00:00. `Fudo_Pagos`
 * (con caída a `Pagos_FUDO`) trae `creacion` como marca de tiempo real de cada pago.
 */
function cajaV3PagosEfectivoVentana_(sede, desdeMs, hastaMs) {
  let filas = [];
  try { filas = leerTabla_(SHEET_NAMES.FUDO_PAGOS); } catch (e) { filas = []; }
  if (!filas.length) { try { filas = leerTabla_(SHEET_NAMES.PAGOS_FUDO); } catch (e) { filas = []; } }
  let total = 0, cantidad = 0, sinMomento = 0, efectivos = 0;
  filas.forEach(function (p) {
    if (p.sede !== sede) return;
    if (p.cancelado === true || normalizar_(p.cancelado) === 'si') return;
    const esEfectivo = typeof pagosFudoEsEfectivo_ === 'function' ? pagosFudoEsEfectivo_(p) : p.es_efectivo === true;
    if (!esEfectivo) return;
    efectivos++;
    const momento = cajaFechaMs_(p.creacion || p.fecha);
    if (!momento) { sinMomento++; return; }
    if (momento < desdeMs) return;
    if (hastaMs && momento > hastaMs) return;
    total += Number(p.monto) || 0;
    cantidad++;
  });
  return { disponible: efectivos > 0 && sinMomento === 0, total: Number(total.toFixed(2)), cantidad: cantidad };
}

/**
 * Igual que `cajaV3FudoResumen_` pero acotado a la ventana real del turno (hora_apertura → hora de
 * cierre, o "ahora" si sigue abierto) en vez de todo el día de calendario. Sin esto, un turno que
 * cierra después de medianoche pierde las ventas en efectivo hechas ya entrada la madrugada (quedan
 * fuera del día en que abrió, y ningún turno del día siguiente las reclama porque ese día no tiene
 * turno abierto todavía a esa hora).
 */
function cajaV3FudoResumenTurno_(turno, fecha, sede) {
  const desde = cajaFechaMs_(turno && turno.hora_apertura);
  if (!desde) return cajaV3FudoResumen_(fecha, sede);
  const hasta = turno && turno.estado === 'Cerrado' ? cajaFechaMs_(turno.timestamp_cierre || turno.hora_cierre) : 0;
  const pagos = cajaV3PagosEfectivoVentana_(sede, desde, hasta);
  const gastos = typeof fudoGastosArqueoTotalTurno_ === 'function'
    ? (fudoGastosArqueoTotalTurno_(fecha, sede, turno) || { total:0, cantidad:0 })
    : { total:0, cantidad:0 };
  // Si no hay momento confiable en los pagos (datos antiguos sin `creacion`), no se puede acotar por
  // ventana — se usa el resumen por día de calendario, igual que antes de este cambio.
  const diario = pagos.disponible ? null : cajaV3FudoResumen_(fecha, sede);
  const efectivo = pagos.disponible ? pagos.total : diario.efectivo;
  const gastosEfectivo = cajaV3Numero_(gastos.total);
  return {
    fecha: cajaV3Fecha_(fecha), sede: sede,
    pagos_total: Number(efectivo.toFixed(2)),
    efectivo: Number(efectivo.toFixed(2)),
    gastos_efectivo: Number(gastosEfectivo.toFixed(2)),
    neto: Number((efectivo - gastosEfectivo).toFixed(2)),
    cantidad_pagos: pagos.disponible ? Number(pagos.cantidad) || 0 : Number(diario.cantidad_pagos) || 0,
    cantidad_gastos: Number(gastos.cantidad) || 0,
    por_ventana: pagos.disponible
  };
}

function cajaV3CredencialesFudoConfiguradas_() {
  if (typeof PropertiesService === 'undefined') return false;
  const p = PropertiesService.getScriptProperties();
  return !!(p.getProperty('FUDO_API_KEY') && p.getProperty('FUDO_API_SECRET'));
}

/**
 * En una instalación sin credenciales, sincronizar no es un error: FUDO simplemente no aplica.
 * (Antes vivía duplicada en ZZ_CajaV3Compat.gs, redefiniendo esta misma función por orden de carga
 * de archivos — se unificó aquí para no repetir el problema que ya tuvo CajaV2.gs con CajaTurno.gs.)
 */
function cajaV3SincronizarFudo_(fecha, sede, usuario) {
  const f = cajaV3Fecha_(fecha);
  if (!cajaV3CredencialesFudoConfiguradas_()) {
    return { ok:true, aplica:false, fecha:f, sede:sede, ventas:null, pagos:null, gastos:null, errores:[], resumen:cajaV3FudoResumen_(f,sede) };
  }
  const res = { ok:true, aplica:true, fecha:f, sede:sede, ventas:null, pagos:null, gastos:null, errores:[] };
  try {
    if (typeof fudoApiSincronizarVentas_ === 'function') res.ventas = fudoApiSincronizarVentas_(f,f,usuario,{sede:'Automática'});
  } catch(e) { res.ok=false; res.errores.push('Ventas: '+(e.message||e)); }
  try {
    if (typeof fudoApiSincronizarPagos_ === 'function') res.pagos = fudoApiSincronizarPagos_(f,f,usuario,{sede:'Automática'});
  } catch(e) { res.ok=false; res.errores.push('Pagos: '+(e.message||e)); }
  try {
    if (typeof fudoApiSincronizarGastosArqueo_ === 'function') res.gastos = fudoApiSincronizarGastosArqueo_(f,f,usuario);
  } catch(e) { res.ok=false; res.errores.push('Gastos: '+(e.message||e)); }
  res.resumen = cajaV3FudoResumen_(f,sede);
  res.error = res.ok ? '' : res.errores.join(' | ');
  return res;
}

function cajaSincronizarAhora_(fecha, sede, usuario) {
  cajaV3ValidarSede_(sede);
  return cajaV3SincronizarFudo_(fecha,sede,usuario);
}

function cajaV3MovimientosTurno_(turnoId) {
  return cajaV3Movimientos_().filter(function(m){ return String(m.turno_id) === String(turnoId); })
    .sort(function(a,b){ return new Date(a.timestamp||a.hora) - new Date(b.timestamp||b.hora); });
}

function cajaV3ResumenMovimientos_(movs) {
  const r = { envios_fuerte:0, retiros_fuerte:0, entregas_admin_caja:0, entregas_admin_fuerte:0, otros_ingresos:0 };
  (movs||[]).forEach(function(m){
    const v = cajaV3Numero_(m.valor);
    if (m.tipo === 'Envío a caja fuerte') r.envios_fuerte += v;
    else if (m.tipo === 'Retiro de caja fuerte') r.retiros_fuerte += v;
    else if (m.tipo === 'Entrega administración desde caja') r.entregas_admin_caja += v;
    else if (m.tipo === 'Entrega administración desde caja fuerte') r.entregas_admin_fuerte += v;
    else if (m.tipo === 'Otro ingreso') r.otros_ingresos += v;
  });
  Object.keys(r).forEach(function(k){ r[k]=Number(r[k].toFixed(2)); });
  return r;
}

function cajaV3Calculo_(turno, fecha, sede) {
  const fudo = cajaV3FudoResumenTurno_(turno,fecha,sede);
  const movs = cajaV3MovimientosTurno_(turno.id);
  const r = cajaV3ResumenMovimientos_(movs);
  const caja = cajaV3Numero_(turno.base_inicial) + fudo.neto + r.otros_ingresos + r.retiros_fuerte -
    r.envios_fuerte - r.entregas_admin_caja;
  const fuerte = cajaV3Numero_(turno.caja_fuerte_inicial) + r.envios_fuerte - r.retiros_fuerte - r.entregas_admin_fuerte;
  return {
    caja_operativa:Number(caja.toFixed(2)),
    caja_fuerte:Number(fuerte.toFixed(2)),
    total:Number((caja+fuerte).toFixed(2)),
    fudo:fudo,
    movimientos:r
  };
}

function cajaEstado_(fecha, sede, usuario) {
  cajaV3ValidarSede_(sede);
  const f = cajaV3Fecha_(fecha);
  const turno = cajaTurnoFila_(f,sede);
  const referencia = cajaV3ReferenciaApertura_(f,sede);
  const calculo = turno ? cajaV3Calculo_(turno,f,sede) : null;
  // Cuando hay turno, el FUDO que se muestra es el MISMO que usa calculo.caja_operativa (acotado a la
  // ventana del turno) — antes se mostraban dos fuentes distintas (esta por día de calendario,
  // calculo.fudo por turno) y podían no coincidir sin que nadie lo notara.
  const fudo = calculo ? calculo.fudo : cajaV3FudoResumen_(f,sede);
  return {
    ok:true,
    version:CAJA_V3_VERSION_,
    fecha:f,
    sede:sede,
    referencia_apertura:referencia,
    apertura:turno,
    fudo:fudo,
    calculo:calculo,
    movimientos:turno ? cajaV3MovimientosTurno_(turno.id) : []
  };
}

function cajaV3ValorContado_(v, nombre) {
  if (v === '' || v === null || v === undefined) return {ok:false,error:'Falta '+nombre+'.'};
  const n = Number(v);
  if (!isFinite(n) || n < 0) return {ok:false,error:nombre+' debe ser un número mayor o igual a cero.'};
  return {ok:true,valor:n};
}

function cajaAbrir_(item, usuario) {
  cajaV3AsegurarInicio_();
  if (!item || !item.fecha || !item.sede) return {ok:false,error:'Falta fecha o sede.'};
  cajaV3ValidarSede_(item.sede);
  if (!sedeEscrituraPermitida_(usuario,item.sede)) return {ok:false,error:'No puedes abrir la caja de otra sede.'};
  const fecha = cajaV3Fecha_(item.fecha);
  if (fecha > cajaV3Fecha_(new Date())) return {ok:false,error:'No puedes abrir una fecha futura.'};

  const c = cajaV3ValorContado_(item.base_inicial,'el efectivo contado al abrir'); if(!c.ok)return c;
  const s = cajaV3ValorContado_(item.caja_fuerte_inicial,'la caja fuerte contada al abrir'); if(!s.ok)return s;

  // Bloqueo: entre leer "¿ya existe turno?" y escribir la fila nueva no puede colarse una segunda
  // apertura para la misma fecha+sede (dos dispositivos, o un reintento de red) — sin esto podían
  // quedar dos filas "Abierto" para el mismo día y no había forma de saber cuál es la real.
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return {ok:false,error:'Otra apertura de caja está en curso ahora mismo.'};
  try {
    const existente = cajaTurnoFila_(fecha,item.sede);
    if (existente) return existente.estado === 'Cerrado' ? {ok:false,error:'Esta caja ya fue cerrada.'} : {ok:true,ya_abierta:true,item:existente};

    const ref = cajaV3ReferenciaApertura_(fecha,item.sede);
    const difCaja = ref.es_inicio_cero ? 0 : Number((c.valor-ref.caja_operativa).toFixed(2));
    const difFuerte = ref.es_inicio_cero ? 0 : Number((s.valor-ref.caja_fuerte).toFixed(2));
    if ((difCaja !== 0 || difFuerte !== 0) && !String(item.observacion_apertura||'').trim()) {
      return {ok:false,error:'Lo contado no coincide con lo recibido del turno anterior. Escribe una observación.',diferencia_apertura:difCaja,diferencia_caja_fuerte_apertura:difFuerte};
    }

    const fila = {
      id:Utilities.getUuid(),version:CAJA_V3_VERSION_,fecha:fecha,sede:item.sede,estado:'Abierto',
      es_inicio_cero:ref.es_inicio_cero,turno_anterior_id:ref.turno_anterior||'',fecha_turno_anterior:ref.fecha_anterior||'',
      base_esperada:ref.caja_operativa,base_inicial:c.valor,diferencia_apertura:difCaja,
      caja_fuerte_esperada_apertura:ref.caja_fuerte,caja_fuerte_inicial:s.valor,diferencia_caja_fuerte_apertura:difFuerte,
      observacion_apertura:item.observacion_apertura||'',hora_apertura:new Date(),
      usuario_apertura_id:usuario.id,usuario_apertura:usuario.nombre
    };
    appendRowFromObj_(SHEET_NAMES.CAJA_TURNO,neutralizarObjetoFormulas_(fila));
    if (typeof auditoriaRegistrar_ === 'function') auditoriaRegistrar_(usuario,'caja_abrir','CajaTurno',fila.id,null,fila,item.sede,item.observacion_apertura||'');
    return {ok:true,item:fila,referencia_apertura:ref};
  } finally {
    lock.releaseLock();
  }
}

function cajaV3EsEntrega_(tipo) {
  return String(tipo || '').indexOf('Entrega administración') === 0;
}

function cajaMovimientoRegistrar_(item, usuario) {
  cajaV3AsegurarInicio_();
  if (!item || !item.fecha || !item.sede || !item.tipo) return {ok:false,error:'Faltan datos del movimiento.'};
  cajaV3ValidarSede_(item.sede);
  if (!sedeEscrituraPermitida_(usuario,item.sede)) return {ok:false,error:'No puedes registrar movimientos de otra sede.'};
  if (CAJA_V3_TIPOS_.indexOf(item.tipo) === -1) return {ok:false,error:'Tipo de movimiento inválido.'};
  const valor = Number(item.valor);
  if (!isFinite(valor) || valor <= 0) return {ok:false,error:'El valor debe ser mayor a cero.'};
  if (!String(item.motivo||'').trim()) return {ok:false,error:'Escribe el motivo.'};
  const persEntrega = item.persona_entrega || usuario.nombre;
  // Una entrega a administración necesita quién entrega y quién recibe registrados explícitamente —
  // se había perdido esta exigencia en la reconstrucción de Caja (el sistema anterior sí la tenía).
  if (cajaV3EsEntrega_(item.tipo) && (!String(persEntrega||'').trim() || !String(item.persona_recibe||'').trim())) {
    return {ok:false,error:'La entrega necesita quién entrega y quién recibe.'};
  }

  // Bloqueo: entre revisar que la caja sigue abierta / la clave de idempotencia y escribir la fila
  // nueva no puede colarse un cierre o un registro duplicado desde otro dispositivo.
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return {ok:false,error:'Otro movimiento se está guardando ahora mismo.'};
  try {
    const turno = cajaTurnoFila_(item.fecha,item.sede);
    if (!turno || turno.estado !== 'Abierto') return {ok:false,error:'Primero debes abrir la caja.'};

    const existentes = cajaV3MovimientosTurno_(turno.id);
    if (item.idempotency_key) {
      const repetido = existentes.find(function(m){ return m.idempotency_key === item.idempotency_key; });
      if (repetido) return {ok:true,item:repetido,ya_existia:true};
    }

    const fila = {
      id:Utilities.getUuid(),version:CAJA_V3_VERSION_,turno_id:turno.id,fecha:cajaV3Fecha_(item.fecha),sede:item.sede,
      tipo:item.tipo,valor:valor,persona_entrega:persEntrega,persona_recibe:item.persona_recibe||'',
      motivo:String(item.motivo).trim(),hora:new Date(),usuario_id:usuario.id,usuario:usuario.nombre,timestamp:new Date(),
      idempotency_key:item.idempotency_key||''
    };
    appendRowFromObj_(SHEET_NAMES.CAJA_MOVIMIENTOS,neutralizarObjetoFormulas_(fila));
    if (typeof auditoriaRegistrar_ === 'function') auditoriaRegistrar_(usuario,'caja_movimiento_registrar','CajaMovimientos',fila.id,null,fila,item.sede,fila.motivo);
    return {ok:true,item:fila};
  } finally {
    lock.releaseLock();
  }
}

function cajaMovimientosListar_(fecha, sede) {
  const turno = cajaTurnoFila_(fecha,sede);
  return turno ? cajaV3MovimientosTurno_(turno.id).reverse() : [];
}

function cajaCerrar_(item, usuario) {
  cajaV3AsegurarInicio_();
  if (!item || !item.fecha || !item.sede) return {ok:false,error:'Falta fecha o sede.'};
  cajaV3ValidarSede_(item.sede);
  if (!sedeEscrituraPermitida_(usuario,item.sede)) return {ok:false,error:'No puedes cerrar la caja de otra sede.'};
  const fecha = cajaV3Fecha_(item.fecha);

  const contado = cajaV3ValorContado_(item.efectivo_contado,'el efectivo contado al cerrar'); if(!contado.ok)return contado;
  const fuerte = cajaV3ValorContado_(item.caja_fuerte_contada,'la caja fuerte contada al cerrar'); if(!fuerte.ok)return fuerte;

  // La sincronización con FUDO es una llamada de red — se hace ANTES de tomar el bloqueo para no
  // dejar a las demás operaciones de Caja esperando mientras dura esa llamada.
  const sync = cajaV3SincronizarFudo_(fecha,item.sede,usuario);

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return {ok:false,error:'Otro cierre de caja está en curso ahora mismo.'};
  try {
    const turno = cajaTurnoFila_(fecha,item.sede);
    if (!turno) return {ok:false,error:'La caja no está abierta.'};
    if (turno.estado === 'Cerrado') return {ok:true,ya_cerrado:true,item:turno};

    const calculo = cajaV3Calculo_(turno,fecha,item.sede);
    const dif = Number((contado.valor-calculo.caja_operativa).toFixed(2));
    const difFuerte = Number((fuerte.valor-calculo.caja_fuerte).toFixed(2));
    if ((dif !== 0 || difFuerte !== 0) && !String(item.observacion||'').trim()) {
      return {ok:false,error:'Hay una diferencia en el cierre. Escribe una observación antes de cerrar.',diferencia:dif,diferencia_caja_fuerte:difFuerte,calculo:calculo};
    }

    const cambios = {
      estado:'Cerrado',
      fudo_efectivo_cierre:calculo.fudo.efectivo,fudo_gastos_cierre:calculo.fudo.gastos_efectivo,
      fudo_neto_cierre:calculo.fudo.neto,fudo_confiable_cierre:sync.ok,
      efectivo_esperado:calculo.caja_operativa,efectivo_contado:contado.valor,diferencia:dif,
      caja_fuerte_esperada:calculo.caja_fuerte,caja_fuerte_contada:fuerte.valor,diferencia_caja_fuerte:difFuerte,
      // Regla central: el dinero FÍSICO que quedó es exactamente lo que debe recibir el turno siguiente.
      base_siguiente:contado.valor,caja_fuerte_siguiente:fuerte.valor,
      observacion_cierre:item.observacion||'',usuario_cierre:usuario.nombre,hora_cierre:new Date(),timestamp_cierre:new Date(),
      estado_conciliacion:(dif===0&&difFuerte===0?'CUADRA':'REVISAR')
    };
    cajaV3ActualizarTurno_(turno.id,cambios);
    if (typeof auditoriaRegistrar_ === 'function') auditoriaRegistrar_(usuario,'caja_cerrar','CajaTurno',turno.id,null,cambios,item.sede,item.observacion||'');
    return {ok:true,calculo:calculo,efectivo_contado:contado.valor,caja_fuerte_contada:fuerte.valor,diferencia:dif,diferencia_caja_fuerte:difFuerte,fudo_sync:sync,base_siguiente:contado.valor,caja_fuerte_siguiente:fuerte.valor};
  } finally {
    lock.releaseLock();
  }
}

function cajaV3ActualizarTurno_(id, cambios) {
  const sh = sheet_(SHEET_NAMES.CAJA_TURNO);
  const data = sh.getDataRange().getValues();
  const headers = data[0];
  const idCol = headers.indexOf('id');
  const limpio = neutralizarObjetoFormulas_(cambios||{});
  for (let r=1;r<data.length;r++) {
    if (String(data[r][idCol]) !== String(id)) continue;
    headers.forEach(function(h,c){ if (limpio[h] !== undefined) sh.getRange(r+1,c+1).setValue(limpio[h]); });
    return true;
  }
  return false;
}

function cajaResumenAdministrador_(fecha, sedes, usuario) {
  const f = cajaV3Fecha_(fecha);
  const lista = Array.isArray(sedes) && sedes.length ? sedes : CAJA_V3_SEDES_;
  return {ok:true,fecha:f,sedes:lista.map(function(sede){
    cajaV3ValidarSede_(sede);
    const estado = cajaEstado_(f,sede,usuario);
    const t = estado.apertura;
    const calc = estado.calculo;
    const ref = estado.referencia_apertura;
    // Sin abrir todavía: el FUDO que se muestra es el del ÚLTIMO CIERRE (para comparar contra lo que
    // quedó físico ese mismo día), no el de hoy — mostrar "hoy hasta ahora" junto a "DILANA esperado"
    // parecía una comparación real y no lo era: son dos días distintos y sin relación entre sí.
    const fudoMostrado = calc ? calc.fudo : {
      efectivo: ref.fudo_efectivo_cierre_anterior, gastos_efectivo: ref.fudo_gastos_cierre_anterior,
      neto: ref.fudo_neto_cierre_anterior
    };
    return {
      sede:sede,
      estado:t ? t.estado : 'Sin abrir',
      referencia_apertura:ref,
      fudo:fudoMostrado,
      fudo_de_cierre_anterior: !t,
      dilana_esperado_caja:calc ? calc.caja_operativa : ref.caja_operativa,
      dilana_esperado_fuerte:calc ? calc.caja_fuerte : ref.caja_fuerte,
      dilana_esperado_total:calc ? calc.total : ref.total,
      contado_caja:t && t.estado==='Cerrado' ? cajaV3Numero_(t.efectivo_contado) : null,
      contado_fuerte:t && t.estado==='Cerrado' ? cajaV3Numero_(t.caja_fuerte_contada) : null,
      diferencia_caja:t && t.estado==='Cerrado' ? cajaV3Numero_(t.diferencia) : null,
      diferencia_fuerte:t && t.estado==='Cerrado' ? cajaV3Numero_(t.diferencia_caja_fuerte) : null,
      usuario_apertura:t ? t.usuario_apertura : '',
      usuario_cierre:t ? t.usuario_cierre : ''
    };
  })};
}

function cajaHistorialListar_(fechaDesde, fechaHasta, sede) {
  cajaV3AsegurarInicio_();
  return {ok:true,data:cajaV3Turnos_().filter(function(r){
    const f=cajaV3Fecha_(r.fecha);
    return (!fechaDesde||f>=fechaDesde)&&(!fechaHasta||f<=fechaHasta)&&(!sede||sede==='Ambas'||r.sede===sede);
  }).sort(function(a,b){return cajaV3Fecha_(b.fecha).localeCompare(cajaV3Fecha_(a.fecha));})};
}

// Compatibilidad deliberadamente mínima con rutas antiguas todavía presentes en Code.gs.
function cajaRappiMarcar_(){ return {ok:false,error:'Rappi ya no forma parte del módulo Caja.'}; }
function cajaNovedadesAdministrador_(){ return {ok:true,data:[]}; }
function cajaNovedadConciliar_(){ return {ok:false,error:'La conciliación antigua fue eliminada. Usa el Control Administrador de Caja.'}; }
function cajaCorregir_(){ return {ok:false,error:'La corrección histórica fue eliminada al iniciar Caja desde cero.'}; }
