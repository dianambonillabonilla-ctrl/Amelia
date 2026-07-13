const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const root = path.join(__dirname, '..');
const context = { console, PropertiesService:{}, Utilities:{}, SpreadsheetApp:{}, LockService:{} };
vm.createContext(context);
const code = ['Config.gs','Db.gs','Recipes.gs'].map(f => fs.readFileSync(path.join(root,f),'utf8')).join('\n') +
  '\nthis.__test={normalizeText_,asNumber_,movementSign_,explodeRecipe_,itemAvailable_};';
vm.runInContext(code, context);
const f = context.__test;

test('normaliza nombres de FUDO sin acentos ni espacios duplicados', () => {
  assert.equal(f.normalizeText_('  Cebollita   de Amélia '), 'cebollita de amelia');
});

test('convierte números colombianos y decimales web', () => {
  assert.equal(f.asNumber_('1.754,38 kg'), 1754.38);
  assert.equal(f.asNumber_('123.287'), 123.287);
});

test('aplica signo correcto a entradas y salidas', () => {
  assert.equal(f.movementSign_('PURCHASE'), 1);
  assert.equal(f.movementSign_('SALE'), -1);
  assert.equal(f.movementSign_('WASTE'), -1);
});

test('expande Papas Listas a insumos base', () => {
  const recipes = [
    {recipeId:'menu',type:'MENU'},
    {recipeId:'prod',type:'PRODUCTION',outputItemId:'papas_listas',outputQty:1000}
  ];
  const lines = [
    {recipeId:'menu',itemId:'papas_listas',qty:100,optional:false},
    {recipeId:'prod',itemId:'papas_prefritas',qty:1754.385965,optional:false},
    {recipeId:'prod',itemId:'ajo',qty:20,optional:false}
  ];
  context.getRows_ = name => name === 'Recipes' ? recipes : lines;
  const result = f.explodeRecipe_('menu', 14);
  assert.ok(Math.abs(result.papas_prefritas - 2456.140351) < 1e-6);
  assert.equal(result.ajo, 28);
});

