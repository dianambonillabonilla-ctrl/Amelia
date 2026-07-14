/**
 * HERRAMIENTAS DE DIAGNÓSTICO — correr manualmente desde el editor de Apps Script cuando algo
 * en el sistema se ve raro (ej. "Disponible Hoy" muestra 0 en todo, o el conteo no cuadra).
 *
 * Cómo usarlas: en el editor de Apps Script, selecciona la función en el menú desplegable de
 * arriba (junto al botón "Ejecutar") y dale clic a "Ejecutar". Después ve a Ver > Registros de
 * ejecución (o el ícono de reloj) para ver el resultado — cada función deja un reporte ahí,
 * no modifican ni borran nada por sí solas.
 */

/**
 * Busca en Recetas cantidades sospechosamente grandes (indicio típico de un cero de más o de
 * mezclar gramos con kilos al capturar el dato) — esto es justo lo que hace que "Disponible Hoy"
 * calcule 0 preparaciones posibles aunque sí haya stock real.
 */
function diagnosticarRecetas_(umbralSospechoso) {
  umbralSospechoso = umbralSospechoso || 20000; // más de 20kg/20000 unidades por receta es raro
  const filas = leerTabla_(SHEET_NAMES.RECETAS);
  const sospechosas = filas.filter(function (r) {
    const cantidad = Number(r.cantidad);
    return isNaN(cantidad) || cantidad <= 0 || cantidad > umbralSospechoso;
  });

  if (!sospechosas.length) {
    Logger.log('Recetas: no se encontraron cantidades sospechosas (umbral: ' + umbralSospechoso + ').');
    return;
  }

  Logger.log('Recetas con cantidades sospechosas (' + sospechosas.length + ' de ' + filas.length + '):');
  sospechosas.forEach(function (r) {
    Logger.log('  - ' + r.producto + ' <- ' + r.ingrediente + ': ' + r.cantidad + ' ' + r.unidad);
  });
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

  const duplicados = Object.keys(grupos).filter(function (k) { return grupos[k].length > 1; });
  if (!duplicados.length) {
    Logger.log('Conteos_Manuales: no se encontraron filas duplicadas.');
    return;
  }

  let totalFilasDeSobra = 0;
  Logger.log('Conteos_Manuales con posibles duplicados (' + duplicados.length + ' grupo(s)):');
  duplicados.forEach(function (k) {
    const grupo = grupos[k];
    totalFilasDeSobra += grupo.length - 1;
    Logger.log('  - ' + grupo.length + 'x  ' + grupo[0].fecha + ' | ' + grupo[0].sede + ' | ' + grupo[0].punto_conteo +
      ' | ' + grupo[0].producto + ' | ' + grupo[0].cantidad + ' | ids: ' + grupo.map(function (r) { return r.id; }).join(', '));
  });
  Logger.log('Si son duplicados reales, hay que borrar ' + totalFilasDeSobra + ' fila(s) de sobra en la hoja (deja solo una de cada grupo).');
}

/** Revisa qué tan completos están los datos importados de Ventas_FUDO. */
function diagnosticarVentasFudo_() {
  const filas = leerTabla_(SHEET_NAMES.VENTAS_FUDO);
  if (!filas.length) {
    Logger.log('Ventas_FUDO: la hoja está vacía, no se ha importado nada todavía.');
    return;
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
}

/** Corre las tres revisiones de una sola vez. */
function diagnosticoCompleto_() {
  Logger.log('========== DIAGNÓSTICO DE RECETAS ==========');
  diagnosticarRecetas_();
  Logger.log('');
  Logger.log('========== DIAGNÓSTICO DE CONTEOS DUPLICADOS ==========');
  diagnosticarConteosDuplicados_();
  Logger.log('');
  Logger.log('========== DIAGNÓSTICO DE VENTAS FUDO ==========');
  diagnosticarVentasFudo_();
}
