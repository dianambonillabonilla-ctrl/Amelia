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

// --- ventasPendientesSedeListar_/Asignar_: la bandeja de ventas "Sin identificar" ----------------

const VENTAS_HEADERS_ = ['id_venta', 'creacion', 'producto', 'categoria', 'cantidad', 'precio', 'cancelada', 'creada_por', 'sede', 'formato_origen', 'archivo_origen', 'importado_en'];

function construirVentasFixture_() {
  return [
    { id_venta: 'v1', creacion: '2026-07-20', producto: 'Poker', creada_por: 'Terraza Nueva SA', sede: 'Sin identificar' },
    { id_venta: 'v2', creacion: '2026-07-21', producto: 'Águila', creada_por: 'Terraza Nueva SA', sede: 'Sin identificar' },
    { id_venta: 'v3', creacion: '2026-07-21', producto: 'Falafel', creada_por: 'Caja Capri', sede: 'Capri' }, // ya identificada, no debe aparecer
    { id_venta: 'v4', creacion: '2026-07-22', producto: 'Limonada', creada_por: 'Domicilios', sede: 'Sin identificar' }
  ];
}

function cargarVentasPendientes_(ventasFudo, mapeoSedes, fudoItems, recalcularLlamadas) {
  fudoItems = fudoItems || [];
  recalcularLlamadas = recalcularLlamadas || [];
  const FUDO_ITEMS_HEADERS = ['id', 'clave_item', 'id_venta', 'creacion', 'producto', 'categoria', 'cantidad', 'precio', 'cancelada', 'sede', 'creada_por', 'formato_origen', 'archivo_origen', 'importado_en'];
  return cargar('apps-script/FudoMapeoSedes.gs', {
    SHEET_NAMES: { FUDO_MAPEO_SEDES: 'mapeo', VENTAS_FUDO: 'ventas', FUDO_ITEMS: 'items' },
    normalizar_: normalizarSimple_,
    formatearFecha_: (v) => String(v).slice(0, 10),
    neutralizarObjetoFormulas_: (o) => o,
    Utilities: { getUuid: () => 'mapeo-nuevo-' + (mapeoSedes.length + 1) },
    fudoVentasRecalcularCabecera_: (idVenta) => recalcularLlamadas.push(idVenta),
    leerTabla_: (hoja) => hoja === 'ventas' ? ventasFudo : hoja === 'mapeo' ? mapeoSedes : hoja === 'items' ? fudoItems : [],
    appendRowFromObj_: (hoja, fila) => { if (hoja === 'mapeo') mapeoSedes.push(fila); },
    sheet_: (nombre) => {
      if (nombre === 'ventas') {
        return {
          getDataRange: () => ({
            getValues: () => [VENTAS_HEADERS_].concat(ventasFudo.map((v) => VENTAS_HEADERS_.map((h) => v[h] !== undefined ? v[h] : '')))
          }),
          getRange: (fila, columna) => ({
            setValue: (valor) => { ventasFudo[fila - 2][VENTAS_HEADERS_[columna - 1]] = valor; }
          })
        };
      }
      if (nombre === 'items') {
        return {
          getDataRange: () => ({
            getValues: () => [FUDO_ITEMS_HEADERS].concat(fudoItems.map((v) => FUDO_ITEMS_HEADERS.map((h) => v[h] !== undefined ? v[h] : '')))
          }),
          getRange: (fila, columna) => ({
            setValue: (valor) => { fudoItems[fila - 2][FUDO_ITEMS_HEADERS[columna - 1]] = valor; }
          })
        };
      }
      // Fudo_Mapeo_Sedes: mismo shape que usan las pruebas de fudoMapeoSedeGuardar_ más arriba.
      const headersMapeo = ['id', 'tipo_referencia', 'id_fudo', 'nombre', 'sede', 'creado_por', 'timestamp'];
      return {
        getDataRange: () => ({
          getValues: () => [headersMapeo].concat(mapeoSedes.map((m) => headersMapeo.map((h) => m[h])))
        }),
        getRange: (fila, columna) => ({
          setValue: (valor) => { mapeoSedes[fila - 2][headersMapeo[columna - 1]] = valor; }
        })
      };
    }
  });
}

(function () {
  const ventasFudo = construirVentasFixture_();
  const mapeoSedes = [];
  const mod = cargarVentasPendientes_(ventasFudo, mapeoSedes);

  const bandeja = mod.ventasPendientesSedeListar_();
  assert.equal(bandeja.length, 2, 'solo deben aparecer los grupos de creada_por con ventas Sin identificar (Terraza Nueva SA y Domicilios)');
  const terrazaNueva = bandeja.find((g) => g.creada_por === 'Terraza Nueva SA');
  assert.equal(terrazaNueva.cantidad, 2);
  assert.equal(terrazaNueva.primera_fecha, '2026-07-20');
  assert.equal(terrazaNueva.ultima_fecha, '2026-07-21');
  assert.ok(!bandeja.some((g) => g.creada_por === 'Caja Capri'), 'una venta ya identificada (v3) no debe aparecer en la bandeja');

  console.log('ventasPendientesSedeListar_ agrupa por creada_por: OK');
})();

(function () {
  const ventasFudo = construirVentasFixture_();
  const mapeoSedes = [];
  const mod = cargarVentasPendientes_(ventasFudo, mapeoSedes);

  const resultado = mod.ventasPendientesSedeAsignar_('Terraza Nueva SA', 'San Antonio', { nombre: 'Diana' });
  assert.equal(resultado.ok, true);
  assert.equal(resultado.actualizadas, 2, 'debe asignar la sede a las 2 ventas de esa referencia');
  assert.equal(ventasFudo.find((v) => v.id_venta === 'v1').sede, 'San Antonio');
  assert.equal(ventasFudo.find((v) => v.id_venta === 'v2').sede, 'San Antonio');
  assert.equal(ventasFudo.find((v) => v.id_venta === 'v4').sede, 'Sin identificar', 'Domicilios no debe tocarse, es otra referencia');
  assert.equal(ventasFudo.find((v) => v.id_venta === 'v3').sede, 'Capri', 'una venta ya identificada no debe tocarse');

  // "El sistema aprende la regla": debe quedar un mapeo tipo Sala para que futuras ventas con esa
  // misma referencia se resuelvan solas, sin que el administrador tenga que repetir esto.
  assert.equal(resultado.regla_creada, true);
  assert.equal(mapeoSedes.length, 1);
  assert.equal(mapeoSedes[0].tipo_referencia, 'Sala');
  assert.equal(mapeoSedes[0].nombre, 'Terraza Nueva SA');
  assert.equal(mapeoSedes[0].sede, 'San Antonio');

  assert.equal(mod.ventasPendientesSedeAsignar_('Terraza Nueva SA', '', { nombre: 'Diana' }).ok, false, 'debe exigir la sede');

  console.log('ventasPendientesSedeAsignar_ asigna en bloque y aprende la regla: OK');
})();

(function () {
  const ventasFudo = construirVentasFixture_();
  const mapeoSedes = [];
  const fudoItems = [
    { id: 'i1', id_venta: 'v1', creada_por: 'Terraza Nueva SA', sede: 'Sin identificar' },
    { id: 'i2', id_venta: 'v2', creada_por: 'Terraza Nueva SA', sede: 'Sin identificar' }
  ];
  const recalcularLlamadas = [];
  const mod = cargarVentasPendientes_(ventasFudo, mapeoSedes, fudoItems, recalcularLlamadas);

  const resultado = mod.ventasPendientesSedeAsignar_('Terraza Nueva SA', 'San Antonio', { nombre: 'Diana' });
  assert.equal(resultado.ok, true);
  assert.equal(resultado.actualizadas_items, 2);
  assert.equal(fudoItems[0].sede, 'San Antonio');
  assert.deepEqual(recalcularLlamadas.sort(), ['v1', 'v2'], 'debe recalcular cabeceras Fudo_Ventas de cada venta tocada');

  console.log('ventasPendientesSedeAsignar_ recalcula cabeceras Fudo_Ventas: OK');
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

  const mapeosCaja = [{ tipo_referencia: 'Caja', nombre: 'Caja Capri', sede: 'Capri' }];
  const fudoCaja = cargar('apps-script/Fudo.gs', {
    SHEET_NAMES: { FUDO_MAPEO_SEDES: 'mapeo' },
    normalizar_: normalizarSimple_,
    leerTabla_: (hoja) => hoja === 'mapeo' ? mapeosCaja : []
  });
  assert.equal(fudoCaja.sedeDesdeCreadaPor_('Caja Capri'), 'Capri', 'CSV con nombre de caja en Creada por debe resolver vía mapeo tipo Caja');

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

// --- importarFudo_('ventas'): prioriza la columna 'Sede' (resuelta por fudoResolverSedeVenta_ en
// el sync de la API vía identificador/mesero) sobre sedeDesdeCreadaPor_, pero le da una segunda
// oportunidad a sedeDesdeCreadaPor_ si esa resolución no encontró nada ("Sin identificar") --------

(function () {
  function cargarFudoVentas_(ventasPrevias) {
    let ventasGuardadas = ventasPrevias || [];
    const ctx = cargar('apps-script/Fudo.gs', {
      SHEET_NAMES: { VENTAS_FUDO: 'ventas', MOVIMIENTOS_FUDO: 'movimientos', FUDO_MAPEO_SEDES: 'mapeo' },
      normalizar_: normalizarSimple_,
      formatearFecha_: (v) => String(v).slice(0, 10),
      leerTabla_: (hoja) => hoja === 'ventas' ? ventasGuardadas : [],
      appendRowsFromObjs_: (hoja, filas) => { if (hoja === 'ventas') ventasGuardadas.push.apply(ventasGuardadas, filas); },
      LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }) }
    });
    return { ctx: ctx, ventas: () => ventasGuardadas };
  }

  const usuario = { nombre: 'Diana' };

  // 'Sede' viene resuelta (ej. por identificador de venta, sin mesa) — debe usarse tal cual, sin
  // siquiera consultar sedeDesdeCreadaPor_ (que con 'Creada por' vacío daría "Sin identificar").
  const conSede = cargarFudoVentas_([]);
  conSede.ctx.importarFudo_('ventas', [
    { 'Id. Venta': '1', 'Creación': '2026-07-21 12:00:00', Producto: 'Domicilio', Cantidad: 1, Precio: 30000, 'Creada por': '', Sede: 'Capri', Cancelada: 'No' }
  ], usuario, {});
  assert.equal(conSede.ventas()[0].sede, 'Capri', "'Sede' ya resuelta debe usarse directo");

  // 'Sede' viene "Sin identificar" (fudoResolverSedeVenta_ tampoco encontró nada) — debe darle una
  // segunda oportunidad a sedeDesdeCreadaPor_ usando 'Creada por' (la lista fija histórica).
  const conRespaldo = cargarFudoVentas_([]);
  conRespaldo.ctx.importarFudo_('ventas', [
    { 'Id. Venta': '2', 'Creación': '2026-07-21 12:00:00', Producto: 'Poker', Cantidad: 1, Precio: 13000, 'Creada por': 'terraza', Sede: 'Sin identificar', Cancelada: 'No' }
  ], usuario, {});
  assert.equal(conRespaldo.ventas()[0].sede, 'San Antonio', "'Sede'=Sin identificar no debe rendirse: sedeDesdeCreadaPor_ todavía puede resolverla");

  // Sin columna 'Sede' (export CSV de siempre) — comportamiento intacto, igual que antes.
  const sinColumnaSede = cargarFudoVentas_([]);
  sinColumnaSede.ctx.importarFudo_('ventas', [
    { 'Id. Venta': '3', 'Creación': '2026-07-21 12:00:00', Producto: 'Poker', Cantidad: 1, Precio: 13000, 'Creada por': 'terraza', Cancelada: 'No' }
  ], usuario, {});
  assert.equal(sinColumnaSede.ventas()[0].sede, 'San Antonio', 'sin la columna Sede (CSV de siempre), debe seguir funcionando exactamente igual');

  console.log("importarFudo_('ventas') prioriza 'Sede' resuelta, con respaldo en sedeDesdeCreadaPor_: OK");
})();

console.log('fudo-mapeo-sedes: OK');
