/**
 * HERRAMIENTAS DE DIAGNÓSTICO — se pueden correr manualmente desde el editor de Apps Script
 * (Ver > Registros de ejecución para el reporte en texto), o desde la página "Diagnóstico" de
 * la app web (que llama a estas mismas funciones vía las acciones diagnostico_* en Code.gs) —
 * útil cuando el editor de Apps Script no deja ejecutar funciones directamente. Ninguna de estas
 * funciones modifica ni borra nada, solo leen y reportan.
 */

/**
 * Busca en Recetas cantidades sospechosamente grandes (indicio típico de un cero de más o de
 * mezclar gramos con kilos al capturar el dato) — esto es justo lo que hace que "Disponible Hoy"
 * calcule 0 preparaciones posibles aunque sí haya stock real.
 */
function diagnosticarRecetas_(umbralSospechoso) {
  umbralSospechoso = Number(umbralSospechoso) || 20000; // más de 20kg/20000 unidades por receta es raro
  const filas = leerTabla_(SHEET_NAMES.RECETAS);
  const sospechosas = filas.filter(function (r) {
    const cantidad = Number(r.cantidad);
    return isNaN(cantidad) || cantidad <= 0 || cantidad > umbralSospechoso;
  });

  if (!sospechosas.length) {
    Logger.log('Recetas: no se encontraron cantidades sospechosas (umbral: ' + umbralSospechoso + ').');
  } else {
    Logger.log('Recetas con cantidades sospechosas (' + sospechosas.length + ' de ' + filas.length + '):');
    sospechosas.forEach(function (r) {
      Logger.log('  - ' + r.producto + ' <- ' + r.ingrediente + ': ' + r.cantidad + ' ' + r.unidad);
    });
  }

  return { total_filas: filas.length, umbral: umbralSospechoso, sospechosas: sospechosas };
}

/**
 * Busca en Conteos_Manuales filas que parecen ser el mismo conteo guardado más de una vez
 * (misma fecha + sede + punto + producto + cantidad + usuario) — típico de un doble clic en
 * "Guardar conteo", que hace que el stock se vea el doble de lo que hay físicamente.
 */
function diagnosticarConteosDuplicados_() {
  const filas = leerTabla_(SHEET_NAMES.CONTEOS);
  const grupos = {};
  filas.forEach(function (r) {
    const clave = [formatearFecha_(r.fecha), r.sede, r.punto_conteo, r.producto, r.cantidad, r.usuario].join('|');
    if (!grupos[clave]) grupos[clave] = [];
    grupos[clave].push(r);
  });

  const duplicados = Object.keys(grupos)
    .filter(function (k) { return grupos[k].length > 1; })
    .map(function (k) { return grupos[k]; });

  let totalFilasDeSobra = 0;
  if (!duplicados.length) {
    Logger.log('Conteos_Manuales: no se encontraron filas duplicadas.');
  } else {
    Logger.log('Conteos_Manuales con posibles duplicados (' + duplicados.length + ' grupo(s)):');
    duplicados.forEach(function (grupo) {
      totalFilasDeSobra += grupo.length - 1;
      Logger.log('  - ' + grupo.length + 'x  ' + grupo[0].fecha + ' | ' + grupo[0].sede + ' | ' + grupo[0].punto_conteo +
        ' | ' + grupo[0].producto + ' | ' + grupo[0].cantidad + ' | ids: ' + grupo.map(function (r) { return r.id; }).join(', '));
    });
    Logger.log('Si son duplicados reales, hay que borrar ' + totalFilasDeSobra + ' fila(s) de sobra en la hoja (deja solo una de cada grupo).');
  }

  return { total_filas: filas.length, grupos_duplicados: duplicados, filas_de_sobra: totalFilasDeSobra };
}

/** Revisa qué tan completos están los datos importados de Ventas_FUDO. */
function diagnosticarVentasFudo_() {
  const filas = leerTabla_(SHEET_NAMES.VENTAS_FUDO);
  if (!filas.length) {
    Logger.log('Ventas_FUDO: la hoja está vacía, no se ha importado nada todavía.');
    return { total_filas: 0, vacios: {} };
  }

  const campos = ['id_venta', 'creacion', 'producto', 'cantidad', 'precio', 'sede', 'creada_por'];
  const vacios = {};
  campos.forEach(function (c) { vacios[c] = 0; });

  filas.forEach(function (r) {
    campos.forEach(function (c) {
      if (r[c] === '' || r[c] === null || r[c] === undefined) vacios[c]++;
    });
  });

  Logger.log('Ventas_FUDO: ' + filas.length + ' filas totales. Campos vacíos:');
  campos.forEach(function (c) {
    if (vacios[c] > 0) Logger.log('  - ' + c + ': ' + vacios[c] + ' de ' + filas.length + ' filas vacías');
  });
  if (campos.every(function (c) { return vacios[c] === 0; })) {
    Logger.log('  Todos los campos están completos.');
  } else {
    Logger.log('Si la mayoría de campos aparecen vacíos, probablemente el archivo que se subió no tenía');
    Logger.log('las columnas con los nombres exactos que espera importarFudo_() en Fudo.gs (Id. Venta, Creación,');
    Logger.log('Producto, Categoría, Cantidad, Precio, Cancelada, Creada por) — revisa el encabezado real del');
    Logger.log('archivo .xls que exporta FUDO y compáralo con esos nombres.');
  }

  return { total_filas: filas.length, vacios: vacios };
}

/**
 * Para cada compra ('Compra cruda' en Ajustes_Inventario), revisa si de verdad se está sumando
 * al cálculo de "Disponible Hoy" o si quedó descartada en silencio, y por qué — mismas reglas
 * exactas que usa obtenerUltimoStockPorIngrediente_/netoAjustesDesdeConteo_ (DisponibleHoy.gs):
 *   - El nombre no coincide con ningún producto del Catálogo Maestro (ver claveProducto_): cuenta
 *     como un producto aparte, nunca suma al que sí existe.
 *   - La unidad de la compra no coincide, después de convertir a g/ml/u (aUnidadBase_), con la
 *     unidad del último conteo físico de ese producto en esa sede: nunca se mezcla peso/volumen
 *     con piezas, así que la compra entera se ignora.
 *   - La fecha de la compra es igual o anterior a la del último conteo físico: se asume que ese
 *     conteo ya la incluía.
 * Pedido real: "todo lo que aparece en la compra no está sumando" — antes solo se sospechaba caso
 * por caso (ej. Limón Tahití); esto lo revisa para TODAS las compras de una vez. Cada problema
 * trae también `solucion` (texto para leer) y `accion.opciones` (lista de decisiones concretas
 * que diagnostico.html convierte en botones — ver resolverOpcionesNombreNoEnCatalogo_ para el caso
 * de nombre fuera de catálogo, e inline para unidad distinta / fecha ya cubierta). Pedido real:
 * "necesito que me dé las opciones y finalmente yo decido qué hacer" — ningún caso se deja solo
 * con texto explicando qué hacer a mano; SIEMPRE hay algo para elegir con un clic, aunque la
 * decisión final (cuál valor es el correcto) siga siendo humana.
 */
function diagnosticarComprasNoSuman_() {
  const indice = indiceCatalogo_();
  const catalogo = leerTabla_(SHEET_NAMES.CATALOGO).filter(function (c) { return c.nombre_estandar; });
  const compras = leerTabla_(SHEET_NAMES.AJUSTES_INVENTARIO).filter(function (a) { return a.tipo === 'Compra cruda'; });
  const conteos = leerTabla_(SHEET_NAMES.CONTEOS);

  const ultimoConteoPorClaveSede = {};
  conteos.forEach(function (c) {
    const clave = claveProducto_(c.producto, indice);
    const sede = c.sede || 'Sin sede';
    const key = clave + '|' + sede;
    const f = formatearFecha_(c.fecha);
    const base = aUnidadBase_(c.cantidad, c.unidad);
    if (!ultimoConteoPorClaveSede[key] || f > ultimoConteoPorClaveSede[key].fecha) {
      ultimoConteoPorClaveSede[key] = { fecha: f, unidad: base.unidad };
    }
  });

  const problemas = [];
  compras.forEach(function (a) {
    const enCatalogo = !!indice[normalizar_(a.producto)];
    const clave = claveProducto_(a.producto, indice);
    const sede = a.sede || 'Sin sede';
    const ultimoConteo = ultimoConteoPorClaveSede[clave + '|' + sede];
    const base = aUnidadBase_(a.cantidad, a.unidad);
    const fechaCompra = formatearFecha_(a.fecha);

    let motivo = '';
    let solucion = '';
    let opciones = [];
    if (!enCatalogo) {
      motivo = 'El nombre "' + a.producto + '" no existe en el Catálogo Maestro — se cuenta como un producto aparte, nunca suma al real.';
      const resuelto = resolverOpcionesNombreNoEnCatalogo_(a.producto, a.unidad, catalogo);
      solucion = resuelto.texto;
      opciones = resuelto.opciones;
    } else if (ultimoConteo && ultimoConteo.unidad && ultimoConteo.unidad !== base.unidad) {
      motivo = 'La compra quedó en "' + a.unidad + '" pero el último conteo físico de este producto en ' + sede + ' fue en una unidad distinta — no se pueden combinar, la compra se ignora por completo.';
      solucion = 'Decide cuál unidad es la correcta para "' + a.producto + '" en ' + sede + ' y elige abajo — el diagnóstico no lo adivina solo.';
      opciones = [
        {
          id: 'corregir_unidad', etiqueta: 'La unidad del último conteo ("' + ultimoConteo.unidad + '") es la correcta — corregir esta compra',
          ajuste_id: a.id, unidad_sugerida: ultimoConteo.unidad, unidad_actual: a.unidad, cantidad_actual: a.cantidad, producto: a.producto
        },
        {
          id: 'ir_a_conteo', etiqueta: 'La unidad de la compra ("' + a.unidad + '") es la correcta — voy a registrar un conteo físico nuevo en esa unidad',
          info: true
        }
      ];
    } else if (ultimoConteo && fechaCompra <= ultimoConteo.fecha) {
      motivo = 'La fecha de la compra (' + fechaCompra + ') es igual o anterior al último conteo físico (' + ultimoConteo.fecha + ') — se asume que ese conteo ya la incluía.';
      solucion = 'Decide si el conteo del ' + ultimoConteo.fecha + ' en ' + sede + ' de verdad ya incluía esta compra y elige abajo.';
      opciones = [
        { id: 'confirmar_incluida', etiqueta: 'Sí, el conteo del ' + ultimoConteo.fecha + ' ya incluía esta compra — no hacer nada', info: true },
        { id: 'ir_a_conteo', etiqueta: 'No, el conteo se hizo ANTES de recibir esta compra (' + fechaCompra + ') — voy a registrar uno nuevo', info: true }
      ];
    }

    if (motivo) {
      problemas.push({
        fecha: fechaCompra, producto: a.producto, sede: sede, cantidad: a.cantidad, unidad: a.unidad,
        proveedor: a.proveedor || '', numero_factura: a.numero_factura || '', motivo: motivo, solucion: solucion,
        accion: { tipo: 'opciones', opciones: opciones }
      });
    }
  });

  problemas.sort(function (x, y) { return x.fecha < y.fecha ? 1 : x.fecha > y.fecha ? -1 : 0; });
  Logger.log('Compras: ' + compras.length + ' revisadas, ' + problemas.length + ' no se están sumando a Disponible Hoy.');
  return { total_compras: compras.length, con_problema: problemas.length, problemas: problemas };
}

/**
 * Opciones concretas y ACCIONABLES para una compra cuyo nombre de producto no existe en el
 * Catálogo Maestro. SIEMPRE incluye "crear como producto nuevo" (catalogo_guardar sin id); si
 * además hay un producto del catálogo con nombre muy parecido (ver sonNombresParecidos_), se
 * agrega también "vincular como alias" del que ya existe (catalogo_guardar con nombre_fudo) — las
 * dos se muestran juntas para que decidas tú cuál aplica, en vez de que el diagnóstico elija solo.
 */
function resolverOpcionesNombreNoEnCatalogo_(nombreCompra, unidadCompra, catalogo) {
  const norm = normalizar_(nombreCompra);
  const parecido = catalogo.find(function (c) { return sonNombresParecidos_(norm, normalizar_(c.nombre_estandar)); });
  const opciones = [];
  let texto;
  if (parecido) {
    texto = 'Probablemente es el mismo producto que "' + parecido.nombre_estandar + '" escrito distinto — elige abajo ' +
      'si quieres vincularlo a ese producto o crearlo como uno nuevo aparte.';
    opciones.push({
      id: 'vincular_alias', etiqueta: 'Vincular a "' + parecido.nombre_estandar + '" (ya existe, escrito distinto)',
      catalogo_id: parecido.id, catalogo_nombre: parecido.nombre_estandar, alias: nombreCompra,
      nombre_fudo_actual: parecido.nombre_fudo || ''
    });
  } else {
    texto = 'No hay ningún producto parecido en el catálogo — créalo con el botón de abajo (o a mano desde Catálogo ' +
      'Maestro) con nombre_estandar "' + nombreCompra + '" (corrígelo antes si fue un error de tipeo).';
  }
  opciones.push({
    id: 'crear_producto', etiqueta: 'Crear "' + nombreCompra + '" como producto nuevo',
    nombre: nombreCompra, unidad_base: normalizarUnidad_(unidadCompra) || ''
  });
  return { texto: texto, opciones: opciones };
}

// Conectores que no aportan nada al comparar nombres de producto — "Aceite Girasol" y "Aceite de
// Girasol" deben tratarse como el mismo producto, no como dos nombres distintos solo porque uno
// tiene un "de" de más en medio.
const CONECTORES_NOMBRE_PRODUCTO_ = ['de', 'del', 'la', 'las', 'el', 'los', 'y', 'con', 'sin', 'para'];

function palabrasSignificativas_(nombreNormalizado) {
  return nombreNormalizado.split(' ').filter(function (p) { return p && CONECTORES_NOMBRE_PRODUCTO_.indexOf(p) === -1; });
}

/**
 * Heurística compartida para decidir si dos nombres normalizados probablemente son el mismo
 * producto escrito distinto. Compara por PALABRAS (ignorando conectores como "de"/"la"), no solo
 * letra por letra, para agarrar casos reales que un simple prefijo o una distancia de edición
 * corta se pierden: "Aceite Girasol" vs "Aceite de Girasol" (conector de más en medio), nombres
 * con las mismas palabras en otro orden, o una palabra de más/de menos en cualquier posición (no
 * solo al final, como "Limón" vs "Limón Tahití"). Si por palabras no calzan, cae a distancia de
 * edición proporcional al tamaño del nombre más corto (typos: "Costilla cruda"/"Costilla curda").
 * Usada tanto por diagnosticarCatalogoDuplicados_ (catálogo contra sí mismo) como por
 * resolverOpcionesNombreNoEnCatalogo_ (nombre de una compra contra el catálogo).
 */
function sonNombresParecidos_(na, nb) {
  if (na === nb) return true;
  const wa = palabrasSignificativas_(na);
  const wb = palabrasSignificativas_(nb);
  if (wa.length && wb.length) {
    const masCorta = wa.length <= wb.length ? wa : wb;
    const masLarga = wa.length <= wb.length ? wb : wa;
    // Todas las palabras del nombre más corto están en el más largo, en cualquier posición: uno es
    // el otro con palabra(s) de más/de menos (cubre también el caso de mismo largo, mismas palabras).
    if (masCorta.every(function (p) { return masLarga.indexOf(p) !== -1; })) return true;
  }
  const distancia = distanciaEdicion_(na, nb);
  const umbral = Math.max(1, Math.floor(Math.min(na.length, nb.length) * 0.25));
  return distancia <= umbral;
}

/**
 * Compara cada par de nombres del Catálogo Maestro para encontrar posibles duplicados escritos
 * distinto — típico de compras/conteos con texto libre que terminan creando un producto nuevo sin
 * querer en vez de reusar el que ya existe (ver catalogoAsegurar_ en Catalogo.gs). Marca un par
 * como sospechoso si uno es el otro con palabra(s) de más (ej. "Limón" vs "Limón Tahití") o si la
 * distancia de edición entre los nombres normalizados es chica para su tamaño (typo, singular vs
 * plural). Trae el `id` de cada uno de los dos para que diagnostico.html pueda ofrecer "con cuál
 * quedarme, cuál elimino" y fusionarlos con un clic (ver catalogoFusionar_ en Catalogo.gs) — esta
 * función en sí NUNCA fusiona ni borra nada, solo detecta y decides tú.
 */
function diagnosticarCatalogoDuplicados_() {
  const catalogo = leerTabla_(SHEET_NAMES.CATALOGO).filter(function (c) { return c.nombre_estandar; });
  const sospechosos = [];
  for (let i = 0; i < catalogo.length; i++) {
    for (let j = i + 1; j < catalogo.length; j++) {
      const a = catalogo[i], b = catalogo[j];
      const na = normalizar_(a.nombre_estandar), nb = normalizar_(b.nombre_estandar);
      if (na === nb) continue; // ya se tratan como el mismo producto (claveProducto_), no es el problema aquí
      const prefijo = na.indexOf(nb + ' ') === 0 || nb.indexOf(na + ' ') === 0;
      if (sonNombresParecidos_(na, nb)) {
        sospechosos.push({
          a: a.nombre_estandar, a_id: a.id, a_categoria: a.categoria || '',
          b: b.nombre_estandar, b_id: b.id, b_categoria: b.categoria || '',
          razon: prefijo ? 'uno es el otro con palabra(s) de más' : 'nombres muy parecidos (posible typo o singular/plural)'
        });
      }
    }
  }
  Logger.log('Catálogo: ' + catalogo.length + ' productos revisados, ' + sospechosos.length + ' par(es) sospechoso(s) de ser el mismo producto.');
  return { total_productos: catalogo.length, sospechosos: sospechosos };
}

/** Distancia de edición (Levenshtein) clásica entre dos strings — usada por sonNombresParecidos_ para sugerir posibles duplicados de catálogo o alias de compras. */
function distanciaEdicion_(a, b) {
  const m = a.length, n = b.length;
  const fila = new Array(n + 1);
  for (let j = 0; j <= n; j++) fila[j] = j;
  for (let i = 1; i <= m; i++) {
    let anterior = fila[0];
    fila[0] = i;
    for (let j = 1; j <= n; j++) {
      const temp = fila[j];
      fila[j] = a[i - 1] === b[j - 1] ? anterior : 1 + Math.min(anterior, fila[j], fila[j - 1]);
      anterior = temp;
    }
  }
  return fila[n];
}

/** Corre las revisiones de una sola vez (para el uso manual desde el editor). */
function diagnosticoCompleto_() {
  Logger.log('========== DIAGNÓSTICO DE RECETAS ==========');
  diagnosticarRecetas_();
  Logger.log('');
  Logger.log('========== DIAGNÓSTICO DE CONTEOS DUPLICADOS ==========');
  diagnosticarConteosDuplicados_();
  Logger.log('');
  Logger.log('========== DIAGNÓSTICO DE VENTAS FUDO ==========');
  diagnosticarVentasFudo_();
  Logger.log('');
  Logger.log('========== DIAGNÓSTICO DE COMPRAS QUE NO SUMAN ==========');
  diagnosticarComprasNoSuman_();
  Logger.log('');
  Logger.log('========== DIAGNÓSTICO DE CATÁLOGO DUPLICADO ==========');
  diagnosticarCatalogoDuplicados_();
}
