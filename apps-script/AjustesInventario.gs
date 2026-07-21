/**
 * AJUSTES DE INVENTARIO
 * Registra eventos que explican por qué cambia el inventario físico sin ser una venta:
 *  - Compra cruda: entrada de materia prima al Centro de Producción o a una sede.
 *  - Merma / desperdicio: producto que se pierde, se daña, se recorta o no queda usable.
 *  - Ajuste operativo: corrección documentada cuando el conteo físico detecta diferencia.
 *
 * Estos registros no reemplazan el conteo físico: lo explican en conciliación. El conteo sigue
 * siendo la verdad del inventario al cierre; compra/merma/ajuste ayudan a saber si el cambio
 * entre ayer y hoy cuadra con compras, producción, traslados y ventas.
 */

const TIPOS_AJUSTE_INVENTARIO = ['Compra cruda', 'Merma / desperdicio', 'Ajuste operativo'];

function ajusteInventarioRegistrar_(item, usuario) {
  if (!item || !item.fecha || !item.sede || !item.tipo || !item.producto || !item.unidad) {
    return { ok: false, error: 'Faltan datos del ajuste (fecha, sede, tipo, producto y unidad son obligatorios)' };
  }
  if (TIPOS_AJUSTE_INVENTARIO.indexOf(item.tipo) === -1) {
    return { ok: false, error: 'Tipo de ajuste no válido: ' + item.tipo };
  }
  if (isNaN(Number(item.cantidad)) || Number(item.cantidad) <= 0) {
    return { ok: false, error: 'La cantidad debe ser un número mayor que cero' };
  }
  const validado = validarItemInventario_(item, 'producto');
  if (!validado.ok) return validado;
  item.producto = validado.producto;
  item.unidad = validado.unidad;
  if (usuario.sede !== 'Ambas' && item.sede !== usuario.sede) {
    return { ok: false, error: 'No puedes registrar ajustes para una sede distinta a la tuya (' + usuario.sede + ')' };
  }

  appendRowFromObj_(SHEET_NAMES.AJUSTES_INVENTARIO, {
    id: Utilities.getUuid(),
    fecha: item.fecha,
    sede: item.sede,
    punto: item.punto || '',
    tipo: item.tipo,
    producto: item.producto,
    unidad: item.unidad,
    cantidad: Number(item.cantidad),
    motivo: item.motivo || '',
    usuario: usuario.nombre,
    timestamp: new Date()
  });
  return { ok: true };
}

function ajustesInventarioListar_(fecha, sede) {
  let rows = leerTabla_(SHEET_NAMES.AJUSTES_INVENTARIO);
  if (fecha) rows = rows.filter(function (r) { return formatearFecha_(r.fecha) === fecha; });
  if (sede) rows = rows.filter(function (r) { return r.sede === sede; });
  return rows.sort(function (a, b) { return new Date(b.timestamp) - new Date(a.timestamp); });
}

function ajustesNetosPorItem_(fecha, sede, indice) {
  const totales = {};
  ajustesInventarioListar_(fecha, sede).forEach(function (a) {
    const base = aUnidadBase_(a.cantidad, a.unidad);
    const clave = claveProducto_(a.producto, indice);
    if (!totales[clave]) {
      totales[clave] = { cantidad: 0, compras: 0, mermas: 0, ajustes: 0, unidad: base.unidad };
    }
    if (totales[clave].unidad !== base.unidad) return;
    if (a.tipo === 'Compra cruda') {
      totales[clave].cantidad += base.cantidad;
      totales[clave].compras += base.cantidad;
    } else if (a.tipo === 'Merma / desperdicio') {
      totales[clave].cantidad -= base.cantidad;
      totales[clave].mermas += base.cantidad;
    } else {
      totales[clave].cantidad += base.cantidad;
      totales[clave].ajustes += base.cantidad;
    }
  });
  return totales;
}
