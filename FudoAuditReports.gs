function importFudoProductsRows(payload, token) {
  var user = getSessionUser_(token);
  payload = payload || {};
  var rows = payload.rows || [];
  if (!rows.length) throw new Error('No se recibieron filas para importar.');

  var idArchivo = generateId('FUDO');
  var hashArchivo = Utilities.base64EncodeWebSafe(Utilities.computeDigest(
    Utilities.DigestAlgorithm.MD5,
    JSON.stringify(rows).slice(0, 50000)
  ));

  var imported = getAllAsObjects_('Archivos_Importados');
  if (imported.some(function(a) { return a.hash_archivo === hashArchivo; })) {
    createAlert_('ARCHIVO_DUPLICADO', 'ALTA', 'Archivo Fudo ya importado previamente.', payload.sede || '');
    return { ok: false, message: 'Archivo ya importado.' };
  }

  appendRow_('Archivos_Importados', [
    idArchivo, nowIso(), payload.nombreArchivo || 'fudo_manual', hashArchivo,
    payload.sede || user.sede_asignada, user.id_usuario, 'REPORTE_PRODUCTOS', 'IMPORTADO'
  ]);

  rows.forEach(function(r) {
    appendRow_('Productos_Fudo', [
      generateId('PFD'),
      r.fecha || '',
      r.categoria || '',
      r.subcategoria || '',
      r.producto || '',
      Number(r.cantidadVendida || 0),
      Number(r.montoTotal || 0),
      Number(r.cmv || 0),
      Number(r.cmvPct || 0),
      Number(r.markup || 0),
      idArchivo
    ]);
  });

  var result = calculateTheoreticalConsumptionByFile_(idArchivo, payload.sede || user.sede_asignada, user);
  logAudit_(user, 'Fudo', 'IMPORTAR_FUDO', 'Archivos_Importados', idArchivo, 'Importación Fudo completada');
  return { ok: true, idArchivo: idArchivo, consumo: result };
}

function calculateTheoreticalConsumptionByFile_(idArchivo, sede, user) {
  var products = getAllAsObjects_('Productos_Fudo').filter(function(p) { return p.id_archivo === idArchivo; });
  var recetas = getAllAsObjects_('Recetas_Venta').filter(function(r) { return String(r.activa).toUpperCase() !== 'NO'; });
  var eq = getAllAsObjects_('Equivalencias_Fudo').filter(function(e) { return String(e.activo).toUpperCase() !== 'NO'; });

  var byFudo = {};
  recetas.forEach(function(r) {
    var key = normalizeText(r.producto_fudo);
    if (!byFudo[key]) byFudo[key] = [];
    byFudo[key].push(r);
  });

  var eqMap = {};
  eq.forEach(function(e) { eqMap[normalizeText(e.nombre_fudo)] = e.nombre_fudo; });

  var created = 0;
  var missingRecipe = 0;
  products.forEach(function(p) {
    var n = normalizeText(p.producto);
    var recipeKey = eqMap[n] ? normalizeText(eqMap[n]) : n;
    var recipeLines = byFudo[recipeKey] || [];
    if (!recipeLines.length) {
      missingRecipe++;
      createAlert_('PRODUCTO_SIN_RECETA', 'ALTA', 'Producto vendido sin receta: ' + p.producto, sede);
      return;
    }

    recipeLines.forEach(function(line) {
      var qty = Number(p.cantidad_vendida || 0) * Number(line.cantidad_por_unidad || 0);
      appendRow_('Consumo_Teorico', [
        generateId('CTE'),
        p.fecha || nowIso(),
        sede,
        p.producto,
        line.id_producto_insumo || '',
        qty,
        line.unidad || 'g',
        0,
        idArchivo
      ]);

      appendRow_('Inventario_Movimientos', [
        generateId('MOV'),
        nowIso(),
        'CONSUMO_TEORICO',
        sede,
        line.id_producto_insumo || '',
        -Math.abs(qty),
        line.unidad || 'g',
        idArchivo,
        'SISTEMA',
        'Descuento por venta Fudo'
      ]);
      created++;
    });
  });

  return { consumosGenerados: created, productosSinReceta: missingRecipe };
}

function runInventoryAudit(payload, token) {
  var user = getSessionUser_(token);
  payload = payload || {};
  var sede = payload.sede || user.sede_asignada;
  var fecha = payload.fecha || Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  var productos = getAllAsObjects_('Productos').filter(function(p) { return String(p.activo).toUpperCase() !== 'NO'; });

  var movimientos = getAllAsObjects_('Inventario_Movimientos').filter(function(m) {
    return String(m.sede) === String(sede);
  });
  var fisicos = getAllAsObjects_('Inventario_Fisico').filter(function(i) {
    return String(i.sede) === String(sede) && String(i.fecha) === String(fecha);
  });

  var mapEsperado = {};
  movimientos.forEach(function(m) {
    var key = m.id_producto;
    mapEsperado[key] = (mapEsperado[key] || 0) + Number(m.cantidad || 0);
  });
  var mapFisico = {};
  fisicos.forEach(function(i) {
    mapFisico[i.id_producto] = Number(i.cantidad_fisica || 0);
  });

  var results = [];
  productos.forEach(function(p) {
    var expected = Number(mapEsperado[p.id_producto] || 0);
    var real = Number(mapFisico[p.id_producto] || 0);
    var diff = real - expected;
    var pct = expected === 0 ? 0 : (diff / expected) * 100;
    var level = Math.abs(pct) >= APP_CONFIG.ALERT_THRESHOLDS.CRITICAL_DIFF_PCT ? 'ROJO' :
      Math.abs(pct) >= APP_CONFIG.ALERT_THRESHOLDS.WARN_DIFF_PCT ? 'AMARILLO' : 'VERDE';

    var idAud = generateId('AUD');
    appendRow_('Auditoria_Inventario', [
      idAud, fecha, sede, p.id_producto, expected, real, diff, pct, 0, level
    ]);
    if (level !== 'VERDE') {
      createAlert_('DIFERENCIA_INVENTARIO', level === 'ROJO' ? 'ALTA' : 'MEDIA', 'Diferencia ' + level + ' producto ' + p.nombre_producto, sede);
    }
    results.push({ producto: p.nombre_producto, esperado: expected, real: real, diferencia: diff, estado: level });
  });

  logAudit_(user, 'Auditoria', 'EJECUTAR_AUDITORIA', 'Auditoria_Inventario', '', 'Auditoría ejecutada');
  return { ok: true, sede: sede, fecha: fecha, resultados: results };
}

function sendDailyEmailReport(payload, token) {
  var user = getSessionUser_(token);
  payload = payload || {};
  var recipients = payload.recipients || [];
  if (!recipients.length) throw new Error('Debe enviar al menos un correo.');
  var sede = payload.sede || user.sede_asignada;
  var fecha = payload.fecha || Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');

  var auditRows = getAllAsObjects_('Auditoria_Inventario').filter(function(a) {
    return String(a.sede) === String(sede) && String(a.fecha) === String(fecha);
  });
  var alerts = getAllAsObjects_('Alertas').filter(function(a) { return String(a.estado).toUpperCase() === 'ABIERTA'; });

  var html = [];
  html.push('<h2>Reporte Diario - ' + APP_CONFIG.APP_NAME + '</h2>');
  html.push('<p><b>Fecha:</b> ' + fecha + ' | <b>Sede:</b> ' + sede + '</p>');
  html.push('<h3>Auditoría de Inventario</h3>');
  if (!auditRows.length) {
    html.push('<p>Sin datos de auditoría para la fecha seleccionada.</p>');
  } else {
    html.push('<table border=\"1\" cellspacing=\"0\" cellpadding=\"6\"><tr><th>Producto</th><th>Esperado</th><th>Real</th><th>Diferencia</th><th>Estado</th></tr>');
    auditRows.slice(0, 50).forEach(function(r) {
      html.push('<tr><td>' + r.id_producto + '</td><td>' + r.inventario_esperado + '</td><td>' + r.inventario_real + '</td><td>' + r.diferencia + '</td><td>' + r.estado_alerta + '</td></tr>');
    });
    html.push('</table>');
  }
  html.push('<h3>Alertas Abiertas</h3><ul>');
  alerts.slice(0, 20).forEach(function(a) {
    html.push('<li>[' + a.nivel + '] ' + a.tipo_alerta + ': ' + a.mensaje + '</li>');
  });
  html.push('</ul>');

  MailApp.sendEmail({
    to: recipients.join(','),
    subject: 'Reporte Diario Dilana OS - ' + sede + ' - ' + fecha,
    htmlBody: html.join('')
  });

  logAudit_(user, 'Reportes', 'ENVIAR_REPORTE_CORREO', 'Alertas', '', 'Envío de correo diario');
  return { ok: true, enviados: recipients.length };
}
