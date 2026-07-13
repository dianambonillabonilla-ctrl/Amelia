function saveItem_(token,data){
  const user=requireUser_(token,[AMELIA.ROLES.ADMIN,AMELIA.ROLES.MANAGER]);
  if(!data.name||!data.category||!data.baseUnit)throw new Error('Nombre, categoría y unidad son obligatorios.');
  const existing=data.itemId?findRow_('Items',function(i){return i.itemId===data.itemId;}):null;
  const itemId=existing?existing.itemId:'itm_'+normalizeText_(data.name).replace(/[^a-z0-9]+/g,'_').replace(/^_|_$/g,'')+'_'+Utilities.getUuid().slice(0,6);
  const row={itemId:itemId,name:String(data.name).trim(),category:String(data.category).trim().toUpperCase(),baseUnit:String(data.baseUnit).trim(),
    active:data.active===false?false:true,minimumStock:asNumber_(data.minimumStock),notes:data.notes||'',createdAt:existing?existing.createdAt:nowIso_(),updatedAt:nowIso_()};
  upsertRow_('Items','itemId',row);audit_(user.userId,existing?'UPDATE_ITEM':'CREATE_ITEM','ITEM',itemId,row);return row;
}

function saveRecipeDefinition_(token,data){
  const user=requireUser_(token,[AMELIA.ROLES.ADMIN]);
  if(!data.name||!data.type||!data.lines||!data.lines.length)throw new Error('La receta necesita nombre, tipo e ingredientes.');
  const recipeId=data.recipeId||'rcp_'+normalizeText_(data.name).replace(/[^a-z0-9]+/g,'_').replace(/^_|_$/g,'')+'_'+Utilities.getUuid().slice(0,6);
  const existing=findRow_('Recipes',function(r){return r.recipeId===recipeId;});
  if(data.type==='PRODUCTION'&&(!data.outputItemId||asNumber_(data.outputQty)<=0))throw new Error('Una producción necesita producto de salida y cantidad.');
  const row={recipeId:recipeId,name:String(data.name).trim(),type:data.type,outputItemId:data.outputItemId||'',outputQty:asNumber_(data.outputQty)||1,
    outputUnit:data.outputUnit||'u',active:true,notes:data.notes||'',createdAt:existing?existing.createdAt:nowIso_(),updatedAt:nowIso_()};
  upsertRow_('Recipes','recipeId',row);
  if(existing){
    const sheet=getTable_('RecipeLines'),values=sheet.getDataRange().getValues(),recipeCol=TABLES.RecipeLines.indexOf('recipeId');
    for(let r=values.length-1;r>=1;r--)if(String(values[r][recipeCol])===recipeId)sheet.deleteRow(r+1);
  }
  const lines=data.lines.filter(function(l){return l.itemId&&asNumber_(l.qty)>0;}).map(function(l){
    const item=findRow_('Items',function(i){return i.itemId===l.itemId;});if(!item)throw new Error('Insumo inválido en receta.');
    return {lineId:makeId_('rln'),recipeId:recipeId,itemId:l.itemId,qty:asNumber_(l.qty),unit:item.baseUnit,optional:!!l.optional,source:'CATALOG_ADMIN',createdAt:nowIso_()};
  });
  if(!lines.length)throw new Error('Agrega al menos un ingrediente válido.');appendRows_('RecipeLines',lines);
  audit_(user.userId,existing?'UPDATE_RECIPE':'CREATE_RECIPE','RECIPE',recipeId,{recipe:row,lines:lines});return row;
}

function saveAlias_(token,data){
  const user=requireUser_(token,[AMELIA.ROLES.ADMIN]);
  if(!data.externalName||!data.entityType||!data.entityId)throw new Error('Completa el nombre FUDO y su equivalencia.');
  const id='als_'+Utilities.base64EncodeWebSafe(normalizeText_(data.externalName)).replace(/=/g,'').slice(0,30);
  const row={aliasId:id,source:'FUDO',externalName:String(data.externalName).trim(),normalizedName:normalizeText_(data.externalName),
    entityType:data.entityType,entityId:data.entityId,active:true,createdAt:nowIso_()};
  upsertRow_('Aliases','aliasId',row);audit_(user.userId,'SAVE_ALIAS','ALIAS',id,row);return row;
}
