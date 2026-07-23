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

/**
 * Por cada sector que alguien de `sede` eligió hoy, qué productos del catálogo marcados con ese
 * `sector` (y que caen en la frecuencia de conteo obligatoria de hoy) todavía no tienen conteo
 * registrado en `fecha`/`sede` — sin importar quién lo haya contado ni en qué punto exacto.
 * Productos del catálogo sin `sector` asignado no aparecen aquí (siguen bajo la validación de
 * frecuencia normal de conteo.html, no bloquean el cierre de turno).
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
  const contados = {};
  conteoListar_(fecha, sede).forEach(function (c) { contados[normalizar_(c.producto)] = true; });

  return Object.keys(sectoresHoy).sort().map(function (sector) {
    const items = catalogo.filter(function (p) {
      // Un producto de una sola sede (ej. "Salsa de mora" solo en Capri) no debe exigirse en la
      // otra — vacío o 'Ambas' = aplica a cualquier sede, igual que en productosObligatoriosFaltantes_.
      return p.sector === sector && p.frecuencia_conteo && frecuencias.indexOf(p.frecuencia_conteo) !== -1 &&
        (!p.sede || p.sede === 'Ambas' || p.sede === sede);
    });
    const faltantes = items.filter(function (p) { return !contados[normalizar_(p.nombre_estandar)]; }).map(function (p) { return p.nombre_estandar; });
    return { sector: sector, total: items.length, faltantes: faltantes };
  });
}

/**
 * Bloquea cerrar el turno si algún sector asignado hoy en `sede` todavía tiene productos
 * obligatorios de hoy sin contar. Si pasa, deja un registro en Cierres_Turno (auditoría de quién
 * cerró y cuándo) — no bloquea nada más del sistema, es la confirmación que pedía Diana.
 */
function turnoCerrar_(fecha, sede, usuario) {
  if (!fecha || !sede) return { ok: false, error: 'Falta la fecha o la sede' };
  const estado = turnoFaltantesPorSector_(fecha, sede);
  const pendientes = estado.filter(function (s) { return s.faltantes.length; });
  if (pendientes.length) {
    return {
      ok: false,
      error: 'Todavía falta contar: ' + pendientes.map(function (p) { return p.sector + ' (' + p.faltantes.join(', ') + ')'; }).join(' · '),
      pendientes: pendientes
    };
  }
  appendRowFromObj_(SHEET_NAMES.CIERRES_TURNO, {
    id: Utilities.getUuid(),
    fecha: fecha,
    sede: sede,
    usuario: usuario.nombre,
    timestamp: new Date()
  });
  return { ok: true };
}

function turnoCierreEstado_(fecha, sede) {
  if (!fecha || !sede) return { ok: true, cerrado: false };
  const fila = leerTabla_(SHEET_NAMES.CIERRES_TURNO).find(function (r) {
    return formatearFecha_(r.fecha) === fecha && r.sede === sede;
  });
  return { ok: true, cerrado: !!fila, usuario: fila ? fila.usuario : '', timestamp: fila ? fila.timestamp : '' };
}
