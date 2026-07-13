function getStockMap_(locationId) {
  const stock = {};
  getRows_('Movements').forEach(function(row) {
    if (locationId && row.locationId !== locationId) return;
    const signed = movementSign_(row.type) * asNumber_(row.qty);
    stock[row.itemId] = (stock[row.itemId] || 0) + signed;
  });
  return stock;
}

function movementRow_(user, data) {
  const item = findRow_('Items', function(r) { return r.itemId === data.itemId && String(r.active) !== 'false'; });
  if (!item) throw new Error('Insumo inválido: ' + data.itemId);
  const qty = asNumber_(data.qty);
  if (!qty && data.type !== MOVEMENT_TYPES.ADJUSTMENT && data.type !== MOVEMENT_TYPES.COUNT_ADJUSTMENT) throw new Error('La cantidad debe ser mayor que cero.');
  return {
    movementId: makeId_('mov'), date: dateKey_(data.date || new Date()), timestamp: data.timestamp || nowIso_(),
    locationId: data.locationId, itemId: data.itemId, type: data.type,
    qty: [MOVEMENT_TYPES.ADJUSTMENT, MOVEMENT_TYPES.COUNT_ADJUSTMENT].indexOf(data.type) >= 0 ? qty : Math.abs(qty), unit: item.baseUnit,
    provider:data.provider||'',documentNo:data.documentNo||'',unitCost:asNumber_(data.unitCost),totalCost:asNumber_(data.totalCost)||Math.abs(qty)*asNumber_(data.unitCost),
    referenceType: data.referenceType || '', referenceId: data.referenceId || '', reason: data.reason || '',
    source: data.source || 'MANUAL', userId: user.userId, createdAt: nowIso_()
  };
}

function saveMovement_(token, data) {
  const user = requireUser_(token, [AMELIA.ROLES.ADMIN, AMELIA.ROLES.MANAGER, AMELIA.ROLES.COUNTER]);
  requireLocation_(user, data.locationId);
  const allowed = [MOVEMENT_TYPES.PURCHASE, MOVEMENT_TYPES.WASTE, MOVEMENT_TYPES.ADJUSTMENT];
  if (allowed.indexOf(data.type) < 0) throw new Error('Tipo de movimiento manual inválido.');
  if (data.type === MOVEMENT_TYPES.WASTE && !data.reason) throw new Error('La merma debe tener un motivo.');
  const row = movementRow_(user, data);
  appendRow_('Movements', row);
  audit_(user.userId, 'CREATE_MOVEMENT', 'MOVEMENT', row.movementId, row);
  return row;
}

function saveTransfer_(token, data) {
  const user = requireUser_(token, [AMELIA.ROLES.ADMIN, AMELIA.ROLES.MANAGER]);
  if (data.fromLocationId === data.toLocationId) throw new Error('Las sedes deben ser diferentes.');
  requireLocation_(user, data.fromLocationId); requireLocation_(user, data.toLocationId);
  const ref = makeId_('trf');
  const out = movementRow_(user, { date:data.date, locationId:data.fromLocationId, itemId:data.itemId, qty:data.qty,
    type:MOVEMENT_TYPES.TRANSFER_OUT, referenceType:'TRANSFER', referenceId:ref, reason:data.reason, source:'MANUAL' });
  const incoming = movementRow_(user, { date:data.date, locationId:data.toLocationId, itemId:data.itemId, qty:data.qty,
    type:MOVEMENT_TYPES.TRANSFER_IN, referenceType:'TRANSFER', referenceId:ref, reason:data.reason, source:'MANUAL' });
  appendRows_('Movements',[out,incoming]);
  audit_(user.userId,'CREATE_TRANSFER','TRANSFER',ref,data);
  return { referenceId:ref, out:out, incoming:incoming };
}

function saveProduction_(token, data) {
  const user = requireUser_(token, [AMELIA.ROLES.ADMIN, AMELIA.ROLES.MANAGER]);
  requireLocation_(user, data.locationId);
  const recipe = findRow_('Recipes', function(r) { return r.recipeId === data.recipeId && r.type === 'PRODUCTION' && String(r.active) !== 'false'; });
  if (!recipe) throw new Error('Receta de producción inválida.');
  const outputQty = asNumber_(data.outputQty);
  if (outputQty <= 0) throw new Error('La cantidad producida debe ser mayor que cero.');
  const scale = outputQty / asNumber_(recipe.outputQty);
  const lines = getRows_('RecipeLines').filter(function(r) { return r.recipeId === recipe.recipeId; });
  if (!lines.length) throw new Error('La receta no tiene ingredientes.');
  const ref = makeId_('prd');
  const stock = getStockMap_(data.locationId);
  lines.forEach(function(line) {
    const needed = asNumber_(line.qty) * scale;
    if ((stock[line.itemId] || 0) + 0.000001 < needed) {
      const item = findRow_('Items', function(i) { return i.itemId === line.itemId; });
      throw new Error('No alcanza ' + (item ? item.name : line.itemId) + '. Necesitas ' + needed.toFixed(2) + ' ' + line.unit + '.');
    }
  });
  const movements = lines.map(function(line) { return movementRow_(user, { date:data.date,locationId:data.locationId,itemId:line.itemId,
    qty:asNumber_(line.qty)*scale,type:MOVEMENT_TYPES.PRODUCTION_INPUT,referenceType:'PRODUCTION',referenceId:ref,reason:data.notes,source:'PRODUCTION' }); });
  movements.push(movementRow_(user,{ date:data.date,locationId:data.locationId,itemId:recipe.outputItemId,qty:outputQty,
    type:MOVEMENT_TYPES.PRODUCTION_OUTPUT,referenceType:'PRODUCTION',referenceId:ref,reason:data.notes,source:'PRODUCTION' }));
  appendRows_('Movements',movements);
  audit_(user.userId,'CREATE_PRODUCTION','PRODUCTION',ref,{ recipeId:recipe.recipeId, outputQty:outputQty, locationId:data.locationId });
  return { referenceId:ref, movements:movements };
}

function saveCount_(token, data) {
  const user = requireUser_(token, [AMELIA.ROLES.ADMIN, AMELIA.ROLES.MANAGER, AMELIA.ROLES.COUNTER]);
  requireLocation_(user, data.locationId);
  if (!data.rows || !data.rows.length) throw new Error('No hay conteos para guardar.');
  return withLock_(function() {
    const stock = getStockMap_(data.locationId);
    const countId = makeId_('cnt');
    const countRows = [], movements = [];
    data.rows.forEach(function(input) {
      if (input.qty === '' || input.qty === null || input.qty === undefined) return;
      const item = findRow_('Items', function(i) { return i.itemId === input.itemId; });
      if (!item) return;
      const counted = asNumber_(input.qty), current = stock[input.itemId] || 0, difference = counted - current;
      countRows.push({ countId:countId + '_' + input.itemId, countDate:dateKey_(data.countDate), timestamp:nowIso_(),
        locationId:data.locationId,itemId:input.itemId,qty:counted,unit:item.baseUnit,difference:difference,source:'PHYSICAL_COUNT',userId:user.userId,createdAt:nowIso_() });
      if (Math.abs(difference) > 0.000001) movements.push(movementRow_(user,{ date:data.countDate,locationId:data.locationId,itemId:input.itemId,
        qty:difference,type:MOVEMENT_TYPES.COUNT_ADJUSTMENT,referenceType:'COUNT',referenceId:countId,
        reason:'Ajuste contra conteo físico: '+current+' → '+counted,source:'PHYSICAL_COUNT' }));
      if (difference < -Math.max(1, Math.abs(current) * 0.1)) createAlert_({date:dateKey_(data.countDate),locationId:data.locationId,severity:'HIGH',
        type:'COUNT_DIFFERENCE',title:'Diferencia importante en '+item.name,detail:'El conteo quedó '+Math.abs(difference).toFixed(2)+' '+item.baseUnit+' por debajo del sistema.',referenceType:'COUNT',referenceId:countId,source:'PHYSICAL_COUNT'});
    });
    appendRows_('Counts',countRows); appendRows_('Movements',movements);
    audit_(user.userId,'SAVE_COUNT','COUNT',countId,{ locationId:data.locationId, rows:countRows.length });
    return { countId:countId, rows:countRows.length, adjustments:movements.length };
  });
}
