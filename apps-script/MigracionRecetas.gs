/**
 * MIGRACIÓN DE Recetas: corrige celdas de `cantidad`/`rendimiento_producto` que quedaron guardadas
 * como TEXTO en vez de número (típico cuando alguien teclea "1.366561" con punto en un Sheets con
 * configuración regional de Colombia: la hoja no lo reconoce como número y lo deja como texto sin
 * avisar), arregla el nombre mal codificado de "Falafel (adición)", separa el choque de nombres
 * entre la porción servida y el insumo a granel ("Cebollita de Amelia" / "Reducción Balsámica"), y
 * agrega toda la capa de producción (materia prima -> insumo preparado) que hoy falta en la hoja.
 *
 * Los multiplicadores de NIVEL 1 (materia prima -> preparado) y NIVEL 1.5 (preparado -> porción
 * lista) vienen de "recetas_actualizadas_costilla_panceta_falafel_papas.csv" (fuente: fórmulas de
 * Guía Producción / Estandarización Productos), confirmados con Diana el 2026-07-15. Se guardan
 * con rendimiento_producto=1 y `cantidad` = el multiplicador exacto en gramos por cada 1g de
 * salida, sin redondear más de los 6 decimales que ya trae la fuente.
 *
 * Deliberadamente NO se agrega receta propia para: consumo de Panceta pre-ahumada por plato
 * (Chanchostilla, Supremo, Panceta, Chanchalafel, Panceta (adición) — 3 estándares distintos sin
 * resolver, PENDIENTE 5.1), la composición de Ajo Preparado (2 recetas distintas, PENDIENTE 5.2),
 * Combo Libra/Media Libra (factor de proteína sin confirmar, PENDIENTE 5.3), Beignets/Cono
 * Beignet/Michelada (sin datos confiables, PENDIENTE 5.4) ni Cebollita de Amelia como adición
 * (solo estimación empírica de un día, PENDIENTE 5.5). Si alguna de esas filas ya existía de un
 * intento anterior, esta migración la borra en vez de "corregirla", para no dejar un número
 * adivinado operando en el sistema — que se muestre como receta pendiente de confirmar en vez de
 * calcular con un dato inventado.
 *
 * También corrige un bug de doble conteo: Chanchostilla/Supremo/Costilla/Costilafel tenían (o
 * habrían quedado con, si esta migración se hubiera corrido antes de detectarlo) una fila directa
 * "plato <- Costilla Preparada" Y la cadena nueva "plato <- Costilla Lista <- Costilla Preparada",
 * contando el mismo consumo dos veces. Se borra la fila directa vieja y se deja solo la cadena de
 * 4 niveles.
 *
 * Y corrige el tipo de "Papas Listas" (y define el de "Costilla Lista") como 'produccion', no
 * 'plato': son porciones listas internas (NIVEL 1.5), no algo que se vende directo — si quedan
 * como 'plato' aparecen como fila vendible en Disponible Hoy y Conciliación las trata como límite
 * de conteo físico en vez de seguir bajando hasta Costilla Preparada, que es el comportamiento
 * correcto pero solo si el tipo está bien puesto.
 *
 * Se corre UNA vez desde la página Diagnóstico (acción `migrar_recetas_produccion`, solo
 * Administrador) o directo desde el editor de Apps Script. Es segura de repetir: busca cada fila
 * por producto+ingrediente antes de tocarla, agregarla o borrarla, así que si ya se corrió antes
 * no duplica nada ni vuelve a pisar una corrección ya aplicada a mano.
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

  const resumen = { celdas_texto_corregidas: [], correcciones: [], renombrados: [], filas_eliminadas: [], tipos_corregidos: [], filas_nuevas: [], filas_que_ya_existian: [] };

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

  /**
   * Convierte un valor de celda a número real, sin importar si quedó guardado como texto con
   * punto decimal (ej. escrito a mano copiando de Excel) o con coma decimal + puntos de miles
   * (formato Colombia). Si ya es un número nativo de Sheets, lo devuelve tal cual. Devuelve null
   * si no se puede interpretar como número (para no dañar texto que no era un valor numérico).
   */
  function aNumero_(valor) {
    if (typeof valor === 'number') return valor;
    if (valor === '' || valor === null || valor === undefined) return null;
    let s = String(valor).trim();
    if (s.indexOf(',') !== -1 && s.indexOf('.') !== -1) {
      s = s.replace(/\./g, '').replace(',', '.'); // "1.234,56" -> "1234.56"
    } else if (s.indexOf(',') !== -1) {
      s = s.replace(',', '.'); // "1,366561" -> "1.366561"
    }
    const n = parseFloat(s);
    return isFinite(n) && String(n) !== 'NaN' ? n : null;
  }

  // 0) Sheets, en configuración regional de Colombia, no reconoce como número una celda tecleada
  // a mano con punto decimal (ej. alguien copiando "1.366561" desde Excel) — la guarda como texto
  // plano, alineado a la izquierda, y cualquier fórmula nativa de Sheets que la referencie falla o
  // la trata como 0. Este paso recorre TODAS las celdas de `cantidad` y `rendimiento_producto` de
  // la hoja, detecta las que quedaron como texto (con punto o con coma) y las reescribe como
  // número nativo — así Sheets las reconoce y las vuelve a mostrar en su formato de coma
  // automáticamente, sin que haga falta cambiar el valor real que representan.
  ['cantidad', 'rendimiento_producto'].forEach(function (col) {
    if (colIdx[col] === undefined) return;
    for (let r = 1; r < data.length; r++) {
      const crudo = data[r][colIdx[col]];
      if (typeof crudo !== 'string' || crudo.trim() === '') continue;
      const numero = aNumero_(crudo);
      if (numero === null) continue;
      sh.getRange(r + 1, colIdx[col] + 1).setValue(numero);
      data[r][colIdx[col]] = numero;
      resumen.celdas_texto_corregidas.push({ producto: data[r][colIdx.producto], ingrediente: data[r][colIdx.ingrediente], columna: col, texto_original: crudo, numero: numero });
    }
  });

  // 1) Corrige las cantidades que perdieron el punto decimal al capturarse. Solo queda esta: las
  // demás correcciones de este mismo tipo (consumo directo de Costilla Preparada y de Panceta
  // pre-ahumada por plato) se resolvieron con BORRADO en el paso 4, no con corrección de valor —
  // ver el comentario del encabezado.
  const correcciones = [
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

  // 4) Borra filas que quedarían operando con un número que Diana no ha confirmado, o que
  // duplicarían un consumo ya cubierto por la cadena de 4 niveles. No se "corrigen" porque no hay
  // un valor correcto que poner todavía — la receta debe quedar pendiente, no aproximada.
  const filasEliminar = [
    // Doble conteo: reemplazadas por "plato <- Costilla Lista <- Costilla Preparada".
    ['Chanchostilla', 'Costilla Preparada'],
    ['Costilla', 'Costilla Preparada'],
    ['Costilafel', 'Costilla Preparada'],
    ['Supremo', 'Costilla Preparada'],
    // PENDIENTE 5.1 — consumo de Panceta pre-ahumada por plato: 3 estándares distintos sin resolver.
    ['Chanchostilla', 'Panceta Pre-ahumada'],
    ['Chanchalafel', 'Panceta Pre-ahumada'],
    ['Panceta', 'Panceta Pre-ahumada'],
    ['Supremo', 'Panceta Pre-ahumada'],
    ['Panceta (adicion)', 'Panceta Pre-ahumada']
  ];
  filasEliminar.forEach(function (fe) {
    const r = buscarFila_(fe[0], fe[1]);
    if (r === -1) { resumen.filas_eliminadas.push({ producto: fe[0], ingrediente: fe[1], estado: 'no encontrada, nada que borrar' }); return; }
    sh.deleteRow(r + 1);
    data.splice(r, 1);
    resumen.filas_eliminadas.push({ producto: fe[0], ingrediente: fe[1], estado: 'borrada' });
  });

  // 5) "Papas Listas" es porción lista (NIVEL 1.5, interna), no un plato vendible — si alguna fila
  // existente quedó con tipo distinto de 'produccion' (o vacío, que por defecto se lee como
  // 'plato'), se corrige aquí. "Costilla Lista" se crea directamente con tipo correcto en el
  // paso 6, así que no necesita este arreglo.
  for (let r = 1; r < data.length; r++) {
    if (norm_(data[r][colIdx.producto]) === norm_('Papas Listas') && String(data[r][colIdx.tipo]).trim() !== 'produccion') {
      const anterior = data[r][colIdx.tipo];
      sh.getRange(r + 1, colIdx.tipo + 1).setValue('produccion');
      data[r][colIdx.tipo] = 'produccion';
      resumen.tipos_corregidos.push({ producto: 'Papas Listas', ingrediente: data[r][colIdx.ingrediente], antes: anterior || '(vacío = plato)', despues: 'produccion' });
    }
  }

  // 6) Filas nuevas.
  //
  // NIVEL 1 y NIVEL 1.5 usan rendimiento_producto=1: `cantidad` es directamente el multiplicador
  // exacto en gramos de ingrediente por 1g de salida, tal cual lo confirmó Diana (CSV
  // recetas_actualizadas_costilla_panceta_falafel_papas.csv, 2026-07-15) — sin inventar ningún
  // tamaño de lote intermedio.
  //
  // OJO: se asume que "Falafel crudo" (usado como ingrediente en Chanchalafel/Costilafel/Supremo/
  // Falafel) y "Falafel (crudo preparado)" (el nombre que usa Diana en la tabla de NIVEL 1) son el
  // mismo insumo — por eso la fila de producción se agrega con el nombre "Falafel crudo" para que
  // conecte con las recetas de NIVEL 2 que ya existían. Si en realidad son dos cosas distintas,
  // hay que decirlo y se separa.
  const filasNuevas = [
    // NIVEL 1 — Materia prima -> Preparado
    ['Zumo Limon', 'Limon Tahiti', 3.457815, 'g', 1, 'g', 'produccion'],
    ['Costilla Limpia Marinada (con polvo)', 'Costilla San Luis Entera', 1, 'g', 1, 'g', 'produccion'],
    ['Costilla Limpia Marinada (con polvo)', 'Sal Marina Gruesa', 0.011661, 'g', 1, 'g', 'produccion'],
    ['Costilla Limpia Marinada (con polvo)', 'Especias de Marinar Costilla', 0.015113, 'g', 1, 'g', 'produccion'],
    ['Costilla Preparada', 'Costilla Limpia Marinada (con polvo)', 1.366561, 'g', 1, 'g', 'produccion'],
    ['Panceta Pre-ahumada', 'Panceta Entera', 1.402337, 'g', 1, 'g', 'produccion'],
    ['Panceta Pre-ahumada', 'Sal Marina Gruesa', 0.019633, 'g', 1, 'g', 'produccion'],
    ['Falafel crudo', 'Cilantro', 0.15, 'g', 1, 'g', 'produccion'],
    ['Falafel crudo', 'Perejil', 0.15, 'g', 1, 'g', 'produccion'],
    ['Falafel crudo', 'Cebolla Corazones', 0.173035, 'g', 1, 'g', 'produccion'],
    ['Falafel crudo', 'Ajo Preparado', 0.028839, 'g', 1, 'g', 'produccion'],
    ['Falafel crudo', 'Garbanzo', 0.288392, 'g', 1, 'g', 'produccion'],
    ['Falafel crudo', 'Zumo Limon', 0.005768, 'g', 1, 'g', 'produccion'],
    ['Falafel crudo', 'Especias Falafel', 0.048306, 'g', 1, 'g', 'produccion'],
    ['Papas pre-fritas', 'Papa Capira', 1.51992, 'g', 1, 'g', 'produccion'],
    ['Papas pre-fritas', 'Vinagre Blanco', 0.012112, 'g', 1, 'g', 'produccion'],
    ['Papas pre-fritas', 'Agua', 0.834861, 'g', 1, 'g', 'produccion'],

    // NIVEL 1.5 — Preparado -> Porción lista
    ['Papas Listas', 'Ajo preparado', 0.02, 'g', 1, 'g', 'produccion'],
    ['Papas Listas', 'Sal marina molida', 0.01, 'g', 1, 'g', 'produccion'],
    ['Papas Listas', 'Perejil Picado', 0.02, 'g', 1, 'g', 'produccion'],
    ['Costilla Lista', 'Costilla preparada', 1.282051, 'g', 1, 'g', 'produccion'],
    ['Costilla Lista', 'Reduccion Balsámica', 0.53, 'g', 1, 'g', 'produccion'],

    // NIVEL 2 — Plato final vendido (solo las líneas sin ambigüedad de fuente; las de Panceta
    // pre-ahumada quedan fuera hasta resolver PENDIENTE 5.1 — ver paso 4).
    ['Chanchostilla', 'Costilla Lista', 90, 'g', '', '', 'plato'],
    ['Costilafel', 'Costilla Lista', 90, 'g', '', '', 'plato'],
    ['Costilla', 'Costilla Lista', 180, 'g', '', '', 'plato'],
    ['Supremo', 'Costilla Lista', 70, 'g', '', '', 'plato'],
    ['Costilla (adición)', 'Costilla Lista', 110, 'g', '', '', 'plato'],

    // Resto de la capa de producción (Aioli, Cebollita de Amelia, Reducción Balsámica...) que ya
    // existía en esta migración y que el CSV de hoy no contradice ni confirma — se deja igual.
    ['Cebolla en Pluma (sin limon)', 'Cebolla Roja', 1480, 'g', 1000, 'g', 'produccion'],
    ['Salsa Costilla Nueva', 'Azucar Morena', 4533.333333, 'g', 18157.33333, 'g', 'produccion'],
    ['Salsa Costilla Nueva', 'Miel Maple', 3640, 'g', 18157.33333, 'g', 'produccion'],
    ['Salsa Costilla Nueva', 'Salsa Soya', 4453.333333, 'g', 18157.33333, 'g', 'produccion'],
    ['Salsa Costilla Nueva', 'Vinagre Balsamico', 4320, 'g', 18157.33333, 'g', 'produccion'],
    ['Salsa Costilla Nueva', 'Ajo Preparado', 650.6666667, 'g', 18157.33333, 'g', 'produccion'],
    ['Salsa Costilla Nueva', 'Especias Salsa Costilla', 560, 'g', 18157.33333, 'g', 'produccion'],
    ['Reduccion Balsámica', 'Salsa Costilla Nueva', 6809, 'g', 9065, 'g', 'produccion'],
    ['Aioli', 'Aceite de Oliva', 1000, 'g', 1303, 'g', 'produccion'],
    ['Aioli', 'Huevos A', 4, 'unidad', 1303, 'g', 'produccion'],
    ['Aioli', 'Sal Marina Molida', 10, 'g', 1303, 'g', 'produccion'],
    ['Aioli', 'Ajo preparado', 115, 'g', 1303, 'g', 'produccion'],
    ['Aioli', 'Zumo Limon', 37, 'g', 1303, 'g', 'produccion'],
    ['Cebollita de Amelia', 'Cebolla en Pluma (sin limon)', 801.8252934, 'g', 1000, 'g', 'produccion'],
    ['Cebollita de Amelia', 'Zumo Limon', 198.8265971, 'g', 1000, 'g', 'produccion'],
    ['Cebollita de Amelia', 'Sal Marina Molida', 5, 'g', 1000, 'g', 'produccion']
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
