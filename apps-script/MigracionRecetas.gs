/**
 * MIGRACIÓN DE Recetas: corrige los valores con el punto decimal perdido, arregla el nombre mal
 * codificado de "Falafel (adición)", separa el choque de nombres entre la porción servida y el
 * insumo a granel ("Cebollita de Amelia" / "Reducción Balsámica"), y agrega toda la capa de
 * producción (materia prima -> insumo preparado) que hoy falta en la hoja.
 *
 * Se corre UNA vez desde la página Diagnóstico (acción `migrar_recetas_produccion`, solo
 * Administrador) o directo desde el editor de Apps Script. Es segura de repetir: busca cada fila
 * por producto+ingrediente antes de tocarla o agregarla, así que si ya se corrió antes no duplica
 * nada ni vuelve a pisar una corrección ya aplicada a mano.
 */
function migrarRecetasProduccion_() {
  const sh = sheet_(SHEET_NAMES.RECETAS);
  let headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];

  ['rendimiento_producto', 'unidad_rendimiento', 'tipo'].forEach(function (col) {
    if (headers.indexOf(col) === -1) {
      sh.getRange(1, sh.getLastColumn() + 1).setValue(col);
      headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
    }
  });

  const colIdx = {};
  headers.forEach(function (h, i) { colIdx[h] = i; });
  let data = sh.getDataRange().getValues();

  const resumen = { correcciones: [], renombrados: [], filas_nuevas: [], filas_que_ya_existian: [] };

  function norm_(s) {
    return String(s || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ');
  }

  function buscarFila_(producto, ingrediente) {
    for (let r = 1; r < data.length; r++) {
      if (norm_(data[r][colIdx.producto]) === norm_(producto) && norm_(data[r][colIdx.ingrediente]) === norm_(ingrediente)) {
        return r;
      }
    }
    return -1;
  }

  // 1) Corrige las cantidades que perdieron el punto decimal al capturarse.
  const correcciones = [
    ['Chanchostilla', 'Costilla Preparada', 115.3846154],
    ['Chanchostilla', 'Panceta Pre-ahumada', 123.2876712],
    ['Chanchalafel', 'Panceta Pre-ahumada', 123.2876712],
    ['Costilla', 'Costilla Preparada', 230.7692308],
    ['Panceta', 'Panceta Pre-ahumada', 232.8767123],
    ['Costilafel', 'Costilla Preparada', 115.3846154],
    ['Supremo', 'Costilla Preparada', 89.74358974],
    ['Supremo', 'Panceta Pre-ahumada', 82.19178082],
    ['Panceta (adicion)', 'Panceta Pre-ahumada', 136.9863014],
    ['Papas Listas', 'Papas Pre-fritas', 1.754386]
  ];
  correcciones.forEach(function (c) {
    const r = buscarFila_(c[0], c[1]);
    if (r === -1) { resumen.correcciones.push({ producto: c[0], ingrediente: c[1], estado: 'no encontrada, revisar a mano' }); return; }
    const anterior = data[r][colIdx.cantidad];
    if (Number(anterior) === c[2]) { resumen.correcciones.push({ producto: c[0], ingrediente: c[1], estado: 'ya estaba correcta' }); return; }
    sh.getRange(r + 1, colIdx.cantidad + 1).setValue(c[2]);
    data[r][colIdx.cantidad] = c[2];
    resumen.correcciones.push({ producto: c[0], ingrediente: c[1], antes: anterior, despues: c[2] });
  });

  // 2) Nombre mal codificado (mojibake típico de copiar/pegar con codificación equivocada).
  for (let r = 1; r < data.length; r++) {
    const p = String(data[r][colIdx.producto]);
    if (p.indexOf('adici') !== -1 && p.indexOf('Ã') !== -1) {
      sh.getRange(r + 1, colIdx.producto + 1).setValue('Falafel (adición)');
      resumen.renombrados.push({ antes: p, despues: 'Falafel (adición)' });
      data[r][colIdx.producto] = 'Falafel (adición)';
    }
  }

  // 3) Choque de nombres: la porción servida y el insumo a granel se llamaban igual. Se renombra
  // solo la fila de la porción servida (la que ya existía en Recetas); el insumo a granel se deja
  // con su nombre original porque es el que ya se cuenta físicamente en Conteos_Manuales.
  [
    ['Cebollita de Amelia', 'Cebollita de Amelia', 'Cebollita de Amelia (porción)'],
    ['Reducción Balsámica', 'Reduccion Balsámica', 'Reducción Balsámica (porción)']
  ].forEach(function (rc) {
    const r = buscarFila_(rc[0], rc[1]);
    if (r === -1) return;
    if (String(data[r][colIdx.producto]).trim() === rc[2]) { resumen.renombrados.push({ producto: rc[2], estado: 'ya estaba renombrado' }); return; }
    sh.getRange(r + 1, colIdx.producto + 1).setValue(rc[2]);
    resumen.renombrados.push({ antes: rc[0], despues: rc[2] });
    data[r][colIdx.producto] = rc[2];
  });

  // 4) Filas nuevas: capa de producción (materia prima -> preparado) sacada de "Guia Produccion",
  // más las líneas de "Costilla Lista" y los productos de combo que faltaban de "Estandarización
  // Productos". No duplica si el producto+ingrediente ya existe en la hoja.
  //
  // OJO: se asume que "Falafel crudo" (usado como ingrediente en Chanchalafel/Costilafel/Falafel)
  // y "Falafel" (el que tiene receta de producción en Guia Produccion) son el mismo insumo — por
  // eso la fila de producción se agrega con el nombre "Falafel crudo" para que conecten. Si en
  // realidad son dos cosas distintas, dímelo y lo separo.
  const filasNuevas = [
    ['Chanchostilla', 'Costilla Lista', 90, 'g', '', '', 'plato'],
    ['Costilafel', 'Costilla Lista', 90, 'g', '', '', 'plato'],
    ['Costilla', 'Costilla Lista', 180, 'g', '', '', 'plato'],
    ['Supremo', 'Costilla Lista', 70, 'g', '', '', 'plato'],
    ['Costilla Lista', 'Costilla preparada', 1.282051282, 'g', '', '', 'plato'],
    ['Costilla Lista', 'Reduccion Balsámica', 0.53, 'g', '', '', 'plato'],
    ['Combo Libra', 'Aioli', 60, 'g', '', '', 'plato'],
    ['Combo Libra', 'Cebollita de Amelia', 60, 'g', '', '', 'plato'],
    ['Combo Libra', 'Papas Listas', 200, 'g', '', '', 'plato'],
    ['Combo Libra', 'Reduccion Balsámica', 70, 'g', '', '', 'plato'],
    ['Combo Media Libra', 'Aioli', 30, 'g', '', '', 'plato'],
    ['Combo Media Libra', 'Cebollita de Amelia', 30, 'g', '', '', 'plato'],
    ['Combo Media Libra', 'Papas Listas', 100, 'g', '', '', 'plato'],
    ['Combo Media Libra', 'Reduccion Balsámica', 35, 'g', '', '', 'plato'],
    ['Costilla de Combo', 'Costilla Lista', 1, 'g', '', '', 'plato'],
    ['Costilla (adición)', 'Costilla Lista', 110, 'g', '', '', 'plato'],
    ['Falafel de Combo', 'Falafel crudo', 1.136363636, 'g', '', '', 'plato'],
    ['Michelada', 'Zumo Limón', 2, 'CONFIRMAR-UNIDAD', '', '', 'plato'],
    ['Michelada', 'Sal marina molida', 1, 'CONFIRMAR-UNIDAD', '', '', 'plato'],
    ['Zumo Limon', 'Limon Tahiti', 3457.814661, 'g', 1000, 'g', 'produccion'],
    ['Ajo preparado', 'Aceite Vegetal', 1000, 'g', 1577, 'g', 'produccion'],
    ['Ajo preparado', 'Ajo en Cabezas', 1000, 'g', 1577, 'g', 'produccion'],
    ['Cebolla en Pluma (sin limon)', 'Cebolla Roja', 1480, 'g', 1000, 'g', 'produccion'],
    ['Salsa Costilla Nueva', 'Azucar Morena', 4533.333333, 'g', 18157.33333, 'g', 'produccion'],
    ['Salsa Costilla Nueva', 'Miel Maple', 3640, 'g', 18157.33333, 'g', 'produccion'],
    ['Salsa Costilla Nueva', 'Salsa Soya', 4453.333333, 'g', 18157.33333, 'g', 'produccion'],
    ['Salsa Costilla Nueva', 'Vinagre Balsamico', 4320, 'g', 18157.33333, 'g', 'produccion'],
    ['Salsa Costilla Nueva', 'Ajo Preparado', 650.6666667, 'g', 18157.33333, 'g', 'produccion'],
    ['Salsa Costilla Nueva', 'Especias Salsa Costilla', 560, 'g', 18157.33333, 'g', 'produccion'],
    ['Reduccion Balsámica', 'Salsa Costilla Nueva', 6809, 'g', 9065, 'g', 'produccion'],
    ['Falafel crudo', 'Cilantro', 849, 'g', 5660, 'g', 'produccion'],
    ['Falafel crudo', 'Perejil', 849, 'g', 5660, 'g', 'produccion'],
    ['Falafel crudo', 'Cebolla Corazones', 979.3799567, 'g', 5660, 'g', 'produccion'],
    ['Falafel crudo', 'Ajo Preparado', 163.2299928, 'g', 5660, 'g', 'produccion'],
    ['Falafel crudo', 'Garbanzo', 2000, 'g', 5660, 'g', 'produccion'],
    ['Falafel crudo', 'Zumo Limon', 32.64599856, 'g', 5660, 'g', 'produccion'],
    ['Falafel crudo', 'Especias Falafel', 273.4102379, 'g', 5660, 'g', 'produccion'],
    ['Panceta de Combo', 'Panceta pre-ahumada', 1.369863014, 'g', '', '', 'plato'],
    ['Costilla Limpia Marinada (con polvo)', 'Costilla San Luis Entera', 23000, 'g', 23615.80361, 'g', 'produccion'],
    ['Costilla Limpia Marinada (con polvo)', 'Sal Marina Gruesa', 268.2009973, 'g', 23615.80361, 'g', 'produccion'],
    ['Costilla Limpia Marinada (con polvo)', 'Especias de Marinar Costilla', 347.6026084, 'g', 23615.80361, 'g', 'produccion'],
    ['Costilla Preparada', 'Costilla Limpia Marinada (con polvo)', 7250, 'g', 5305.288301, 'g', 'produccion'],
    ['Panceta Pre-ahumada', 'Panceta Entera', 31800, 'g', 22676.42857, 'g', 'produccion'],
    ['Panceta Pre-ahumada', 'Sal Marina Gruesa', 445.2, 'g', 22676.42857, 'g', 'produccion'],
    ['Aioli', 'Aceite de Oliva', 1000, 'g', 1303, 'g', 'produccion'],
    ['Aioli', 'Huevos A', 4, 'unidad', 1303, 'g', 'produccion'],
    ['Aioli', 'Sal Marina Molida', 10, 'g', 1303, 'g', 'produccion'],
    ['Aioli', 'Ajo preparado', 115, 'g', 1303, 'g', 'produccion'],
    ['Aioli', 'Zumo Limon', 37, 'g', 1303, 'g', 'produccion'],
    ['Cebollita de Amelia', 'Cebolla en Pluma (sin limon)', 801.8252934, 'g', 1000, 'g', 'produccion'],
    ['Cebollita de Amelia', 'Zumo Limon', 198.8265971, 'g', 1000, 'g', 'produccion'],
    ['Cebollita de Amelia', 'Sal Marina Molida', 5, 'g', 1000, 'g', 'produccion'],
    ['Papas pre-fritas', 'Papa Capira', 1519.920319, 'g', 1000, 'g', 'produccion'],
    ['Papas pre-fritas', 'Vinagre Blanco', 12.11155378, 'g', 1000, 'g', 'produccion'],
    ['Papas pre-fritas', 'Agua', 834.8605578, 'g', 1000, 'g', 'produccion']
  ];

  filasNuevas.forEach(function (f) {
    if (buscarFila_(f[0], f[1]) !== -1) { resumen.filas_que_ya_existian.push(f[0] + ' <- ' + f[1]); return; }
    const fila = headers.map(function (h) {
      if (h === 'producto') return f[0];
      if (h === 'ingrediente') return f[1];
      if (h === 'cantidad') return f[2];
      if (h === 'unidad') return f[3];
      if (h === 'rendimiento_producto') return f[4];
      if (h === 'unidad_rendimiento') return f[5];
      if (h === 'tipo') return f[6];
      return '';
    });
    sh.appendRow(fila);
    resumen.filas_nuevas.push(f[0] + ' <- ' + f[1]);
    data.push(fila); // así una fila nueva no se vuelve a agregar si aparece dos veces en la lista
  });

  SpreadsheetApp.flush();
  return { ok: true, resumen: resumen };
}
