const assert = require('assert');
const { crearEntorno } = require('./helpers/entorno-apps-script');

(function () {
  const env = crearEntorno();
  const ctx = env.ctx;
  ctx.configurarHojas();

  env.agregar('Catalogo_Maestro', [
    { id: 'c1', nombre_estandar: 'Aguila Light', nombre_fudo: '', id_fudo: '', unidad_base: 'u', categoria: 'Bebidas/Cerveza' },
    { id: 'c2', nombre_estandar: 'Papa', nombre_fudo: 'Papa cruda', id_fudo: '99', tipo_fudo: 'Ingrediente', unidad_base: 'g', categoria: 'Insumos' }
  ]);

  const props = ctx.PropertiesService.getScriptProperties();
  props.setProperty('FUDO_API_KEY', 'k');
  props.setProperty('FUDO_API_SECRET', 's');
  props.setProperty('FUDO_API_TOKEN', 'token');
  props.setProperty('FUDO_API_TOKEN_EXP', String(Math.floor(Date.now() / 1000) + 3600));

  const productoApi = {
    id: '10',
    type: 'Product',
    attributes: { name: 'Aguila Light', stock: 5 },
    relationships: { unit: { data: { type: 'Unit', id: '1' } } }
  };
  const ingredienteApi = {
    id: '99',
    type: 'Ingredient',
    attributes: { name: 'Papa pelada', stock: 100 },
    relationships: { unit: { data: { type: 'Unit', id: '2' } } }
  };
  const unitG = { id: '2', type: 'Unit', attributes: { name: 'g' } };

  ctx.UrlFetchApp.fetch = (url, opts) => {
    if (url.includes('/products?')) {
      return {
        getResponseCode: () => 200,
        getContentText: () => JSON.stringify({ data: [productoApi], included: [unitG] })
      };
    }
    if (url.includes('/ingredients?')) {
      return {
        getResponseCode: () => 200,
        getContentText: () => JSON.stringify({ data: [ingredienteApi], included: [unitG] })
      };
    }
    if (opts && opts.method === 'patch' && url.includes('/ingredients/99')) {
      const body = JSON.parse(opts.payload);
      assert.equal(body.data.attributes.name, 'Papa pelada nueva');
      return { getResponseCode: () => 200, getContentText: () => JSON.stringify({ data: ingredienteApi }) };
    }
    throw new Error('fetch no mockado: ' + url + ' ' + (opts && opts.method));
  };

  const sync = ctx.catalogoSincronizarDesdeFudo_({ nombre: 'Test' }, {});
  assert.equal(sync.ok, true);
  assert.equal(sync.vinculados_por_nombre, 1);
  assert.equal(sync.vinculados_por_id, 1);
  assert.ok(sync.nombres_actualizados >= 1);

  const catalogo = env.hoja('Catalogo_Maestro');
  const aguila = catalogo.getRange(2, 1, 1, catalogo.getLastColumn()).getValues()[0];
  const headers = catalogo.getRange(1, 1, 1, catalogo.getLastColumn()).getValues()[0];
  const idx = (h) => headers.indexOf(h);
  const rowById = (id) => {
    for (let r = 2; r <= catalogo.getLastRow(); r++) {
      const row = catalogo.getRange(r, 1, 1, catalogo.getLastColumn()).getValues()[0];
      if (row[idx('id')] === id) return row;
    }
    return null;
  };
  const aguilaRow = rowById('c1');
  assert.equal(aguilaRow[idx('id_fudo')], '10');
  assert.equal(aguilaRow[idx('tipo_fudo')], 'Producto');
  assert.equal(aguilaRow[idx('nombre_fudo')], 'Aguila Light');

  const papaRow = rowById('c2');
  assert.equal(papaRow[idx('nombre_fudo')], 'Papa pelada');

  ctx.catalogoGuardar_({ id: 'c2', nombre_fudo: 'Papa pelada nueva' });
  const push = ctx.catalogoEnviarNombreAFudo_('c2', { nombre: 'Test' });
  assert.equal(push.ok, true);
  assert.equal(push.nombre_enviado, 'Papa pelada nueva');

  const cmp = ctx.catalogoCompararConFudoInterno_([
    { id_fudo: '10', nombre_fudo: 'Aguila Light', tipo_fudo: 'Producto', unidad: 'u' },
    { id_fudo: '99', nombre_fudo: 'Papa pelada nueva', tipo_fudo: 'Ingrediente', unidad: 'g' },
    { id_fudo: '50', nombre_fudo: 'Solo FUDO', tipo_fudo: 'Producto', unidad: 'u' }
  ]);
  assert.equal(cmp.ok, true);
  assert.equal(cmp.resumen.coinciden, 2);
  assert.equal(cmp.resumen.solo_fudo, 1);
  assert.ok(cmp.solo_fudo.some(s => s.nombre_fudo === 'Solo FUDO'));

  console.log('fudo-catalogo-sync: OK');
})();
