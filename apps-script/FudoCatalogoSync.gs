/**
 * SINCRONIZACIÓN CATÁLOGO DILANA ↔ FUDO
 *
 * Dilana guarda productos en Catalogo_Maestro con nombre_estandar (vocabulario interno) y
 * nombre_fudo + id_fudo + tipo_fudo (vínculo con el POS). Hasta jul 2026 ese vínculo se armaba
 * manualmente en catalogo.html; esta módulo automatiza:
 *
 * - FUDO → Dilana: leer /products + /ingredients, vincular por id_fudo o por nombre, actualizar
 *   nombre_fudo y rellenar id_fudo/tipo_fudo en productos que ya existían sin ID.
 * - Dilana → FUDO: PATCH del nombre en FUDO cuando el Administrador guarda "Nombre en FUDO" o usa
 *   "Enviar nombres a FUDO".
 *
 * nombre_estandar NO se empuja a FUDO — es el nombre interno de Amelia; solo nombre_fudo es el
 * nombre del POS.
 */

const FUDO_CATALOGO_LIMITE_NOMBRE_ = 45;

function fudoCatalogoTipoRecurso_(tipoFudo) {
  if (tipoFudo === 'Ingrediente') return { recurso: 'ingredients', jsonType: 'Ingredient' };
  return { recurso: 'products', jsonType: 'Product' };
}

function catalogoIndicePorIdFudo_(catalogo) {
  const indice = {};
  catalogo.forEach(function (c) {
    if (c.id_fudo) indice[String(c.id_fudo)] = c;
  });
  return indice;
}

function catalogoBuscarPorNombreFudo_(nombre, catalogo, indiceNombre) {
  const norm = normalizar_(nombre);
  const clave = claveProducto_(nombre, indiceNombre);
  return catalogo.find(function (c) {
    return claveProducto_(c.nombre_estandar, indiceNombre) === clave || normalizar_(c.nombre_fudo) === norm;
  }) || null;
}

/**
 * Trae el catálogo completo de FUDO y lo cruza con Catalogo_Maestro.
 * opciones.crear_faltantes = true → crea entradas nuevas en Dilana para productos/ingredientes
 * de FUDO que no tienen pareja (por defecto false: solo reporta sin_vincular).
 */
function catalogoSincronizarDesdeFudo_(usuario, opciones) {
  opciones = opciones || {};
  const crearFaltantes = opciones.crear_faltantes === true;
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(60000)) {
    return { ok: false, error: 'Otra sincronización de catálogo está en curso — espera un momento y vuelve a intentarlo.' };
  }
  try {
    const productos = fudoApiObtenerTodoCompleto_('products', { include: 'unit' });
    const ingredientes = fudoApiObtenerTodoCompleto_('ingredients', { include: 'unit' });

    const catalogo = leerTabla_(SHEET_NAMES.CATALOGO);
    const indiceNombre = indiceCatalogo_();
    const porIdFudo = catalogoIndicePorIdFudo_(catalogo);

    const res = {
      ok: true,
      vinculados_por_id: 0,
      vinculados_por_nombre: 0,
      nombres_actualizados: 0,
      creados: 0,
      conflictos: [],
      sin_vincular: [],
      productos_fudo: 0,
      ingredientes_fudo: 0
    };

    function procesar(resultado, tipoFudo) {
      resultado.registros.forEach(function (item) {
        const idFudo = String(item.id);
        const attrs = item.attributes || {};
        const nombreFudo = String(attrs.name || '').trim();
        if (!nombreFudo) return;

        if (tipoFudo === 'Producto') res.productos_fudo++;
        else res.ingredientes_fudo++;

        const unidad = fudoApiUnidadDesdeItem_(item, resultado.incluidos);
        const row = porIdFudo[idFudo];

        if (row) {
          const patch = { id: row.id, id_fudo: idFudo, tipo_fudo: tipoFudo };
          if (!row.nombre_fudo || normalizar_(row.nombre_fudo) !== normalizar_(nombreFudo)) {
            patch.nombre_fudo = nombreFudo;
            res.nombres_actualizados++;
          }
          if (!row.unidad_base && unidad && typeof normalizarUnidad_ === 'function') {
            patch.unidad_base = normalizarUnidad_(unidad);
          }
          catalogoGuardar_(patch);
          res.vinculados_por_id++;
          return;
        }

        const porNombre = catalogoBuscarPorNombreFudo_(nombreFudo, catalogo, indiceNombre);
        if (porNombre) {
          if (porNombre.id_fudo && String(porNombre.id_fudo) !== idFudo) {
            res.conflictos.push({
              nombre_fudo: nombreFudo,
              id_fudo_nuevo: idFudo,
              id_fudo_actual: String(porNombre.id_fudo),
              producto: porNombre.nombre_estandar,
              mensaje: '"' + porNombre.nombre_estandar + '" ya tiene id_fudo ' + porNombre.id_fudo +
                ' pero FUDO también trae "' + nombreFudo + '" con id ' + idFudo
            });
            return;
          }
          catalogoGuardar_({
            id: porNombre.id,
            id_fudo: idFudo,
            tipo_fudo: tipoFudo,
            nombre_fudo: nombreFudo
          });
          porIdFudo[idFudo] = porNombre;
          res.vinculados_por_nombre++;
          return;
        }

        if (crearFaltantes) {
          const nuevo = {
            nombre_estandar: nombreFudo,
            nombre_fudo: nombreFudo,
            id_fudo: idFudo,
            tipo_fudo: tipoFudo,
            unidad_base: (typeof normalizarUnidad_ === 'function' ? normalizarUnidad_(unidad) : unidad) || '',
            categoria: ''
          };
          const guardado = catalogoGuardar_(nuevo, usuario);
          if (guardado.ok) {
            nuevo.id = guardado.id || nuevo.id;
            catalogo.push(nuevo);
            porIdFudo[idFudo] = nuevo;
            indiceNombre[normalizar_(nombreFudo)] = nombreFudo;
            res.creados++;
          }
        } else {
          res.sin_vincular.push({ nombre: nombreFudo, id_fudo: idFudo, tipo: tipoFudo });
        }
      });
    }

    procesar(productos, 'Producto');
    procesar(ingredientes, 'Ingrediente');

    if (typeof fudoApiSyncRegistrar_ === 'function') {
      fudoApiSyncRegistrar_('catalogo', {
        ok: true,
        usuario: usuario && usuario.nombre,
        vinculados_por_id: res.vinculados_por_id,
        vinculados_por_nombre: res.vinculados_por_nombre,
        nombres_actualizados: res.nombres_actualizados,
        creados: res.creados,
        conflictos: res.conflictos.length,
        sin_vincular: res.sin_vincular.length,
        error: ''
      });
    }

    return res;
  } finally {
    lock.releaseLock();
  }
}

/** Envía el "Nombre en FUDO" de un producto del catálogo al POS (PATCH). */
function catalogoEnviarNombreAFudo_(catalogoId, usuario) {
  const row = leerTabla_(SHEET_NAMES.CATALOGO).find(function (c) { return c.id === catalogoId; });
  if (!row) return { ok: false, error: 'Producto no encontrado en el catálogo' };
  if (!row.id_fudo) return { ok: false, error: 'Sin id_fudo — primero sincroniza desde FUDO o vincula manualmente.' };
  if (!row.tipo_fudo) return { ok: false, error: 'Sin tipo_fudo — vuelve a sincronizar desde FUDO.' };

  const nombre = String(row.nombre_fudo || '').trim();
  if (!nombre) return { ok: false, error: 'No hay "Nombre en FUDO" para enviar.' };
  if (nombre.length > FUDO_CATALOGO_LIMITE_NOMBRE_) {
    return { ok: false, error: 'El nombre supera ' + FUDO_CATALOGO_LIMITE_NOMBRE_ + ' caracteres (límite de FUDO).' };
  }

  const spec = fudoCatalogoTipoRecurso_(row.tipo_fudo);
  fudoApiPatch_(spec.recurso, row.id_fudo, {
    data: {
      id: String(row.id_fudo),
      type: spec.jsonType,
      attributes: { name: nombre }
    }
  });
  return { ok: true, id_fudo: row.id_fudo, nombre_enviado: nombre };
}

/** Envía en lote los nombres en FUDO de todos los productos vinculados (con id_fudo + tipo_fudo). */
function catalogoEnviarNombresAFudo_(usuario, opciones) {
  opciones = opciones || {};
  const catalogo = leerTabla_(SHEET_NAMES.CATALOGO);
  let enviados = 0;
  let omitidos = 0;
  const errores = [];

  catalogo.forEach(function (row) {
    if (!row.id_fudo || !row.tipo_fudo) { omitidos++; return; }
    if (!String(row.nombre_fudo || '').trim()) { omitidos++; return; }
    const r = catalogoEnviarNombreAFudo_(row.id, usuario);
    if (r.ok) enviados++;
    else errores.push({ producto: row.nombre_estandar, error: r.error });
  });

  if (typeof fudoApiSyncRegistrar_ === 'function') {
    fudoApiSyncRegistrar_('catalogo_push', {
      ok: errores.length === 0,
      usuario: usuario && usuario.nombre,
      enviados: enviados,
      omitidos: omitidos,
      errores: errores.length,
      error: errores.length ? errores[0].error : ''
    });
  }

  return { ok: true, enviados: enviados, omitidos: omitidos, errores: errores };
}
