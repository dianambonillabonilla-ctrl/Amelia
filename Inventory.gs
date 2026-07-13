function registerInventoryPhysical(payload, token) {
  var user = getSessionUser_(token);
  payload = payload || {};

  var cantidad = requireNumeric(payload.cantidadFisica, 'cantidadFisica');
  var idInventario = generateId('INVF');
  var fecha = payload.fecha || Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');

  appendRow_('Inventario_Fisico', [
    idInventario,
    fecha,
    payload.sede || user.sede_asignada,
    payload.idProducto || '',
    cantidad,
    payload.unidad || 'g',
    payload.fotoUrl || '',
    payload.observacion || '',
    user.id_usuario
  ]);

  appendRow_('Inventario_Movimientos', [
    generateId('MOV'),
    nowIso(),
    'CONTEO_FISICO',
    payload.sede || user.sede_asignada,
    payload.idProducto || '',
    cantidad,
    payload.unidad || 'g',
    idInventario,
    user.id_usuario,
    payload.observacion || ''
  ]);

  logAudit_(user, 'Inventario', 'REGISTRAR_CONTEO', 'Inventario_Fisico', idInventario, 'Conteo físico registrado');
  return { ok: true, idInventario: idInventario };
}

function registerMerma(payload, token) {
  var user = getSessionUser_(token);
  payload = payload || {};
  var cantidad = requireNumeric(payload.cantidad, 'cantidad');
  var idMerma = generateId('MER');

  appendRow_('Mermas', [
    idMerma,
    nowIso(),
    payload.sede || user.sede_asignada,
    payload.idProducto || '',
    cantidad,
    payload.unidad || 'g',
    payload.motivo || 'OTRO',
    payload.fotoUrl || '',
    user.id_usuario,
    Number(payload.valorEstimado || 0),
    payload.aprobadoPor || '',
    payload.observaciones || ''
  ]);

  appendRow_('Inventario_Movimientos', [
    generateId('MOV'),
    nowIso(),
    'MERMA',
    payload.sede || user.sede_asignada,
    payload.idProducto || '',
    -Math.abs(cantidad),
    payload.unidad || 'g',
    idMerma,
    user.id_usuario,
    payload.motivo || ''
  ]);

  createAlert_('MERMA_REGISTRADA', 'MEDIA', 'Merma registrada para producto ' + (payload.idProducto || ''), payload.sede || user.sede_asignada);
  logAudit_(user, 'Mermas', 'REGISTRAR_MERMA', 'Mermas', idMerma, 'Merma registrada');

  return { ok: true, idMerma: idMerma };
}

function createTransfer(payload, token) {
  var user = getSessionUser_(token);
  payload = payload || {};
  var items = payload.items || [];
  if (!items.length) throw new Error('Debe enviar al menos un producto.');
  var idTransfer = generateId('TRF');

  appendRow_('Transferencias', [
    idTransfer,
    Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd'),
    Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'HH:mm:ss'),
    payload.origen || user.sede_asignada,
    payload.destino || '',
    user.id_usuario,
    '',
    'ENVIADA',
    payload.fotoEnvioUrl || '',
    '',
    payload.observaciones || ''
  ]);

  items.forEach(function(it) {
    var qty = requireNumeric(it.cantidadEnviada, 'cantidadEnviada');
    appendRow_('Transferencias_Detalle', [
      generateId('TRFD'),
      idTransfer,
      it.idProducto || '',
      qty,
      '',
      it.unidad || 'g',
      ''
    ]);

    appendRow_('Inventario_Movimientos', [
      generateId('MOV'),
      nowIso(),
      'TRANSFERENCIA_SALIDA',
      payload.origen || user.sede_asignada,
      it.idProducto || '',
      -Math.abs(qty),
      it.unidad || 'g',
      idTransfer,
      user.id_usuario,
      'Envío de transferencia'
    ]);
  });

  createAlert_('TRANSFERENCIA_PENDIENTE', 'MEDIA', 'Transferencia pendiente de recepción: ' + idTransfer, payload.destino || '');
  logAudit_(user, 'Transferencias', 'CREAR_TRANSFERENCIA', 'Transferencias', idTransfer, 'Transferencia creada');

  return { ok: true, idTransferencia: idTransfer };
}

function receiveTransfer(payload, token) {
  var user = getSessionUser_(token);
  payload = payload || {};
  var idTransfer = payload.idTransferencia;
  if (!idTransfer) throw new Error('idTransferencia es obligatorio.');

  var trfSheet = getSheet_('Transferencias');
  var trfData = trfSheet.getDataRange().getValues();
  var foundRow = -1;
  for (var i = 1; i < trfData.length; i++) {
    if (trfData[i][0] === idTransfer) {
      foundRow = i + 1;
      break;
    }
  }
  if (foundRow < 0) throw new Error('Transferencia no encontrada.');

  var details = payload.items || [];
  details.forEach(function(it) {
    var qty = requireNumeric(it.cantidadRecibida, 'cantidadRecibida');
    appendRow_('Inventario_Movimientos', [
      generateId('MOV'),
      nowIso(),
      'TRANSFERENCIA_ENTRADA',
      payload.sedeDestino || user.sede_asignada,
      it.idProducto || '',
      Math.abs(qty),
      it.unidad || 'g',
      idTransfer,
      user.id_usuario,
      'Recepción de transferencia'
    ]);
  });

  trfSheet.getRange(foundRow, 7).setValue(user.id_usuario);
  trfSheet.getRange(foundRow, 8).setValue(payload.estado || 'RECIBIDA');
  trfSheet.getRange(foundRow, 10).setValue(payload.fotoRecepcionUrl || '');

  logAudit_(user, 'Transferencias', 'RECIBIR_TRANSFERENCIA', 'Transferencias', idTransfer, 'Recepción registrada');
  return { ok: true };
}
