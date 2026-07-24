const fs = require('fs');
const vm = require('vm');
const assert = require('assert');

function cargar(path, extras = {}) {
  const ctx = Object.assign({ console }, extras);
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path, 'utf8'), ctx, { filename: path });
  return ctx;
}

// --- auditoriaRegistrar_ ---------------------------------------------------------------------

(function () {
  const eventosGuardados = [];
  const ctx = cargar('apps-script/Auditoria.gs', {
    SHEET_NAMES: { AUDITORIA: 'auditoria' },
    appendRowFromObj_: (hoja, fila) => { if (hoja === 'auditoria') eventosGuardados.push(fila); },
    Utilities: { getUuid: () => 'evento-1' },
    Logger: { log: () => {} }
  });
  ctx.auditoriaRegistrar_({ id: 'u1', nombre: 'Diana' }, 'conteo_corregido', 'Conteo', 'c1', { cantidad: 5 }, { cantidad: 8 }, 'San Antonio', 'motivo opcional');
  assert.equal(eventosGuardados.length, 1);
  assert.equal(eventosGuardados[0].usuario_id, 'u1');
  assert.equal(eventosGuardados[0].usuario_nombre, 'Diana');
  assert.equal(eventosGuardados[0].accion, 'conteo_corregido');
  assert.equal(eventosGuardados[0].entidad_tipo, 'Conteo');
  assert.equal(eventosGuardados[0].entidad_id, 'c1');
  assert.equal(eventosGuardados[0].valor_anterior, JSON.stringify({ cantidad: 5 }));
  assert.equal(eventosGuardados[0].valor_nuevo, JSON.stringify({ cantidad: 8 }));
  assert.equal(eventosGuardados[0].sede, 'San Antonio');
  assert.equal(eventosGuardados[0].motivo, 'motivo opcional');
  console.log('auditoriaRegistrar_ guarda un evento completo: OK');
})();

(function () {
  // Sin usuario, sin valores anterior/nuevo, sin motivo — no debe reventar, solo dejar esos
  // campos vacíos.
  const eventosGuardados = [];
  const ctx = cargar('apps-script/Auditoria.gs', {
    SHEET_NAMES: { AUDITORIA: 'auditoria' },
    appendRowFromObj_: (hoja, fila) => { eventosGuardados.push(fila); },
    Utilities: { getUuid: () => 'evento-2' },
    Logger: { log: () => {} }
  });
  ctx.auditoriaRegistrar_(null, 'algo', 'Entidad', 'e1', null, null, null);
  assert.equal(eventosGuardados[0].usuario_id, '');
  assert.equal(eventosGuardados[0].usuario_nombre, '');
  assert.equal(eventosGuardados[0].valor_anterior, '');
  assert.equal(eventosGuardados[0].valor_nuevo, '');
  assert.equal(eventosGuardados[0].sede, '');
  assert.equal(eventosGuardados[0].motivo, '');
  console.log('auditoriaRegistrar_ tolera campos vacíos/ausentes: OK');
})();

(function () {
  // Nunca debe bloquear la operación real (ej. guardar un conteo) si falla el registro de
  // auditoría — se limita a dejar constancia en el registro de ejecución.
  let logueado = '';
  const ctx = cargar('apps-script/Auditoria.gs', {
    SHEET_NAMES: { AUDITORIA: 'auditoria' },
    appendRowFromObj_: () => { throw new Error('Sheets no disponible ahora mismo'); },
    Utilities: { getUuid: () => 'evento-3' },
    Logger: { log: (m) => { logueado = m; } }
  });
  assert.doesNotThrow(() => ctx.auditoriaRegistrar_({ nombre: 'Diana' }, 'x', 'Y', 'z', null, null, ''));
  assert.match(logueado, /auditoriaRegistrar_ falló/);
  console.log('auditoriaRegistrar_ nunca bloquea la operación real si falla: OK');
})();

// --- auditoriaListar_ -------------------------------------------------------------------------

(function () {
  const filas = [
    { entidad_tipo: 'Conteo', entidad_id: 'c1', timestamp: '2026-07-20T10:00:00Z' },
    { entidad_tipo: 'Conteo', entidad_id: 'c2', timestamp: '2026-07-22T10:00:00Z' },
    { entidad_tipo: 'Usuario', entidad_id: 'u1', timestamp: '2026-07-21T10:00:00Z' }
  ];
  const ctx = cargar('apps-script/Auditoria.gs', { SHEET_NAMES: { AUDITORIA: 'auditoria' }, leerTabla_: () => filas });

  const soloConteos = ctx.auditoriaListar_({ entidad_tipo: 'Conteo' });
  assert.equal(soloConteos.length, 2);
  assert.equal(soloConteos.every((r) => r.entidad_tipo === 'Conteo'), true);
  // Más reciente primero.
  assert.equal(soloConteos[0].entidad_id, 'c2');

  const unSoloId = ctx.auditoriaListar_({ entidad_id: 'u1' });
  assert.equal(unSoloId.length, 1);
  assert.equal(unSoloId[0].entidad_tipo, 'Usuario');

  const porFecha = ctx.auditoriaListar_({ fecha_desde: '2026-07-21', fecha_hasta: '2026-07-21' });
  assert.equal(porFecha.length, 1);
  assert.equal(porFecha[0].entidad_id, 'u1');

  console.log('auditoriaListar_ filtra por entidad_tipo/entidad_id/rango de fechas: OK');
})();

console.log('auditoria: OK');
