/**
 * BASE DE CAJA — cuadre de caja física por sede
 * Pedido real: "el cajero maneja base de caja... debe de realizar auditoria de cuando no cuadra".
 * Es un registro manual, uno por sede+fecha, separado de Cierres_Turno (que es "ya se vendió,
 * produjo y contó todo lo demás") — este es específicamente si el efectivo físico de la caja
 * cuadra contra lo que debió pasar ese día.
 *
 * Migrado del Excel "Cálculos del Día" que ya usaban ambas sedes (columnas Efectivo ingresa FUDO /
 * Caja Fuerte / Efectivo Caja Menor / Pendiente / Gastos / Cuadre) — ver baseCajaCalcularCuadre_
 * para la fórmula exacta, reconstruida de ese Excel y confirmada con Diana.
 */

/**
 * Cuánto debería haber en Caja Menor hoy = lo que había ayer + el efectivo que entró según FUDO
 * - lo gastado en efectivo - lo que se llevó a la Caja Fuerte, más el ajuste de Pendiente que se
 * resolvió o se generó de un día a otro. `Cuadre` es la diferencia entre eso y lo que de verdad
 * se contó hoy: 0 = cuadra, positivo = sobra, negativo = falta.
 */
function baseCajaCalcularCuadre_(anterior, actual) {
  const cuadre = (actual.efectivo_caja_menor - anterior.efectivo_caja_menor)
    - actual.efectivo_fudo + actual.gastos + actual.caja_fuerte
    + (anterior.pendiente - actual.pendiente);
  return Number(cuadre.toFixed(2));
}

/**
 * Caja Menor y Pendiente del último día registrado en `sede` antes de `fecha`. `existe: false`
 * cuando es el primer día que se registra esa sede — no hay contra qué comparar todavía, así que
 * baseCajaGuardar_ no calcula un "cuadre" ahí (mismo criterio que traía el Excel original: su
 * primera fila de cada sede quedaba en 0 a mano, sin fórmula, en vez de comparar contra la nada).
 */
function baseCajaFilaAnterior_(fecha, sede) {
  const anteriores = leerTabla_(SHEET_NAMES.BASE_CAJA)
    .filter(function (r) { return r.sede === sede && formatearFecha_(r.fecha) < fecha; })
    .sort(function (a, b) { return formatearFecha_(a.fecha) < formatearFecha_(b.fecha) ? 1 : -1; });
  const ultima = anteriores[0];
  return {
    existe: !!ultima,
    efectivo_caja_menor: ultima ? Number(ultima.efectivo_caja_menor) || 0 : 0,
    pendiente: ultima ? Number(ultima.pendiente) || 0 : 0
  };
}

/** El registro de `sede` en `fecha`, si ya existe (para precargar el formulario al reabrir el mismo día). */
function baseCajaDia_(fecha, sede) {
  if (!fecha || !sede) return { ok: false, error: 'Falta la fecha o la sede' };
  const fila = leerTabla_(SHEET_NAMES.BASE_CAJA).find(function (r) {
    return formatearFecha_(r.fecha) === fecha && r.sede === sede;
  });
  return { ok: true, item: fila || null };
}

function baseCajaGuardar_(item, usuario) {
  if (!item || !item.fecha) return { ok: false, error: 'Falta la fecha' };
  if (!item.sede) return { ok: false, error: 'Falta indicar la sede' };
  if (!sedeEscrituraPermitida_(usuario, item.sede)) {
    return { ok: false, error: 'No puedes registrar la base de caja de una sede distinta a la tuya (' + usuario.sede + ')' };
  }
  if (item.efectivo_caja_menor === '' || item.efectivo_caja_menor === null || item.efectivo_caja_menor === undefined) {
    return { ok: false, error: 'Falta el efectivo contado en caja menor' };
  }

  const fecha = formatearFecha_(item.fecha);
  const actual = {
    efectivo_fudo: Number(item.efectivo_fudo) || 0,
    caja_fuerte: Number(item.caja_fuerte) || 0,
    efectivo_caja_menor: Number(item.efectivo_caja_menor) || 0,
    pendiente: Number(item.pendiente) || 0,
    gastos: Number(item.gastos) || 0
  };
  const anterior = baseCajaFilaAnterior_(fecha, item.sede);
  const cuadre = anterior.existe ? baseCajaCalcularCuadre_(anterior, actual) : 0;

  const cambios = Object.assign({
    fecha: fecha,
    sede: item.sede,
    usuario: usuario.nombre,
    timestamp: new Date(),
    observacion: item.observacion || ''
  }, actual, { cuadre: cuadre });
  // observacion es texto libre — sin esto, algo como "=HYPERLINK(...)" se guardaba tal cual y
  // Sheets lo interpretaba como fórmula al abrir la hoja (auditoría de seguridad, jul 2026).
  const cambiosLimpios = neutralizarObjetoFormulas_(cambios);

  const sh = sheet_(SHEET_NAMES.BASE_CAJA);
  const data = sh.getDataRange().getValues();
  const headers = data[0];
  const fechaCol = headers.indexOf('fecha');
  const sedeCol = headers.indexOf('sede');
  let filaExistente = -1;
  for (let r = 1; r < data.length; r++) {
    if (formatearFecha_(data[r][fechaCol]) === fecha && data[r][sedeCol] === item.sede) { filaExistente = r + 1; break; }
  }
  if (filaExistente !== -1) {
    headers.forEach(function (h, c) { if (cambiosLimpios[h] !== undefined) sh.getRange(filaExistente, c + 1).setValue(cambiosLimpios[h]); });
  } else {
    cambiosLimpios.id = Utilities.getUuid();
    appendRowFromObj_(SHEET_NAMES.BASE_CAJA, cambiosLimpios);
  }

  // Pedido real: "debe de realizar auditoria de cuando no cuadra" — solo se deja rastro en la
  // bitácora cuando de verdad no cuadró, no en cada guardado normal.
  if (cuadre !== 0) {
    auditoriaRegistrar_(usuario, 'base_caja_no_cuadra', 'BaseCaja', fecha + '|' + item.sede, null,
      { cuadre: cuadre }, item.sede, cuadre > 0 ? 'Sobrante en caja' : 'Faltante en caja');
  }

  return { ok: true, cuadre: cuadre, actualizado: filaExistente !== -1 };
}

function baseCajaListar_(filtros, usuario) {
  filtros = filtros || {};
  let rows = leerTabla_(SHEET_NAMES.BASE_CAJA);
  if (filtros.fecha_desde) rows = rows.filter(function (r) { return formatearFecha_(r.fecha) >= filtros.fecha_desde; });
  if (filtros.fecha_hasta) rows = rows.filter(function (r) { return formatearFecha_(r.fecha) <= filtros.fecha_hasta; });
  if (filtros.sede) rows = rows.filter(function (r) { return r.sede === filtros.sede; });
  if (usuario && usuario.rol !== 'Administrador' && usuario.sede !== 'Ambas') {
    rows = rows.filter(function (r) { return sedeEscrituraPermitida_(usuario, r.sede); });
  }
  return rows.sort(function (a, b) {
    const fa = formatearFecha_(a.fecha), fb = formatearFecha_(b.fecha);
    if (fa !== fb) return fa < fb ? 1 : -1;
    return String(a.sede).localeCompare(String(b.sede));
  });
}
