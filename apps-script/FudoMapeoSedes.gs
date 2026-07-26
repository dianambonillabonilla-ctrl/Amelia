/**
 * MAPEO DE SEDES DE VENTAS DE FUDO
 * Fudo no tiene ningún campo de sede/sucursal (confirmado contra la especificación OpenAPI oficial
 * completa, ver apps-script/fudo-openapi.yml) — hoy la sede de una venta se infiere a mano con
 * listas de nombres de sala hardcodeadas en sedeDesdeCreadaPor_ (Fudo.gs). Esta hoja/tabla
 * (Fudo_Mapeo_Sedes) reemplaza esas listas fijas por una configuración editable desde la app: cada
 * fila vincula una referencia real de Fudo (nombre o, cuando se confirme que la cuenta lo entrega,
 * id) con una sede de Amelia.
 *
 * Prioridad para resolver la sede de una venta (jul 2026, según el modelo de arquitectura acordado):
 *   1. Mesa → Sala
 *   2. Caja registradora
 *   3. Identificador de venta
 *   4. Usuario o mesero
 *   5. (reglas específicas de canal — no implementado aún, no hay un caso real que lo pida todavía)
 *   6. Sin identificar (queda pendiente — nunca se asigna una sede sin evidencia)
 *
 * fudoResolverSedeVenta_ recibe las referencias YA resueltas de la venta (nombre de sala, de caja,
 * de identificador, de usuario/mesero — lo que haya disponible) y devuelve la primera que tenga
 * mapeo, en ese orden. No decide solo mirando la venta cruda: fudoApiFilasVentaDesdeSale_ (FudoApi.gs)
 * es quien arma esas referencias a partir de sale.relationships + los "incluidos" de la respuesta.
 */

const FUDO_MAPEO_SEDES_TIPOS_ = ['Sala', 'Caja', 'Identificador', 'Usuario'];
const FUDO_MAPEO_SEDES_PRIORIDAD_ = ['Sala', 'Caja', 'Identificador', 'Usuario'];
const FUDO_SEDE_SIN_IDENTIFICAR_ = 'Sin identificar';
const FUDO_PENDIENTE_VENTA_PREFIJO_ = 'Venta FUDO #';

function fudoMapeoSedeListar_() {
  return leerTabla_(SHEET_NAMES.FUDO_MAPEO_SEDES);
}

function fudoMapeoSedeGuardar_(item, usuario) {
  if (!item || !item.tipo_referencia || !item.nombre || !item.sede) {
    return { ok: false, error: 'Faltan tipo_referencia, nombre o sede' };
  }
  if (FUDO_MAPEO_SEDES_TIPOS_.indexOf(item.tipo_referencia) === -1) {
    return { ok: false, error: 'tipo_referencia debe ser una de: ' + FUDO_MAPEO_SEDES_TIPOS_.join(', ') };
  }
  const existentes = fudoMapeoSedeListar_();
  const clave = normalizar_(item.tipo_referencia) + '|' + normalizar_(item.nombre);
  const existente = existentes.find(function (m) {
    return normalizar_(m.tipo_referencia) + '|' + normalizar_(m.nombre) === clave;
  });
  const ahora = new Date();
  if (existente) {
    const sh = sheet_(SHEET_NAMES.FUDO_MAPEO_SEDES);
    const data = sh.getDataRange().getValues();
    const headers = data[0];
    const idCol = headers.indexOf('id');
    for (let r = 1; r < data.length; r++) {
      if (data[r][idCol] === existente.id) {
        const filaReal = r + 1;
        headers.forEach(function (h, c) {
          if (h === 'sede') sh.getRange(filaReal, c + 1).setValue(item.sede);
          if (h === 'id_fudo' && item.id_fudo !== undefined) sh.getRange(filaReal, c + 1).setValue(item.id_fudo);
        });
        break;
      }
    }
    return { ok: true, id: existente.id, actualizado: true };
  }
  const id = Utilities.getUuid();
  appendRowFromObj_(SHEET_NAMES.FUDO_MAPEO_SEDES, neutralizarObjetoFormulas_({
    id: id,
    tipo_referencia: item.tipo_referencia,
    id_fudo: item.id_fudo || '',
    nombre: item.nombre,
    sede: item.sede,
    creado_por: usuario && usuario.nombre,
    timestamp: ahora
  }));
  return { ok: true, id: id, actualizado: false };
}

function fudoMapeoSedeEliminar_(id) {
  if (!id) return { ok: false, error: 'Falta el id del mapeo a eliminar' };
  const sh = sheet_(SHEET_NAMES.FUDO_MAPEO_SEDES);
  const data = sh.getDataRange().getValues();
  const idCol = data[0].indexOf('id');
  for (let r = 1; r < data.length; r++) {
    if (data[r][idCol] === id) {
      sh.deleteRow(r + 1);
      return { ok: true };
    }
  }
  return { ok: false, error: 'No existe ese mapeo' };
}

function fudoMapeoSedeIndice_() {
  const indice = {};
  fudoMapeoSedeListar_().forEach(function (m) {
    indice[normalizar_(m.tipo_referencia) + '|' + normalizar_(m.nombre)] = m;
  });
  return indice;
}

function fudoResolverSedeVenta_(referencias, indiceOpcional) {
  const indice = indiceOpcional || fudoMapeoSedeIndice_();
  const referenciasPorTipo = {
    Sala: referencias && referencias.sala,
    Caja: referencias && referencias.caja,
    Identificador: referencias && referencias.identificador,
    Usuario: referencias && referencias.usuario
  };
  for (let i = 0; i < FUDO_MAPEO_SEDES_PRIORIDAD_.length; i++) {
    const tipo = FUDO_MAPEO_SEDES_PRIORIDAD_[i];
    const nombre = referenciasPorTipo[tipo];
    if (!nombre) continue;
    const mapeo = indice[normalizar_(tipo) + '|' + normalizar_(nombre)];
    if (mapeo) return { sede: mapeo.sede, resuelto_por: tipo };
  }
  return { sede: FUDO_SEDE_SIN_IDENTIFICAR_, resuelto_por: null };
}

/**
 * Convierte el valor que ya usa la API (`creada_por`) en un selector seguro.
 * - Referencias reales (sala/caja/usuario) siguen agrupándose y aprendiendo una regla.
 * - Cuando FUDO no trae ninguna referencia, la bandeja usa la etiqueta "Venta FUDO #<id>" y la
 *   asignación se limita exclusivamente a ese id_venta. Así dos domicilios sin mesa nunca se mandan
 *   juntos a una sede solo porque ambos tienen `creada_por` vacío.
 * También acepta un objeto { creada_por, id_venta } para clientes futuros sin romper la API actual.
 */
function ventasPendientesSedeSelector_(valor) {
  if (valor && typeof valor === 'object') {
    return {
      creada_por: String(valor.creada_por || ''),
      id_venta: valor.id_venta === null || valor.id_venta === undefined ? '' : String(valor.id_venta)
    };
  }
  const texto = String(valor || '');
  if (texto.indexOf(FUDO_PENDIENTE_VENTA_PREFIJO_) === 0) {
    return { creada_por: '', id_venta: texto.slice(FUDO_PENDIENTE_VENTA_PREFIJO_.length) };
  }
  return { creada_por: texto, id_venta: '' };
}

/**
 * BANDEJA "VENTAS PENDIENTES DE SEDE".
 * Las filas con una referencia real se agrupan por `creada_por`, para aprender una regla reutilizable.
 * Las filas sin referencia se agrupan por `id_venta`, porque varias ventas de domicilio pueden tener
 * `creada_por` vacío y pertenecer a sedes distintas.
 */
function ventasPendientesSedeListar_() {
  const grupos = {};
  const filas = (typeof ventasFudoLineasTodas_ === 'function'
    ? ventasFudoLineasTodas_({ sin_canceladas: false }).lineas
    : leerTabla_(SHEET_NAMES.VENTAS_FUDO));
  filas.forEach(function (v) {
    if (v.sede !== FUDO_SEDE_SIN_IDENTIFICAR_) return;
    const referencia = String(v.creada_por || '').trim();
    const idVenta = v.id_venta === null || v.id_venta === undefined ? '' : String(v.id_venta).trim();
    const porVenta = !referencia && !!idVenta;
    const clave = porVenta ? 'venta|' + idVenta : 'referencia|' + normalizar_(referencia);
    const etiqueta = porVenta ? FUDO_PENDIENTE_VENTA_PREFIJO_ + idVenta : referencia;
    if (!grupos[clave]) {
      grupos[clave] = {
        creada_por: etiqueta,
        id_venta: porVenta ? idVenta : '',
        tipo_asignacion: porVenta ? 'venta' : 'referencia',
        cantidad: 0,
        primera_fecha: v.creacion,
        ultima_fecha: v.creacion
      };
    }
    grupos[clave].cantidad++;
    if (formatearFecha_(v.creacion) < formatearFecha_(grupos[clave].primera_fecha)) grupos[clave].primera_fecha = v.creacion;
    if (formatearFecha_(v.creacion) > formatearFecha_(grupos[clave].ultima_fecha)) grupos[clave].ultima_fecha = v.creacion;
  });
  return Object.keys(grupos).map(function (k) { return grupos[k]; })
    .sort(function (a, b) { return b.cantidad - a.cantidad; });
}

/**
 * Asigna una sede por referencia reutilizable o, cuando no existe referencia, por id_venta.
 * En el segundo caso no crea una regla de mapeo: la decisión solo aplica a esa venta concreta.
 */
function ventasPendientesSedeAsignar_(creadaPor, sede, usuario) {
  if (!sede) return { ok: false, error: 'Falta la sede a asignar' };
  const selector = ventasPendientesSedeSelector_(creadaPor);
  const sh = sheet_(SHEET_NAMES.VENTAS_FUDO);
  const data = sh.getDataRange().getValues();
  const headers = data[0];
  const creadaPorCol = headers.indexOf('creada_por');
  const sedeCol = headers.indexOf('sede');
  const idVentaCol = headers.indexOf('id_venta');
  if (selector.id_venta && idVentaCol < 0) return { ok: false, error: 'Ventas_FUDO no tiene columna id_venta' };
  const idVentasTocadas = {};
  let actualizadas = 0;
  for (let r = 1; r < data.length; r++) {
    const coincide = selector.id_venta
      ? String(data[r][idVentaCol] || '') === selector.id_venta
      : (data[r][creadaPorCol] || '') === selector.creada_por;
    if (coincide && data[r][sedeCol] === FUDO_SEDE_SIN_IDENTIFICAR_) {
      sh.getRange(r + 1, sedeCol + 1).setValue(sede);
      actualizadas++;
      if (idVentaCol >= 0 && data[r][idVentaCol]) idVentasTocadas[String(data[r][idVentaCol])] = true;
    }
  }
  let actualizadasNorm = 0;
  if (typeof ventasPendientesSedeActualizarItems_ === 'function') {
    const resItems = ventasPendientesSedeActualizarItems_(selector.creada_por, sede, selector.id_venta);
    actualizadasNorm = resItems.actualizadas || 0;
    (resItems.id_ventas || []).forEach(function (id) { idVentasTocadas[String(id)] = true; });
  }
  if (typeof fudoVentasRecalcularCabecera_ === 'function') {
    Object.keys(idVentasTocadas).forEach(function (idVenta) { fudoVentasRecalcularCabecera_(idVenta); });
  }
  const reglaCreada = !selector.id_venta && selector.creada_por
    ? fudoMapeoSedeGuardar_({ tipo_referencia: 'Sala', nombre: selector.creada_por, sede: sede }, usuario)
    : null;
  return {
    ok: true,
    actualizadas: actualizadas,
    actualizadas_items: actualizadasNorm,
    id_venta: selector.id_venta || '',
    regla_creada: !!(reglaCreada && reglaCreada.ok)
  };
}

/** Actualiza sede en Fudo_Items usando la misma selección segura que Ventas_FUDO. */
function ventasPendientesSedeActualizarItems_(creadaPor, sede, idVentaObjetivo) {
  const sh = sheet_(SHEET_NAMES.FUDO_ITEMS);
  const data = sh.getDataRange().getValues();
  if (!data.length) return { actualizadas: 0, id_ventas: [] };
  const headers = data[0];
  const creadaPorCol = headers.indexOf('creada_por');
  const sedeCol = headers.indexOf('sede');
  const idVentaCol = headers.indexOf('id_venta');
  if (creadaPorCol < 0 || sedeCol < 0) return { actualizadas: 0, id_ventas: [] };
  if (idVentaObjetivo && idVentaCol < 0) return { actualizadas: 0, id_ventas: [] };
  const idVentas = {};
  let actualizadas = 0;
  for (let r = 1; r < data.length; r++) {
    const coincide = idVentaObjetivo
      ? String(data[r][idVentaCol] || '') === String(idVentaObjetivo)
      : (data[r][creadaPorCol] || '') === (creadaPor || '');
    if (coincide && data[r][sedeCol] === FUDO_SEDE_SIN_IDENTIFICAR_) {
      sh.getRange(r + 1, sedeCol + 1).setValue(sede);
      actualizadas++;
      if (idVentaCol >= 0 && data[r][idVentaCol]) idVentas[String(data[r][idVentaCol])] = true;
    }
  }
  return { actualizadas: actualizadas, id_ventas: Object.keys(idVentas) };
}
