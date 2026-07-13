function uploadReport_(token, payload) {
  const user = requireUser_(token, [AMELIA.ROLES.ADMIN, AMELIA.ROLES.MANAGER]);
  if (!payload || !payload.fileName || !payload.dataUrl) throw new Error('Selecciona un archivo.');
  const base64 = String(payload.dataUrl).split(',').pop();
  const bytes = Utilities.base64Decode(base64);
  if (bytes.length > AMELIA.MAX_UPLOAD_BYTES) throw new Error('El archivo supera el límite de 10 MB.');
  const hash = bytesToHex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, bytes));
  const duplicate = findRow_('Imports', function(r) { return r.fileHash === hash && r.status !== 'ERROR'; });
  if (duplicate) throw new Error('Este archivo ya fue cargado el ' + duplicate.createdAt + '.');
  const mime = payload.mimeType || MimeType.MICROSOFT_EXCEL;
  const blob = Utilities.newBlob(bytes, mime, payload.fileName);
  const folder = DriveApp.getFolderById(PropertiesService.getScriptProperties().getProperty(AMELIA.UPLOAD_FOLDER_PROPERTY));
  const original = folder.createFile(blob);
  const importId = makeId_('imp');
  const row = {
    importId:importId,reportDate:dateKey_(payload.reportDate),sourceType:payload.sourceType || 'FUDO_OTHER',fileName:payload.fileName,
    fileHash:hash,originalFileId:original.getId(),convertedFileId:'',status:'UPLOADED',rowsRead:0,rowsImported:0,pendingRows:0,
    unmappedRows:0,notes:'',userId:user.userId,createdAt:nowIso_()
  };
  appendRow_('Imports',row);
  try {
    const converted = Drive.Files.create({ name:'CONVERTIDO - '+payload.fileName, mimeType:'application/vnd.google-apps.spreadsheet', parents:[folder.getId()] }, blob, { fields:'id' });
    row.convertedFileId = converted.id;
    if (row.sourceType === 'FUDO_VENTAS') {
      const result = parseFudoSales_(user, row, converted.id, payload.defaultLocationId || '');
      Object.assign(row,result,{status:'PROCESSED'});
    } else {
      row.status = 'STORED_REVIEW';
      row.notes = 'Archivo conservado como evidencia. Solo FUDO Ventas genera consumos automáticos; stock, movimientos y gastos requieren revisión para no duplicar inventario.';
      createAlert_({date:row.reportDate,severity:'LOW',type:'IMPORT_REVIEW',title:'Archivo pendiente de revisión: '+payload.fileName,
        detail:row.notes,referenceType:'IMPORT',referenceId:importId,source:row.sourceType});
    }
    upsertRow_('Imports','importId',row);
    audit_(user.userId,'UPLOAD_IMPORT','IMPORT',importId,{fileName:payload.fileName,sourceType:row.sourceType,status:row.status});
    return row;
  } catch (err) {
    row.status='ERROR'; row.notes=err.message; upsertRow_('Imports','importId',row);
    throw err;
  }
}

function parseFudoSales_(user, importRow, spreadsheetId, defaultLocationId) {
  const book = SpreadsheetApp.openById(spreadsheetId);
  const salesSheet = book.getSheetByName('Ventas');
  const additionsSheet = book.getSheetByName('Adiciones');
  const modifiersSheet = book.getSheetByName('Adiciones de Modificadores');
  if (!salesSheet || !additionsSheet) throw new Error('El archivo no contiene las hojas Ventas y Adiciones esperadas.');
  const saleTable = tableFromSheet_(salesSheet,['Id','Caja','Estado']);
  const additionTable = tableFromSheet_(additionsSheet,['Id. Venta','Producto','Cantidad','Cancelada']);
  const modifierTable = modifiersSheet ? tableFromSheet_(modifiersSheet,['Id. Venta','Producto','Modificador','Cantidad','Cancelada']) : [];
  const saleMeta = {};
  saleTable.forEach(function(s) {
    saleMeta[String(s['Id'])] = { documentNo:s['N° Doc.'] || '', locationId:locationIdFromFudo_(s['Caja']) || defaultLocationId,
      status:String(s['Estado'] || ''), created:s['Creación'] || s['Fecha'] || '', date:dateKey_(s['Fecha'] || s['Creación']) };
  });
  const aliasIndex = {};
  getRows_('Aliases').filter(function(a) { return a.source === 'FUDO' && String(a.active) !== 'false'; }).forEach(function(a) { aliasIndex[a.normalizedName] = a; });
  const salesRows=[], modifierRows=[], movementRows=[];
  let pending=0, unmapped=0;
  additionTable.forEach(function(a,index) {
    const meta=saleMeta[String(a['Id. Venta'])] || {locationId:defaultLocationId,status:'DESCONOCIDA',date:importRow.reportDate,created:''};
    const cancelled=isYes_(a['Cancelada']); const alias=aliasIndex[normalizeText_(a['Producto'])];
    const saleLineId=importRow.importId+'_sale_'+index;
    const row={saleLineId:saleLineId,importId:importRow.importId,saleId:String(a['Id. Venta']||''),documentNo:meta.documentNo,
      saleDate:meta.date||importRow.reportDate,createdAtSource:dateKey_(a['Creación'])||meta.created,locationId:meta.locationId,saleStatus:meta.status,
      productName:String(a['Producto']||''),category:String(a['Categoría']||''),qty:asNumber_(a['Cantidad']),cancelled:cancelled,
      mappingType:alias?alias.entityType:'',mappingId:alias?alias.entityId:'',source:'FUDO_VENTAS',createdAt:nowIso_()};
    salesRows.push(row);
    if (cancelled) return;
    if (meta.status !== 'Cerrada') { pending += asNumber_(a['Cantidad']); createAlert_({date:row.saleDate,locationId:row.locationId,severity:'MEDIUM',type:'PENDING_SALE',
      title:'Venta no cerrada: '+row.productName,detail:'La venta '+row.saleId+' está en estado '+meta.status+'. No se descontó del inventario.',referenceType:'SALE',referenceId:saleLineId,source:'FUDO_VENTAS'}); return; }
    if (!row.locationId) { pending++; createAlert_({date:row.saleDate,severity:'HIGH',type:'MISSING_LOCATION',title:'Venta sin sede: '+row.productName,
      detail:'La venta '+row.saleId+' no tiene caja/sede. No se descontó.',referenceType:'SALE',referenceId:saleLineId,source:'FUDO_VENTAS'}); return; }
    if (!alias) { unmapped++; createAlert_({date:row.saleDate,locationId:row.locationId,severity:'HIGH',type:'UNMAPPED_PRODUCT',title:'Producto FUDO sin equivalencia',
      detail:row.productName+' no está asociado a un insumo o receta.',referenceType:'SALE',referenceId:saleLineId,source:'FUDO_VENTAS'}); return; }
    Array.prototype.push.apply(movementRows, movementsForMapping_(user,row.locationId,row.saleDate,alias,asNumber_(row.qty),'SALE',saleLineId));
  });
  modifierTable.forEach(function(m,index) {
    const meta=saleMeta[String(m['Id. Venta'])] || {locationId:defaultLocationId,status:'DESCONOCIDA',date:importRow.reportDate};
    const cancelled=isYes_(m['Cancelada']); const alias=aliasIndex[normalizeText_(m['Modificador'])];
    const id=importRow.importId+'_mod_'+index;
    const row={modifierLineId:id,importId:importRow.importId,saleId:String(m['Id. Venta']||''),saleDate:meta.date||importRow.reportDate,
      locationId:meta.locationId,parentProduct:String(m['Producto']||''),groupName:String(m['Grupo modificador']||''),modifierName:String(m['Modificador']||''),
      qty:asNumber_(m['Cantidad']),cancelled:cancelled,mappingType:alias?alias.entityType:'',mappingId:alias?alias.entityId:'',source:'FUDO_VENTAS',createdAt:nowIso_()};
    modifierRows.push(row);
    if (cancelled || meta.status !== 'Cerrada' || !meta.locationId) return;
    if (!alias) { unmapped++; createAlert_({date:row.saleDate,locationId:row.locationId,severity:'MEDIUM',type:'UNMAPPED_MODIFIER',title:'Modificador sin equivalencia',
      detail:row.modifierName+' no está asociado a una receta.',referenceType:'SALE_MODIFIER',referenceId:id,source:'FUDO_VENTAS'}); return; }
    Array.prototype.push.apply(movementRows,movementsForMapping_(user,row.locationId,row.saleDate,alias,asNumber_(row.qty),'SALE_MODIFIER',id));
  });
  appendRows_('Sales',salesRows); appendRows_('SaleModifiers',modifierRows); appendRows_('Movements',movementRows);
  return {rowsRead:additionTable.length+modifierTable.length,rowsImported:salesRows.length+modifierRows.length,pendingRows:pending,unmappedRows:unmapped,
    notes:'Ventas cerradas descontadas. Canceladas y pendientes conservadas sin afectar inventario.'};
}

function movementsForMapping_(user,locationId,date,alias,qty,referenceType,referenceId) {
  if (alias.entityType === 'ITEM') return [movementRow_(user,{date:date,locationId:locationId,itemId:alias.entityId,qty:qty,type:MOVEMENT_TYPES.SALE,
    referenceType:referenceType,referenceId:referenceId,reason:'Venta importada desde FUDO',source:'FUDO_VENTAS'})];
  if (alias.entityType !== 'RECIPE') return [];
  const lines=getRows_('RecipeLines').filter(function(l){return l.recipeId===alias.entityId && String(l.optional)!=='true';});
  return lines.map(function(line){return movementRow_(user,{date:date,locationId:locationId,itemId:line.itemId,qty:asNumber_(line.qty)*qty,
    type:MOVEMENT_TYPES.SALE,referenceType:referenceType,referenceId:referenceId,reason:'Consumo esperado por receta FUDO',source:'FUDO_VENTAS'});});
}

function tableFromSheet_(sheet, requiredHeaders) {
  const values=sheet.getDataRange().getValues(); let headerIndex=-1;
  for(let r=0;r<Math.min(values.length,10);r++){
    const normalized=values[r].map(normalizeText_);
    if(requiredHeaders.every(function(h){return normalized.indexOf(normalizeText_(h))>=0;})){headerIndex=r;break;}
  }
  if(headerIndex<0) throw new Error('No se encontraron columnas requeridas en '+sheet.getName()+': '+requiredHeaders.join(', '));
  const headers=values[headerIndex].map(function(h){return String(h||'').trim();});
  return values.slice(headerIndex+1).filter(function(row){return row.some(function(v){return v!=='';});}).map(function(row){
    const out={};headers.forEach(function(h,i){if(h)out[h]=row[i];});return out;
  });
}

function locationIdFromFudo_(value) {
  const n=normalizeText_(value);
  if(n.indexOf('capri')>=0)return 'capri';
  if(n.indexOf('san antonio')>=0)return 'san_antonio';
  return '';
}

function isYes_(value){const n=normalizeText_(value);return n==='si'||n==='sí'||n==='true'||n==='yes';}
function bytesToHex_(bytes){return bytes.map(function(b){const v=b<0?b+256:b;return('0'+v.toString(16)).slice(-2);}).join('');}
