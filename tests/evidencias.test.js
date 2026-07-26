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
  let sharingLlamado = false;
  const props = { store: {} };
  const folder = {
    getId: () => 'folder-test-id',
    createFile: (blob) => {
      archivosCreados.push({ nombre: blob.getName(), mime: blob.getContentType(), bytes: blob._bytes });
      return {
        getUrl: () => 'https://drive.google.com/file/d/test/view',
        getId: () => 'file-test-id',
        getName: () => blob.getName(),
        getBlob: () => blob,
        getParents: () => ({ hasNext: () => true, next: () => folder }),
        setSharing: () => { sharingLlamado = true; }
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
      getFileById: (id) => folder.createFile({
        getName: () => 'pesaje.jpg',
        getContentType: () => 'image/jpeg',
        getBytes: () => Buffer.from([0xFF, 0xD8, 0xFF, 0xE0]),
        _bytes: Buffer.from([0xFF, 0xD8, 0xFF, 0xE0])
      }),
      getFoldersByName: () => ({ hasNext: () => false }),
      createFolder: () => folder,
      Access: { ANYONE_WITH_LINK: 'anyone' },
      Permission: { VIEW: 'view' }
    },
    Utilities: {
      base64Decode: (b64) => Buffer.from(b64, 'base64'),
      base64Encode: (bytes) => Buffer.from(bytes).toString('base64'),
      newBlob: (bytes, mime, name) => ({
        getName: () => name,
        getContentType: () => mime,
        getBytes: () => bytes,
        _bytes: bytes
      })
    }
  });

  const jpegBytes = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10]);
  const ok = mod.evidenciaSubir_({
    nombre: 'pesaje.jpg',
    mime_type: 'image/jpeg',
    contenido_base64: jpegBytes.toString('base64')
  });
  assert.equal(ok.ok, true);
  assert.ok(ok.url.startsWith('evidencia:'));
  assert.equal(archivosCreados.length, 1);
  assert.equal(archivosCreados[0].nombre, 'pesaje.jpg');
  assert.equal(archivosCreados[0].mime, 'image/jpeg');
  assert.equal(sharingLlamado, false, 'no debe compartir el archivo públicamente');

  const sinArchivo = mod.evidenciaSubir_(null);
  assert.equal(sinArchivo.ok, false);

  const grande = mod.evidenciaSubir_({
    nombre: 'grande.jpg',
    mime_type: 'image/jpeg',
    contenido_base64: Buffer.alloc(9 * 1024 * 1024).toString('base64')
  });
  assert.equal(grande.ok, false);

  const falsoJpeg = mod.evidenciaSubir_({
    nombre: 'malicioso.jpg',
    mime_type: 'image/jpeg',
    contenido_base64: Buffer.from('esto no es una imagen').toString('base64')
  });
  assert.equal(falsoJpeg.ok, false, 'debe rechazar archivos sin firma JPEG/PNG/PDF válida');

  const pngBytes = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00]);
  const pngOk = mod.evidenciaSubir_({
    nombre: 'captura.png',
    mime_type: 'image/png',
    contenido_base64: pngBytes.toString('base64')
  });
  assert.equal(pngOk.ok, true);
  assert.equal(archivosCreados[archivosCreados.length - 1].mime, 'image/png');

  const obtener = mod.evidenciaObtener_('file-test-id');
  assert.equal(obtener.ok, true);
  assert.equal(obtener.mime_type, 'image/jpeg');
  assert.ok(obtener.contenido_base64);

  console.log('evidenciaSubir_/evidenciaObtener_: OK');
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

(function () {
  const mod = cargar('apps-script/AjustesInventario.gs', {
    Utilities: { getUuid: () => 'aj-1' }
  });
  const fila = mod.ajusteInventarioFila_({
    fecha: '2026-07-10', sede: 'Capri', tipo: 'Merma / desperdicio', producto: 'Aceite',
    unidad: 'u', cantidad: 2, motivo: 'se cayó', evidencia_url: 'evidencia:abc123'
  }, { nombre: 'Ana' });
  assert.equal(fila.evidencia_url, 'evidencia:abc123');
  console.log('ajusteInventarioFila_ con evidencia_url: OK');
})();

console.log('evidencias: OK');
