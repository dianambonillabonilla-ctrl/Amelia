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
  'entrega_cierre','persona_recibe_cierre','persona_verifica_cierre','base_siguiente','usuario_cierre','hora_cierre',
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

const CAJA_MIGRACION_HISTORICA_PROP_ = 'CAJA_MIGRACION_HISTORICA_HECHA';

/**
 * Correcciones puntuales de historia real (venían de CajaV2.gs, antes de consolidar todo aquí):
 * el millón que se guardó en la caja fuerte de San Antonio el 2026-08-02, la entrega de $550.000
 * hecha en Capri el mismo rango de fechas, y la devolución de ese millón (ya lo tiene la
 * administradora, la caja fuerte física de San Antonio está en cero) — fechada el mismo día que la
 * de Capri porque cajaSaldoFuerteAntes_ solo cuenta movimientos ANTERIORES a la fecha consultada:
 * si se fecha el mismo día que "hoy", ese día todavía muestra la diferencia vieja.
 *
 * cajaAsegurarEstructura_ llama esto en CADA acción de Caja — sin la bandera de Propiedades del
 * Script, cada llamada volvía a leer Caja_Movimientos completo solo para confirmar que las tres
 * migraciones ya estaban puestas. Una vez confirmadas, se marca hecho y no se vuelve a escanear.
 */
function cajaMigrarHistorico_() {
  const props = typeof PropertiesService !== 'undefined' ? PropertiesService.getScriptProperties() : null;
  if (props && props.getProperty(CAJA_MIGRACION_HISTORICA_PROP_)) return;

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
  if (props) props.setProperty(CAJA_MIGRACION_HISTORICA_PROP_, 'true');
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
  cache.put(key, JSON.stringify(resultado), CAJA_FUDO_CACHE_SEGUNDOS_);
  return resultado;
}

function cajaTurnoFila_(fecha, sede) {
  cajaAsegurarEstructura_();
  return leerTabla_(SHEET_NAMES.CAJA_TURNO).find(r => formatearFecha_(r.fecha) === fecha && r.sede === sede);
}

/**
 * "Antes" se decide por la fecha DE NEGOCIO del turno (r.fecha — la que se eligió al abrirlo),
 * nunca por la hora real en que se dio clic en "Cerrar caja" (timestamp_cierre/hora_cierre). Un
 * cierre tarde en la noche (después de medianoche real) para el turno de "ayer" quedaba con un
 * timestamp_cierre que ya pertenece al día calendario de "hoy" — comparado contra la medianoche de
 * "hoy" con timestamp_cierre < limite, ese cierre real dejaba de contar como "anterior a hoy" y
 * cajaBaseEsperada_/cajaSaldoFuerteAntes_ mostraban $0, como si el cierre de ayer no hubiera
 * pasado. timestamp_cierre/hora_cierre solo se usan para desempatar entre cierres de la MISMA fecha
 * (no debería haber más de uno, pero por si acaso).
 */
function cajaUltimoCierreAntes_(fecha, sede) {
  return leerTabla_(SHEET_NAMES.CAJA_TURNO)
    .filter(r => r.sede === sede && r.estado === 'Cerrado' && formatearFecha_(r.fecha) < fecha)
    .sort((a,b) => {
      const porFecha = formatearFecha_(b.fecha).localeCompare(formatearFecha_(a.fecha));
      if (porFecha !== 0) return porFecha;
      return cajaFechaMs_(b.timestamp_cierre || b.hora_cierre) - cajaFechaMs_(a.timestamp_cierre || a.hora_cierre);
    })[0] || null;
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

/**
 * Efectivo FUDO del día que quedó con sede "Sin identificar" (no atribuible a ninguna sede) —
 * puramente informativo. Diana (ago 2026): esto NUNCA debe bloquear la apertura ni el cierre de
 * Caja, solo debe saberse que existe; el Administrador concilia esas ventas desde la bandeja
 * "Ventas pendientes de sede" (Importar de FUDO) para que dejen de aparecer.
 */
function cajaEfectivoSinIdentificarDia_(fecha) {
  const pagos = typeof pagosFudoTotalesSedeFecha_ === 'function' ? pagosFudoTotalesSedeFecha_(fecha, 'Sin identificar') : { pagos_efectivo_esperado: 0 };
  return Number(pagos.pagos_efectivo_esperado) || 0;
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

function cajaValorContadoValido_(valor) {
  if (valor === '' || valor === undefined || valor === null) return { ok: false, error: 'Falta contar el dinero — el campo no puede quedar vacío.' };
  const n = Number(valor);
  if (!isFinite(n)) return { ok: false, error: 'El dinero contado debe ser un número.' };
  if (n < 0) return { ok: false, error: 'El dinero contado no puede ser negativo.' };
  return { ok: true, valor: n };
}

function cajaAbrir_(item, usuario) {
  cajaAsegurarEstructura_();
  if (!item || !item.fecha || !item.sede) return {ok:false,error:'Falta la fecha o la sede'};
  if (!sedeEscrituraPermitida_(usuario,item.sede)) return {ok:false,error:'No puedes abrir la caja de otra sede'};
  const fecha = formatearFecha_(item.fecha);
  const existente = cajaTurnoFila_(fecha,item.sede);
  if (existente) return existente.estado === 'Cerrado' ? {ok:false,error:'La caja ya se cerró'} : {ok:true,ya_abierta:true,item:existente};

  // Los campos de conteo llegan vacíos desde la pantalla a propósito (ver caja.html) — sin esto,
  // un envío vacío se leía como "$0 contados" en silencio, sin avisar que faltaba contar.
  const baseValida = cajaValorContadoValido_(item.base_inicial);
  if (!baseValida.ok) return { ok:false, error: 'Efectivo contado al abrir: ' + baseValida.error };
  const fuerteValida = cajaValorContadoValido_(item.caja_fuerte_inicial);
  if (!fuerteValida.ok) return { ok:false, error: 'Caja fuerte contada al abrir: ' + fuerteValida.error };

  // Abrir NO depende de los pagos de HOY: la base esperada viene del cierre anterior, no de FUDO
  // (solo cerrar sí lo necesita, ver cajaCerrar_). Se intenta sincronizar para que el aviso en
  // pantalla esté al día, pero un fallo de la API nunca debe impedir abrir la caja — antes esto
  // bloqueaba a cualquiera, incluida la Administradora, aunque el conteo físico coincidiera
  // exactamente con lo esperado.
  const syncFudo = cajaSincronizarFudo_(fecha,item.sede,usuario,true);

  const baseEsperada = cajaBaseEsperada_(fecha,item.sede);
  const fuerteEsperada = cajaSaldoFuerteAntes_(fecha,item.sede);
  const baseInicial = baseValida.valor;
  const fuerteInicial = fuerteValida.valor;
  const difApertura = Number((baseInicial-baseEsperada).toFixed(2));
  const difFuerteApertura = Number((fuerteInicial-fuerteEsperada).toFixed(2));
  // Con diferencia (en efectivo o en caja fuerte), solo un Administrador puede aprobar la
  // apertura, y solo dejando por escrito qué pasó — el frontend ya bloquea el botón hasta que
  // ambas condiciones se cumplan, pero eso solo protege el navegador.
  if (difApertura !== 0 || difFuerteApertura !== 0) {
    if (usuario.rol !== 'Administrador') {
      return {ok:false,error:'Hay una diferencia al abrir la caja. Solo un Administrador puede aprobar la apertura.',diferencia_apertura:difApertura,diferencia_caja_fuerte_apertura:difFuerteApertura};
    }
    if (!String(item.observacion_apertura || '').trim()) {
      return {ok:false,error:'Hay una diferencia al abrir la caja. Escribe una observación explicando qué pasó.',diferencia_apertura:difApertura,diferencia_caja_fuerte_apertura:difFuerteApertura};
    }
  }
  const fila = {
    id:Utilities.getUuid(),fecha,sede:item.sede,estado:'Abierto',base_esperada:baseEsperada,base_inicial:baseInicial,
    diferencia_apertura:difApertura,observacion_apertura:item.observacion_apertura||'',
    caja_fuerte_esperada_apertura:fuerteEsperada,caja_fuerte_inicial:fuerteInicial,
    diferencia_caja_fuerte_apertura:difFuerteApertura,
    hora_apertura:new Date(),usuario_apertura_id:usuario.id,usuario_apertura:usuario.nombre,
    efectivo_fudo_al_abrir:cajaEfectivoFudoDia_(fecha,item.sede),rappi_encendido:false
  };

  // El candado solo cubre leer-de-nuevo-y-escribir: dos dispositivos abriendo la misma fecha+sede
  // al mismo tiempo podían pasar juntos el chequeo de "existente" de arriba y crear dos filas. La
  // sincronización con FUDO queda A PROPÓSITO fuera del candado — es una llamada de red que puede
  // tardar, y ella misma podría intentar tomar este mismo candado (pagosFudoImportar_).
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) {
    return { ok:false, error:'Otra apertura de caja está en curso ahora mismo — espera un momento y vuelve a intentarlo.' };
  }
  try {
    const existenteAhora = cajaTurnoFila_(fecha,item.sede);
    if (existenteAhora) {
      return existenteAhora.estado === 'Cerrado' ? {ok:false,error:'La caja ya se cerró'} : {ok:true,ya_abierta:true,item:existenteAhora};
    }
    appendRowFromObj_(SHEET_NAMES.CAJA_TURNO,fila);
    auditoriaRegistrar_(usuario,'caja_abrir','CajaTurno',fecha+'|'+item.sede,null,fila,item.sede,item.observacion_apertura||'');
  } finally {
    lock.releaseLock();
  }
  return {ok:true,item:fila,fudo_sync:syncFudo};
}

/**
 * Sintetiza en un solo valor lo que hoy son dos señales sueltas (cuadre_confiable y
 * efectivo_sin_identificar) más la diferencia de un cierre ya hecho — para el semáforo del panel de
 * Administrador. No es una regla de negocio nueva: solo combina señales que ya existían y ya se
 * mostraban por separado. 'no_confiable' gana siempre (si FUDO no se pudo confirmar, no importa si
 * además hay Sin identificar); 'pendiente' es todo lo demás que merece revisión pero no bloquea nada
 * (coherente con que Sin identificar nunca bloquea, ago 2026).
 */
function cajaNivelConfianza_(cuadreConfiable, efectivoSinIdentificar, diferenciaPendiente, sincronizacionPendiente) {
  if (!cuadreConfiable) return sincronizacionPendiente ? 'pendiente' : 'no_confiable';
  if ((Number(efectivoSinIdentificar) || 0) > 0 || diferenciaPendiente) return 'pendiente';
  return 'confiable';
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
  // ago 2026: antes, si el caché de FUDO estaba vencido o nunca se había llenado, esta consulta
  // forzaba aquí mismo una sincronización real contra la API (red + varias páginas de /sales y
  // /payments) antes de devolver NADA — la pantalla de Caja podía quedarse en "Consultando…" varios
  // minutos solo por abrir la página o cambiar de fecha. cajaEstado_ ahora SIEMPRE lee del caché
  // (rápido, nunca hace red) y, si está pendiente, lo dice tal cual (fudo_sync.pendiente=true) — el
  // frontend dispara la sincronización real aparte, en segundo plano, vía cajaSincronizarAhora_
  // (acción 'caja_sincronizar_ahora'), sin bloquear el primer dibujo de la pantalla. cajaAbrir_ y
  // cajaCerrar_ siguen forzando la sincronización real de forma síncrona a propósito — ahí sí hace
  // falta un dato fresco antes de calcular el efectivo esperado.
  let syncFudo = cajaLeerEstadoFudo_(fechaFmt,sede);
  // Sin credenciales configuradas, la validación FUDO nunca aplica (igual que dentro de
  // cajaSincronizarFudo_) — se resuelve aquí mismo, sin red, para no marcar "no confiable" para
  // siempre en una instalación que ni siquiera tiene la integración prendida.
  if (syncFudo.pendiente && !cajaFudoCredencialesConfiguradas_()) {
    syncFudo = { ok: true, aplica: false, fecha: fechaFmt, sede: sede, sincronizado_en: '', error: '' };
  }
  const efectivoSinIdentificar = cajaEfectivoSinIdentificarDia_(fechaFmt);
  const apertura = cajaTurnoFila_(fechaFmt,sede);
  if (!apertura) return {
    ok:true,abierta:false,base_esperada:cajaBaseEsperada_(fechaFmt,sede),caja_fuerte_esperada:cajaSaldoFuerteAntes_(fechaFmt,sede),
    puede_cerrar:cajaPuedeCerrar_(usuario,fechaFmt),fudo_sync:syncFudo,cuadre_confiable:syncFudo.ok,
    efectivo_sin_identificar:efectivoSinIdentificar,
    nivel_confianza:cajaNivelConfianza_(syncFudo.ok,efectivoSinIdentificar,false,syncFudo.pendiente)
  };
  const calculo = cajaEfectivoEsperado_(apertura,cajaMovimientosDelDia_(fechaFmt,sede),fechaFmt,sede);
  // La diferencia solo existe una vez contada de verdad (al cerrar) — mientras la caja sigue
  // abierta no hay nada que "esté pendiente" en ese sentido, el semáforo no se adelanta a un
  // conteo que todavía no pasó.
  const diferenciaPendiente = apertura.estado==='Cerrado' && (Number(apertura.diferencia)!==0 || Number(apertura.diferencia_caja_fuerte)!==0);
  return {
    ok:true,abierta:apertura.estado==='Abierto',apertura,movimientos_resumen:calculo.resumen,
    pagos_efectivo_esperado:calculo.pagos_efectivo_esperado,pagos_efectivo_dia:calculo.pagos_efectivo_dia,
    efectivo_esperado:calculo.esperado,caja_fuerte_esperada:calculo.caja_fuerte_esperada,
    total_bajo_custodia:calculo.esperado+calculo.caja_fuerte_esperada,puede_cerrar:cajaPuedeCerrar_(usuario,fechaFmt),
    fudo_sync:syncFudo,cuadre_confiable:syncFudo.ok,efectivo_sin_identificar:efectivoSinIdentificar,
    nivel_confianza:cajaNivelConfianza_(syncFudo.ok,efectivoSinIdentificar,diferenciaPendiente,syncFudo.pendiente)
  };
}

function cajaSincronizarAhora_(fecha,sede,usuario) {
  if (!fecha || !sede) return {ok:false,error:'Falta la fecha o la sede'};
  return cajaSincronizarFudo_(fecha,sede,usuario,true);
}

/**
 * Panel de Administrador: las dos sedes lado a lado para una misma fecha, en una sola llamada — la
 * "torre de control" en vez de tener que entrar sede por sede. Reutiliza cajaEstado_ tal cual (misma
 * lógica, mismos campos, incluyendo nivel_confianza) para cada sede; no duplica ningún cálculo.
 */
function cajaResumenAdministrador_(fecha, sedes, usuario) {
  if (!fecha) return { ok: false, error: 'Falta la fecha' };
  const fechaFmt = formatearFecha_(fecha);
  const listaSedes = Array.isArray(sedes) && sedes.length ? sedes : ['San Antonio', 'Capri'];
  const resumen = listaSedes.map(function (sede) {
    return Object.assign({ sede: sede }, cajaEstado_(fechaFmt, sede, usuario));
  });
  return { ok: true, fecha: fechaFmt, sedes: resumen };
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

  // Igual que al abrir: los campos de conteo llegan vacíos desde la pantalla a propósito, así que
  // un envío vacío/negativo debe rechazarse, no leerse como "$0 contados".
  const contadoValido=cajaValorContadoValido_(item.efectivo_contado);
  if(!contadoValido.ok)return {ok:false,error:'Efectivo contado: '+contadoValido.error};
  const fuerteContadaValida=cajaValorContadoValido_(item.caja_fuerte_contada);
  if(!fuerteContadaValida.ok)return {ok:false,error:'Caja fuerte contada: '+fuerteContadaValida.error};
  if(!String(item.persona_recibe_cierre||'').trim())return {ok:false,error:'Falta la persona que recibe el dinero.'};
  if(!String(item.persona_verifica_cierre||'').trim())return {ok:false,error:'Falta la persona que verifica el cierre.'};

  const calculo=cajaEfectivoEsperado_(apertura,cajaMovimientosDelDia_(fecha,item.sede),fecha,item.sede);
  const contado=contadoValido.valor, fuerteContada=fuerteContadaValida.valor;
  const baseSiguiente=item.base_siguiente!==''&&item.base_siguiente!=null?Number(item.base_siguiente)||0:contado;
  if(baseSiguiente>contado)return {ok:false,error:'La base para el siguiente turno no puede ser mayor que el efectivo contado.'};
  if(baseSiguiente<0)return {ok:false,error:'La base para el siguiente turno no puede ser negativa.'};
  const dif=Number((contado-calculo.esperado).toFixed(2)), difFuerte=Number((fuerteContada-calculo.caja_fuerte_esperada).toFixed(2));
  if((dif!==0||difFuerte!==0)&&usuario.rol!=='Administrador')return {ok:false,error:'Hay una diferencia. Solo un Administrador puede cerrar.',diferencia:dif,diferencia_caja_fuerte:difFuerte};
  if((dif!==0||difFuerte!==0)&&!String(item.observacion||'').trim())return {ok:false,error:'Hay una diferencia. Debes escribir una observación.'};

  // Mismo candado que al abrir: cubre solo leer-de-nuevo-y-escribir, nunca la sincronización con
  // FUDO (ya terminada arriba) — evita que dos dispositivos cierren el mismo turno a la vez.
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) {
    return { ok:false, error:'Otro cierre de caja está en curso ahora mismo — espera un momento y vuelve a intentarlo.' };
  }
  try {
    const aperturaAhora = cajaTurnoFila_(fecha,item.sede);
    if (!aperturaAhora) return {ok:false,error:'La caja no está abierta'};
    if (aperturaAhora.estado === 'Cerrado') return {ok:true,ya_cerrado:true};
    cajaTurnoActualizarFila_(fecha,item.sede,{estado:'Cerrado',efectivo_contado:contado,efectivo_esperado:calculo.esperado,diferencia:dif,caja_fuerte_contada:fuerteContada,caja_fuerte_esperada:calculo.caja_fuerte_esperada,diferencia_caja_fuerte:difFuerte,entrega_cierre:Math.max(0,contado-baseSiguiente),persona_recibe_cierre:item.persona_recibe_cierre||'',persona_verifica_cierre:item.persona_verifica_cierre||'',base_siguiente:baseSiguiente,caja_fuerte_siguiente:fuerteContada,usuario_cierre:usuario.nombre,hora_cierre:new Date(),observacion_cierre:item.observacion||'',timestamp_cierre:new Date()});
    auditoriaRegistrar_(usuario,'caja_cerrar','CajaTurno',fecha+'|'+item.sede,null,{efectivo_esperado:calculo.esperado,efectivo_contado:contado,diferencia:dif,caja_fuerte_esperada:calculo.caja_fuerte_esperada,caja_fuerte_contada:fuerteContada,diferencia_caja_fuerte:difFuerte,fudo_sync:syncFudo.sincronizado_en},item.sede,item.observacion||'');
  } finally {
    lock.releaseLock();
  }
  {
    const efectivoSinIdentificarCierre = cajaEfectivoSinIdentificarDia_(fecha);
    const diferenciaPendiente = dif!==0 || difFuerte!==0;
    return {ok:true,efectivo_esperado:calculo.esperado,efectivo_contado:contado,diferencia:dif,caja_fuerte_esperada:calculo.caja_fuerte_esperada,caja_fuerte_contada:fuerteContada,diferencia_caja_fuerte:difFuerte,base_siguiente:baseSiguiente,fudo_sync:syncFudo,cuadre_confiable:fudoConfiable,efectivo_sin_identificar:efectivoSinIdentificarCierre,nivel_confianza:cajaNivelConfianza_(fudoConfiable,efectivoSinIdentificarCierre,diferenciaPendiente)};
  }
}
