function registerPurchase(payload, token) {
  var user = getSessionUser_(token);
  payload = payload || {};
  var items = payload.items || [];
  if (!items.length) throw new Error('Compra sin detalle de productos.');

  var idCompra = generateId('COM');
  var total = 0;
  items.forEach(function(it) {
    total += Number(it.valorTotalLinea || 0);
  });

  appendRow_('Compras', [
    idCompra,
    Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd'),
    Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'HH:mm:ss'),
    user.id_usuario,
    payload.proveedor || '',
    payload.numeroFactura || '',
    payload.fotoFacturaUrl || '',
    payload.sedeEntrada || user.sede_asignada,
    Number(payload.subtotal || total),
    Number(payload.iva || 0),
    Number(payload.descuento || 0),
    Number(payload.total || total),
    payload.estado || 'REGISTRADA',
    payload.observaciones || ''
  ]);

  items.forEach(function(it) {
    var qtyBase = requireNumeric(it.cantidadBase, 'cantidadBase');
    var precioUnit = Number(it.valorUnitarioBase || 0);
    appendRow_('Detalle_Compras', [
      generateId('COD'),
      idCompra,
      it.idProducto || '',
      Number(it.cantidadComprada || 0),
      it.unidadComprada || '',
      qtyBase,
      Number(it.valorTotalLinea || 0),
      precioUnit
    ]);

    appendRow_('Inventario_Movimientos', [
      generateId('MOV'),
      nowIso(),
      'COMPRA_ENTRADA',
      payload.sedeEntrada || user.sede_asignada,
      it.idProducto || '',
      qtyBase,
      it.unidadBase || 'g',
      idCompra,
      user.id_usuario,
      'Entrada por compra'
    ]);

    appendRow_('Historial_Precios', [
      generateId('HPR'),
      nowIso(),
      it.idProducto || '',
      payload.proveedor || '',
      precioUnit,
      idCompra
    ]);
  });

  logAudit_(user, 'Compras', 'REGISTRAR_COMPRA', 'Compras', idCompra, 'Compra registrada');
  return { ok: true, idCompra: idCompra };
}

function registerProductionLot(payload, token) {
  var user = getSessionUser_(token);
  payload = payload || {};
  var idLote = generateId('LOT');
  var qtyReal = requireNumeric(payload.cantidadReal, 'cantidadReal');
  var insumos = payload.insumos || [];

  appendRow_('Produccion_Lotes', [
    idLote,
    Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd'),
    payload.horaInicio || Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'HH:mm:ss'),
    payload.horaFin || '',
    user.id_usuario,
    payload.idProductoProducido || '',
    Number(payload.cantidadEsperada || 0),
    qtyReal,
    payload.unidad || 'g',
    payload.fotoUrl || '',
    Number(payload.mermaCalculada || 0),
    payload.estado || 'TERMINADA',
    payload.observaciones || ''
  ]);

  insumos.forEach(function(it) {
    var qty = requireNumeric(it.cantidadReal || it.cantidadTeorica, 'cantidadInsumo');
    appendRow_('Produccion_Detalle', [
      generateId('PRD'),
      idLote,
      it.idInsumo || '',
      Number(it.cantidadTeorica || qty),
      qty,
      it.unidad || 'g'
    ]);

    appendRow_('Inventario_Movimientos', [
      generateId('MOV'),
      nowIso(),
      'PRODUCCION_CONSUMO',
      payload.sede || user.sede_asignada,
      it.idInsumo || '',
      -Math.abs(qty),
      it.unidad || 'g',
      idLote,
      user.id_usuario,
      'Consumo en producción'
    ]);
  });

  appendRow_('Inventario_Movimientos', [
    generateId('MOV'),
    nowIso(),
    'PRODUCCION_ENTRADA',
    payload.sede || user.sede_asignada,
    payload.idProductoProducido || '',
    Math.abs(qtyReal),
    payload.unidad || 'g',
    idLote,
    user.id_usuario,
    'Salida de lote de producción'
  ]);

  logAudit_(user, 'Produccion', 'REGISTRAR_LOTE', 'Produccion_Lotes', idLote, 'Lote registrado');
  return { ok: true, idLote: idLote };
}
