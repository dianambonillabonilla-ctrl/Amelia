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
function claveProductoMock_(texto) { return normalizarSimple_(texto); }
function aUnidadBaseMock_(cantidad, unidad) {
  const n = Number(cantidad) || 0;
  const u = normalizarSimple_(unidad);
  if (u === 'kg') return { cantidad: n * 1000, unidad: 'g' };
  return { cantidad: n, unidad: u };
}

// --- Ubicaciones ---------------------------------------------------------------------------------

(function () {
  const mod = cargar('apps-script/Ubicaciones.gs', {});
  const todas = mod.ubicacionesListar_();
  assert.ok(todas['Centro de Producción'].includes('Materia prima cruda'));
  assert.ok(todas['San Antonio'].includes('Caja'));
  assert.ok(todas['Capri'].includes('Waflería'));
  assert.deepEqual(mod.ubicacionesListar_('Capri'), todas['Capri']);
  assert.deepEqual(mod.ubicacionesListar_('Sede que no existe'), []);
  console.log('ubicacionesListar_: OK');
})();

// --- movimientosInventarioListar_: normaliza Ajustes/Producciones/Traslados con signo -----------

function fixtures_() {
  const ajustes = [
    { id: 'a1', fecha: '2026-07-01', sede: 'Capri', punto: 'Almacén', tipo: 'Compra cruda', producto: 'Costilla', unidad: 'kg', cantidad: 5, usuario: 'Ana', avalado: false },
    { id: 'a2', fecha: '2026-07-02', sede: 'Capri', punto: 'Cocina', tipo: 'Merma / desperdicio', producto: 'Costilla', unidad: 'kg', cantidad: 1, usuario: 'Ana', avalado: true }
  ];
  const producciones = [
    { id: 'p1', fecha: '2026-07-03', sede: 'Capri', item: 'Costilla Preparada', cantidad: 3, unidad: 'kg', usuario: 'Ana' }
  ];
  const traslados = [
    // Enviado y confirmado: debe generar traslado enviado (Centro de Producción) + recibido (Capri).
    { id: 't1', fecha: '2026-07-04', producto: 'Costilla', unidad: 'kg', cantidad_enviada: 2, cantidad_recibida: 1.9,
      sede_origen: 'Centro de Producción', punto_origen: 'Despachos pendientes', sede_destino: 'Capri', punto_destino: 'Almacén',
      usuario_envia: 'Juan', usuario_recibe: 'Ana', timestamp_recibe: '2026-07-05', estado: 'Confirmado' },
    // Solo enviado, todavía no confirmado: NO debe generar "Traslado recibido".
    { id: 't2', fecha: '2026-07-06', producto: 'Costilla', unidad: 'kg', cantidad_enviada: 4, cantidad_recibida: '',
      sede_origen: 'Centro de Producción', punto_origen: 'Despachos pendientes', sede_destino: 'San Antonio', punto_destino: 'Almacén',
      usuario_envia: 'Juan', usuario_recibe: '', timestamp_recibe: '', estado: 'Enviado' }
  ];
  return { ajustes, producciones, traslados };
}

function cargarMovimientos_(fx) {
  return cargar('apps-script/MovimientosInventario.gs', {
    SHEET_NAMES: { AJUSTES_INVENTARIO: 'ajustes', PRODUCCIONES: 'producciones', TRASLADOS: 'traslados', CONTEOS: 'conteos' },
    normalizar_: normalizarSimple_,
    formatearFecha_: (v) => String(v).slice(0, 10),
    claveProducto_: claveProductoMock_,
    aUnidadBase_: aUnidadBaseMock_,
    leerTabla_: (hoja) => hoja === 'ajustes' ? fx.ajustes : hoja === 'producciones' ? fx.producciones : hoja === 'traslados' ? fx.traslados : (fx.conteos || [])
  });
}

(function () {
  const fx = fixtures_();
  const mod = cargarMovimientos_(fx);
  const movimientos = mod.movimientosInventarioListar_({ indice: {} });

  // 2 ajustes + 1 producción + 2 movimientos del traslado confirmado (enviado+recibido) + 1 del
  // traslado solo enviado (sin el "recibido" porque no está confirmado) = 6.
  assert.equal(movimientos.length, 6);

  const compra = movimientos.find((m) => m.documento_relacionado === 'a1');
  assert.equal(compra.tipo_movimiento, 'Compra recibida');
  assert.equal(compra.cantidad, 5, 'una compra debe quedar en positivo');
  assert.equal(compra.ubicacion_destino, 'Capri / Almacén');
  assert.equal(compra.ubicacion_origen, '');

  const merma = movimientos.find((m) => m.documento_relacionado === 'a2');
  assert.equal(merma.tipo_movimiento, 'Merma en sede');
  assert.equal(merma.cantidad, -1, 'una merma debe quedar en negativo');
  assert.equal(merma.ubicacion_origen, 'Capri / Cocina');
  assert.equal(merma.estado, 'Avalado');

  const produccion = movimientos.find((m) => m.documento_relacionado === 'p1');
  assert.equal(produccion.tipo_movimiento, 'Entrada por producción');
  assert.equal(produccion.cantidad, 3);

  const enviados = movimientos.filter((m) => m.tipo_movimiento === 'Traslado enviado');
  assert.equal(enviados.length, 2, 'TODO traslado, confirmado o no, genera su movimiento de salida');
  const enviadoT1 = enviados.find((m) => m.documento_relacionado === 't1');
  assert.equal(enviadoT1.cantidad, -2);
  assert.equal(enviadoT1.sede, 'Centro de Producción');

  const recibidos = movimientos.filter((m) => m.tipo_movimiento === 'Traslado recibido');
  assert.equal(recibidos.length, 1, 'solo el traslado CONFIRMADO debe generar el movimiento de entrada');
  assert.equal(recibidos[0].documento_relacionado, 't1');
  assert.equal(recibidos[0].cantidad, 1.9, 'debe entrar lo REALMENTE recibido, no lo enviado');
  assert.equal(recibidos[0].sede, 'Capri');

  console.log('movimientosInventarioListar_ normaliza Ajustes/Producciones/Traslados: OK');
})();

(function () {
  const fx = fixtures_();
  const mod = cargarMovimientos_(fx);

  const soloCapri = mod.movimientosInventarioListar_({ sede: 'Capri', indice: {} });
  assert.ok(soloCapri.every((m) => m.sede === 'Capri'));
  assert.equal(soloCapri.length, 4, '2 ajustes + 1 producción, todos de Capri, más el traslado recibido en Capri');

  const soloJulio2 = mod.movimientosInventarioListar_({ fecha_desde: '2026-07-02', fecha_hasta: '2026-07-02', indice: {} });
  assert.equal(soloJulio2.length, 1);
  assert.equal(soloJulio2[0].documento_relacionado, 'a2');

  const soloCostillaPreparada = mod.movimientosInventarioListar_({ producto: 'Costilla Preparada', indice: {} });
  assert.equal(soloCostillaPreparada.length, 1);
  assert.equal(soloCostillaPreparada[0].documento_relacionado, 'p1');

  console.log('movimientosInventarioListar_ filtra por sede/fecha/producto: OK');
})();

// --- movimientosDesdeProduccion_: insumo consumido y merma de proceso (opcionales) --------------

(function () {
  const fx = fixtures_();
  fx.producciones.push({
    id: 'p2', fecha: '2026-07-07', sede: 'Centro de Producción', item: 'Costilla Preparada',
    cantidad: 18.2, unidad: 'kg', usuario: 'Juan',
    insumo_producto: 'Costilla cruda', insumo_cantidad: 25, insumo_unidad: 'kg', merma_cantidad: 6.8
  });
  const mod = cargarMovimientos_(fx);
  const deP2 = mod.movimientosInventarioListar_({ indice: {} }).filter((m) => m.documento_relacionado === 'p2');

  assert.equal(deP2.length, 3, 'una producción con insumo y merma debe generar 3 movimientos: entrada, consumo y merma');

  const entrada = deP2.find((m) => m.tipo_movimiento === 'Entrada por producción');
  assert.equal(entrada.producto, 'Costilla Preparada');
  assert.equal(entrada.cantidad, 18.2);

  const consumo = deP2.find((m) => m.tipo_movimiento === 'Consumo de producción');
  assert.equal(consumo.producto, 'Costilla cruda');
  assert.equal(consumo.cantidad, -25, 'debe restar TODO el insumo que entró al lote, en negativo');
  assert.equal(consumo.sede, 'Centro de Producción');

  const merma = deP2.find((m) => m.tipo_movimiento === 'Merma de producción');
  assert.equal(merma.cantidad, -6.8);
  assert.notEqual(merma.producto, 'Costilla cruda', 'la merma NO debe registrarse contra el nombre real del insumo (evita descontarlo dos veces)');
  assert.notEqual(merma.producto, 'Costilla Preparada', 'tampoco contra el nombre real del terminado');

  console.log('movimientosDesdeProduccion_ genera consumo/merma cuando la fila los trae: OK');
})();

(function () {
  // Una producción SIN insumo/merma (como todas las que había antes de jul 2026) sigue generando
  // UN solo movimiento — nada de esto es retroactivo ni obligatorio.
  const fx = fixtures_();
  const mod = cargarMovimientos_(fx);
  const deP1 = mod.movimientosInventarioListar_({ indice: {} }).filter((m) => m.documento_relacionado === 'p1');
  assert.equal(deP1.length, 1);
  assert.equal(deP1[0].tipo_movimiento, 'Entrada por producción');
  console.log('movimientosDesdeProduccion_ sin insumo/merma sigue generando un solo movimiento: OK');
})();

(function () {
  // La propiedad importante: declarar insumo/merma NO debe alterar el inventario teórico calculado
  // para el producto TERMINADO (solo afecta al insumo crudo, que se resta UNA sola vez).
  const fx = fixtures_();
  fx.producciones = [{
    id: 'p2', fecha: '2026-07-07', sede: 'Centro de Producción', item: 'Costilla Preparada',
    cantidad: 18.2, unidad: 'kg', usuario: 'Juan',
    insumo_producto: 'Costilla cruda', insumo_cantidad: 25, insumo_unidad: 'kg', merma_cantidad: 6.8
  }];
  fx.ajustes = [];
  fx.traslados = [];
  fx.conteos = [];
  const mod = cargarMovimientos_(fx);

  const terminado = mod.calcularInventarioTeorico_('Costilla Preparada', 'Centro de Producción', '2026-07-10', {});
  assert.equal(terminado.cantidad, 18200, 'el terminado debe reflejar exactamente lo producido (18.2 kg), sin que la merma lo toque');

  const crudo = mod.calcularInventarioTeorico_('Costilla cruda', 'Centro de Producción', '2026-07-10', {});
  assert.equal(crudo.cantidad, -25000, 'el insumo crudo debe restarse UNA sola vez (25 kg), no 31.8 kg (25 + 6.8 de merma)');

  console.log('la merma de producción no descuenta dos veces el insumo ni afecta al terminado: OK');
})();

// --- calcularInventarioTeorico_: último conteo + movimientos posteriores, con signo -------------

(function () {
  const fx = fixtures_();
  fx.conteos = [
    { fecha: '2026-07-01', sede: 'Capri', producto: 'Costilla', unidad: 'kg', cantidad: 10 }
  ];
  const mod = cargarMovimientos_(fx);

  // Conteo (10 kg, 1 jul) + compra del 1 jul (mismo día del conteo, NO debe sumar aparte) ...
  // en realidad la compra a1 es del mismo día que el conteo (2026-07-01): no debe sumar.
  // La merma a2 es del 2 jul (posterior): sí debe restar. El traslado recibido en Capri es 4 jul: sí debe sumar.
  const resultado = mod.calcularInventarioTeorico_('Costilla', 'Capri', '2026-07-10', {});
  // 10000 g (10 kg) - 1000 g (merma 1 kg) + 1900 g (1.9 kg recibidos) = 10900 g
  assert.equal(resultado.unidad, 'g');
  assert.equal(resultado.cantidad, 10900);
  assert.equal(resultado.ultimo_conteo.cantidad, 10);

  // Fecha de corte ANTES del traslado recibido: no debe incluirlo.
  const resultadoAntes = mod.calcularInventarioTeorico_('Costilla', 'Capri', '2026-07-03', {});
  assert.equal(resultadoAntes.cantidad, 9000, '10000 - 1000 (merma), sin el traslado recibido (4 jul es posterior al corte)');

  console.log('calcularInventarioTeorico_ combina último conteo + movimientos posteriores: OK');
})();

(function () {
  // Sin ningún conteo previo, arranca en 0 y suma lo que haya hasta la fecha de corte.
  const fx = fixtures_();
  fx.conteos = [];
  const mod = cargarMovimientos_(fx);
  const resultado = mod.calcularInventarioTeorico_('Costilla Preparada', 'Capri', '2026-07-10', {});
  assert.equal(resultado.cantidad, 3000, 'sin conteo previo, la producción de 3 kg debe aparecer igual (3000 g)');
  assert.equal(resultado.ultimo_conteo, null);
  console.log('calcularInventarioTeorico_ sin conteo previo: OK');
})();

console.log('movimientos-inventario: OK');
