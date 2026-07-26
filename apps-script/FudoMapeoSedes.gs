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
// Mismo orden de prioridad de fudoResolverSedeVenta_ — se declara aparte para no repetirlo.
const FUDO_MAPEO_SEDES_PRIORIDAD_ = ['Sala', 'Caja', 'Identificador', 'Usuario'];
const FUDO_SEDE_SIN_IDENTIFICAR_ = 'Sin identificar';

function fudoMapeoSedeListar_() {
  return leerTabla_(SHEET_NAMES.FUDO_MAPEO_SEDES);
}

/**
 * Crea o actualiza (por tipo_referencia + nombre, sin distinguir mayúsculas/tildes) el mapeo de una
 * referencia de Fudo hacia una sede. id_fudo es opcional: hoy la cuenta real solo confirma nombres
 * (de sala), no ids estables de caja/usuario/identificador — se guarda si se manda, para el día que
 * se confirme contra la cuenta real.
 */
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

/** tipo_referencia normalizado + nombre normalizado -> fila de Fudo_Mapeo_Sedes, para resolver rápido. */
function fudoMapeoSedeIndice_() {
  const indice = {};
  fudoMapeoSedeListar_().forEach(function (m) {
    indice[normalizar_(m.tipo_referencia) + '|' + normalizar_(m.nombre)] = m;
  });
  return indice;
}

/**
 * referencias = { sala, caja, identificador, usuario } — cualquiera puede venir vacío/ausente si
 * esa venta no trae ese dato (ej. sin mesa no hay sala; hoy la cuenta real tampoco trae caja).
 * Devuelve { sede, resuelto_por } con resuelto_por en FUDO_MAPEO_SEDES_PRIORIDAD_, o
 * { sede: FUDO_SEDE_SIN_IDENTIFICAR_, resuelto_por: null } si ninguna referencia tiene mapeo — en
 * ese caso NUNCA se inventa una sede: la venta queda pendiente para que un administrador la asigne.
 */
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
