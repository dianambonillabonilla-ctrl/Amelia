const fs = require('fs');
const vm = require('vm');
const assert = require('assert');

function cargar(path, extras = {}) {
  const ctx = Object.assign({ console }, extras);
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path, 'utf8'), ctx, { filename: path });
  return ctx;
}

(function () {
  const archivosCreados = [];
  const props = { store: {} };
  const folder = {
    getId: () => 'folder-test-id',
    createFile: (blob) => {
      archivosCreados.push({ nombre: blob.getName(), mime: blob.getContentType() });
      return {
        getUrl: () => 'https://drive.google.com/file/d/test/view',
        getId: () => 'file-test-id',
        setSharing: () => {}
      };
    }
  };
  const mod = cargar('apps-script/Evidencias.gs', {
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k) => props.store[k] || null,
        setProperty: (k, v) => { props.store[k] = v; },
        deleteProperty: (k) => { delete props.store[k]; }
      })
    },
    DriveApp: {
      getFolderById: () => folder,
      getFoldersByName: () => ({ hasNext: () => false }),
      createFolder: () => folder,
      Access: { ANYONE_WITH_LINK: 'anyone' },
      Permission: { VIEW: 'view' }
    },
    Utilities: {
      base64Decode: (b64) => Buffer.from(b64, 'base64'),
      newBlob: (bytes, mime, name) => ({
        getName: () => name,
        getContentType: () => mime
      })
    }
  });

  const ok = mod.evidenciaSubir_({
    nombre: 'pesaje.jpg',
    mime_type: 'image/jpeg',
    contenido_base64: Buffer.from('foto-test').toString('base64')
  });
  assert.equal(ok.ok, true);
  assert.ok(ok.url);
  assert.equal(archivosCreados.length, 1);
  assert.equal(archivosCreados[0].nombre, 'pesaje.jpg');

  const sinArchivo = mod.evidenciaSubir_(null);
  assert.equal(sinArchivo.ok, false);

  const grande = mod.evidenciaSubir_({
    nombre: 'grande.jpg',
    mime_type: 'image/jpeg',
    contenido_base64: Buffer.alloc(9 * 1024 * 1024).toString('base64')
  });
  assert.equal(grande.ok, false);

  console.log('evidenciaSubir_: OK');
})();

(function () {
  const props = { INVENTARIO_LIBRO_ACTIVO: 'false' };
  const mod = cargar('apps-script/InventarioMovimientos.gs', {
    SHEET_NAMES: { MOVIMIENTOS_INVENTARIO: 'mov' },
    MOVIMIENTO_TIPOS_SIGNO_: {},
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k) => props[k] || null,
        setProperty: (k, v) => { props[k] = v; }
      })
    },
    leerTabla_: () => [{ id: '1' }]
  });
  const r = mod.inventarioLibroConfigurarDesdeApi_(true);
  assert.equal(r.ok, true);
  assert.equal(r.data.activo, true);
  assert.equal(mod.inventarioLibroActivo_(), true);
  console.log('inventarioLibroConfigurarDesdeApi_: OK');
})();

console.log('evidencias: OK');
