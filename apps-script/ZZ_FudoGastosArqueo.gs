/**
 * GASTOS FUDO QUE IMPACTAN EL ARQUEO DE CAJA
 *
 * La API pública de FUDO expone /expenses con:
 * - Expense.useInCashCount + cashRegister/paymentMethod (modelo legado de un pago), y
 * - Expense.payments con cada Payment.amount/canceled/paymentMethod/cashRegister (modelo nuevo).
 *
 * Para Caja DILANA solo importa el EFECTIVO físico que salió de una caja FUDO. La regla es estricta:
 * el Expense debe estar marcado useInCashCount=true; además el pago debe ser efectivo, no cancelado
 * y estar asociado a una caja registradora identificable. Una tarjeta/transferencia nunca reduce el
 * cajón y la sola presencia de cashRegister no sustituye la bandera oficial "Usar en arqueo".
 */
const FUDO_GASTOS_ARQUEO_HOJA_ = 'Fudo_Gastos_Arqueo';
const FUDO_GASTOS_ARQUEO_COLUMNAS_ = [
  'id_movimiento','id_gasto','fecha_pago','momento_fudo','monto','cancelado','usa_arqueo','es_efectivo',
  'metodo_pago','metodo_tipo','caja_fudo','sede','modelo','descripcion',
  'primera_sincronizacion_en','ultima_sincronizacion_en','importado_por'
];

function fudoGastosArqueoAsegurarEstructura_() {
  const ss = ss_();
  let sh = ss.getSheetByName(FUDO_GASTOS_ARQUEO_HOJA_);
  if (!sh) {
    sh = ss.insertSheet(FUDO_GASTOS_ARQUEO_HOJA_);
    sh.getRange(1, 1, 1, FUDO_GASTOS_ARQUEO_COLUMNAS_.length).setValues([FUDO_GASTOS_ARQUEO_COLUMNAS_]);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, FUDO_GASTOS_ARQUEO_COLUMNAS_.length)
      .setFontWeight('bold').setBackground('#0B1F3A').setFontColor('#FFFFFF');
  } else {
    asegurarColumnas_(sh, FUDO_GASTOS_ARQUEO_COLUMNAS_);
  }
  return sh;
}

function fudoGastosBool_(v) {
  return v === true || String(v).toLowerCase() === 'true' || String(v).toLowerCase() === 'si';
}

function fudoGastosPtr_(obj, nombre) {
  return obj && obj.relationships && obj.relationships[nombre] ? obj.relationships[nombre].data : null;
}

function fudoGastosIncluido_(ptr, incluidos) {
  if (!ptr) return null;
  return incluidos[ptr.type + ':' + ptr.id] || null;
}

function fudoGastosNombreIncluido_(ptr, incluidos) {
  const r = fudoGastosIncluido_(ptr, incluidos);
  return r && r.attributes && r.attributes.name ? r.attributes.name : '';
}

function fudoGastosSedeDesdeCaja_(nombreCaja) {
  if (!nombreCaja) return typeof FUDO_SEDE_SIN_IDENTIFICAR_ !== 'undefined' ? FUDO_SEDE_SIN_IDENTIFICAR_ : 'Sin identificar';
  if (typeof fudoResolverSedeVenta_ === 'function') {
    const res = fudoResolverSedeVenta_({ sala:'', caja:nombreCaja, identificador:'', usuario:'' });
    if (res && res.sede) return res.sede;
  }
  if (typeof sedeDesdeCreadaPor_ === 'function') return sedeDesdeCreadaPor_(nombreCaja);
  const n = normalizar_(nombreCaja);
  if (n.indexOf('capri') !== -1) return 'Capri';
  if (n.indexOf('san antonio') !== -1 || n === 'caja') return 'San Antonio';
  return 'Sin identificar';
}

function fudoGastosMetodo_(ptr, incluidos) {
  const r = fudoGastosIncluido_(ptr, incluidos);
  const a = r && r.attributes ? r.attributes : {};
  return { nombre:a.name || '', tipo:a.kind || a.code || '' };
}

function fudoGastosEsEfectivo_(metodo) {
  if (typeof pagosFudoEsEfectivo_ === 'function') {
    return pagosFudoEsEfectivo_({ metodo_pago:metodo.nombre, metodo_tipo:metodo.tipo });
  }
  const tipo = normalizar_(metodo.tipo);
  const nombre = normalizar_(metodo.nombre);
  return tipo === 'cash' || nombre.indexOf('efectivo') !== -1 || nombre.indexOf('cash') !== -1;
}

function fudoGastosMomento_(attrs, fallback) {
  return attrs.paidAt || attrs.paid_at || attrs.createdAt || attrs.created_at || fallback || '';
}

function fudoGastosFechaEnRango_(momento, desde, hasta) {
  const f = formatearFecha_(momento);
  return !!f && f >= desde && f <= hasta;
}

/**
 * Convierte un Expense + included en movimientos de caja. Si trae payments, cada pago es una fila.
 * El modelo legado (sin payments resueltos) usa amount/paymentDate del Expense.
 */
function fudoGastosArqueoFilasDesdeExpense_(expense, incluidos, fechaDesde, fechaHasta) {
  const filas = [];
  const ea = expense.attributes || {};
  const canceladoGasto = fudoGastosBool_(ea.canceled);
  const usaArqueoGasto = fudoGastosBool_(ea.useInCashCount);
  const descripcion = ea.description || '';
  const pagosPtrRaw = fudoGastosPtr_(expense, 'payments');
  const pagosPtr = Array.isArray(pagosPtrRaw) ? pagosPtrRaw : (pagosPtrRaw ? [pagosPtrRaw] : []);
  let pagosResueltos = 0;

  pagosPtr.forEach(function (ptr) {
    const payment = fudoGastosIncluido_(ptr, incluidos);
    if (!payment) return;
    pagosResueltos++;
    const pa = payment.attributes || {};
    const momento = fudoGastosMomento_(pa, ea.paymentDate || ea.date || ea.createdAt);
    if (!fudoGastosFechaEnRango_(momento, fechaDesde, fechaHasta)) return;

    const cajaPtr = fudoGastosPtr_(payment, 'cashRegister');
    const metodoPtr = fudoGastosPtr_(payment, 'paymentMethod');
    const cajaNombre = fudoGastosNombreIncluido_(cajaPtr, incluidos);
    const metodo = fudoGastosMetodo_(metodoPtr, incluidos);
    const usaArqueo = usaArqueoGasto && !!cajaPtr;

    filas.push({
      id_movimiento:'P:' + String(payment.id),
      id_gasto:String(expense.id),
      fecha_pago:formatearFecha_(momento),
      momento_fudo:momento ? new Date(momento) : '',
      monto:Number(pa.amount) || 0,
      cancelado:canceladoGasto || fudoGastosBool_(pa.canceled),
      usa_arqueo:usaArqueo,
      es_efectivo:fudoGastosEsEfectivo_(metodo),
      metodo_pago:metodo.nombre,
      metodo_tipo:metodo.tipo,
      caja_fudo:cajaNombre,
      sede:fudoGastosSedeDesdeCaja_(cajaNombre),
      modelo:'payment',
      descripcion:descripcion
    });
  });

  if (pagosResueltos === 0) {
    const momento = ea.paymentDate || ea.date || ea.createdAt || '';
    if (fudoGastosFechaEnRango_(momento, fechaDesde, fechaHasta)) {
      const cajaPtr = fudoGastosPtr_(expense, 'cashRegister');
      const metodoPtr = fudoGastosPtr_(expense, 'paymentMethod');
      const cajaNombre = fudoGastosNombreIncluido_(cajaPtr, incluidos);
      const metodo = fudoGastosMetodo_(metodoPtr, incluidos);
      filas.push({
        id_movimiento:'E:' + String(expense.id),
        id_gasto:String(expense.id),
        fecha_pago:formatearFecha_(momento),
        momento_fudo:/T\d{2}:\d{2}/.test(String(momento)) ? new Date(momento) : '',
        monto:Number(ea.amount) || 0,
        cancelado:canceladoGasto,
        usa_arqueo:usaArqueoGasto && !!cajaPtr,
        es_efectivo:fudoGastosEsEfectivo_(metodo),
        metodo_pago:metodo.nombre,
        metodo_tipo:metodo.tipo,
        caja_fudo:cajaNombre,
        sede:fudoGastosSedeDesdeCaja_(cajaNombre),
        modelo:'expense_legacy',
        descripcion:descripcion
      });
    }
  }
  return filas;
}

function fudoGastosArqueoConsultar_(fechaDesde, fechaHasta) {
  const include = 'cashRegister,paymentMethod,payments,payments.paymentMethod,payments.cashRegister';
  const campos = {
    expense:'amount,canceled,createdAt,date,description,paymentDate,status,useInCashCount,cashRegister,paymentMethod,payments',
    payment:'amount,created_at,updated_at,paid_at,canceled,paymentMethod,cashRegister',
    paymentMethod:'code,name',
    cashRegister:'name'
  };

  const porGasto = fudoApiObtenerTodoCompleto_('expenses', {
    filtros:{ date:'and(gte.' + fechaDesde + ',lte.' + fechaHasta + ')' },
    include:include, campos:campos, orden:'date'
  });
  const porPago = fudoApiObtenerTodoCompleto_('expenses', {
    filtros:{ payments:{ createdAt:'and(gte.' + fechaDesde + 'T00:00:00,lte.' + fechaHasta + 'T23:59:59)' } },
    include:include, campos:campos, orden:'date'
  });

  const filasPorId = {};
  function procesar(resultado) {
    resultado.registros.forEach(function (expense) {
      fudoGastosArqueoFilasDesdeExpense_(expense, resultado.incluidos, fechaDesde, fechaHasta).forEach(function (fila) {
        filasPorId[fila.id_movimiento] = fila;
      });
    });
  }
  procesar(porGasto);
  procesar(porPago);
  return Object.keys(filasPorId).map(function (k) { return filasPorId[k]; });
}

function fudoGastosArqueoUpsert_(filas, usuario) {
  const sh = fudoGastosArqueoAsegurarEstructura_();
  const data = sh.getDataRange().getValues();
  const headers = data[0];
  const idCol = headers.indexOf('id_movimiento');
  const primeraCol = headers.indexOf('primera_sincronizacion_en');
  const filaPorId = {};
  for (let r=1; r<data.length; r++) filaPorId[String(data[r][idCol] || '')] = r + 1;

  const ahora = new Date();
  let importados=0, actualizados=0, omitidos=0;
  const nuevas = [];
  filas.forEach(function (f) {
    if (!f.id_movimiento) { omitidos++; return; }
    const existente = filaPorId[f.id_movimiento];
    const obj = neutralizarObjetoFormulas_(Object.assign({}, f, {
      ultima_sincronizacion_en:ahora,
      importado_por:usuario && usuario.nombre ? usuario.nombre : 'sistema'
    }));
    if (existente) {
      const primera = primeraCol >= 0 ? data[existente - 1][primeraCol] : '';
      obj.primera_sincronizacion_en = primera || ahora;
      headers.forEach(function (h,c) {
        if (obj[h] !== undefined) sh.getRange(existente,c+1).setValue(obj[h]);
      });
      actualizados++;
    } else {
      obj.primera_sincronizacion_en = ahora;
      nuevas.push(obj);
      importados++;
    }
  });
  if (nuevas.length) appendRowsFromObjs_(FUDO_GASTOS_ARQUEO_HOJA_, nuevas);
  return { ok:true, importados:importados, actualizados:actualizados, omitidos:omitidos };
}

function fudoApiSincronizarGastosArqueo_(fechaDesde, fechaHasta, usuario) {
  if (!fechaDesde || !fechaHasta) return { ok:false, error:'Faltan fecha_desde/fecha_hasta' };
  const filas = fudoGastosArqueoConsultar_(fechaDesde, fechaHasta);
  const upsert = fudoGastosArqueoUpsert_(filas, usuario || { nombre:'sistema' });
  let impactan=0, monto=0;
  filas.forEach(function (f) {
    if (!f.cancelado && f.usa_arqueo && f.es_efectivo && f.sede !== 'Sin identificar') {
      impactan++; monto += Number(f.monto) || 0;
    }
  });
  const res = Object.assign({}, upsert, {
    tipo:'gastos_arqueo', movimientos_encontrados:filas.length,
    impactan_arqueo_efectivo:impactan, monto_arqueo_efectivo:Number(monto.toFixed(2))
  });
  if (typeof fudoApiSyncRegistrar_ === 'function') {
    fudoApiSyncRegistrar_('gastos_arqueo', {
      ok:true, fecha_desde:fechaDesde, fecha_hasta:fechaHasta, usuario:usuario && usuario.nombre,
      importados:upsert.importados, actualizados:upsert.actualizados,
      movimientos_encontrados:filas.length, monto_arqueo_efectivo:res.monto_arqueo_efectivo, error:''
    });
  }
  return res;
}

function fudoGastosArqueoFilasSedeFecha_(fecha, sede) {
  fudoGastosArqueoAsegurarEstructura_();
  return leerTabla_(FUDO_GASTOS_ARQUEO_HOJA_).filter(function (r) {
    return formatearFecha_(r.fecha_pago) === fecha && r.sede === sede &&
      !fudoGastosBool_(r.cancelado) && fudoGastosBool_(r.usa_arqueo) && fudoGastosBool_(r.es_efectivo);
  });
}

function fudoGastosArqueoTotalDia_(fecha, sede) {
  let total=0;
  const filas = fudoGastosArqueoFilasSedeFecha_(fecha,sede);
  filas.forEach(function (r) { total += Number(r.monto) || 0; });
  return { total:Number(total.toFixed(2)), cantidad:filas.length };
}

function fudoGastosArqueoTotalTurno_(fecha, sede, apertura) {
  const desde = cajaFechaMs_(apertura && apertura.hora_apertura);
  const hasta = apertura && apertura.estado === 'Cerrado'
    ? cajaFechaMs_(apertura.timestamp_cierre || apertura.hora_cierre) : 0;
  let total=0, cantidad=0;
  fudoGastosArqueoFilasSedeFecha_(fecha,sede).forEach(function (r) {
    const momento = cajaFechaMs_(r.momento_fudo) || cajaFechaMs_(r.primera_sincronizacion_en);
    if (desde && momento && momento < desde) return;
    if (hasta && momento && momento > hasta) return;
    total += Number(r.monto) || 0;
    cantidad++;
  });
  return { total:Number(total.toFixed(2)), cantidad:cantidad };
}
