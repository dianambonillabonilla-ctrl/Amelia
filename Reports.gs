function bootstrap_(token) {
  const user=requireUser_(token);
  const locations=getRows_('Locations').filter(function(l){return String(l.active)!=='false'&&canAccessLocation_(user,l.locationId);});
  const items=getRows_('Items').filter(function(i){return String(i.active)!=='false';}).map(function(i){return {itemId:i.itemId,name:i.name,category:i.category,baseUnit:i.baseUnit,minimumStock:asNumber_(i.minimumStock)};});
  const productionRecipes=getRows_('Recipes').filter(function(r){return r.type==='PRODUCTION'&&String(r.active)!=='false';});
  const imports=getRows_('Imports').slice(-10).reverse();
  const alerts=getRows_('Alerts').filter(function(a){return a.status==='OPEN'&&(!a.locationId||canAccessLocation_(user,a.locationId));}).slice(-20).reverse();
  return {app:{name:AMELIA.NAME,version:AMELIA.VERSION},user:publicUser_(user),locations:locations,items:items,
    productionRecipes:productionRecipes,recipes:getRows_('Recipes').filter(function(r){return String(r.active)!=='false';}),
    imports:imports,alerts:alerts,roles:AMELIA.ROLES,today:dateKey_(new Date())};
}

function dashboard_(token,locationId) {
  const user=requireUser_(token); requireLocation_(user,locationId);
  const items={}; getRows_('Items').forEach(function(i){items[i.itemId]=i;});
  const stock=getStockMap_(locationId);
  const inventory=Object.keys(items).map(function(id){return {itemId:id,name:items[id].name,category:items[id].category,unit:items[id].baseUnit,
    stock:round_(stock[id]||0,3),minimum:asNumber_(items[id].minimumStock),source:'Libro de movimientos por sede'};});
  const negative=inventory.filter(function(i){return i.stock<0;});
  const low=inventory.filter(function(i){return i.minimum>0&&i.stock<=i.minimum;});
  return {locationId:locationId,inventory:inventory,availability:recipeAvailability_(locationId),negativeCount:negative.length,lowCount:low.length,
    openAlerts:getRows_('Alerts').filter(function(a){return a.status==='OPEN'&&(!a.locationId||a.locationId===locationId);}).length,
    lastImport:getRows_('Imports').slice(-1)[0]||null};
}

function dailyAnalysis_(token,date,locationId) {
  const user=requireUser_(token); requireLocation_(user,locationId);
  const items={};getRows_('Items').forEach(function(i){items[i.itemId]=i;});
  const expected=expectedConsumption_(date,locationId,false);
  const rawEquivalent=expectedConsumption_(date,locationId,true);
  const counts=getRows_('Counts').filter(function(c){return c.locationId===locationId;});
  const opening={},closing={};
  counts.forEach(function(c){
    const d=dateKey_(c.countDate);
    if(d<date&&(!opening[c.itemId]||d>opening[c.itemId].date))opening[c.itemId]={date:d,qty:asNumber_(c.qty),source:'Conteo físico'};
    if(d===date)closing[c.itemId]={date:d,qty:asNumber_(c.qty),source:'Conteo físico'};
  });
  const knownMovements={};
  getRows_('Movements').filter(function(m){return m.locationId===locationId&&dateKey_(m.date)===date&&m.type!==MOVEMENT_TYPES.SALE&&m.type!==MOVEMENT_TYPES.COUNT_ADJUSTMENT;}).forEach(function(m){
    knownMovements[m.itemId]=(knownMovements[m.itemId]||0)+movementSign_(m.type)*asNumber_(m.qty);
  });
  const ids={};Object.keys(expected.items).forEach(function(id){ids[id]=true;});Object.keys(opening).forEach(function(id){ids[id]=true;});Object.keys(closing).forEach(function(id){ids[id]=true;});
  const rows=Object.keys(ids).map(function(itemId){
    const op=opening[itemId],cl=closing[itemId],cons=expected.items[itemId]||0,known=knownMovements[itemId]||0;
    const projected=op?op.qty+known-cons:null;const difference=cl&&projected!==null?cl.qty-projected:null;
    return {itemId:itemId,name:items[itemId]?items[itemId].name:itemId,unit:items[itemId]?items[itemId].baseUnit:'',opening:op?round_(op.qty,3):null,
      openingDate:op?op.date:'',knownMovements:round_(known,3),expectedConsumption:round_(cons,3),projectedClosing:projected===null?null:round_(projected,3),
      physicalClosing:cl?round_(cl.qty,3):null,difference:difference===null?null:round_(difference,3),
      status:!op?'MISSING_OPENING':!cl?'MISSING_CLOSING':Math.abs(difference)<=0.01?'MATCH':difference>0?'ENTRY_REQUIRED':'EXTRA_USE',
      sources:{opening:op?'Conteo físico '+op.date:'Faltante',consumption:'FUDO Ventas + Estandarización Productos',movements:'Compras/producción/traslados/mermas',closing:cl?'Conteo físico '+date:'Faltante'}};
  }).sort(function(a,b){return a.name.localeCompare(b.name);});
  const products=Object.keys(expected.products).map(function(name){return {name:name,qty:expected.products[name]};}).sort(function(a,b){return b.qty-a.qty;});
  const missingClosing=rows.filter(function(r){return r.status==='MISSING_CLOSING';}).length;
  const differences=rows.filter(function(r){return ['ENTRY_REQUIRED','EXTRA_USE'].indexOf(r.status)>=0;});
  const location=findRow_('Locations',function(l){return l.locationId===locationId;});
  const narrative=[];
  narrative.push('FUDO registró '+products.reduce(function(s,p){return s+p.qty;},0)+' unidades de productos cerrados con receta o inventario en '+(location?location.name:locationId)+'.');
  narrative.push('El consumo esperado se calculó con las recetas vigentes y los modificadores importados; los pesos de comida no provienen de FUDO.');
  if(missingClosing) narrative.push('Faltan '+missingClosing+' conteos de cierre, por lo que esas líneas son proyecciones y no conciliaciones físicas.');
  if(differences.length) narrative.push('Hay '+differences.length+' diferencias que requieren producción, compra, traslado, merma o corrección de conteo.');
  else if(!missingClosing) narrative.push('Los insumos contados coinciden con el movimiento esperado dentro de la tolerancia.');
  const rawRows=Object.keys(rawEquivalent.items).map(function(itemId){return {itemId:itemId,name:items[itemId]?items[itemId].name:itemId,
    qty:round_(rawEquivalent.items[itemId],3),unit:items[itemId]?items[itemId].baseUnit:'',source:'Recetas expandidas hasta insumos base'};}).sort(function(a,b){return a.name.localeCompare(b.name);});
  return {date:date,locationId:locationId,products:products,rows:rows,rawEquivalent:rawRows,narrative:narrative,sources:[
    {name:'Ventas y cancelaciones',source:'FUDO Ventas importado'},
    {name:'Gramajes',source:'Estandarización Productos / Recetario'},
    {name:'Apertura y cierre',source:'Conteos físicos por sede'},
    {name:'Entradas y salidas',source:'Movimientos registrados en Amelia'}]};
}

function round_(n,d){const p=Math.pow(10,d||0);return Math.round((n+Number.EPSILON)*p)/p;}
