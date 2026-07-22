const fs = require('fs');
const vm = require('vm');
const assert = require('assert');

function cargar(path, extras = {}) {
  const ctx = Object.assign({ console }, extras);
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path, 'utf8'), ctx, { filename: path });
  return ctx;
}

const ajustesGuardados = [];
const compras = cargar('apps-script/Compras.gs', {
  SHEET_NAMES: { AJUSTES_INVENTARIO: 'ajustes' },
  Utilities: { getUuid: () => 'id-' + (ajustesGuardados.length + 1) },
  normalizar_: (v) => String(v || '').trim().toLowerCase(),
  leerTabla_: (hoja) => hoja === 'ajustes' ? ajustesGuardados : [],
  appendRowFromObj_: (hoja, fila) => { if (hoja === 'ajustes') ajustesGuardados.push(fila); },
  ajusteInventarioRegistrar_: (item) => {
    ajustesGuardados.push(Object.assign({ tipo: 'Compra cruda' }, item));
    return { ok: true };
  },
  catalogoAsegurar_: () => {}
});

const usuario = { nombre: 'Diana', sede: 'Ambas' };
const factura = { fecha: '2026-07-21', proveedor: 'Mercamio', numero_factura: 'F-1', sede: 'Centro de Producción',
  lineas: [{ producto: 'Costilla', unidad: 'kg', cantidad: 1, costo: 100 }] };

const resultado = compras.compraRegistrarFactura_(factura, usuario);
assert.equal(resultado.ok, true);
assert.equal(resultado.total, 100);
assert.equal(ajustesGuardados.length, 1, 'debe registrar una línea de ajuste por línea de factura');

assert.equal(
  compras.compraRegistrarFactura_(Object.assign({}, factura, { proveedor: '' }), usuario).ok,
  false,
  'debe exigir proveedor'
);
assert.equal(
  compras.compraRegistrarFactura_(factura, { nombre: 'Diana', sede: 'San Antonio' }).ok,
  false,
  'debe bloquear registrar una compra fuera de la sede del usuario'
);
// NOTA: compraRegistrarFactura_ no valida hoy número de factura duplicado ni que el total
// declarado coincida con la suma de las líneas — se decidió conscientemente no agregar esa
// lógica en esta pasada (ver auditoría), solo alinear la prueba con el comportamiento real.

const traslados = [
  { fecha: '2026-07-20', timestamp_recibe: '2026-07-21', estado: 'Resuelto', producto: 'Costilla', unidad: 'kg', cantidad_enviada: 5, cantidad_recibida: 3, sede_origen: 'Centro de Producción', sede_destino: 'Capri' }
];
const conciliacion = cargar('apps-script/Conciliacion.gs', {
  SHEET_NAMES: { TRASLADOS: 'traslados' },
  leerTabla_: () => traslados,
  formatearFecha_: (v) => String(v).slice(0, 10),
  claveProducto_: (v) => v,
  aUnidadBase_: (cantidad, unidad) => ({ cantidad: Number(cantidad), unidad })
});
assert.equal(conciliacion.trasladosNetosPorItem_('2026-07-21', 'Centro de Producción', {}).Costilla.cantidad, -5);
assert.equal(conciliacion.trasladosNetosPorItem_('2026-07-21', 'Capri', {}).Costilla.cantidad, 3);
assert.deepEqual(conciliacion.trasladosNetosPorItem_('2026-07-20', 'Capri', {}), {}, 'debe conciliarse en fecha de recepción');

// --- Disponible Hoy: compras/mermas registradas después del último conteo, por sede ---------
const conteosStock = [
  { fecha: '2026-07-01', sede: 'Capri', producto: 'Costilla', unidad: 'g', cantidad: 100 }
];
const ajustesStock = [
  { fecha: '2026-07-05', sede: 'Capri', producto: 'Costilla', unidad: 'g', cantidad: 50, tipo: 'Compra cruda' },
  { fecha: '2026-07-06', sede: 'Capri', producto: 'Costilla', unidad: 'g', cantidad: 10, tipo: 'Merma / desperdicio' },
  { fecha: '2026-07-10', sede: 'San Antonio', producto: 'Costilla', unidad: 'g', cantidad: 999, tipo: 'Compra cruda' }
];
const disponibleHoy = cargar('apps-script/DisponibleHoy.gs', {
  SHEET_NAMES: { CONTEOS: 'conteos', AJUSTES_INVENTARIO: 'ajustes' },
  leerTabla_: (hoja) => hoja === 'conteos' ? conteosStock : (hoja === 'ajustes' ? ajustesStock : []),
  formatearFecha_: (v) => String(v).slice(0, 10),
  claveProducto_: (texto) => String(texto || '').trim().toLowerCase(),
  nombreCanonico_: (texto) => texto,
  aUnidadBase_: (cantidad, unidad) => ({ cantidad: Number(cantidad), unidad })
});

assert.equal(
  disponibleHoy.obtenerUltimoStockPorIngrediente_('2026-07-08', {}, 'Capri').costilla.cantidad, 140,
  'una compra suma y una merma resta al stock de Capri después del conteo'
);
assert.equal(
  disponibleHoy.obtenerUltimoStockPorIngrediente_('2026-07-05', {}, 'Capri').costilla.cantidad, 150,
  'no debe contar ajustes posteriores a la fecha de corte'
);
assert.equal(
  disponibleHoy.obtenerUltimoStockPorIngrediente_('2026-07-08', {}, 'San Antonio').costilla, undefined,
  'una compra en Capri no debe afectar el stock de San Antonio'
);

// --- Disponible Hoy: producto comprado por primera vez, SIN ningún conteo físico previo -------
// (bug reportado: un banano recién comprado no aparecía en absoluto en Disponible Hoy porque el
// cálculo solo miraba compras de productos que YA tenían al menos un conteo).
const sinConteoAjustes = [
  { fecha: '2026-07-21', sede: 'Capri', producto: 'Banano', unidad: 'u', cantidad: 12, tipo: 'Compra cruda' }
];
const disponibleHoySinConteo = cargar('apps-script/DisponibleHoy.gs', {
  SHEET_NAMES: { CONTEOS: 'conteos', AJUSTES_INVENTARIO: 'ajustes', TRASLADOS: 'traslados' },
  leerTabla_: (hoja) => hoja === 'ajustes' ? sinConteoAjustes : [],
  formatearFecha_: (v) => String(v).slice(0, 10),
  claveProducto_: (texto) => String(texto || '').trim().toLowerCase(),
  nombreCanonico_: (texto) => texto,
  aUnidadBase_: (cantidad, unidad) => ({ cantidad: Number(cantidad), unidad })
});
const stockSinConteo = disponibleHoySinConteo.obtenerUltimoStockPorIngrediente_('2026-07-22', {}, 'Capri');
assert.equal(stockSinConteo.banano.cantidad, 12, 'una compra de un producto nunca contado igual debe aparecer con esa cantidad');
assert.equal(stockSinConteo.banano.unidad, 'u');

// --- Catálogo: crear producto automáticamente si no existe todavía ---------------------------
const catalogoGuardado = [];
const catalogoMod = cargar('apps-script/Catalogo.gs', {
  SHEET_NAMES: { CATALOGO: 'catalogo' },
  Utilities: { getUuid: () => 'id-' + (catalogoGuardado.length + 1) },
  Logger: { log: () => {} },
  leerTabla_: () => catalogoGuardado,
  appendRowFromObj_: (hoja, fila) => catalogoGuardado.push(fila),
  sheet_: () => ({ getDataRange: () => ({ getValues: () => [['id', 'nombre_estandar', 'unidad_base', 'categoria']] }) }),
  normalizarUnidad_: (u) => String(u || '').trim().toLowerCase()
});
catalogoMod.catalogoAsegurar_('Producto Nuevo', 'kg');
assert.equal(catalogoGuardado.length, 1, 'debe crear el producto si no existe en el catálogo');
assert.equal(catalogoGuardado[0].nombre_estandar, 'Producto Nuevo');
catalogoMod.catalogoAsegurar_('producto nuevo', 'kg');
assert.equal(catalogoGuardado.length, 1, 'no debe duplicar si ya existe (comparación sin tildes/mayúsculas)');

// --- Extremo a extremo: compra sube el stock Y "para cuántos platos alcanza" (ejemplo del banano) ---
const conteoBanano = [
  { fecha: '2026-07-01', sede: 'San Antonio', producto: 'Banano', unidad: 'u', cantidad: 2 }
];
const ajusteBanano = [
  { fecha: '2026-07-05', sede: 'San Antonio', producto: 'Banano', unidad: 'u', cantidad: 4, tipo: 'Compra cruda' }
];
const disponibleHoyBanano = cargar('apps-script/DisponibleHoy.gs', {
  SHEET_NAMES: { CONTEOS: 'conteos', AJUSTES_INVENTARIO: 'ajustes' },
  leerTabla_: (hoja) => hoja === 'conteos' ? conteoBanano : (hoja === 'ajustes' ? ajusteBanano : []),
  formatearFecha_: (v) => String(v).slice(0, 10),
  claveProducto_: (texto) => String(texto || '').trim().toLowerCase(),
  nombreCanonico_: (texto) => texto,
  normalizar_: (v) => String(v || '').trim().toLowerCase(),
  aUnidadBase_: (cantidad, unidad) => ({ cantidad: Number(cantidad), unidad })
});

const stockBanano = disponibleHoyBanano.obtenerUltimoStockPorIngrediente_('2026-07-08', {}, 'San Antonio');
assert.equal(stockBanano.banano.cantidad, 6, '2 contados + 4 comprados = 6 bananos disponibles');

const recetaMapBanano = disponibleHoyBanano.construirRecetaMap_(
  [{ producto: 'Wafle de Banano', ingrediente: 'Banano', cantidad: 1, unidad: 'u', tipo: 'plato', controla_disponibilidad: true }],
  {}
);
const disponibilidadWafle = disponibleHoyBanano.cantidadDisponibleDetallada_('wafle de banano', recetaMapBanano, stockBanano, {}, {}, {});
assert.equal(Math.floor(disponibilidadWafle.disponible), 6, 'con 6 bananos y receta 1 banano/wafle, alcanza para 6 wafles de banano');

// --- Registrar conteo: bloqueo de productos obligatorios también en el backend (no solo en la
// pantalla) — mismo criterio que conteo.html: Diario siempre, Miércoles/Viernes según el día,
// Mensual del 1 al 5 del mes. ------------------------------------------------------------------
const catalogoObligatorios = [
  { nombre_estandar: 'Lavaloza', frecuencia_conteo: 'Diario' },
  { nombre_estandar: 'Detergente', frecuencia_conteo: 'Miércoles' },
  { nombre_estandar: 'Sal', frecuencia_conteo: 'Viernes' },
  { nombre_estandar: 'Tenedores', frecuencia_conteo: 'Mensual' },
  { nombre_estandar: 'Servilletas', frecuencia_conteo: '' }
];
const catalogoMod2 = cargar('apps-script/Catalogo.gs', { normalizar_: (v) => String(v || '').trim().toLowerCase() });
const conteosMod = cargar('apps-script/Conteos.gs', {
  SHEET_NAMES: { CATALOGO: 'catalogo' },
  leerTabla_: () => catalogoObligatorios,
  normalizar_: (v) => String(v || '').trim().toLowerCase(),
  frecuenciasObligatoriasDelDia_: catalogoMod2.frecuenciasObligatoriasDelDia_
});

assert.deepEqual(
  catalogoMod2.frecuenciasObligatoriasDelDia_('2026-07-01'), ['Diario', 'Miércoles', 'Mensual'],
  '1 de julio 2026 es miércoles y día 1: Diario + Miércoles + Mensual'
);
assert.deepEqual(
  catalogoMod2.frecuenciasObligatoriasDelDia_('2026-07-08'), ['Diario', 'Miércoles'],
  '8 de julio es miércoles pero fuera del 1-5: sin Mensual'
);
assert.deepEqual(catalogoMod2.frecuenciasObligatoriasDelDia_('2026-07-06'), ['Diario'], '6 de julio es lunes: solo Diario');

assert.deepEqual(
  conteosMod.productosObligatoriosFaltantes_([
    { fecha: '2026-07-01', sede: 'San Antonio', punto_conteo: 'Bodega', producto: 'Lavaloza', unidad: 'g', cantidad: 100 }
  ]).sort(),
  ['Detergente', 'Tenedores'],
  'falta Detergente (miércoles) y Tenedores (mensual, día 1) aunque ya se contó Lavaloza'
);
assert.deepEqual(
  conteosMod.productosObligatoriosFaltantes_([
    { fecha: '2026-07-01', sede: 'San Antonio', punto_conteo: 'Bodega', producto: 'Lavaloza', unidad: 'g', cantidad: 100 },
    { fecha: '2026-07-01', sede: 'San Antonio', punto_conteo: 'Bodega', producto: 'Detergente', unidad: 'g', cantidad: 50 },
    { fecha: '2026-07-01', sede: 'San Antonio', punto_conteo: 'Bodega', producto: 'Tenedores', unidad: 'u', cantidad: 20 }
  ]), [],
  'sin faltantes cuando ya están los tres obligatorios de ese día'
);

// --- Disponible Hoy: traslado recibido y confirmado suma al stock de la sede que lo recibe -----
const conteosTraslado = [
  { fecha: '2026-07-01', sede: 'Capri', producto: 'Costilla', unidad: 'g', cantidad: 100 }
];
const trasladosStock = [
  // Confirmado y recibido después del conteo: debe sumar lo REALMENTE recibido (30, no lo enviado).
  { fecha: '2026-07-03', timestamp_recibe: '2026-07-04', estado: 'Confirmado', producto: 'Costilla', unidad: 'g',
    cantidad_enviada: 50, cantidad_recibida: 30, sede_origen: 'Centro de Producción', sede_destino: 'Capri' },
  // Todavía "Enviado" (no confirmado): no debe contar mientras no se confirme.
  { fecha: '2026-07-05', timestamp_recibe: '', estado: 'Enviado', producto: 'Costilla', unidad: 'g',
    cantidad_enviada: 999, cantidad_recibida: '', sede_origen: 'Centro de Producción', sede_destino: 'Capri' },
  // Recibido en San Antonio: no debe afectar el stock de Capri.
  { fecha: '2026-07-03', timestamp_recibe: '2026-07-04', estado: 'Confirmado', producto: 'Costilla', unidad: 'g',
    cantidad_enviada: 999, cantidad_recibida: 999, sede_origen: 'Centro de Producción', sede_destino: 'San Antonio' }
];
const disponibleHoyTraslado = cargar('apps-script/DisponibleHoy.gs', {
  SHEET_NAMES: { CONTEOS: 'conteos', AJUSTES_INVENTARIO: 'ajustes', TRASLADOS: 'traslados' },
  leerTabla_: (hoja) => hoja === 'conteos' ? conteosTraslado : (hoja === 'traslados' ? trasladosStock : []),
  formatearFecha_: (v) => String(v).slice(0, 10),
  claveProducto_: (texto) => String(texto || '').trim().toLowerCase(),
  nombreCanonico_: (texto) => texto,
  aUnidadBase_: (cantidad, unidad) => ({ cantidad: Number(cantidad), unidad })
});
assert.equal(
  disponibleHoyTraslado.obtenerUltimoStockPorIngrediente_('2026-07-08', {}, 'Capri').costilla.cantidad, 130,
  '100 contados + 30 recibidos por traslado confirmado = 130 (no cuenta el "Enviado" sin confirmar ni lo de San Antonio)'
);

// --- Conciliación: una venta cancelada no debe contar como venta, sin importar tilde/mayúscula --
// (bug real: el export de FUDO trae "Cancelada" = "Si" sin tilde, pero el filtro solo reconocía
// "Sí" con tilde exacta — una venta cancelada se contaba como válida en "ventas esperadas").
function normalizarSimple_(s) {
  return String(s || '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}
const ventasFudo = [
  { creacion: '2026-07-20', sede: 'Capri', categoria: 'Bebidas', producto: 'Aguila Light', cantidad: 2, cancelada: 'No' },
  { creacion: '2026-07-20', sede: 'Capri', categoria: 'Bebidas', producto: 'Aguila Light', cantidad: 5, cancelada: 'Si' }, // sin tilde, como en el export real
  { creacion: '2026-07-20', sede: 'Capri', categoria: 'Bebidas', producto: 'Poker', cantidad: 3, cancelada: 'Sí' }, // con tilde
  { creacion: '2026-07-20', sede: 'Capri', categoria: 'Conos', producto: 'Falafel', cantidad: 1, cancelada: false }
];
const conciliacionCancelada = cargar('apps-script/Conciliacion.gs', {
  SHEET_NAMES: { VENTAS_FUDO: 'ventas' },
  leerTabla_: (hoja) => hoja === 'ventas' ? ventasFudo : [],
  formatearFecha_: (v) => String(v).slice(0, 10),
  normalizar_: normalizarSimple_
});
const resumen = conciliacionCancelada.resumirVentasFudo_('2026-07-20');
assert.equal(resumen.length, 2, 'solo las 2 ventas no canceladas deben quedar en el resumen');
assert.equal(resumen.find(r => r.producto === 'Aguila Light').cantidad, 2, 'la venta cancelada sin tilde no debe sumarse');
assert.equal(resumen.some(r => r.producto === 'Poker'), false, 'la venta cancelada con tilde tampoco debe sumarse');

// --- Importar FUDO: dos ventas reales que comparten Id. Venta + Producto no deben perderse -----
// (bug real, encontrado con un export real de FUDO: el mismo producto agregado dos veces a la
// misma mesa —a veces a horas distintas, a veces a la misma hora exacta— generaba la misma llave
// de deduplicación que "esta fila ya se había importado antes", y la segunda venta real se
// descartaba en silencio como si fuera un duplicado).
let ventasGuardadas = [];
function cargarFudo_(previas) {
  ventasGuardadas = previas || [];
  return cargar('apps-script/Fudo.gs', {
    SHEET_NAMES: { VENTAS_FUDO: 'ventas', MOVIMIENTOS_FUDO: 'movimientos' },
    normalizar_: normalizarSimple_,
    formatearFecha_: (v) => String(v).slice(0, 10),
    leerTabla_: (hoja) => hoja === 'ventas' ? ventasGuardadas : [],
    appendRowFromObj_: (hoja, fila) => { if (hoja === 'ventas') ventasGuardadas.push(fila); }
  });
}

const usuarioFudo = { nombre: 'Diana' };
const filasPoker = [
  { 'Id. Venta': 31300, 'Creación': '2026-07-20 19:58:32', Producto: 'Poker', Cantidad: 2, Precio: 13000, 'Creada por': 'terraza', Cancelada: 'No' },
  { 'Id. Venta': 31300, 'Creación': '2026-07-20 20:47:36', Producto: 'Poker', Cantidad: 2, Precio: 13000, 'Creada por': 'terraza', Cancelada: 'No' }
];

const fudoPrimeraVez = cargarFudo_([]);
const resultadoPrimeraVez = fudoPrimeraVez.importarFudo_('ventas', filasPoker, usuarioFudo, { sede: 'San Antonio' });
assert.equal(resultadoPrimeraVez.importados, 2, 'las dos ventas reales de Poker en la misma mesa deben importarse, no solo la primera');
assert.equal(resultadoPrimeraVez.omitidos_duplicados, 0);

// Reimportar EXACTAMENTE el mismo archivo (ej. por error) sí debe reconocerse como duplicado esta vez.
const fudoSegundaVez = cargarFudo_(ventasGuardadas.slice());
const resultadoSegundaVez = fudoSegundaVez.importarFudo_('ventas', filasPoker, usuarioFudo, { sede: 'San Antonio' });
assert.equal(resultadoSegundaVez.importados, 0, 'reimportar el mismo archivo no debe duplicar las ventas ya guardadas');
assert.equal(resultadoSegundaVez.omitidos_duplicados, 2);

console.log('inventory-controls: OK');
