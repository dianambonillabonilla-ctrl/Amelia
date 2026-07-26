const fs = require('fs');
const vm = require('vm');
const assert = require('assert');

function cargar(path, extras = {}) {
  const ctx = Object.assign({ console }, extras);
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path, 'utf8'), ctx, { filename: path });
  return ctx;
}

function normalizarSimple_(s) {
  return String(s || '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ');
}

// --- fudoResolverSedeVenta_: prioridad Sala > Caja > Identificador > Usuario > Sin identificar ---

(function () {
  const mod = cargar('apps-script/FudoMapeoSedes.gs', {
    SHEET_NAMES: { FUDO_MAPEO_SEDES: 'mapeo' },
    normalizar_: normalizarSimple_,
    leerTabla_: () => []
  });

  const indice = {
    'sala|terraza capri': { sede: 'Capri' },
    'caja|caja capri': { sede: 'Capri' },
    'identificador|domicilios capri': { sede: 'Capri' },
    'usuario|caja sa': { sede: 'San Antonio' }
  };

  assert.equal(
    mod.fudoResolverSedeVenta_({ sala: 'Terraza Capri', caja: 'Caja SA' }, indice).sede, 'Capri',
    'sala debe ganarle a caja cuando ambas tienen mapeo'
  );
  assert.equal(
    mod.fudoResolverSedeVenta_({ sala: 'Terraza Capri' }, indice).resuelto_por, 'Sala'
  );
  assert.equal(
    mod.fudoResolverSedeVenta_({ caja: 'Caja Capri', usuario: 'Caja SA' }, indice).sede, 'Capri',
    'sin sala, caja debe ganarle a usuario'
  );
  assert.equal(
    mod.fudoResolverSedeVenta_({ identificador: 'Domicilios Capri', usuario: 'Caja SA' }, indice).sede, 'Capri',
    'sin sala ni caja, identificador debe ganarle a usuario'
  );
  assert.equal(
    mod.fudoResolverSedeVenta_({ usuario: 'Caja SA' }, indice).sede, 'San Antonio'
  );
  const sinMapeo = mod.fudoResolverSedeVenta_({ sala: 'Sala que no existe' }, indice);
  assert.equal(sinMapeo.sede, 'Sin identificar', 'sin ningún mapeo que coincida, nunca debe inventar una sede');
  assert.equal(sinMapeo.resuelto_por, null);
  assert.deepEqual(mod.fudoResolverSedeVenta_({}, indice), { sede: 'Sin identificar', resuelto_por: null }, 'sin ninguna referencia disponible, tampoco debe inventar nada');

  console.log('fudoResolverSedeVenta_: OK');
})();

// --- fudoMapeoSedeGuardar_/Listar_/Eliminar_ ----------------------------------------------------

(function () {
  let filas = [];
  let contadorId = 0;
  const escritos = [];
  function mod() {
    return cargar('apps-script/FudoMapeoSedes.gs', {
      SHEET_NAMES: { FUDO_MAPEO_SEDES: 'mapeo' },
      normalizar_: normalizarSimple_,
      neutralizarObjetoFormulas_: (o) => o,
      Utilities: { getUuid: () => 'id-' + (++contadorId) },
      leerTabla_: () => filas,
      appendRowFromObj_: (hoja, fila) => { if (hoja === 'mapeo') filas.push(fila); },
      sheet_: () => ({
        getDataRange: () => ({
          getValues: () => [['id', 'tipo_referencia', 'id_fudo', 'nombre', 'sede', 'creado_por', 'timestamp']]
            .concat(filas.map((f) => [f.id, f.tipo_referencia, f.id_fudo, f.nombre, f.sede, f.creado_por, f.timestamp]))
        }),
        getRange: (fila, columna) => ({
          setValue: (valor) => {
            const headers = ['id', 'tipo_referencia', 'id_fudo', 'nombre', 'sede', 'creado_por', 'timestamp'];
            filas[fila - 2][headers[columna - 1]] = valor;
          }
        }),
        deleteRow: (fila) => { filas.splice(fila - 2, 1); }
      })
    });
  }

  const usuario = { nombre: 'Diana' };
  const resultado = mod().fudoMapeoSedeGuardar_({ tipo_referencia: 'Sala', nombre: 'Terraza Capri', sede: 'Capri' }, usuario);
  assert.equal(resultado.ok, true);
  assert.equal(filas.length, 1);
  assert.equal(filas[0].sede, 'Capri');
  assert.equal(filas[0].creado_por, 'Diana');

  assert.equal(mod().fudoMapeoSedeGuardar_({ tipo_referencia: 'Sala', nombre: '' }, usuario).ok, false, 'debe exigir nombre');
  assert.equal(mod().fudoMapeoSedeGuardar_({ tipo_referencia: 'Invalida', nombre: 'x', sede: 'Capri' }, usuario).ok, false, 'debe validar tipo_referencia');

  // Guardar de nuevo la MISMA sala (nombre sin distinguir mayúsculas/tildes) debe actualizar, no
  // duplicar — tipo_referencia sigue siendo un enum de case exacto (viene de un desplegable fijo
  // en la app, no de texto libre), solo el nombre de la sala se compara normalizado.
  const actualizado = mod().fudoMapeoSedeGuardar_({ tipo_referencia: 'Sala', nombre: 'TERRAZA CAPRI', sede: 'San Antonio' }, usuario);
  assert.equal(actualizado.ok, true);
  assert.equal(actualizado.actualizado, true);
  assert.equal(filas.length, 1, 'no debe crear una segunda fila para la misma sala');
  assert.equal(filas[0].sede, 'San Antonio', 'debe quedar con la sede nueva');

  assert.equal(mod().fudoMapeoSedeListar_().length, 1);

  const eliminado = mod().fudoMapeoSedeEliminar_(filas[0].id);
  assert.equal(eliminado.ok, true);
  assert.equal(filas.length, 0);
  assert.equal(mod().fudoMapeoSedeEliminar_('no-existe').ok, false);

  console.log('fudoMapeoSedeGuardar_/Listar_/Eliminar_: OK');
})();

// --- sedeDesdeCreadaPor_ (Fudo.gs) debe preferir el mapeo configurado sobre la lista fija -------

(function () {
  const mapeos = [{ tipo_referencia: 'Sala', nombre: 'Sala Nueva', sede: 'Capri' }];
  const fudo = cargar('apps-script/Fudo.gs', {
    SHEET_NAMES: { FUDO_MAPEO_SEDES: 'mapeo' },
    normalizar_: normalizarSimple_,
    leerTabla_: (hoja) => hoja === 'mapeo' ? mapeos : []
  });
  assert.equal(fudo.sedeDesdeCreadaPor_('Sala Nueva'), 'Capri', 'una sala configurada en Fudo_Mapeo_Sedes debe resolverse aunque no esté en la lista fija');
  assert.equal(fudo.sedeDesdeCreadaPor_('Terraza Capri'), 'Capri', 'sin mapeo para esa sala, debe seguir usando la lista fija de siempre');
  assert.equal(fudo.sedeDesdeCreadaPor_('Sala Desconocida'), 'Sin identificar');

  // Un mapeo puede incluso CORREGIR lo que la lista fija diría por defecto.
  const mapeosQueCorrigen = [{ tipo_referencia: 'Sala', nombre: 'Terraza Capri', sede: 'San Antonio' }];
  const fudoCorregido = cargar('apps-script/Fudo.gs', {
    SHEET_NAMES: { FUDO_MAPEO_SEDES: 'mapeo' },
    normalizar_: normalizarSimple_,
    leerTabla_: (hoja) => hoja === 'mapeo' ? mapeosQueCorrigen : []
  });
  assert.equal(fudoCorregido.sedeDesdeCreadaPor_('Terraza Capri'), 'San Antonio', 'el mapeo configurado debe poder anular la lista fija');

  console.log('sedeDesdeCreadaPor_ con Fudo_Mapeo_Sedes: OK');
})();

console.log('fudo-mapeo-sedes: OK');
