/**
 * MIGRACIÓN SEGURA DEL MODELO DE RECETAS (15 jul 2026) — YA CUMPLIÓ SU FUNCIÓN, SUPERADA.
 *
 * MigracionRecetasJulio2026.gs (16 jul 2026) archiva (estado='archivado') las recetas que esta
 * migración cargaba con la versión 'amelia_historica_validada' (Chanchostilla, Supremo, Costilla,
 * Costilafel con números antiguos) por tener cantidades incorrectas. A propósito YA NO tiene ruta
 * en Code.gs (se quitó de handleRequest_): si se vuelve a correr, su upsert_ busca esas mismas
 * filas por producto+ingrediente+versión y las reescribe con estado='activo' por defecto, sin
 * saber que fueron archivadas a propósito — resucitaría en silencio recetas con números
 * incorrectos junto a las nuevas correctas. Se conserva el archivo solo como referencia histórica
 * de qué se corrigió y por qué; no debe volver a exponerse en el router ni en una pantalla.
 *
 * - crea un respaldo de la hoja antes del primer cambio;
 * - corrige los decimales perdidos de la base entregada;
 * - carga el estándar Amelia que fue verificado con los archivos históricos;
 * - carga Wafflería y las recetas nuevas todavía no confirmadas como BORRADOR;
 * - desactiva las líneas duplicadas de "Costilla Lista" que una migración anterior pudo agregar.
 *
 * Es idempotente: producto + ingrediente + versión identifican una línea.
 */
function migrarRecetasProduccion_() {
  configurarHojas();
  respaldarHojaRecetas_();

  const sh = sheet_(SHEET_NAMES.RECETAS);
  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  let data = sh.getDataRange().getValues();
  const col = {};
  headers.forEach(function (h, i) { col[h] = i; });
  const resumen = { corregidas: 0, creadas: 0, actualizadas: 0, desactivadas: 0, borradores: 0, respaldo: true };

  function clave_(s) { return normalizar_(s).replace(/ã³/g, 'o'); }
  function buscar_(producto, ingrediente, version) {
    for (let r = 1; r < data.length; r++) {
      if (clave_(data[r][col.producto]) !== clave_(producto)) continue;
      if (clave_(data[r][col.ingrediente]) !== clave_(ingrediente)) continue;
      const v = data[r][col.version];
      if (!version || !v || String(v) === String(version)) return r;
    }
    return -1;
  }

  function escribirFila_(r, obj) {
    headers.forEach(function (h, c) {
      if (obj[h] !== undefined) {
        sh.getRange(r + 1, c + 1).setValue(obj[h]);
        data[r][c] = obj[h];
      }
    });
  }

  function upsert_(obj) {
    obj = Object.assign({
      id: Utilities.getUuid(), rendimiento_producto: '', unidad_rendimiento: '', tipo: 'plato',
      fuente: 'Estandarización Amelia histórica', version: 'amelia_historica_validada', sede: 'Ambas',
      vigente_desde: '', vigente_hasta: '', estado: 'activo', controla_disponibilidad: true, notas: ''
    }, obj);
    const r = buscar_(obj.producto, obj.ingrediente, obj.version);
    if (r !== -1) {
      if (!data[r][col.id]) obj.id = Utilities.getUuid(); else obj.id = data[r][col.id];
      escribirFila_(r, obj);
      resumen.actualizadas++;
      if (obj.estado === 'borrador') resumen.borradores++;
      return;
    }
    const fila = headers.map(function (h) { return obj[h] !== undefined ? obj[h] : ''; });
    sh.appendRow(fila);
    data.push(fila);
    resumen.creadas++;
    if (obj.estado === 'borrador') resumen.borradores++;
  }

  // Si existe el texto dañado, se corrige antes de buscar/upsertar.
  for (let r = 1; r < data.length; r++) {
    if (String(data[r][col.producto] || '').indexOf('Falafel (adiciÃ') === 0) {
      escribirFila_(r, { producto: 'Falafel (adición)' });
      resumen.corregidas++;
    }
    const p = clave_(data[r][col.producto]);
    const i = clave_(data[r][col.ingrediente]);
    if (i === 'falafel crudo') {
      escribirFila_(r, { ingrediente: 'Falafel' });
      resumen.corregidas++;
    }
    if (p === 'falafel' && (i === 'falafel crudo' || i === 'falafel')) {
      escribirFila_(r, { producto: 'Falafel (plato)', ingrediente: 'Falafel' });
      resumen.corregidas++;
    }
    if (p === 'cebollita de amelia' && i === 'cebollita de amelia') {
      escribirFila_(r, { producto: 'Cebollita de Amelia (porción)' });
      resumen.corregidas++;
    }
    if (p === 'reduccion balsamica' && i === 'reduccion balsamica') {
      escribirFila_(r, { producto: 'Reducción Balsámica (porción)', ingrediente: 'Reducción Balsámica' });
      resumen.corregidas++;
    }
    if (p === 'papas listas' && (i === 'sal' || i === 'sal marina')) {
      escribirFila_(r, { ingrediente: 'Sal Marina Molida' });
      resumen.corregidas++;
    }
    if (p === 'papas listas' && i === 'perejil') {
      escribirFila_(r, { ingrediente: 'Perejil Picado' });
      resumen.corregidas++;
    }
    if (p === 'costilla lista') {
      escribirFila_(r, { tipo: 'produccion' });
      resumen.corregidas++;
    }
  }

  const platos = [
    ['Chanchostilla', 'Costilla Preparada', 115.3846154, 'g'],
    ['Chanchostilla', 'Panceta Pre-Ahumada', 123.2876712, 'g'],
    ['Chanchostilla', 'Papas Listas', 100, 'g'],
    ['Supremo', 'Costilla Preparada', 89.74358974, 'g'],
    ['Supremo', 'Panceta Pre-Ahumada', 82.19178082, 'g'],
    ['Supremo', 'Falafel', 68, 'g'],
    ['Supremo', 'Papas Listas', 100, 'g'],
    ['Costilla', 'Costilla Preparada', 230.7692308, 'g'],
    ['Costilla', 'Papas Listas', 100, 'g'],
    ['Panceta', 'Panceta Pre-Ahumada', 232.8767123, 'g'],
    ['Panceta', 'Papas Listas', 100, 'g'],
    ['Costilafel', 'Costilla Preparada', 115.3846154, 'g'],
    ['Costilafel', 'Falafel', 85, 'g'],
    ['Costilafel', 'Papas Listas', 100, 'g'],
    ['Chanchalafel', 'Panceta Pre-Ahumada', 123.2876712, 'g'],
    ['Chanchalafel', 'Falafel', 102, 'g'],
    ['Chanchalafel', 'Papas Listas', 100, 'g'],
    ['Falafel (plato)', 'Falafel', 187, 'g'],
    ['Falafel (plato)', 'Papas Listas', 100, 'g'],
    ['Panceta (adición)', 'Panceta Pre-Ahumada', 136.9863014, 'g'],
    ['Falafel (adición)', 'Falafel', 119, 'g'],
    ['Aioli (adición)', 'Aioli', 35, 'g'],
    ['Cebollita de Amelia (porción)', 'Cebollita de Amelia', 30, 'g'],
    ['Reducción Balsámica (porción)', 'Reducción Balsámica', 35, 'g'],
    ['Papas (adición)', 'Papas Listas', 100, 'g'],
    ['Combo Libra', 'Aioli', 60, 'g'],
    ['Combo Libra', 'Cebollita de Amelia', 60, 'g'],
    ['Combo Libra', 'Papas Listas', 200, 'g'],
    ['Combo Libra', 'Reducción Balsámica', 70, 'g'],
    ['Combo Media Libra', 'Aioli', 30, 'g'],
    ['Combo Media Libra', 'Cebollita de Amelia', 30, 'g'],
    ['Combo Media Libra', 'Papas Listas', 100, 'g'],
    ['Combo Media Libra', 'Reducción Balsámica', 35, 'g']
  ];
  platos.forEach(function (r) {
    upsert_({ producto: r[0], ingrediente: r[1], cantidad: r[2], unidad: r[3] });
  });

  // Preparación validada: para obtener 1 g de Papas Listas se consumen estos gramos.
  [
    ['Papas Pre-Fritas', 1.754386, true],
    ['Ajo Preparado', 0.02, false],
    ['Sal Marina Molida', 0.01, false],
    ['Perejil Picado', 0.02, false]
  ].forEach(function (r) {
    upsert_({ producto: 'Papas Listas', ingrediente: r[0], cantidad: r[1], unidad: 'g',
      rendimiento_producto: 1, unidad_rendimiento: 'g', tipo: 'produccion', controla_disponibilidad: r[2],
      notas: r[2] ? 'Insumo principal que limita el rendimiento.' : 'Se descuenta en el consumo teórico, pero no bloquea disponibilidad si no se cuenta a diario.' });
  });

  // La Wafflería: 15 g por bolita, 8 bolitas por Wafflebonitos y 35 g por porción de salsa.
  upsert_({ producto: 'Bolita de pandebono', ingrediente: 'Mezcla de pandebono', cantidad: 15, unidad: 'g',
    rendimiento_producto: 1, unidad_rendimiento: 'unidad', tipo: 'produccion',
    fuente: 'Recetario de la Wafflería', version: 'waffleria_validada',
    notas: 'Lote observado: 3.800 g = 253 bolitas y sobran 5 g.' });
  upsert_({ producto: 'Wafflebonitos', ingrediente: 'Bolita de pandebono', cantidad: 8, unidad: 'unidad',
    fuente: 'Recetario de la Wafflería', version: 'waffleria_validada',
    notas: '253 bolitas = 31 platos y sobran 5 bolitas.' });
  upsert_({ producto: 'Porción salsa pie de limón', ingrediente: 'Salsa de pie de limón', cantidad: 35, unidad: 'g',
    fuente: 'Recetario de la Wafflería', version: 'waffleria_validada',
    notas: 'Lote observado: 2.195 g = 62 porciones y sobran 25 g.' });

  // Datos nuevos que todavía requieren confirmar si el peso es antes o después de cocción.
  const borradores = [
    ['Cono Costilla', 'Costilla Preparada', 130], ['Cono Costilla', 'Papas Listas', 120],
    ['Cono Costilla', 'Cebollita de Amelia', 50],
    ['Cono Chanchostilla', 'Costilla Preparada', 80], ['Cono Chanchostilla', 'Panceta Pre-Ahumada', 90],
    ['Cono Chanchostilla', 'Papas Listas', 80], ['Cono Chanchostilla', 'Cebollita de Amelia', 50],
    ['Cono Panceta', 'Panceta Pre-Ahumada', 130], ['Cono Panceta', 'Papas Listas', 80],
    ['Cono Panceta', 'Cebollita de Amelia', 50]
  ];
  borradores.forEach(function (r) {
    upsert_({ producto: r[0], ingrediente: r[1], cantidad: r[2], unidad: 'g', estado: 'borrador',
      version: 'amelia_conos_por_confirmar', fuente: 'Actualización de estandarización',
      notas: 'Confirmar si el peso corresponde al insumo contado o al producto ya servido.' });
  });

  // Una migración anterior agregó estas líneas además de las cantidades ya ajustadas por merma.
  // Dejarlas activas contaría la costilla dos veces; se conservan para auditoría, pero inactivas.
  [['Chanchostilla', 'Costilla Lista'], ['Costilafel', 'Costilla Lista'], ['Costilla', 'Costilla Lista'], ['Supremo', 'Costilla Lista']]
    .forEach(function (x) {
      const r = buscar_(x[0], x[1], null);
      if (r !== -1 && normalizar_(data[r][col.estado] || 'activo') !== 'inactivo') {
        escribirFila_(r, { estado: 'inactivo', notas: 'Desactivada: duplicaba el consumo de Costilla Preparada ya ajustado por rendimiento.' });
        resumen.desactivadas++;
      }
    });

  SpreadsheetApp.flush();
  return { ok: true, resumen: resumen };
}

function respaldarHojaRecetas_() {
  const ss = ss_();
  const marca = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd_HHmmss');
  const prefijo = 'Respaldo_Recetas_';
  const yaExiste = ss.getSheets().some(function (s) { return s.getName().indexOf(prefijo) === 0; });
  if (yaExiste) return;
  sheet_(SHEET_NAMES.RECETAS).copyTo(ss).setName(prefijo + marca);
}
