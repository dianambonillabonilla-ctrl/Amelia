/**
 * GESTIONES DE FALTANTES
 * Pedido real de Diana: cuando algo aparece "bajo mínimo" o agotado (Disponible Hoy), no había
 * forma de avisar "esto ya se está resolviendo" — tanto ella como el personal podían estar
 * mirando la misma alerta sin saber si el otro ya actuó (ej. ella ya va a comprar banano, pero
 * el empleado que llega después no lo sabe y lo vuelve a reportar).
 *
 * Una gestión es un caso abierto contra un producto+sede, con un estado que avanza:
 *   Pendiente -> Pedido realizado -> Resuelto        (o "Cancelada" desde Pendiente/Pedido realizado)
 *
 * Cualquiera que ya puede registrar conteos/compras (Administrador, Encargado, Cocina) puede
 * crear una gestión y también marcarla en cualquier estado — mismo grupo de roles, mismo criterio
 * que ya se usa para Compras (ver requiereRol_ en Code.gs).
 *
 * Si después se registra una compra real (Compras.gs) para ese mismo producto+sede, la gestión
 * abierta se cierra sola como "Resuelto" — ver gestionAutoResolverPorCompra_, llamada desde
 * compraRegistrarFactura_. Si el producto se compró sin quedar exactamente igual escrito, o se
 * resolvió sin pasar por Compras (ej. lo trajo alguien de otro lado), se puede marcar manual.
 */

const GESTION_ESTADOS = ['Pendiente', 'Pedido realizado', 'Resuelto', 'Cancelada'];
const GESTION_ESTADOS_ABIERTOS = ['Pendiente', 'Pedido realizado'];

function gestionCrear_(item, usuario) {
  if (!item || !String(item.producto || '').trim()) return { ok: false, error: 'Falta el producto' };
  if (!item.sede) return { ok: false, error: 'Falta indicar la sede' };
  if (!sedeEscrituraPermitida_(usuario, item.sede)) {
    return { ok: false, error: 'No puedes abrir una gestión para una sede distinta a la tuya (' + usuario.sede + ')' };
  }

  const id = Utilities.getUuid();
  appendRowFromObj_(SHEET_NAMES.GESTIONES, {
    id: id,
    fecha: formatearFecha_(new Date()),
    producto: String(item.producto).trim(),
    sede: item.sede,
    estado: 'Pendiente',
    nota: item.nota || '',
    creado_por: usuario.nombre,
    timestamp_creado: new Date(),
    actualizado_por: '',
    timestamp_actualizado: '',
    factura_id: ''
  });
  return { ok: true, id: id };
}

/**
 * `filtro.estado === 'abiertas'` trae Pendiente + Pedido realizado juntos (lo que necesita el
 * Dashboard para saber qué alertas ya tienen alguien encima); cualquier otro valor de estado
 * filtra exacto; sin estado, trae todo (lo que necesita la página de Gestiones).
 */
function gestionesListar_(filtro, usuario) {
  filtro = filtro || {};
  let rows = leerTabla_(SHEET_NAMES.GESTIONES);
  if (filtro.estado === 'abiertas') {
    rows = rows.filter(function (r) { return GESTION_ESTADOS_ABIERTOS.indexOf(r.estado) !== -1; });
  } else if (filtro.estado) {
    rows = rows.filter(function (r) { return r.estado === filtro.estado; });
  }
  if (filtro.sede) rows = rows.filter(function (r) { return r.sede === filtro.sede; });
  if (usuario.rol !== 'Administrador' && usuario.sede !== 'Ambas') {
    rows = rows.filter(function (r) { return sedeEscrituraPermitida_(usuario, r.sede); });
  }
  return rows.sort(function (a, b) { return new Date(b.timestamp_creado) - new Date(a.timestamp_creado); });
}

function gestionBuscarFila_(id) {
  const sh = sheet_(SHEET_NAMES.GESTIONES);
  const data = sh.getDataRange().getValues();
  const headers = data[0];
  const idCol = headers.indexOf('id');
  for (let r = 1; r < data.length; r++) {
    if (data[r][idCol] === id) return { sh: sh, headers: headers, fila: r + 1, valores: data[r] };
  }
  return null;
}

function gestionActualizarEstado_(id, nuevoEstado, nota, usuario) {
  if (GESTION_ESTADOS.indexOf(nuevoEstado) === -1) return { ok: false, error: 'Estado inválido: ' + nuevoEstado };
  const encontrado = gestionBuscarFila_(id);
  if (!encontrado) return { ok: false, error: 'No se encontró la gestión' };
  const sede = encontrado.valores[encontrado.headers.indexOf('sede')];
  if (!sedeEscrituraPermitida_(usuario, sede)) {
    return { ok: false, error: 'No puedes actualizar una gestión de una sede distinta a la tuya (' + usuario.sede + ')' };
  }

  const cambios = {
    estado: nuevoEstado,
    actualizado_por: usuario.nombre,
    timestamp_actualizado: new Date()
  };
  if (nota !== undefined && nota !== null) cambios.nota = nota;

  encontrado.headers.forEach(function (h, c) {
    if (cambios[h] !== undefined) encontrado.sh.getRange(encontrado.fila, c + 1).setValue(cambios[h]);
  });
  return { ok: true };
}

/**
 * Best-effort: si algo falla aquí, la compra ya se guardó y no debe perderse por esto — mismo
 * criterio que revisarAlertas_ en Alertas.gs (efecto secundario, no bloquea lo principal).
 */
function gestionAutoResolverPorCompra_(lineas, facturaId, usuario) {
  try {
    const abiertas = leerTabla_(SHEET_NAMES.GESTIONES).filter(function (r) {
      return GESTION_ESTADOS_ABIERTOS.indexOf(r.estado) !== -1;
    });
    if (!abiertas.length) return;
    const sh = sheet_(SHEET_NAMES.GESTIONES);
    const data = sh.getDataRange().getValues();
    const headers = data[0];
    const idCol = headers.indexOf('id');
    const estadoCol = headers.indexOf('estado');
    const notaCol = headers.indexOf('nota');
    const actualizadoPorCol = headers.indexOf('actualizado_por');
    const timestampCol = headers.indexOf('timestamp_actualizado');
    const facturaCol = headers.indexOf('factura_id');

    lineas.forEach(function (l) {
      const sedeLinea = l.sede;
      const normProducto = normalizar_(l.producto);
      abiertas
        .filter(function (g) { return g.sede === sedeLinea && normalizar_(g.producto) === normProducto; })
        .forEach(function (g) {
          for (let r = 1; r < data.length; r++) {
            if (data[r][idCol] === g.id) {
              sh.getRange(r + 1, estadoCol + 1).setValue('Resuelto');
              sh.getRange(r + 1, notaCol + 1).setValue('Resuelto automáticamente por una compra registrada.');
              sh.getRange(r + 1, actualizadoPorCol + 1).setValue(usuario.nombre);
              sh.getRange(r + 1, timestampCol + 1).setValue(new Date());
              sh.getRange(r + 1, facturaCol + 1).setValue(facturaId);
              break;
            }
          }
        });
    });
  } catch (err) {
    Logger.log('gestionAutoResolverPorCompra_ falló: ' + err.message);
  }
}
