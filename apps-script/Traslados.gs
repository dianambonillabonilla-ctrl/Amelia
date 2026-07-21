/**
 * TRASLADOS ENTRE SEDES
 * El personal puede rotar, pero la sede asignada en Usuarios sigue protegiendo el movimiento:
 * Administrador y usuarios con sede "Ambas" pueden operar cualquier traslado; los demás solo
 * pueden enviar desde su sede, recibir en su sede y ver traslados relacionados con ella.
 *
 * Flujo:
 *  1. Quien envía crea el traslado (producto, cantidad, origen -> destino). Queda "Enviado".
 *  2. Quien recibe lo confirma (pasa a "Confirmado") o reporta un problema (pasa a
 *     "Con observación" y dispara un correo a todos los Administrador/Encargado — mismo
 *     destinatariosAlerta_ que usan las alertas de stock bajo).
 *  3. Un traslado "Con observación" queda visualmente pendiente hasta que alguien lo marca
 *     como "Resuelto" — el sistema no lo cuenta como recibido del todo mientras tanto.
 *
 * Este registro es un log de trazabilidad, no toca Conteos_Manuales directamente: el stock real
 * sigue viniendo del próximo conteo físico en cada punto, como en el resto del sistema.
 */

function trasladoCrear_(item, usuario) {
  if (!item || !item.producto || !item.unidad || !item.cantidad || !item.sede_origen || !item.sede_destino) {
    return { ok: false, error: 'Faltan datos del traslado (producto, unidad, cantidad, sede origen y sede destino son obligatorios)' };
  }
  if (isNaN(Number(item.cantidad)) || Number(item.cantidad) <= 0) {
    return { ok: false, error: 'La cantidad debe ser un número mayor que cero' };
  }
  if (item.sede_origen === item.sede_destino && (item.punto_origen || '') === (item.punto_destino || '')) {
    return { ok: false, error: 'El origen y el destino no pueden ser el mismo lugar' };
  }
  requiereSedeTraslado_(usuario, item.sede_origen, 'enviar');

  appendRowFromObj_(SHEET_NAMES.TRASLADOS, {
    id: Utilities.getUuid(),
    fecha: item.fecha || formatearFecha_(new Date()),
    producto: item.producto,
    unidad: item.unidad || '',
    cantidad_enviada: Number(item.cantidad),
    sede_origen: item.sede_origen,
    punto_origen: item.punto_origen || '',
    sede_destino: item.sede_destino,
    punto_destino: item.punto_destino || '',
    usuario_envia: usuario.nombre,
    timestamp_envio: new Date(),
    estado: 'Enviado',
    usuario_recibe: '',
    timestamp_recibe: '',
    cantidad_recibida: '',
    observacion: '',
    resuelto_por: '',
    timestamp_resuelto: '',
    nota_resolucion: ''
  });
  return { ok: true };
}

function trasladosListar_(filtro, usuario) {
  filtro = filtro || {};
  let rows = leerTabla_(SHEET_NAMES.TRASLADOS);
  if (filtro.estado) rows = rows.filter(function (r) { return r.estado === filtro.estado; });
  if (usuario.rol !== 'Administrador' && usuario.sede !== 'Ambas') {
    rows = rows.filter(function (r) { return r.sede_origen === usuario.sede || r.sede_destino === usuario.sede; });
  }
  return rows.sort(function (a, b) { return new Date(b.timestamp_envio) - new Date(a.timestamp_envio); });
}

function trasladoBuscarFila_(id) {
  const sh = sheet_(SHEET_NAMES.TRASLADOS);
  const data = sh.getDataRange().getValues();
  const headers = data[0];
  const idCol = headers.indexOf('id');
  for (let r = 1; r < data.length; r++) {
    if (data[r][idCol] === id) return { sh: sh, headers: headers, fila: r + 1, valores: data[r] };
  }
  return null;
}

function trasladoActualizar_(id, cambios) {
  const encontrado = trasladoBuscarFila_(id);
  if (!encontrado) return { ok: false, error: 'No se encontró el traslado ' + id };
  encontrado.headers.forEach(function (h, c) {
    if (cambios[h] !== undefined) encontrado.sh.getRange(encontrado.fila, c + 1).setValue(cambios[h]);
  });
  const idCol = encontrado.headers.indexOf('estado');
  return { ok: true, estado: cambios.estado || encontrado.valores[idCol] };
}

function trasladoConfirmar_(id, cantidadRecibida, usuario) {
  const encontrado = trasladoBuscarFila_(id);
  if (!encontrado) return { ok: false, error: 'No se encontró el traslado' };
  const estadoActual = encontrado.valores[encontrado.headers.indexOf('estado')];
  if (estadoActual !== 'Enviado') return { ok: false, error: 'Este traslado ya fue confirmado o tiene una observación (estado actual: ' + estadoActual + ')' };
  requiereSedeTraslado_(usuario, encontrado.valores[encontrado.headers.indexOf('sede_destino')], 'recibir');

  const enviada = Number(encontrado.valores[encontrado.headers.indexOf('cantidad_enviada')]);
  const recibida = cantidadRecibida !== undefined && cantidadRecibida !== '' ? Number(cantidadRecibida) : enviada;
  if (isNaN(recibida) || recibida <= 0 || recibida > enviada) {
    return { ok: false, error: 'La cantidad recibida debe ser mayor que cero y no superar la cantidad enviada' };
  }

  return trasladoActualizar_(id, {
    estado: 'Confirmado',
    usuario_recibe: usuario.nombre,
    timestamp_recibe: new Date(),
    cantidad_recibida: recibida
  });
}

function trasladoObservar_(id, cantidadRecibida, observacion, usuario) {
  if (!observacion || !String(observacion).trim()) return { ok: false, error: 'Escribe qué pasó con el traslado' };
  const encontrado = trasladoBuscarFila_(id);
  if (!encontrado) return { ok: false, error: 'No se encontró el traslado' };
  const estadoActual = encontrado.valores[encontrado.headers.indexOf('estado')];
  if (estadoActual !== 'Enviado') return { ok: false, error: 'Este traslado ya fue confirmado o tiene una observación (estado actual: ' + estadoActual + ')' };
  requiereSedeTraslado_(usuario, encontrado.valores[encontrado.headers.indexOf('sede_destino')], 'recibir');
  const enviada = Number(encontrado.valores[encontrado.headers.indexOf('cantidad_enviada')]);
  const recibida = Number(cantidadRecibida);
  if (isNaN(recibida) || recibida < 0 || recibida >= enviada) {
    return { ok: false, error: 'En una observación, la cantidad recibida debe estar entre cero y ser menor que la enviada' };
  }

  const resultado = trasladoActualizar_(id, {
    estado: 'Con observación',
    usuario_recibe: usuario.nombre,
    timestamp_recibe: new Date(),
    cantidad_recibida: recibida,
    observacion: String(observacion).trim()
  });

  if (resultado.ok) {
    const traslado = leerTabla_(SHEET_NAMES.TRASLADOS).find(function (r) { return r.id === id; });
    if (traslado) {
      try {
        enviarCorreoObservacionTraslado_(traslado);
      } catch (err) {
        Logger.log('enviarCorreoObservacionTraslado_ falló: ' + err.message);
      }
    }
  }
  return resultado;
}

function trasladoResolver_(id, notaResolucion, usuario) {
  requiereRol_(usuario, ['Administrador', 'Encargado']);
  const encontrado = trasladoBuscarFila_(id);
  if (!encontrado) return { ok: false, error: 'No se encontró el traslado' };
  const estadoActual = encontrado.valores[encontrado.headers.indexOf('estado')];
  if (estadoActual !== 'Con observación') return { ok: false, error: 'Solo se pueden resolver traslados con una observación pendiente' };
  const origen = encontrado.valores[encontrado.headers.indexOf('sede_origen')];
  const destino = encontrado.valores[encontrado.headers.indexOf('sede_destino')];
  if (usuario.rol !== 'Administrador' && usuario.sede !== 'Ambas' && usuario.sede !== origen && usuario.sede !== destino) {
    throw new Error('Solo puedes resolver traslados relacionados con tu sede');
  }

  return trasladoActualizar_(id, {
    estado: 'Resuelto',
    resuelto_por: usuario.nombre,
    timestamp_resuelto: new Date(),
    nota_resolucion: notaResolucion || ''
  });
}

function requiereSedeTraslado_(usuario, sede, accion) {
  if (usuario.rol === 'Administrador' || usuario.sede === 'Ambas') return;
  if (usuario.sede !== sede) throw new Error('No puedes ' + accion + ' un traslado de una sede distinta a la tuya (' + usuario.sede + ')');
}

function enviarCorreoObservacionTraslado_(traslado) {
  const destinatarios = destinatariosAlerta_(); // Administrador + Encargado con email (Alertas.gs)
  if (!destinatarios.length) return;
  const cuerpo = 'Un traslado quedó con una observación y necesita resolverse:\n\n' +
    'Producto: ' + traslado.producto + ' (' + traslado.cantidad_enviada + ' ' + traslado.unidad + ')\n' +
    'De: ' + traslado.sede_origen + (traslado.punto_origen ? ' / ' + traslado.punto_origen : '') + '\n' +
    'A: ' + traslado.sede_destino + (traslado.punto_destino ? ' / ' + traslado.punto_destino : '') + '\n' +
    'Enviado por: ' + traslado.usuario_envia + '\n' +
    'Observación de ' + traslado.usuario_recibe + ': ' + traslado.observacion + '\n\n' +
    'Este traslado queda pendiente hasta que alguien lo marque como resuelto en Dilana OS.';

  MailApp.sendEmail({
    to: destinatarios.join(','),
    subject: 'Dilana OS — Observación en traslado de ' + traslado.producto,
    body: cuerpo
  });
}
