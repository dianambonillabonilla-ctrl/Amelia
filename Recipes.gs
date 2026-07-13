function recipeIndex_() {
  const recipes = {}, linesByRecipe = {}, productionByOutput = {};
  getRows_('Recipes').filter(function(r) { return String(r.active) !== 'false'; }).forEach(function(r) {
    recipes[r.recipeId] = r; if (r.type === 'PRODUCTION' && r.outputItemId) productionByOutput[r.outputItemId] = r;
  });
  getRows_('RecipeLines').forEach(function(line) { (linesByRecipe[line.recipeId] = linesByRecipe[line.recipeId] || []).push(line); });
  return { recipes:recipes, linesByRecipe:linesByRecipe, productionByOutput:productionByOutput };
}

function explodeItem_(itemId, qty, index, result, path) {
  path = path || {};
  if (path[itemId]) throw new Error('Ciclo detectado en receta para ' + itemId);
  const production = index.productionByOutput[itemId];
  if (!production) { result[itemId] = (result[itemId] || 0) + qty; return; }
  const nextPath = Object.assign({}, path); nextPath[itemId] = true;
  const factor = qty / asNumber_(production.outputQty);
  (index.linesByRecipe[production.recipeId] || []).forEach(function(line) {
    explodeItem_(line.itemId, asNumber_(line.qty) * factor, index, result, nextPath);
  });
}

function explodeRecipe_(recipeId, servings) {
  const index = recipeIndex_(), result = {};
  const recipe = index.recipes[recipeId];
  if (!recipe) return result;
  (index.linesByRecipe[recipeId] || []).filter(function(l) { return String(l.optional) !== 'true'; }).forEach(function(line) {
    explodeItem_(line.itemId, asNumber_(line.qty) * servings, index, result, {});
  });
  return result;
}

function itemAvailable_(itemId, locationId, stock, index, path) {
  path = path || {};
  if (path[itemId]) return Math.max(0, stock[itemId] || 0);
  const direct = Math.max(0, stock[itemId] || 0);
  const production = index.productionByOutput[itemId];
  if (!production) return direct;
  const nextPath = Object.assign({}, path); nextPath[itemId] = true;
  const lines = index.linesByRecipe[production.recipeId] || [];
  if (!lines.length) return direct;
  let batches = Infinity;
  lines.forEach(function(line) {
    const available = itemAvailable_(line.itemId, locationId, stock, index, nextPath);
    batches = Math.min(batches, available / asNumber_(line.qty));
  });
  return direct + Math.max(0, batches * asNumber_(production.outputQty));
}

function recipeAvailability_(locationId) {
  const stock = getStockMap_(locationId), index = recipeIndex_(), items = {};
  getRows_('Items').forEach(function(i) { items[i.itemId] = i; });
  return Object.keys(index.recipes).map(function(id) { return index.recipes[id]; }).filter(function(r) { return r.type === 'MENU'; }).map(function(recipe) {
    const lines = index.linesByRecipe[recipe.recipeId] || [];
    let capacity = Infinity, limiting = [];
    lines.filter(function(l) { return String(l.optional) !== 'true'; }).forEach(function(line) {
      const available = itemAvailable_(line.itemId, locationId, stock, index, {});
      const portions = Math.floor((available + 0.000001) / asNumber_(line.qty));
      if (portions < capacity) { capacity = portions; limiting = [items[line.itemId] ? items[line.itemId].name : line.itemId]; }
      else if (portions === capacity) limiting.push(items[line.itemId] ? items[line.itemId].name : line.itemId);
    });
    if (!isFinite(capacity)) capacity = 0;
    return { recipeId:recipe.recipeId,name:recipe.name,available:Math.max(0,capacity),limiting:limiting.join(', '),source:'Inventario actual + Estandarización Productos' };
  }).sort(function(a,b) { return a.name.localeCompare(b.name); });
}

function expectedConsumption_(date, locationId, flattenProduction) {
  const sales = getRows_('Sales').filter(function(s) { return dateKey_(s.saleDate) === date && s.locationId === locationId && s.cancelled !== true && String(s.cancelled).toLowerCase() !== 'true' && s.saleStatus === 'Cerrada'; });
  const modifiers = getRows_('SaleModifiers').filter(function(s) { return dateKey_(s.saleDate) === date && s.locationId === locationId && s.cancelled !== true && String(s.cancelled).toLowerCase() !== 'true'; });
  const result = {}, productSummary = {};
  sales.forEach(function(s) {
    productSummary[s.productName] = (productSummary[s.productName] || 0) + asNumber_(s.qty);
    if (s.mappingType === 'RECIPE') {
      const exploded = consumptionForRecipe_(s.mappingId, asNumber_(s.qty), flattenProduction);
      Object.keys(exploded).forEach(function(itemId) { result[itemId] = (result[itemId] || 0) + exploded[itemId]; });
    } else if (s.mappingType === 'ITEM') result[s.mappingId] = (result[s.mappingId] || 0) + asNumber_(s.qty);
  });
  modifiers.forEach(function(s) {
    if (s.mappingType === 'RECIPE') {
      const exploded = consumptionForRecipe_(s.mappingId, asNumber_(s.qty), flattenProduction);
      Object.keys(exploded).forEach(function(itemId) { result[itemId] = (result[itemId] || 0) + exploded[itemId]; });
    } else if (s.mappingType === 'ITEM') result[s.mappingId] = (result[s.mappingId] || 0) + asNumber_(s.qty);
  });
  return { items:result, products:productSummary, salesRows:sales.length, modifierRows:modifiers.length };
}

function consumptionForRecipe_(recipeId, servings, flattenProduction) {
  if (flattenProduction) return explodeRecipe_(recipeId, servings);
  const result = {};
  getRows_('RecipeLines').filter(function(line) { return line.recipeId === recipeId && String(line.optional) !== 'true'; }).forEach(function(line) {
    result[line.itemId] = (result[line.itemId] || 0) + asNumber_(line.qty) * servings;
  });
  return result;
}
