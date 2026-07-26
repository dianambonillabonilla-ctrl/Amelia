/**
 * TURNOS Y SECTORES DEL DÍA
 * Una misma persona puede ser cocinero un día y estar en café o en caja otro — pedido real:
 * "yo debería manualmente definir las opciones de sub usuario de cada usuario y cuando se marque
 * esa opción qué sector le toca contar". `sectores_permitidos` en Usuarios (lista separada por
 * comas, la define el Administrador) es el conjunto de sectores que esa persona puede elegir; cada
 * vez que entra, elige cuál le toca HOY (Turnos_Sector, una fila por usuario+fecha, se actualiza
 * si vuelve a elegir el mismo día).
 *
 * Esto no reemplaza ni bloquea el guardado individual de cada quien (conteoRegistrar_ sigue igual)
 * — alimenta turnoFaltantesPorSector_/turnoCerrar_, para que el Encargado/Administrador vea quién
 * falta y no pueda cerrar el turno del día hasta que todos los sectores asignados hoy hayan
 * contado lo que el catálogo marca como suyo (columna `sector`, opcional — un producto sin sector
 * asignado no bloquea nada, sigue bajo la regla de frecuencia normal de Registrar conteo).
 */

function sectoresPermitidos_(usuario) {
  return String((usuario && usuario.sectores_permitidos) || '')
    .split(',')
    .map(function (s) { return s.trim(); })
    .filter(Boolean);
}

function turnoSectorElegir_(fecha, sector, usuario) {
  if (!fecha || !sector) return { ok: false, error: 'Falta la fecha o el sector' };
  const permitidos = sectoresPermitidos_(usuario);
  if (permitidos.length && permitidos.indexOf(sector) === -1) {
    return { ok: false, error: 'Ese sector no está habilitado para tu usuario — pídele al Administrador que te lo agregue en Usuarios.' };
  }

  const sh = sheet_(SHEET_NAMES.TURNOS_SECTOR);
  const data = sh.getDataRange().getValues();
  const headers = data[0];
  const fechaCol = headers.indexOf('fecha');
  const usuarioIdCol = headers.indexOf('usuario_id');
  const sectorCol = headers.indexOf('sector');
  const tsCol = headers.indexOf('timestamp');

  for (let r = 1; r < data.length; r++) {
    if (formatearFecha_(data[r][fechaCol]) === fecha && data[r][usuarioIdCol] === usuario.id) {
      sh.getRange(r + 1, sectorCol + 1).setValue(sector);
      sh.getRange(r + 1, tsCol + 1).setValue(new Date());
      return { ok: true, actualizado: true };
    }
  }

  appendRowFromObj_(SHEET_NAMES.TURNOS_SECTOR, {
    id: Utilities.getUuid(),
    fecha: fecha,
    usuario_id: usuario.id,
    usuario_nombre: usuario.nombre,
    sector: sector,
    timestamp: new Date()
  });
  return { ok: true, creado: true };
}

function turnoSectorDeHoy_(usuario, fecha) {
  if (!fecha) return { ok: false, error: 'Falta la fecha' };
  const fila = leerTabla_(SHEET_NAMES.TURNOS_SECTOR).find(function (r) {
    return formatearFecha_(r.fecha) === fecha && r.usuario_id === usuario.id;
  });
  return { ok: true, sector: fila ? fila.sector : '' };
}

function turnosSectorDelDia_(fecha) {
  return leerTabla_(SHEET_NAMES.TURNOS_SECTOR).filter(function (r) { return formatearFecha_(r.fecha) === fecha; });
}

/** `fechaStr` (yyyy-MM-dd) menos un día — año/mes/día locales, no el string ISO directo, para que
 * la zona horaria no corra el día (mismo patrón que frecuenciasObligatoriasDelDia_ en Catalogo.gs). */
function diaAnterior_(fechaStr) {
  const partes = String(fechaStr).slice(0, 10).split('-').map(Number);
  const d = new Date(partes[0], partes[1] - 1, partes[2]);
  d.setDate(d.getDate() - 1);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

/**
 * Si hoy hace falta un conteo de INICIO de turno en `sede` antes del de cierre — pedido real:
 * "cuando no se registre conteo de cierre para el turno[,] del próximo día debe de pedir conteo
 * de inicio de turno y después el conteo de cierre de turno". Se dispara solo: si el turno de
 * AYER en esta sede nunca quedó cerrado (sin fila en Cierres_Turno), hoy hace falta primero
 * establecer una base real con un conteo de inicio, antes de confiar en lo que se cuente al
 * cierre. Una vez que el turno de hoy se cierre bien, mañana ya no lo pide (no se acumula "deuda"
 * más allá de un día para atrás).
 */
function requiereConteoInicioTurno_(fecha, sede) {
  if (!fecha || !sede) return false;
  return !turnoCierreEstado_(diaAnterior_(fecha), sede).cerrado;
}

/**
 * Por cada sector que alguien de `sede` eligió hoy, qué productos del catálogo marcados con ese
 * `sector` (y que caen en la frecuencia de conteo obligatoria de hoy) todavía no tienen conteo
 * registrado en `fecha`/`sede` — sin importar en qué punto exacto. Productos del catálogo sin
 * `sector` asignado no aparecen aquí (siguen bajo la validación de frecuencia normal de Registrar
 * conteo, no bloquean el cierre de turno).
 *
 * `usuarios` trae los nombres de quienes ya contaron algo de ese sector hoy (turno "Cierre de
 * turno") — pedido real: "le debe de salir que si ya registró, el que registró y quién lo hizo" —
 * para que Caja (quien cierra el turno, ver turnoCerrar_) vea de un vistazo quién sí cumplió.
 *
 * Si `requiereConteoInicioTurno_` es cierto (ayer no se cerró esta sede), cada sector trae TAMBIÉN
 * `faltantes_inicio`/`usuarios_inicio`: lo mismo pero para el turno "Inicio de turno", que hoy hay
 * que completar ANTES de que el de "Cierre de turno" cuente para poder cerrar — ver turnoCerrar_.
 */
function turnoFaltantesPorSector_(fecha, sede) {
  if (!fecha || !sede) return [];
  const usuariosPorId = {};
  leerTabla_(SHEET_NAMES.USUARIOS).forEach(function (u) { usuariosPorId[u.id] = u; });

  const sectoresHoy = {};
  turnosSectorDelDia_(fecha).forEach(function (t) {
    const u = usuariosPorId[t.usuario_id];
    if (!u || !t.sector) return;
    if (u.sede !== sede && u.sede !== 'Ambas') return;
    sectoresHoy[t.sector] = true;
  });

  const catalogo = leerTabla_(SHEET_NAMES.CATALOGO);
  const frecuencias = frecuenciasObligatoriasDelDia_(fecha);
  // claveProducto_/indiceCatalogo_ (no normalizar_ a secas): sin esto, un producto contado bajo su
  // alias de FUDO (nombre_fudo) en vez de nombre_estandar exacto seguía apareciendo como "falta
  // contar" para el sector, aunque ya se hubiera contado — bloqueaba cerrar el turno sin motivo.
  const indice = indiceCatalogo_();
  const requiereInicio = requiereConteoInicioTurno_(fecha, sede);

  // Separado por turno ('Inicio de turno' / 'Cierre de turno'): contadoPorClave (booleano) va
  // aparte de usuariosPorClave (nombres) — una fila de conteo sin `usuario` registrado (dato
  // viejo/incompleto) SÍ debe contar como "ya contado" aunque no se pueda decir quién lo hizo.
  function turnoVacio_() { return { contado: {}, usuarios: {} }; }
  const porTurno = { 'Inicio de turno': turnoVacio_(), 'Cierre de turno': turnoVacio_() };
  conteoListar_(fecha, sede).forEach(function (c) {
    const turno = c.turno === 'Inicio de turno' ? 'Inicio de turno' : 'Cierre de turno';
    const clave = claveProducto_(c.producto, indice);
    porTurno[turno].contado[clave] = true;
    if (!porTurno[turno].usuarios[clave]) porTurno[turno].usuarios[clave] = [];
    if (c.usuario && porTurno[turno].usuarios[clave].indexOf(c.usuario) === -1) porTurno[turno].usuarios[clave].push(c.usuario);
  });

  function faltantesYUsuarios_(items, turno) {
    const faltantes = [];
    const usuariosSector = {};
    items.forEach(function (p) {
      const clave = claveProducto_(p.nombre_estandar, indice);
      if (!porTurno[turno].contado[clave]) { faltantes.push(p.nombre_estandar); return; }
      (porTurno[turno].usuarios[clave] || []).forEach(function (u) { usuariosSector[u] = true; });
    });
    return { faltantes: faltantes, usuarios: Object.keys(usuariosSector).sort() };
  }

  return Object.keys(sectoresHoy).sort().map(function (sector) {
    const items = catalogo.filter(function (p) {
      // Un producto de una sola sede (ej. "Salsa de mora" solo en Capri) no debe exigirse en la
      // otra — vacío o 'Ambas' = aplica a cualquier sede, igual que en productosObligatoriosFaltantes_.
      return p.sector === sector && p.frecuencia_conteo && frecuencias.indexOf(p.frecuencia_conteo) !== -1 &&
        (!p.sede || p.sede === 'Ambas' || p.sede === sede);
    });
    const cierre = faltantesYUsuarios_(items, 'Cierre de turno');
    const resultado = {
      sector: sector, total: items.length, faltantes: cierre.faltantes, usuarios: cierre.usuarios,
      requiere_inicio: requiereInicio
    };
    if (requiereInicio) {
      const inicio = faltantesYUsuarios_(items, 'Inicio de turno');
      resultado.faltantes_inicio = inicio.faltantes;
      resultado.usuarios_inicio = inicio.usuarios;
    }
    return resultado;
  });
}

/**
 * A qué 'turno' pertenece un conteo que se está guardando AHORA, cuando quien lo guarda no lo
 * especifica: 'Inicio de turno' si hoy hace falta (ayer no se cerró esta sede, ver
 * requiereConteoInicioTurno_) y el sector de hoy de `usuario` todavía no completó su conteo de
 * inicio; 'Cierre de turno' en cualquier otro caso (el comportamiento de siempre). Se autoetiqueta
 * solo — el personal no necesita entender la diferencia entre los dos, solo sigue contando normal
 * y el sistema decide a cuál turno pertenece cada envío. Usada por conteoRegistrar_ (Conteos.gs).
 */
function turnoOportuno_(fecha, sede, usuario) {
  if (!requiereConteoInicioTurno_(fecha, sede)) return 'Cierre de turno';
  const sectorHoy = turnoSectorDeHoy_(usuario, fecha).sector;
  if (!sectorHoy) return 'Cierre de turno';
  const estadoSector = turnoFaltantesPorSector_(fecha, sede).find(function (s) { return s.sector === sectorHoy; });
  if (estadoSector && estadoSector.faltantes_inicio && estadoSector.faltantes_inicio.length) return 'Inicio de turno';
  return 'Cierre de turno';
}

/**
 * Resumen de lo que hay para revisar ANTES de cerrar el turno (docs/modelo-inventario.md, sección
 * 6.F): total vendido según Fudo, traslados de/hacia esta sede que todavía no quedaron Confirmados/
 * Resueltos, y cuánta producción se registró — para que quien cierra vea de un vistazo si falta
 * algo antes de confirmar. Es de solo lectura (se puede pedir las veces que haga falta sin efecto
 * alguno); turnoCerrar_ vuelve a calcular lo mismo y lo guarda como snapshot al momento de cerrar.
 *
 * Incluye pagos sincronizados de Fudo (Pagos_FUDO) para comparar el efectivo esperado contra
 * `efectivo_contado` al cerrar, y un resumen de diferencias inventario (teórico vs. contado del día)
 * para los productos que sí tuvieron conteo en esa sede.
 */
function turnoResumenCierre_(fecha, sede) {
  if (!fecha || !sede) return { ok: false, error: 'Falta la fecha o la sede' };

  const ventasDelDia = leerTabla_(SHEET_NAMES.VENTAS_FUDO).filter(function (v) {
    return formatearFecha_(v.creacion) === fecha && v.sede === sede &&
      !(v.cancelada === true || normalizar_(v.cancelada) === 'si');
  });
  const ventasFudoTotal = ventasDelDia.reduce(function (acc, v) {
    return acc + (Number(v.precio) || 0) * (Number(v.cantidad) || 0);
  }, 0);

  const pagos = pagosFudoTotalesSedeFecha_(fecha, sede);

  const trasladosPendientes = leerTabla_(SHEET_NAMES.TRASLADOS).filter(function (t) {
    return (t.sede_origen === sede || t.sede_destino === sede) &&
      ['Enviado', 'Con observación'].indexOf(t.estado) !== -1;
  }).length;

  // Se lee Producciones directamente (no produccionListar_ de Produccion.gs) por el mismo motivo
  // que sedeDesdeCreadaPor_ (Fudo.gs) no llama a fudoMapeoSedeIndice_: en Apps Script real todos los
  // .gs comparten un mismo scope, pero en las pruebas cada archivo se carga en un contexto aislado —
  // así no hace falta mockear una función de otro archivo solo para esto.
  const produccionesRegistradas = leerTabla_(SHEET_NAMES.PRODUCCIONES).filter(function (p) {
    return formatearFecha_(p.fecha) === fecha && p.sede === sede;
  }).length;

  const inventario = typeof resumenDiferenciasInventarioFechaSede_ === 'function'
    ? resumenDiferenciasInventarioFechaSede_(fecha, sede)
    : { ok: true, productos_contados: 0, productos_con_diferencia: 0, diferencias: [] };

  return {
    ok: true,
    ventas_fudo_total: ventasFudoTotal,
    ventas_fudo_cantidad: ventasDelDia.length,
    pagos_fudo_total: pagos.pagos_fudo_total,
    pagos_efectivo_esperado: pagos.pagos_efectivo_esperado,
    pagos_fudo_cantidad: pagos.pagos_fudo_cantidad,
    traslados_pendientes: trasladosPendientes,
    producciones_registradas: produccionesRegistradas,
    inventario_contado: inventario.productos_contados || 0,
    diferencia_inventario: inventario.productos_con_diferencia || 0,
    diferencias_inventario: inventario.diferencias || []
  };
}

/**
 * Bloquea cerrar el turno si algún sector asignado hoy en `sede` todavía tiene productos
 * obligatorios de hoy sin contar — primero el de INICIO si hace falta (ver
 * requiereConteoInicioTurno_/turnoFaltantesPorSector_), y solo después el de CIERRE. Si pasa, deja
 * un registro en Cierres_Turno (auditoría de quién cerró y cuándo, más el resumen de
 * turnoResumenCierre_ y lo que haya llegado en `datosCierre.efectivo_contado`/`observaciones`) —
 * no bloquea nada más del sistema, es la confirmación que pedía Diana.
 *
 * Quién puede cerrar: Administrador/Encargado siempre (supervisión), o quien tenga el sector
 * "Caja" elegido hoy — pedido real: "caja es el responsable final de que todo quede bien". El
 * resto del personal (Cocina/Café ese día) no puede cerrar el turno aunque tenga acceso a la app.
 */
function turnoCerrar_(fecha, sede, usuario, datosCierre) {
  datosCierre = datosCierre || {};
  if (!fecha || !sede) return { ok: false, error: 'Falta la fecha o la sede' };
  if (usuario.rol !== 'Administrador' && usuario.rol !== 'Encargado') {
    const sectorHoy = turnoSectorDeHoy_(usuario, fecha).sector;
    if (sectorHoy !== 'Caja') {
      return { ok: false, error: 'Solo quien tiene el sector "Caja" asignado hoy (o un Administrador/Encargado) puede cerrar el turno.' };
    }
  }
  // Sin este chequeo, dos personas cerrando casi al mismo tiempo (o un doble clic) dejaban dos
  // filas de cierre para el mismo día/sede en Cierres_Turno — no rompía nada más, pero ensuciaba
  // la auditoría de quién cerró. Cerrar de nuevo un turno ya cerrado simplemente confirma el
  // cierre existente en vez de duplicarlo.
  const yaCerrado = turnoCierreEstado_(fecha, sede);
  if (yaCerrado.cerrado) return { ok: true, ya_cerrado: true, usuario: yaCerrado.usuario, timestamp: yaCerrado.timestamp };

  const estado = turnoFaltantesPorSector_(fecha, sede);
  const pendientesInicio = estado.filter(function (s) { return s.requiere_inicio && s.faltantes_inicio && s.faltantes_inicio.length; });
  if (pendientesInicio.length) {
    return {
      ok: false,
      error: 'Ayer no se cerró el turno de ' + sede + ' — primero hay que completar el conteo de INICIO de hoy: ' +
        pendientesInicio.map(function (p) { return p.sector + ' (' + p.faltantes_inicio.join(', ') + ')'; }).join(' · '),
      pendientes_inicio: pendientesInicio
    };
  }
  const pendientesCierre = estado.filter(function (s) { return s.faltantes.length; });
  if (pendientesCierre.length) {
    return {
      ok: false,
      error: 'Todavía falta contar: ' + pendientesCierre.map(function (p) { return p.sector + ' (' + p.faltantes.join(', ') + ')'; }).join(' · '),
      pendientes: pendientesCierre
    };
  }
  const resumen = turnoResumenCierre_(fecha, sede);
  const efectivoContado = datosCierre.efectivo_contado !== undefined && datosCierre.efectivo_contado !== ''
    ? Number(datosCierre.efectivo_contado) : '';
  const diferenciaCaja = efectivoContado !== ''
    ? efectivoContado - (Number(resumen.pagos_efectivo_esperado) || 0) : '';
  const diffsInventario = (resumen.diferencias_inventario || []).filter(function (d) {
    return Math.abs(Number(d.diferencia) || 0) > 0.001;
  }).slice(0, 40);
  appendRowFromObj_(SHEET_NAMES.CIERRES_TURNO, {
    id: Utilities.getUuid(),
    fecha: fecha,
    sede: sede,
    usuario: usuario.nombre,
    timestamp: new Date(),
    ventas_fudo_total: resumen.ventas_fudo_total,
    traslados_pendientes: resumen.traslados_pendientes,
    producciones_registradas: resumen.producciones_registradas,
    pagos_fudo_total: resumen.pagos_fudo_total,
    pagos_efectivo_esperado: resumen.pagos_efectivo_esperado,
    diferencia_caja: diferenciaCaja,
    efectivo_contado: efectivoContado,
    inventario_contado: resumen.inventario_contado,
    diferencia_inventario: resumen.diferencia_inventario,
    diferencias_inventario_json: diffsInventario.length ? JSON.stringify(diffsInventario) : '',
    observaciones: datosCierre.observaciones || ''
  });
  return { ok: true, resumen: resumen, diferencia_caja: diferenciaCaja };
}

/**
 * Histórico de cierres de turno — para historial-cierres-turno.html. Más reciente primero por fecha
 * de cierre (luego por sede). Parsea diferencias_inventario_json a un arreglo listo para la UI.
 */
function cierresTurnoListar_(filtros) {
  filtros = filtros || {};
  let rows = leerTabla_(SHEET_NAMES.CIERRES_TURNO);
  if (filtros.fecha_desde) {
    rows = rows.filter(function (r) { return formatearFecha_(r.fecha) >= filtros.fecha_desde; });
  }
  if (filtros.fecha_hasta) {
    rows = rows.filter(function (r) { return formatearFecha_(r.fecha) <= filtros.fecha_hasta; });
  }
  if (filtros.sede && filtros.sede !== 'Ambas') {
    rows = rows.filter(function (r) { return r.sede === filtros.sede; });
  }
  return rows.sort(function (a, b) {
    const fa = formatearFecha_(a.fecha);
    const fb = formatearFecha_(b.fecha);
    if (fa !== fb) return fa < fb ? 1 : -1;
    return String(a.sede).localeCompare(String(b.sede));
  }).map(function (r) {
    const fila = Object.assign({}, r);
    if (fila.diferencias_inventario_json) {
      try {
        fila.diferencias_inventario = JSON.parse(fila.diferencias_inventario_json);
      } catch (err) {
        fila.diferencias_inventario = [];
      }
      delete fila.diferencias_inventario_json;
    } else {
      fila.diferencias_inventario = [];
    }
    return fila;
  });
}

function turnoCierreEstado_(fecha, sede) {
  if (!fecha || !sede) return { ok: true, cerrado: false };
  const fila = leerTabla_(SHEET_NAMES.CIERRES_TURNO).find(function (r) {
    return formatearFecha_(r.fecha) === fecha && r.sede === sede;
  });
  return {
    ok: true,
    cerrado: !!fila,
    usuario: fila ? fila.usuario : '',
    timestamp: fila ? fila.timestamp : '',
    ventas_fudo_total: fila ? fila.ventas_fudo_total : '',
    traslados_pendientes: fila ? fila.traslados_pendientes : '',
    producciones_registradas: fila ? fila.producciones_registradas : '',
    pagos_fudo_total: fila ? fila.pagos_fudo_total : '',
    pagos_efectivo_esperado: fila ? fila.pagos_efectivo_esperado : '',
    diferencia_caja: fila ? fila.diferencia_caja : '',
    efectivo_contado: fila ? fila.efectivo_contado : '',
    inventario_contado: fila ? fila.inventario_contado : '',
    diferencia_inventario: fila ? fila.diferencia_inventario : '',
    observaciones: fila ? fila.observaciones : ''
  };
}
