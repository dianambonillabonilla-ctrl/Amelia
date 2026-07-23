const fs = require('fs');
const vm = require('vm');
const assert = require('assert');

function cargar(path, extras = {}) {
  const ctx = Object.assign({ console }, extras);
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path, 'utf8'), ctx, { filename: path });
  return ctx;
}

// Espejo de sedeEscrituraPermitida_ en Code.gs — en Apps Script real todos los archivos comparten
// un mismo scope global, pero aquí cada .gs se carga en un contexto aislado, así que hay que
// pasarla como mock a cada módulo que la use.
function sedeEscrituraPermitidaMock_(usuario, sede) {
  return usuario.rol === 'Administrador' || usuario.sede === 'Ambas' ||
    sede === usuario.sede || sede === 'Centro de Producción';
}

const ajustesGuardados = [];
const compras = cargar('apps-script/Compras.gs', {
  SHEET_NAMES: { AJUSTES_INVENTARIO: 'ajustes' },
  Utilities: { getUuid: () => 'id-' + (ajustesGuardados.length + 1) },
  normalizar_: (v) => String(v || '').trim().toLowerCase(),
  formatearFecha_: (v) => String(v).slice(0, 10),
  leerTabla_: (hoja) => hoja === 'ajustes' ? ajustesGuardados : [],
  appendRowFromObj_: (hoja, fila) => { if (hoja === 'ajustes') ajustesGuardados.push(fila); },
  ajusteInventarioRegistrar_: (item) => {
    ajustesGuardados.push(Object.assign({ tipo: 'Compra cruda' }, item));
    return { ok: true };
  },
  catalogoAsegurar_: () => {},
  sedeEscrituraPermitida_: sedeEscrituraPermitidaMock_
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
  compras.compraRegistrarFactura_(Object.assign({}, factura, { sede: 'Capri' }), { nombre: 'Diana', sede: 'San Antonio' }).ok,
  false,
  'debe bloquear registrar una compra fuera de la sede del usuario'
);
// Excepción explícita: San Antonio/Capri/Ambas SÍ pueden registrar en Centro de Producción, aunque
// no sea su propia sede — pedido real: "el que sea de san antonio o capri o ambas todos deben de
// poder guardar cosas del centro de producción".
assert.equal(
  compras.compraRegistrarFactura_(factura, { nombre: 'Diana', sede: 'San Antonio' }).ok,
  true,
  'San Antonio SÍ debe poder registrar una compra para Centro de Producción'
);
// NOTA: compraRegistrarFactura_ no valida hoy número de factura duplicado ni que el total
// declarado coincida con la suma de las líneas — se decidió conscientemente no agregar esa
// lógica en esta pasada (ver auditoría), solo alinear la prueba con el comportamiento real.

// --- Compras: una misma factura puede traer productos para sedes distintas --------------------
// (pedido real: "si compro 3 aceites los 3 no son para capri, si compro costilla cruda debería
// de poner adicionarla a centro de producción" — antes toda la factura tenía UNA sola sede y
// cada línea heredaba esa sede sin poder cambiarla).
const ajustesAntesMixta = ajustesGuardados.length;
const facturaMixta = {
  fecha: '2026-07-22', proveedor: 'Mercamio', numero_factura: 'F-2',
  lineas: [
    { producto: 'Costilla cruda', sede: 'Centro de Producción', unidad: 'kg', cantidad: 5, costo: 200 },
    { producto: 'Aceite', sede: 'Capri', unidad: 'l', cantidad: 2, costo: 30 },
    { producto: 'Aceite', sede: 'San Antonio', unidad: 'l', cantidad: 1, costo: 15 }
  ]
};
const resultadoMixta = compras.compraRegistrarFactura_(facturaMixta, usuario);
assert.equal(resultadoMixta.ok, true, 'una factura sin sede única, con sede por línea, debe guardarse');
assert.equal(resultadoMixta.total, 245);
const lineasMixta = ajustesGuardados.slice(ajustesAntesMixta);
assert.deepEqual(lineasMixta.map(l => l.sede), ['Centro de Producción', 'Capri', 'San Antonio'],
  'cada línea debe quedar registrada en SU PROPIA sede, no en una sola sede de toda la factura');

const facturasMixtas = compras.comprasListar_(null, null, null).find(f => f.factura_id === resultadoMixta.factura_id);
assert.ok(facturasMixtas, 'la factura mixta debe aparecer en el listado');
assert.deepEqual(facturasMixtas.sedes.sort(), ['Capri', 'Centro de Producción', 'San Antonio'],
  'el listado debe mostrar TODAS las sedes distintas a las que llegó algo de esa factura');
assert.equal(facturasMixtas.lineas.find(l => l.producto === 'Costilla cruda').sede, 'Centro de Producción');

const soloCapri = compras.comprasListar_(null, null, 'Capri').find(f => f.factura_id === resultadoMixta.factura_id);
assert.equal(soloCapri.lineas.length, 1, 'filtrar por sede debe dejar ver solo las líneas de esa sede dentro de la factura');
assert.equal(soloCapri.lineas[0].producto, 'Aceite');

// Un usuario de una sola sede no puede colar, dentro de la misma factura, una línea para una sede
// que de verdad no le corresponde (Capri) — aunque las otras dos líneas de esta misma factura SÍ
// le estarían permitidas (San Antonio es la suya, Centro de Producción es la excepción general).
const resultadoBloqueadoMixta = compras.compraRegistrarFactura_(facturaMixta, { nombre: 'Encargada SA', sede: 'San Antonio' });
assert.equal(resultadoBloqueadoMixta.ok, false, 'debe bloquear la línea de Capri aunque las otras dos sean su sede o Centro de Producción');

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

// --- Catálogo: repara filas sin id (pegadas directo en el Sheet, sin pasar por Guardar producto) ---
// Sin id, "Eliminar" responde "Falta el id del producto a eliminar" y no hay con qué encontrar la
// fila. catalogoRepararIds_ debe asignarle uno nuevo a cada fila que llegó en blanco, sin tocar
// las que ya tienen (para no perder ediciones/eliminaciones ya hechas por ese id).
const filasCatalogoSheet = [
  ['id', 'nombre_estandar', 'categoria'],
  ['id-existente', 'Costilla Preparada', 'Elaborados'],
  ['', 'Aguila Light', 'Bebidas'],   // pegada a mano, sin id
  ['', 'Aguila Light', 'Bebidas']    // duplicado, también sin id
];
const escritos = [];
let contadorUuid = 0;
const catalogoReparar = cargar('apps-script/Catalogo.gs', {
  SHEET_NAMES: { CATALOGO: 'catalogo' },
  Utilities: { getUuid: () => 'id-nuevo-' + (++contadorUuid) },
  sheet_: () => ({
    getDataRange: () => ({ getValues: () => filasCatalogoSheet }),
    getRange: (fila, columna) => ({
      setValue: (valor) => { escritos.push({ fila, columna, valor }); filasCatalogoSheet[fila - 1][columna - 1] = valor; }
    })
  })
});
const resultadoReparar = catalogoReparar.catalogoRepararIds_();
assert.equal(resultadoReparar.reparadas, 2, 'debe reparar las 2 filas sin id, sin tocar la que ya tenía');
assert.equal(escritos.length, 2);
assert.equal(filasCatalogoSheet[1][0], 'id-existente', 'la fila que ya tenía id no debe cambiar');
assert.equal(filasCatalogoSheet[2][0], 'id-nuevo-1');
assert.equal(filasCatalogoSheet[3][0], 'id-nuevo-2');

// --- Catálogo: actualizar un producto existente NO debe exigir nombre_estandar de nuevo ---------
// (bug real, mismo patrón que el de usuarios.html: la herramienta de "barrido" para vincular
// nombres de FUDO manda solo { id, nombre_fudo } al vincular un nombre visto en FUDO a un producto
// que ya existe. La validación exigía nombre_estandar SIEMPRE, así que esa actualización parcial
// fallaba con "Falta nombre_estandar" aunque el producto ya lo tuviera puesto).
const filasCatalogoParcial = [
  ['id', 'nombre_estandar', 'categoria', 'nombre_fudo'],
  ['id-costilla', 'Costilla Preparada', 'Elaborados', '']
];
const catalogoParcial = cargar('apps-script/Catalogo.gs', {
  SHEET_NAMES: { CATALOGO: 'catalogo' },
  sheet_: () => ({
    getDataRange: () => ({ getValues: () => filasCatalogoParcial }),
    getRange: (fila, columna) => ({
      setValue: (valor) => { filasCatalogoParcial[fila - 1][columna - 1] = valor; }
    })
  })
});
const resultadoVincular = catalogoParcial.catalogoGuardar_({ id: 'id-costilla', nombre_fudo: 'Costilla' });
assert.equal(resultadoVincular.ok, true, 'actualizar solo nombre_fudo de un producto existente debe funcionar sin repetir nombre_estandar');
assert.equal(filasCatalogoParcial[1][3], 'Costilla', 'el nombre_fudo debe quedar guardado en la hoja');
assert.equal(filasCatalogoParcial[1][1], 'Costilla Preparada', 'el resto de la fila no debe tocarse');

assert.equal(
  catalogoParcial.catalogoGuardar_({ categoria: 'Elaborados' }).ok,
  false,
  'crear un producto nuevo (sin id) SÍ debe seguir exigiendo nombre_estandar'
);

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

// --- Conciliación: una venta sin receta encontrada debe marcarse sin_receta, no compararse -----
// como si fuera correcta. Antes, un plato vendido con un nombre que no coincidía con ningún
// "producto" de la hoja Recetas (el mismo problema que tuvo "Falafel" vs "Falafel (plato)", ver
// claveRecetaVenta_ en Recetas.gs) se autoconsumía 1:1 en silencio, sin ninguna señal de que la
// receta no se había encontrado — la fila se veía igual de "confiable" que una sí explotada por
// receta, mostrando incluso "Cuadra" cuando en realidad no se comparó nada real.
const ventasComida = [
  { creacion: '2026-07-21', sede: 'San Antonio', categoria: 'Bebidas', producto: 'Agua', cantidad: 2, cancelada: false },
  { creacion: '2026-07-21', sede: 'San Antonio', categoria: 'Comida', producto: 'Supremo', cantidad: 1, cancelada: false }
];
const recetaMapComida = {
  supremo: { nombre: 'Supremo', tipo: 'plato', lineas: [{ ingrediente: 'Costilla', cantidad: 100, rendimiento: 1, unidad: 'g', controla_disponibilidad: true }] }
};
const conciliacionComida = cargar('apps-script/Conciliacion.gs', {
  SHEET_NAMES: { VENTAS_FUDO: 'ventas', CONTEOS: 'conteos', TRASLADOS: 'traslados' },
  leerTabla_: (hoja) => hoja === 'ventas' ? ventasComida : [],
  formatearFecha_: (v) => String(v).slice(0, 10),
  normalizar_: normalizarSimple_,
  nombreCanonico_: (texto) => texto,
  claveProducto_: (texto) => normalizarSimple_(texto),
  claveRecetaVenta_: (producto, recetaMap) => { const d = normalizarSimple_(producto); return recetaMap[d] ? d : d; },
  construirRecetaMap_: () => recetaMapComida,
  recetasVigentes_: () => [],
  explotarReceta_: (claveProducto, cantidadBase, recetaMap, acumulado) => {
    const entrada = recetaMap[claveProducto];
    if (!entrada) return acumulado;
    entrada.lineas.forEach(function (l) {
      const k = normalizarSimple_(l.ingrediente);
      if (!acumulado[k]) acumulado[k] = { nombre: l.ingrediente, cantidad: 0, unidad: l.unidad };
      acumulado[k].cantidad += cantidadBase * l.cantidad;
    });
    return acumulado;
  },
  produccionListar_: () => [],
  produccionTotalPorItem_: () => ({}),
  ajustesNetosPorItem_: () => ({}),
  indiceCatalogo_: () => ({})
});
const filasSanAntonio = conciliacionComida.conciliarComidaPorSede_('2026-07-21')['San Antonio'];
const filaAgua = filasSanAntonio.find(f => f.ingrediente === 'Agua');
const filaCostilla = filasSanAntonio.find(f => f.ingrediente === 'Costilla');
assert.ok(filaAgua, 'debe aparecer una fila para la venta sin receta');
assert.equal(filaAgua.sin_receta, true, 'una venta sin receta encontrada debe marcarse sin_receta');
assert.equal(filaAgua.consumo_esperado, 2);
assert.ok(filaCostilla, 'debe aparecer el ingrediente explotado desde la receta de Supremo');
assert.equal(filaCostilla.sin_receta, false, 'un ingrediente que sí vino de una receta encontrada no debe marcarse sin_receta');
assert.equal(filaCostilla.consumo_esperado, 100);

// --- Usuarios: activar/desactivar un usuario existente NO debe exigir nombre/usuario/rol --------
// (bug real: usuarios.html manda solo { id, activo } al togglear Activar/Desactivar. La validación
// exigía nombre/usuario/rol SIEMPRE, así que esa actualización fallaba en el 100% de los casos —
// pero el botón no revisaba el resultado, así que fallaba en total silencio: ni el letrero verde
// ni una alerta de error, como si el clic no hiciera nada).
function mockHojaUsuarios_(headers, filas) {
  const data = [headers].concat(filas.map(f => headers.map(h => (f[h] !== undefined ? f[h] : ''))));
  return {
    getDataRange: () => ({ getValues: () => data }),
    getRange: (r, c) => ({ setValue: (v) => { data[r - 1][c - 1] = v; } }),
    _data: data
  };
}
const headersUsuarios = ['id', 'nombre', 'usuario', 'password_hash', 'salt', 'rol', 'sede', 'activo', 'email'];
let hojaUsuarios;
const usuariosMod = cargar('apps-script/Usuarios.gs', {
  SHEET_NAMES: { USUARIOS: 'usuarios' },
  requiereAdmin_: () => {},
  sheet_: () => hojaUsuarios,
  leerTabla_: () => [],
  appendRowFromObj_: () => {},
  generarSalt_: () => 'salt',
  hashPasswordSalted_: () => 'hash',
  Utilities: { getUuid: () => 'nuevo-id' },
  PASSWORD_LARGO_MINIMO: 8
});
const admin = { rol: 'Administrador' };

hojaUsuarios = mockHojaUsuarios_(headersUsuarios, [
  { id: 'u1', nombre: 'Ana', usuario: 'ana', rol: 'Encargado', sede: 'San Antonio', activo: true, email: '' }
]);
const resultadoToggle = usuariosMod.usuarioGuardar_({ id: 'u1', activo: false }, admin);
assert.equal(resultadoToggle.ok, true, 'togglear activo de un usuario existente debe funcionar sin mandar nombre/usuario/rol');
const activoCol = headersUsuarios.indexOf('activo');
assert.equal(hojaUsuarios._data[1][activoCol], false, 'la hoja debe quedar con activo en false tras el toggle');

assert.equal(
  usuariosMod.usuarioGuardar_({ nombre: '', usuario: '', rol: '' }, admin).ok,
  false,
  'crear un usuario nuevo SÍ debe seguir exigiendo nombre/usuario/rol'
);

hojaUsuarios = mockHojaUsuarios_(headersUsuarios, [
  { id: 'u1', nombre: 'Ana', usuario: 'ana', rol: 'Encargado', sede: 'San Antonio', activo: true, email: '' }
]);
assert.equal(
  usuariosMod.usuarioGuardar_({ id: 'u1', rol: 'RolQueNoExiste' }, admin).ok,
  false,
  'un rol inválido debe seguir rechazándose incluso al actualizar'
);

// --- Auditoría de sedes: sedeConsultaPermitida_ (Code.gs) no debe dejar consultar otra sede -----
// (encontrado en esta auditoría: la función existía en Code.gs pero NUNCA se llamaba desde
// ninguna acción del router — conteo_listar, ajustes_inventario_listar, compras_listar,
// compras_resumen_gasto, disponible_hoy, produccion_listar y conteos_historial dejaban pasar
// cualquier `sede` que mandara el cliente, sin comparar contra la sede real del usuario).
const codeMod = cargar('apps-script/Code.gs', {});
const adminAmbas = { rol: 'Administrador', sede: 'Ambas' };
const encargadaSA = { rol: 'Encargado', sede: 'San Antonio' };
assert.equal(codeMod.sedeConsultaPermitida_(adminAmbas, 'Capri'), 'Capri', 'Administrador puede pedir cualquier sede');
assert.equal(codeMod.sedeConsultaPermitida_(adminAmbas, null), null, 'Administrador sin sede pedida no queda limitado');
assert.equal(codeMod.sedeConsultaPermitida_(encargadaSA, 'San Antonio'), 'San Antonio', 'puede pedir su propia sede');
assert.equal(codeMod.sedeConsultaPermitida_(encargadaSA, null), 'San Antonio', 'sin pedir sede, se limita a la suya automáticamente (no "todas")');
assert.throws(() => codeMod.sedeConsultaPermitida_(encargadaSA, 'Capri'), /distinta a la tuya/, 'no puede consultar la sede de otro');

// --- Auditoría de sedes: excepción de Centro de Producción ("todos deben poder guardar cosas ---
// del centro de producción", pedido explícito) — San Antonio, Capri y Ambas pueden consultar Y
// registrar en Centro de Producción además de su propia sede; entre ellos (San Antonio <-> Capri)
// se mantiene el bloqueo de siempre.
const encargadaCapri = { rol: 'Encargado', sede: 'Capri' };
assert.equal(codeMod.sedeConsultaPermitida_(encargadaSA, 'Centro de Producción'), 'Centro de Producción', 'San Antonio SÍ puede consultar Centro de Producción');
assert.equal(codeMod.sedeConsultaPermitida_(encargadaCapri, 'Centro de Producción'), 'Centro de Producción', 'Capri SÍ puede consultar Centro de Producción');
assert.throws(() => codeMod.sedeConsultaPermitida_(encargadaSA, 'Capri'), /distinta a la tuya/, 'San Antonio sigue sin poder consultar Capri');
const encargadoCentro = { rol: 'Encargado', sede: 'Centro de Producción' };
assert.throws(() => codeMod.sedeConsultaPermitida_(encargadoCentro, 'San Antonio'), /distinta a la tuya/, 'Centro de Producción NO gana acceso a San Antonio (la excepción no es de ida y vuelta)');

assert.equal(codeMod.sedeEscrituraPermitida_(encargadaSA, 'Centro de Producción'), true, 'San Antonio puede REGISTRAR en Centro de Producción');
assert.equal(codeMod.sedeEscrituraPermitida_(encargadaCapri, 'Centro de Producción'), true, 'Capri puede REGISTRAR en Centro de Producción');
assert.equal(codeMod.sedeEscrituraPermitida_(encargadaSA, 'Capri'), false, 'San Antonio sigue sin poder registrar en Capri');
assert.equal(codeMod.sedeEscrituraPermitida_({ rol: 'Encargado', sede: 'Ambas' }, 'Capri'), true, 'Ambas puede registrar en cualquier sede, sin cambios');

// conteoRegistrar_ (Conteos.gs) debe aplicar la misma excepción al guardar de verdad.
const conteosGuardados = [];
const conteosRegistrarMod = cargar('apps-script/Conteos.gs', {
  SHEET_NAMES: { CATALOGO: 'catalogo', CONTEOS: 'conteos' },
  leerTabla_: (hoja) => hoja === 'conteos' ? conteosGuardados : [],
  normalizar_: (v) => String(v || '').trim().toLowerCase(),
  formatearFecha_: (v) => String(v).slice(0, 10),
  frecuenciasObligatoriasDelDia_: () => ['Diario'],
  catalogoAsegurar_: () => {},
  appendRowFromObj_: (hoja, fila) => { if (hoja === 'conteos') conteosGuardados.push(fila); },
  Utilities: { getUuid: () => 'conteo-id' },
  sheet_: () => ({ getDataRange: () => ({ getValues: () => [['id']] }) }),
  revisarAlertas_: () => {},
  sedeEscrituraPermitida_: sedeEscrituraPermitidaMock_
});
const itemsCentro = [{ fecha: '2026-07-21', sede: 'Centro de Producción', punto_conteo: 'General', producto: 'Costilla', unidad: 'kg', cantidad: 5 }];
assert.equal(conteosRegistrarMod.conteoRegistrar_(itemsCentro, encargadaSA).ok, true, 'San Antonio debe poder registrar un conteo para Centro de Producción');
const itemsCapriConteo = [{ fecha: '2026-07-21', sede: 'Capri', punto_conteo: 'General', producto: 'Costilla', unidad: 'kg', cantidad: 5 }];
assert.equal(conteosRegistrarMod.conteoRegistrar_(itemsCapriConteo, encargadaSA).ok, false, 'San Antonio NO debe poder registrar un conteo para Capri');

// --- Auditoría de sedes: traslados_listar solo debe mostrar traslados relacionados con tu sede --
// (bug de seguridad real encontrado en esta auditoría: Code.gs nunca pasaba `sesion.usuario` como
// segundo argumento a trasladosListar_, así que el filtro por sede que ya existía en Traslados.gs
// jamás se ejecutaba — de hecho `usuario` quedaba undefined y la función explotaba con un error de
// servidor en TODAS las llamadas, para cualquier rol, en vez de solo limitar por sede).
const trasladosFilas = [
  { id: 't1', sede_origen: 'Centro de Producción', sede_destino: 'San Antonio', producto: 'Costilla', estado: 'Enviado', timestamp_envio: '2026-07-20' },
  { id: 't2', sede_origen: 'Centro de Producción', sede_destino: 'Capri', producto: 'Costilla', estado: 'Enviado', timestamp_envio: '2026-07-20' },
  { id: 't3', sede_origen: 'San Antonio', sede_destino: 'Capri', producto: 'Aceite', estado: 'Confirmado', timestamp_envio: '2026-07-19' }
];
const trasladosMod = cargar('apps-script/Traslados.gs', {
  SHEET_NAMES: { TRASLADOS: 'traslados' },
  leerTabla_: () => trasladosFilas
});
const listaSA = trasladosMod.trasladosListar_({}, encargadaSA);
assert.deepEqual(listaSA.map(t => t.id).sort(), ['t1', 't3'],
  'San Antonio solo debe ver traslados donde participa (t1: lo recibe, t3: lo envía) — no t2 (Centro de Producción -> Capri)');
const listaAdminTraslados = trasladosMod.trasladosListar_({}, adminAmbas);
assert.equal(listaAdminTraslados.length, 3, 'Administrador/Ambas sigue viendo todos los traslados');

// --- Auditoría de sedes: Conciliación solo debe mostrar la parte de la sede del usuario ---------
// (pedido explícito: "si es conciliacion solo sepa que cuadra su parte" — antes calcularConciliacion_
// devolvía ventas/bebidas/comida de TODAS las sedes a cualquiera con acceso a Conciliación, sin
// importar la sede asignada al usuario que preguntara).
const ventasMultiSede = [
  { creacion: '2026-07-21', sede: 'San Antonio', categoria: 'Comida', producto: 'Supremo', cantidad: 1, cancelada: false },
  { creacion: '2026-07-21', sede: 'Capri', categoria: 'Comida', producto: 'Supremo', cantidad: 5, cancelada: false }
];
const movimientosMultiSede = [
  { fecha: '2026-07-21', nombre: 'Poker', evento: 'Adición Creada', sede: 'San Antonio', diferencia: -3, stock_actual: 20 },
  { fecha: '2026-07-21', nombre: 'Poker', evento: 'Adición Creada', sede: 'Capri', diferencia: -7, stock_actual: 20 }
];
const catalogoBebidasMultiSede = [{ nombre_estandar: 'Poker', nombre_fudo: 'Poker', categoria: 'Bebidas/Cerveza' }];
const conteosBebidasMultiSede = [
  { fecha: '2026-07-21', sede: 'San Antonio', producto: 'Poker', unidad: 'u', cantidad: 15 },
  { fecha: '2026-07-21', sede: 'Capri', producto: 'Poker', unidad: 'u', cantidad: 40 }
];
const conciliacionSedes = cargar('apps-script/Conciliacion.gs', {
  SHEET_NAMES: { VENTAS_FUDO: 'ventas', MOVIMIENTOS_FUDO: 'movimientos', CATALOGO: 'catalogo', CONTEOS: 'conteos', TRASLADOS: 'traslados' },
  leerTabla_: (hoja) => {
    if (hoja === 'ventas') return ventasMultiSede;
    if (hoja === 'movimientos') return movimientosMultiSede;
    if (hoja === 'catalogo') return catalogoBebidasMultiSede;
    return [];
  },
  formatearFecha_: (v) => String(v).slice(0, 10),
  normalizar_: normalizarSimple_,
  nombreCanonico_: (texto) => texto,
  claveProducto_: (texto) => normalizarSimple_(texto),
  claveRecetaVenta_: (producto, recetaMap) => { const d = normalizarSimple_(producto); return recetaMap[d] ? d : d; },
  construirRecetaMap_: () => ({ supremo: { nombre: 'Supremo', tipo: 'plato', lineas: [] } }),
  recetasVigentes_: () => [],
  explotarReceta_: (claveProducto, cantidadBase, recetaMap, acumulado) => acumulado,
  conteoListar_: (fecha) => conteosBebidasMultiSede.filter(function (c) { return c.fecha === fecha; }),
  indiceCatalogo_: () => ({}),
  produccionListar_: () => [],
  produccionTotalPorItem_: () => ({}),
  ajustesNetosPorItem_: () => ({}),
  aUnidadBase_: (cantidad, unidad) => ({ cantidad: Number(cantidad), unidad })
});

const resultadoSA = conciliacionSedes.calcularConciliacion_('2026-07-21', encargadaSA);
assert.equal(resultadoSA.sede_restringida, 'San Antonio');
assert.ok(resultadoSA.ventas.length > 0 && resultadoSA.ventas.every(function (v) { return v.sede === 'San Antonio'; }), 'ventas de otra sede no deben aparecer');
assert.deepEqual(Object.keys(resultadoSA.comida), ['San Antonio'], 'comida solo debe traer el bloque de San Antonio, ni siquiera calculado para las otras');
const filaPokerSA = resultadoSA.bebidas.find(function (b) { return b.producto === 'Poker'; });
assert.equal(filaPokerSA.sa, 15, 'debe ver su propio conteo');
assert.equal(filaPokerSA.capri, null, 'no debe ver el conteo de Capri');
assert.equal(filaPokerSA.fudo_cierre, null, 'no debe ver el cierre combinado de FUDO (revelaría info de Capri por resta)');
assert.equal(filaPokerSA.consumo_fudo_capri, null, 'no debe ver el consumo de FUDO de Capri');

const resultadoAdminConciliacion = conciliacionSedes.calcularConciliacion_('2026-07-21', adminAmbas);
assert.equal(resultadoAdminConciliacion.sede_restringida, null);
assert.deepEqual(Object.keys(resultadoAdminConciliacion.comida).sort(), ['Capri', 'Centro de Producción', 'San Antonio'].sort());
const filaPokerAdminConciliacion = resultadoAdminConciliacion.bebidas.find(function (b) { return b.producto === 'Poker'; });
assert.equal(filaPokerAdminConciliacion.capri, 40, 'Administrador/Ambas sigue viendo todo, sin cambios');

console.log('inventory-controls: OK');
