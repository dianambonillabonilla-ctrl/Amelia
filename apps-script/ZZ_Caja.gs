/**
 * CAJA — apertura, movimientos de efectivo y cierre por turno.
 *
 * Este módulo es independiente del cierre operativo de inventario (Cierres_Turno): una sede puede
 * abrir y cerrar varias cajas en el mismo día cuando cambia la persona responsable. La base que se
 * deja al cerrar se convierte en la base esperada de la siguiente apertura.
 *
 * Se conecta a la API sin modificar el switch central de Code.gs: reemplaza doPost únicamente para
 * interceptar acciones `caja_*` y delega todas las demás a handleRequest_.
 */

var CAJA_SHEET_TURNOS_ = 'Caja_Turnos';
var CAJA_SHEET_MOVIMIENTOS_ = 'Caja_Movimientos';

var CAJA_HEADERS_TURNOS_ = [
  'id', 'fecha', 'sede', 'estado',
  'usuario_abre_id', 'usuario_abre', 'apertura_en',
  'base_esperada', 'efectivo_inicial', 'diferencia_apertura', 'observacion_apertura',
  'efectivo_fudo_al_abrir',
  'rappi_encendido', 'rappi_confirmado_por', 'rappi_confirmado_en',
  'usuario_cierra_id', 'usuario_cierra', 'cierre_en',
  'efectivo_fudo_turno', 'ingresos_total', 'entregas_admin_total', 'salidas_total',
  'efectivo_esperado', 'efectivo_contado', 'diferencia_cierre',
  'entrega_final_admin', 'recibido_por_cierre', 'base_siguiente', 'observacion_cierre'
];

var CAJA_HEADERS_MOVIMIENTOS_ = [
  'id', 'turno_id', 'fecha', 'sede', 'tipo', 'monto', 'motivo', 'recibido_por',
  'usuario_id', 'usuario', 'timestamp'
];

function cajaTextoSeguro_(valor) {
  var texto = String(valor === null || valor === undefined ? '' : valor).trim();
  return /^[=+\-@]/.test(texto) ? "'" + texto : texto;
}

function cajaMonto_(valor, etiqueta, permitirCero) {
  if (valor === '' || valor === null || valor === undefined) {
    throw new Error('Falta ' + etiqueta + '.');
  }
  var numero = Number(valor);
  if (!isFinite(numero) || numero < 0 || (!permitirCero && numero === 0)) {
    throw new Error(etiqueta + ' debe ser un valor válido' + (permitirCero ? ' mayor o igual a cero.' : ' mayor que cero.'));
  }
  return Number(numero.toFixed(2));
}

function cajaAsegurarHoja_(nombre, headers) {
  var libro = ss_();
  var sh = libro.getSheetByName(nombre);
  if (!sh) sh = libro.insertSheet(nombre);
  if (sh.getLastRow() === 0) {
    sh.getRange(1, 1, 1, headers.length).setValues([headers]);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, headers.length)
      .setFontWeight('bold').setBackground('#0B1F3A').setFontColor('#FFFFFF');
  } else {
    asegurarColumnas_(sh, headers);
  }
  return sh;
}

function cajaAsegurarHojas_() {
  cajaAsegurarHoja_(CAJA_SHEET_TURNOS_, CAJA_HEADERS_TURNOS_);
  cajaAsegurarHoja_(CAJA_SHEET_MOVIMIENTOS_, CAJA_HEADERS_MOVIMIENTOS_);
}

function cajaTurnos_() {
  cajaAsegurarHojas_();
  return leerTabla_(CAJA_SHEET_TURNOS_);
}

function cajaMovimientos_() {
  cajaAsegurarHojas_();
  return leerTabla_(CAJA_SHEET_MOVIMIENTOS_);
}

function cajaTimestampMs_(valor) {
  if (!valor) return 0;
  var d = valor instanceof Date ? valor : new Date(valor);
  return isNaN(d.getTime()) ? 0 : d.getTime();
}

function cajaTurnoAbierto_(sede) {
  return cajaTurnos_()
    .filter(function (t) { return t.sede === sede && t.estado === 'Abierto'; })
    .sort(function (a, b) { return cajaTimestampMs_(b.apertura_en) - cajaTimestampMs_(a.apertura_en); })[0] || null;
}

function cajaUltimoCierre_(sede) {
  return cajaTurnos_()
    .filter(function (t) { return t.sede === sede && t.estado === 'Cerrado'; })
    .sort(function (a, b) { return cajaTimestampMs_(b.cierre_en) - cajaTimestampMs_(a.cierre_en); })[0] || null;
}

function cajaBaseEsperada_(sede) {
  var ultimo = cajaUltimoCierre_(sede);
  return ultimo && ultimo.base_siguiente !== '' ? Number(ultimo.base_siguiente) || 0 : 0;
}

function cajaActualizarTurno_(id, cambios) {
  var sh = cajaAsegurarHoja_(CAJA_SHEET_TURNOS_, CAJA_HEADERS_TURNOS_);
  var data = sh.getDataRange().getValues();
  var headers = data[0];
  var idCol = headers.indexOf('id');
  for (var r = 1; r < data.length; r++) {
    if (String(data[r][idCol]) !== String(id)) continue;
    Object.keys(cambios).forEach(function (campo) {
      var col = headers.indexOf(campo);
      if (col !== -1) data[r][col] = cambios[campo];
    });
    sh.getRange(r + 1, 1, 1, headers.length).setValues([data[r]]);
    return true;
  }
  return false;
}

function cajaEfectivoFudoDia_(fecha, sede) {
  if (typeof pagosFudoTotalesSedeFecha_ !== 'function') return 0;
  var resumen = pagosFudoTotalesSedeFecha_(fecha, sede) || {};
  return Number(resumen.pagos_efectivo_esperado) || 0;
}

function cajaPuedeOperar_(fecha, usuario) {
  if (!usuario) return false;
  if (usuario.rol === 'Administrador' || usuario.rol === 'Encargado') return true;
  return turnoSectorDeHoy_(usuario, fecha).sector === 'Caja';
}

function cajaExigirPermiso_(fecha, usuario) {
  requiereRol_(usuario, ['Administrador', 'Encargado', 'Cocina']);
  if (!cajaPuedeOperar_(fecha, usuario)) {
    throw new Error('Para usar Caja debes tener el sector "Caja" asignado hoy. Entra primero a Inicio y confirma tu función del turno.');
  }
}

function cajaSedePermitida_(usuario, sede) {
  var permitida = sedeConsultaPermitida_(usuario, sede);
  if (!permitida || permitida === 'Ambas' || permitida === 'Centro de Producción') {
    throw new Error('Elige una sede de venta válida: San Antonio o Capri.');
  }
  return permitida;
}

function cajaResumenTurno_(turno) {
  var movimientos = cajaMovimientos_()
    .filter(function (m) { return String(m.turno_id) === String(turno.id); })
    .sort(function (a, b) { return cajaTimestampMs_(b.timestamp) - cajaTimestampMs_(a.timestamp); });

  var ingresos = 0;
  var entregas = 0;
  var salidas = 0;
  movimientos.forEach(function (m) {
    var monto = Number(m.monto) || 0;
    if (m.tipo === 'Ingreso') ingresos += monto;
    if (m.tipo === 'Entrega administrador') entregas += monto;
    if (m.tipo === 'Salida') salidas += monto;
  });

  var efectivoFudoActual = cajaEfectivoFudoDia_(turno.fecha, turno.sede);
  var efectivoFudoTurno = efectivoFudoActual - (Number(turno.efectivo_fudo_al_abrir) || 0);
  var esperado = (Number(turno.efectivo_inicial) || 0) + efectivoFudoTurno + ingresos - entregas - salidas;

  return {
    efectivo_fudo_actual: Number(efectivoFudoActual.toFixed(2)),
    efectivo_fudo_turno: Number(efectivoFudoTurno.toFixed(2)),
    ingresos_total: Number(ingresos.toFixed(2)),
    entregas_admin_total: Number(entregas.toFixed(2)),
    salidas_total: Number(salidas.toFixed(2)),
    efectivo_esperado: Number(esperado.toFixed(2)),
    movimientos: movimientos
  };
}

function cajaEstado_(fecha, sede, usuario) {
  cajaExigirPermiso_(fecha, usuario);
  cajaAsegurarHojas_();
  var abierto = cajaTurnoAbierto_(sede);
  var ultimo = cajaUltimoCierre_(sede);
  if (!abierto) {
    return {
      ok: true,
      estado: 'sin_abrir',
      fecha: fecha,
      sede: sede,
      base_esperada: cajaBaseEsperada_(sede),
      ultimo_cierre: ultimo || null
    };
  }
  return {
    ok: true,
    estado: 'abierta',
    fecha: fecha,
    sede: sede,
    turno: abierto,
    resumen: cajaResumenTurno_(abierto),
    ultimo_cierre: ultimo || null
  };
}

function cajaAbrir_(fecha, sede, datos, usuario) {
  cajaExigirPermiso_(fecha, usuario);
  cajaAsegurarHojas_();
  if (cajaTurnoAbierto_(sede)) return { ok: false, error: 'Ya existe una caja abierta en ' + sede + '.' };

  datos = datos || {};
  var efectivoInicial = cajaMonto_(datos.efectivo_inicial, 'el efectivo contado al abrir', true);
  var baseEsperada = cajaBaseEsperada_(sede);
  var diferencia = Number((efectivoInicial - baseEsperada).toFixed(2));
  var observacion = cajaTextoSeguro_(datos.observacion || '');
  if (Math.abs(diferencia) > 0.99 && !observacion) {
    return { ok: false, error: 'La base contada no coincide con la esperada. Escribe una observación antes de abrir.' };
  }

  var id = Utilities.getUuid();
  appendRowFromObj_(CAJA_SHEET_TURNOS_, {
    id: id,
    fecha: fecha,
    sede: sede,
    estado: 'Abierto',
    usuario_abre_id: usuario.id,
    usuario_abre: usuario.nombre,
    apertura_en: new Date(),
    base_esperada: baseEsperada,
    efectivo_inicial: efectivoInicial,
    diferencia_apertura: diferencia,
    observacion_apertura: observacion,
    efectivo_fudo_al_abrir: cajaEfectivoFudoDia_(fecha, sede),
    rappi_encendido: false
  });
  if (typeof auditoriaRegistrar_ === 'function') {
    auditoriaRegistrar_(usuario, 'ABRIR_CAJA', 'Caja_Turno', id, null, {
      fecha: fecha, sede: sede, base_esperada: baseEsperada, efectivo_inicial: efectivoInicial, diferencia: diferencia
    }, sede, observacion);
  }
  return cajaEstado_(fecha, sede, usuario);
}

function cajaConfirmarRappi_(fecha, sede, usuario) {
  cajaExigirPermiso_(fecha, usuario);
  var turno = cajaTurnoAbierto_(sede);
  if (!turno) return { ok: false, error: 'Primero debes abrir la caja.' };
  cajaActualizarTurno_(turno.id, {
    rappi_encendido: true,
    rappi_confirmado_por: usuario.nombre,
    rappi_confirmado_en: new Date()
  });
  if (typeof auditoriaRegistrar_ === 'function') {
    auditoriaRegistrar_(usuario, 'CONFIRMAR_RAPPI', 'Caja_Turno', turno.id, { rappi_encendido: false }, { rappi_encendido: true }, sede, 'Rappi encendido');
  }
  return cajaEstado_(fecha, sede, usuario);
}

function cajaRegistrarMovimiento_(fecha, sede, item, usuario) {
  cajaExigirPermiso_(fecha, usuario);
  var turno = cajaTurnoAbierto_(sede);
  if (!turno) return { ok: false, error: 'Primero debes abrir la caja.' };

  item = item || {};
  var tipos = ['Ingreso', 'Salida', 'Entrega administrador'];
  var tipo = cajaTextoSeguro_(item.tipo);
  if (tipos.indexOf(tipo) === -1) return { ok: false, error: 'Tipo de movimiento inválido.' };
  var monto = cajaMonto_(item.monto, 'el monto', false);
  var motivo = cajaTextoSeguro_(item.motivo || '');
  var recibidoPor = cajaTextoSeguro_(item.recibido_por || '');
  if (!motivo) return { ok: false, error: 'Escribe el motivo del movimiento.' };
  if (tipo === 'Entrega administrador' && !recibidoPor) {
    return { ok: false, error: 'Escribe quién recibió el dinero.' };
  }

  var id = Utilities.getUuid();
  appendRowFromObj_(CAJA_SHEET_MOVIMIENTOS_, {
    id: id,
    turno_id: turno.id,
    fecha: fecha,
    sede: sede,
    tipo: tipo,
    monto: monto,
    motivo: motivo,
    recibido_por: recibidoPor,
    usuario_id: usuario.id,
    usuario: usuario.nombre,
    timestamp: new Date()
  });
  if (typeof auditoriaRegistrar_ === 'function') {
    auditoriaRegistrar_(usuario, 'REGISTRAR_MOVIMIENTO_CAJA', 'Caja_Movimiento', id, null, {
      turno_id: turno.id, tipo: tipo, monto: monto, motivo: motivo, recibido_por: recibidoPor
    }, sede, motivo);
  }
  return cajaEstado_(fecha, sede, usuario);
}

function cajaCerrar_(fecha, sede, datos, usuario) {
  cajaExigirPermiso_(fecha, usuario);
  var turno = cajaTurnoAbierto_(sede);
  if (!turno) return { ok: false, error: 'No hay una caja abierta para cerrar.' };

  datos = datos || {};
  var resumen = cajaResumenTurno_(turno);
  var contado = cajaMonto_(datos.efectivo_contado, 'el efectivo contado al cerrar', true);
  var baseSiguiente = cajaMonto_(datos.base_siguiente, 'la base que se deja para el siguiente turno', true);
  if (baseSiguiente > contado) {
    return { ok: false, error: 'La base para el siguiente turno no puede ser mayor que el efectivo contado.' };
  }
  var entregaFinal = Number((contado - baseSiguiente).toFixed(2));
  var recibidoPor = cajaTextoSeguro_(datos.recibido_por || '');
  if (entregaFinal > 0 && !recibidoPor) {
    return { ok: false, error: 'Escribe quién recibe el efectivo que se entrega al cierre.' };
  }
  var diferencia = Number((contado - resumen.efectivo_esperado).toFixed(2));
  var observacion = cajaTextoSeguro_(datos.observacion || '');
  if (Math.abs(diferencia) > 0.99 && !observacion) {
    return { ok: false, error: 'Hay una diferencia de caja. Escribe una observación antes de cerrar.' };
  }

  cajaActualizarTurno_(turno.id, {
    estado: 'Cerrado',
    usuario_cierra_id: usuario.id,
    usuario_cierra: usuario.nombre,
    cierre_en: new Date(),
    efectivo_fudo_turno: resumen.efectivo_fudo_turno,
    ingresos_total: resumen.ingresos_total,
    entregas_admin_total: resumen.entregas_admin_total,
    salidas_total: resumen.salidas_total,
    efectivo_esperado: resumen.efectivo_esperado,
    efectivo_contado: contado,
    diferencia_cierre: diferencia,
    entrega_final_admin: entregaFinal,
    recibido_por_cierre: recibidoPor,
    base_siguiente: baseSiguiente,
    observacion_cierre: observacion
  });

  if (typeof auditoriaRegistrar_ === 'function') {
    auditoriaRegistrar_(usuario, 'CERRAR_CAJA', 'Caja_Turno', turno.id, { estado: 'Abierto' }, {
      estado: 'Cerrado', efectivo_esperado: resumen.efectivo_esperado, efectivo_contado: contado,
      diferencia: diferencia, entrega_final_admin: entregaFinal, base_siguiente: baseSiguiente
    }, sede, observacion);
  }

  return {
    ok: true,
    estado: 'cerrada',
    turno_id: turno.id,
    sede: sede,
    efectivo_esperado: resumen.efectivo_esperado,
    efectivo_contado: contado,
    diferencia_cierre: diferencia,
    entrega_final_admin: entregaFinal,
    base_siguiente: baseSiguiente
  };
}

function cajaResponderApi_(e) {
  var body = {};
  try {
    if (e.postData && e.postData.contents) body = JSON.parse(e.postData.contents);
  } catch (err) {
    return jsonOut_({ ok: false, error: 'JSON inválido en el cuerpo de la solicitud' });
  }
  var params = Object.assign({}, e.parameter || {}, body || {});
  var action = params.action || '';
  if (String(action).indexOf('caja_') !== 0) return handleRequest_(e, 'POST');

  try {
    var sesion = validarToken_(params.token);
    if (!sesion.ok) return jsonOut_(sesion);
    var fecha = params.fecha;
    var sede = cajaSedePermitida_(sesion.usuario, params.sede);
    if (!fecha) return jsonOut_({ ok: false, error: 'Falta la fecha.' });

    switch (action) {
      case 'caja_estado':
        return jsonOut_(cajaEstado_(fecha, sede, sesion.usuario));
      case 'caja_abrir':
        return jsonOut_(cajaAbrir_(fecha, sede, params.datos || {}, sesion.usuario));
      case 'caja_rappi_confirmar':
        return jsonOut_(cajaConfirmarRappi_(fecha, sede, sesion.usuario));
      case 'caja_movimiento_registrar':
        return jsonOut_(cajaRegistrarMovimiento_(fecha, sede, params.item || {}, sesion.usuario));
      case 'caja_cerrar':
        return jsonOut_(cajaCerrar_(fecha, sede, params.datos || {}, sesion.usuario));
      default:
        return jsonOut_({ ok: false, error: 'Acción de caja desconocida: ' + action });
    }
  } catch (err) {
    var detalle = err && err.message ? err.message : String(err);
    return jsonOut_({ ok: false, error: detalle });
  }
}

// Code.gs declara doPost como función. Esta asignación conserva todo el enrutamiento existente y
// solo intercepta acciones cuyo nombre empieza por `caja_`.
doPost = function (e) {
  return cajaResponderApi_(e);
};
