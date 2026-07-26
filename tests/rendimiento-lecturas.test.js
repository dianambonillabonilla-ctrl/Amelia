/**
 * RENDIMIENTO DE LECTURAS AL SHEET
 *
 * Cada leerTabla_ es una llamada real a la API de Sheets, y Apps Script corta cualquier ejecución a
 * los 6 minutos. Estas pruebas fijan el número de lecturas que puede costar un cálculo, para que un
 * cambio futuro no vuelva a dejar una pantalla imposible de abrir.
 *
 * El caso real que motivó esto (jul 2026): `disponible_hoy` (lo primero que carga el dashboard)
 * recorría el rango de fechas día por día y, para un producto sin conteo físico previo, ese rango
 * arrancaba en 1970 — ~20.000 días × 3 tablas de Fudo = ~62.000 lecturas al Sheet por UN producto.
 * La pantalla nunca alcanzaba a responder. Además los días sin ventas no se memoizaban, así que el
 * caché no ayudaba justo en los días vacíos, que son la mayoría de un rango largo.
 */
const fs = require('fs');
const vm = require('vm');
const assert = require('assert');

const ARCHIVOS = [
  'apps-script/MovimientosInventario.gs',
  'apps-script/FudoLectores.gs',
  'apps-script/DisponibleHoy.gs'
];

function normalizarSimple_(s) {
  return String(s || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ');
}

/**
 * Carga los módulos implicados en un mismo contexto (como los une Apps Script) con un leerTabla_
 * que cuenta cuántas veces se pide cada hoja.
 */
function cargarConContador(tablas, opciones = {}) {
  const lecturas = {};
  const ctx = {
    console,
    SHEET_NAMES: {
      CONTEOS: 'Conteos_Manuales',
      AJUSTES_INVENTARIO: 'Ajustes_Inventario',
      TRASLADOS: 'Traslados',
      PRODUCCIONES: 'Producciones',
      RECETAS: 'Recetas',
      FUDO_ITEMS: 'Fudo_Items',
      FUDO_SUBITEMS: 'Fudo_Subitems',
      VENTAS_FUDO: 'Ventas_FUDO',
      MOVIMIENTOS_INVENTARIO: 'Movimientos_Inventario'
    },
    normalizar_: normalizarSimple_,
    formatearFecha_: (v) => (v ? String(v instanceof Date ? v.toISOString() : v).slice(0, 10) : ''),
    claveProducto_: (texto) => normalizarSimple_(texto),
    nombreCanonico_: (texto) => texto,
    aUnidadBase_: (cantidad, unidad) => ({ cantidad: Number(cantidad) || 0, unidad: normalizarSimple_(unidad) }),
    indiceCatalogo_: () => ({}),
    recetasVigentes_: () => tablas.Recetas || [],
    ventaCancelada_: (v) => v.cancelada === true || normalizarSimple_(v.cancelada) === 'si',
    claveRecetaVenta_: (producto) => normalizarSimple_(producto),
    movimientoUbicacion_: (sede, punto) => (punto ? sede + ' / ' + punto : sede),
    leerTabla_: (hoja) => {
      lecturas[hoja] = (lecturas[hoja] || 0) + 1;
      return (tablas[hoja] || []).slice();
    }
  };
  Object.assign(ctx, opciones);
  vm.createContext(ctx);
  ARCHIVOS.forEach((archivo) => {
    vm.runInContext(fs.readFileSync(archivo, 'utf8'), ctx, { filename: archivo });
  });
  ctx.__lecturas = lecturas;
  ctx.__total = () => Object.values(lecturas).reduce((a, b) => a + b, 0);
  return ctx;
}

const HOY = '2026-07-26';

function tablasBase() {
  return {
    Conteos_Manuales: [
      // "Papa" sí tiene conteo; "Banano" nunca se contó (solo se compró) — ese es el caso crítico.
      { fecha: '2026-07-25', sede: 'San Antonio', punto_conteo: 'Cocina', producto: 'Papa', unidad: 'g', cantidad: 1000, timestamp: '2026-07-25T08:00:00Z' }
    ],
    Ajustes_Inventario: [
      { id: 'a1', fecha: HOY, sede: 'San Antonio', punto: 'Bodega', tipo: 'Compra cruda', producto: 'Banano', unidad: 'g', cantidad: 5000, timestamp: HOY + 'T09:00:00Z' }
    ],
    Traslados: [],
    Producciones: [],
    Recetas: [],
    Fudo_Items: [
      { id_venta: 'V1', creacion: HOY + 'T13:00:00Z', producto: 'Papa', cantidad: 1, precio: 1000, cancelada: false, sede: 'San Antonio' }
    ],
    Fudo_Subitems: [],
    Ventas_FUDO: []
  };
}

// --- 1. Un producto sin conteo previo no puede provocar un escaneo del calendario desde 1970 ------

(function () {
  const mod = cargarConContador(tablasBase());
  const stock = mod.obtenerUltimoStockPorIngrediente_(HOY, {}, 'San Antonio');

  // El resultado tiene que seguir siendo el correcto: Banano solo tiene la compra de 5000 g.
  assert.equal(stock.banano.cantidad, 5000, 'un producto sin conteo previo suma solo sus compras');
  assert.equal(stock.papa.cantidad, 1000, 'un producto con conteo mantiene su último conteo');

  const total = mod.__total();
  assert.ok(
    total < 40,
    `obtenerUltimoStockPorIngrediente_ debe costar unas pocas lecturas, no una por día de calendario ` +
    `(fueron ${total}; antes de la corrección eran ~62.000 por cada producto sin conteo)`
  );
  console.log(`producto sin conteo previo no escanea el calendario (${total} lecturas): OK`);
})();

// --- 2. Los días SIN ventas también se memoizan --------------------------------------------------

(function () {
  const mod = cargarConContador(tablasBase());
  const cache = {};

  const antes = mod.__total();
  const primera = mod.movimientosDesdeVentas_('2020-01-01', 'San Antonio', {}, cache);
  const costePrimera = mod.__total() - antes;

  const segunda = mod.movimientosDesdeVentas_('2020-01-01', 'San Antonio', {}, cache);
  const costeSegunda = mod.__total() - antes - costePrimera;

  assert.deepEqual(primera, [], 'un día sin ventas no genera movimientos');
  assert.deepEqual(segunda, [], 'la segunda consulta del mismo día vacío devuelve lo mismo');
  assert.ok(costePrimera > 0, 'la primera consulta sí lee el Sheet');
  assert.equal(costeSegunda, 0, 'un día sin ventas ya consultado no debe volver a leer el Sheet');
  console.log('los días sin ventas se memoizan: OK');
})();

// --- 3. fudoFechasConVentas_ solo devuelve días con datos reales ---------------------------------

(function () {
  const tablas = tablasBase();
  tablas.Fudo_Items = [
    { id_venta: 'V1', creacion: '2026-07-20T13:00:00Z', producto: 'Papa', cantidad: 1, sede: 'San Antonio' },
    { id_venta: 'V2', creacion: '2026-07-26T13:00:00Z', producto: 'Papa', cantidad: 1, sede: 'San Antonio' },
    { id_venta: 'V3', creacion: '2026-07-22T13:00:00Z', producto: 'Papa', cantidad: 1, sede: 'Capri' }
  ];
  // Un día que solo existe en la tabla plana: también debe aparecer (la unión cubre los dos caminos
  // del fallback de ventasFudoLineasParaFecha_).
  tablas.Ventas_FUDO = [
    { id_venta: 'V0', creacion: '2026-06-01T13:00:00Z', producto: 'Papa', cantidad: 1, sede: 'San Antonio' }
  ];
  const mod = cargarConContador(tablas);

  const sa = mod.fudoFechasConVentas_('San Antonio', {});
  assert.deepEqual(sa, ['2026-06-01', '2026-07-20', '2026-07-26'], 'solo los días con ventas de esa sede, ordenados');

  const capri = mod.fudoFechasConVentas_('Capri', {});
  assert.deepEqual(capri, ['2026-07-22'], 'la sede filtra los días');

  const enRango = mod.fudoFechasConVentasEnRango_('San Antonio', '2026-07-20', HOY, {});
  assert.deepEqual(enRango, ['2026-07-26'], 'el rango excluye el día del conteo e incluye el corte');

  assert.deepEqual(
    mod.fudoFechasConVentasEnRango_('San Antonio', '', '', {}),
    [],
    'sin fecha de corte no hay rango que recorrer'
  );

  // Con caché, la segunda llamada no vuelve a leer.
  const cache = {};
  mod.fudoFechasConVentas_('San Antonio', cache);
  const trasPrimera = mod.__total();
  mod.fudoFechasConVentas_('San Antonio', cache);
  assert.equal(mod.__total(), trasPrimera, 'fudoFechasConVentas_ se memoiza en el caché compartido');
  console.log('fudoFechasConVentas_ solo devuelve días con datos y se memoiza: OK');
})();

// --- 4. El consumo por ventas se sigue restando igual que antes ----------------------------------

(function () {
  const tablas = tablasBase();
  // Papa: conteo de 1000 g el 25, y el 26 se venden 2 unidades de un plato que gasta 100 g cada uno.
  tablas.Recetas = [
    { producto: 'Arepa', ingrediente: 'Papa', cantidad: 100, unidad: 'g', tipo: 'plato', estado: 'activo' }
  ];
  tablas.Fudo_Items = [
    { id_venta: 'V1', creacion: HOY + 'T13:00:00Z', producto: 'Arepa', cantidad: 2, precio: 1000, cancelada: false, sede: 'San Antonio' }
  ];
  const mod = cargarConContador(tablas, {
    explotarReceta_: (clave, cantidad, recetaMap, acumulado) => {
      acumulado.papa = { nombre: 'Papa', cantidad: (acumulado.papa ? acumulado.papa.cantidad : 0) + cantidad * 100, unidad: 'g' };
    },
    construirRecetaMap_: () => ({ arepa: { nombre: 'Arepa', tipo: 'plato', lineas: [] } })
  });

  const stock = mod.obtenerUltimoStockPorIngrediente_(HOY, {}, 'San Antonio');
  assert.equal(stock.papa.cantidad, 800, '1000 g contados menos 200 g vendidos = 800 g');
  console.log('el consumo por ventas se resta igual que antes (1000 - 200 = 800): OK');
})();

// --- 5. El libro de inventario tampoco recorre el calendario día por día -------------------------

(function () {
  const tablas = tablasBase();
  tablas.Fudo_Items = [
    { id_venta: 'V1', creacion: HOY + 'T13:00:00Z', producto: 'Papa', cantidad: 1, precio: 1000, cancelada: false, sede: 'San Antonio' }
  ];
  const mod = cargarConContador(tablas);

  // Un rango de dos años con un solo día de ventas: antes costaba ~730 días × 3 tablas.
  mod.movimientosInventarioListar_({
    fecha_desde: '2024-07-26',
    fecha_hasta: HOY,
    sede: 'San Antonio',
    incluir_consumo_ventas: true,
    incluir_cancelaciones_ventas: true,
    indice: {}
  });
  const total = mod.__total();
  assert.ok(
    total < 40,
    `un rango de 2 años con un solo día de ventas debe costar unas pocas lecturas (fueron ${total})`
  );
  console.log(`el libro no recorre el calendario día por día (${total} lecturas): OK`);
})();

console.log('rendimiento-lecturas: OK');
