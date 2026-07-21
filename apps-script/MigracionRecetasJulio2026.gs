/**
 * MIGRACIÓN DE RECETAS — RECETAS_FINAL_DILANA_OS v3 (16 jul 2026)
 *
 * Fuente: letrero físico de cocina (empleados confirman vigente) + WhatsApp de Rafa/Carolina +
 * confirmaciones directas de Diana, cruzado contra el menú real (dilana.ola.click/products).
 * Ver INSTRUCCIONES_PARA_CLAUDE_CODE_v3.md para el detalle completo de qué cambió.
 *
 * Qué hace esta migración (confirmado con Diana, 16 jul 2026):
 *  1) Archiva (estado='archivado', nunca borra) las recetas viejas que este archivo reemplaza:
 *     nombres sin "Cono" con números antiguos (Chanchostilla, Supremo, Costilla=230,77g...) y los
 *     borradores sin confirmar (Cono Costilla, Cono Chanchostilla, Cono Panceta).
 *  2) Asegura alias de catálogo para los nombres nuevos (Falafel Preparado, Aioli Preparado, etc.)
 *     para que sigan coincidiendo con lo que el personal cuenta en Conteo — sin borrar ni renombrar
 *     nada que ya exista, solo agrega.
 *  3) Carga las líneas "plato" (venta -> ingrediente) y "producción" (subreceta -> insumo) con:
 *     - estado='activo'      -> ACTIVA: se usa en Disponible Hoy / Conciliación, sin advertencia.
 *     - estado='revisar'     -> REVISAR: se usa igual, pero recetas.html muestra advertencia.
 *     - estado='pendiente'   -> PENDIENTE: dato inválido o incompleto, NO se usa en el cálculo.
 *     - estado='referencia'  -> dato confirmado (ACTIVA o REVISAR en el Excel) pero que el motor
 *       de recetas no puede automatizar hoy: son las opciones de "elegir 1 de N" (salsas, toppings,
 *       masa de waffle) y el reparto de proteína del Combo Libra/Media Libra. Ventas_FUDO solo
 *       guarda el nombre del producto vendido (ej. "Arma tu Waffle x3"), no qué salsa eligió el
 *       cliente, así que no hay con qué automatizar el descuento exacto todavía. Quedan guardadas
 *       para consulta/costeo, con controla_disponibilidad=false, y no participan en el cálculo
 *       (recetasVigentes_ las excluye igual que 'pendiente').
 *     - Reducción Balsámica Preparada (y sus insumos) se fuerza a 'pendiente' aunque el Excel diga
 *       distinto para los insumos: falta el peso real del lote después de reducir (confirmado con
 *       Diana que se deja así hasta tener ese dato).
 *     - Falafel Preparado y Costilla Limpia Marinada quedan con controla_disponibilidad=false en
 *       todas sus líneas: no tienen rendimiento final confirmado, así que dejar que "Disponible
 *       Hoy" proyecte producción a partir de materia prima daría un ratio inventado (por defecto
 *       1:1) y un número de disponibilidad falso. Se usa solo lo contado, no lo proyectado.
 *     - Carbón (insumo de ahumado de Panceta Pre-Ahumada) queda con controla_disponibilidad=false:
 *       es insumo de proceso, no debe topar cuánta panceta se puede producir.
 *
 * Es idempotente: producto + ingrediente + versión ('julio_2026') identifican una línea, así que
 * correrla de nuevo actualiza las mismas filas en vez de duplicarlas. Crea un respaldo de Recetas
 * antes de escribir (no reutiliza el respaldo de la migración anterior).
 */
function migrarRecetasJulio2026_() {
  configurarHojas();
  respaldarHojaRecetasJulio2026_();

  const sh = sheet_(SHEET_NAMES.RECETAS);
  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  let data = sh.getDataRange().getValues();
  const col = {};
  headers.forEach(function (h, i) { col[h] = i; });
  const resumen = { archivadas: 0, creadas: 0, actualizadas: 0, alias_catalogo: 0, respaldo: true };

  function clave_(s) { return normalizar_(s); }
  function buscarTodas_(producto) {
    const filas = [];
    for (let r = 1; r < data.length; r++) {
      if (clave_(data[r][col.producto]) === clave_(producto)) filas.push(r);
    }
    return filas;
  }
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
      if (obj[h] !== undefined) { sh.getRange(r + 1, c + 1).setValue(obj[h]); data[r][c] = obj[h]; }
    });
  }
  function archivar_(producto, motivo) {
    buscarTodas_(producto).forEach(function (r) {
      if (normalizar_(data[r][col.estado] || 'activo') === 'archivado') return;
      escribirFila_(r, {
        estado: 'archivado',
        notas: (String(data[r][col.notas] || '') + ' [Archivado 16 jul 2026: ' + motivo + ']').trim()
      });
      resumen.archivadas++;
    });
  }
  function upsert_(obj) {
    obj = Object.assign({
      id: Utilities.getUuid(), rendimiento_producto: '', unidad_rendimiento: '', tipo: 'plato',
      sede: 'Ambas', vigente_desde: '', vigente_hasta: '', controla_disponibilidad: true
    }, obj);
    const r = buscar_(obj.producto, obj.ingrediente, obj.version);
    if (r !== -1) {
      obj.id = data[r][col.id] || Utilities.getUuid();
      escribirFila_(r, obj);
      resumen.actualizadas++;
      return;
    }
    const fila = headers.map(function (h) { return obj[h] !== undefined ? obj[h] : ''; });
    sh.appendRow(fila);
    data.push(fila);
    resumen.creadas++;
  }

  // 1) Archivar recetas viejas que este archivo reemplaza (confirmado con Diana, 16 jul 2026).
  [
    ['Chanchostilla', "mismo plato, renombrado y con números corregidos a 'Cono Chanchostilla'"],
    ['Supremo', "mismo plato, renombrado y con números corregidos a 'Cono Supremo'"],
    ['Chanchalafel', "mismo plato, renombrado y con números corregidos a 'Cono Chanchalafel'"],
    ['Costilla', 'números corregidos según letrero de cocina (230,77g costilla -> 180g)'],
    ['Panceta', 'números corregidos según letrero de cocina (232,88g panceta -> 170g)'],
    ['Costilafel', 'números corregidos según letrero de cocina'],
    ['Falafel (plato)', "mismo plato, renombrado a 'Falafel'"],
    ['Panceta (adición)', "renombrado a 'Adición de Panceta' con número corregido (136,99g -> 125g)"],
    ['Falafel (adición)', "renombrado a 'Adición de Falafel' con número corregido (119g -> 136g)"],
    ['Aioli (adición)', "renombrado a 'Alioli de Amelia' con número corregido (35g -> 30g)"],
    ['Cebollita de Amelia (porción)', "renombrado a 'Cebollita de Amelia' con número corregido (30g -> 45g)"],
    ['Reducción Balsámica (porción)', "renombrado a 'Reducción Balsámica', ingrediente renombrado a 'Reducción Balsámica Preparada'"],
    ['Papas (adición)', "renombrado a 'Porción de Papas'"],
    ['Combo Libra', 'reemplazado completo: mismos acompañamientos + regla de reparto de proteína nueva (antes no existía)'],
    ['Combo Media Libra', 'reemplazado completo: mismos acompañamientos + regla de reparto de proteína nueva (antes no existía)'],
    ['Cono Costilla', "borrador sin confirmar nunca usado; el menú real no tiene 'Cono Costilla', ver 'Costilla' (formato plato)"],
    ['Cono Chanchostilla', "borrador sin confirmar nunca usado, reemplazado por la versión ya confirmada de 'Cono Chanchostilla'"],
    ['Cono Panceta', "borrador sin confirmar nunca usado; el menú real no tiene 'Cono Panceta', ver 'Panceta' (formato plato)"],
    ['Wafflebonitos', "renombrado a 'Waffle Bonitos', receta simplificada (consume Mezcla de pandebono directo en vez de por bolitas)"],
    ['Bolita de pandebono', "ya no se usa como paso intermedio: 'Waffle Bonitos' ahora consume Mezcla de pandebono directo"],
    ['Porción salsa pie de limón', "ya no es un producto vendido aparte: ahora es una opción de salsa (sin automatizar) dentro de Arma tu Waffle/Waffle Bonitos/Waffle Churros"]
  ].forEach(function (x) { archivar_(x[0], x[1]); });

  // 2) Alias de catálogo: solo agrega, nunca borra ni reemplaza lo que ya exista con otro nombre.
  //    Sin esto, el personal seguiría viendo el nombre viejo al contar y el conteo dejaría de
  //    coincidir con el ingrediente que ahora usan las recetas nuevas.
  [
    ['Falafel Preparado', 'Elaborados/Preparaciones de Cocina', 'g'],
    ['Aioli Preparado', 'Elaborados/Preparaciones de Cocina', 'g'],
    ['Cebolla Elaborada', 'Elaborados/Preparaciones de Cocina', 'g'],
    ['Reducción Balsámica Preparada', 'Elaborados/Preparaciones de Cocina', 'g'],
    ['Costilla Limpia Marinada', 'Elaborados/Preparaciones de Cocina', 'g'],
    ['Mezcla de pandebono', 'Elaborados/Preparaciones de Cocina', 'g'],
    ['Waffle tradicional', 'Elaborados/Postres y Panadería', 'g'],
    ['Waffle Canela', 'Elaborados/Postres y Panadería', 'g'],
    ['Salsa de pie de limón', 'Elaborados/Postres y Panadería', 'g'],
    ['Azúcar con canela', 'Elaborados/Postres y Panadería', 'u'],
    ['Salsa de maracuyá', 'Elaborados/Postres y Panadería', 'u'],
    ['Salsa de mora', 'Elaborados/Postres y Panadería', 'g'],
    ['Premezcla Colmaíz', 'Materia Prima/No Perecederos', 'g'],
    ['Margarina', 'Materia Prima/No Perecederos', 'g'],
    ['Queso costeño', 'Materia Prima/No Perecederos', 'g'],
    ['Leche condensada', 'Materia Prima/No Perecederos', 'g'],
    ['Maracuyá', 'Materia Prima/Fruver', 'g'],
    ['Azúcar', 'Materia Prima/No Perecederos', 'g'],
    ['Canela', 'Materia Prima/No Perecederos', 'g'],
    ['Cebolla corazones', 'Materia Prima/Fruver', 'g'],
    ['Limón entero', 'Materia Prima/Fruver', 'unidad'],
    ['Costilla San Luis', 'Materia Prima/Cárnicos', 'g']
  ].forEach(function (c) {
    const nombre = c[0], categoria = c[1], unidad = c[2];
    if (catalogoBuscar_(nombre)) return;
    catalogoGuardar_({ nombre_estandar: nombre, categoria: categoria, unidad_base: unidad });
    resumen.alias_catalogo++;
  });

  // 3) Líneas "plato" (venta -> ingrediente), generadas desde las hojas AMELIA y LA WAFFLERIA.
  const lineasPlato = [
    { producto: 'Cono Supremo', ingrediente: 'Panceta Pre-Ahumada', cantidad: 60, unidad: 'g', tipo: 'plato', estado: 'activo', controla_disponibilidad: true, fuente: 'RECETAS_FINAL_DILANA_OS v3, hoja AMELIA (16 jul 2026)', version: 'julio_2026', notas: 'Confirmado 16 jul 2026: letrero físico de cocina (empleados confirman vigente) + WhatsApp Rafa/Carolina. OJO: en la versión anterior de este archivo costilla/panceta estaban invertidas para este plato.' },
    { producto: 'Cono Supremo', ingrediente: 'Costilla Preparada', cantidad: 70, unidad: 'g', tipo: 'plato', estado: 'revisar', controla_disponibilidad: true, fuente: 'RECETAS_FINAL_DILANA_OS v3, hoja AMELIA (16 jul 2026)', version: 'julio_2026', notas: 'Confirmado 16 jul 2026: letrero físico de cocina (empleados confirman vigente) + WhatsApp Rafa/Carolina. El letrero dice 70 g pero Carolina (WhatsApp) dijo 75 g — pequeña contradicción entre las dos fuentes, usar 70 g (letrero oficial) hasta que se confirme.' },
    { producto: 'Cono Supremo', ingrediente: 'Falafel Preparado', cantidad: 68, unidad: 'g', tipo: 'plato', estado: 'activo', controla_disponibilidad: true, fuente: 'RECETAS_FINAL_DILANA_OS v3, hoja AMELIA (16 jul 2026)', version: 'julio_2026', notas: '4 bolitas de 17 g = 68 g. Sin cambios respecto a la versión anterior.' },
    { producto: 'Cono Supremo', ingrediente: 'Papas Listas', cantidad: 100, unidad: 'g', tipo: 'plato', estado: 'activo', controla_disponibilidad: true, fuente: 'RECETAS_FINAL_DILANA_OS v3, hoja AMELIA (16 jul 2026)', version: 'julio_2026', notas: '' },
    { producto: 'Cono Supremo', ingrediente: 'Cebolla Elaborada', cantidad: 50, unidad: 'g', tipo: 'plato', estado: 'activo', controla_disponibilidad: true, fuente: 'RECETAS_FINAL_DILANA_OS v3, hoja AMELIA (16 jul 2026)', version: 'julio_2026', notas: '' },
    { producto: 'Cono Supremo', ingrediente: 'Aioli Preparado', cantidad: 35, unidad: 'g', tipo: 'plato', estado: 'activo', controla_disponibilidad: true, fuente: 'RECETAS_FINAL_DILANA_OS v3, hoja AMELIA (16 jul 2026)', version: 'julio_2026', notas: '' },
    { producto: 'Cono Chanchalafel', ingrediente: 'Panceta Pre-Ahumada', cantidad: 75, unidad: 'g', tipo: 'plato', estado: 'activo', controla_disponibilidad: true, fuente: 'RECETAS_FINAL_DILANA_OS v3, hoja AMELIA (16 jul 2026)', version: 'julio_2026', notas: 'Confirmado 16 jul 2026: letrero físico de cocina (empleados confirman vigente) + WhatsApp Rafa/Carolina. Antes decía 85 g.' },
    { producto: 'Cono Chanchalafel', ingrediente: 'Falafel Preparado', cantidad: 102, unidad: 'g', tipo: 'plato', estado: 'activo', controla_disponibilidad: true, fuente: 'RECETAS_FINAL_DILANA_OS v3, hoja AMELIA (16 jul 2026)', version: 'julio_2026', notas: '6 bolitas de 17 g = 102 g. Sin cambios.' },
    { producto: 'Cono Chanchalafel', ingrediente: 'Papas Listas', cantidad: 100, unidad: 'g', tipo: 'plato', estado: 'activo', controla_disponibilidad: true, fuente: 'RECETAS_FINAL_DILANA_OS v3, hoja AMELIA (16 jul 2026)', version: 'julio_2026', notas: '' },
    { producto: 'Cono Chanchalafel', ingrediente: 'Cebolla Elaborada', cantidad: 50, unidad: 'g', tipo: 'plato', estado: 'activo', controla_disponibilidad: true, fuente: 'RECETAS_FINAL_DILANA_OS v3, hoja AMELIA (16 jul 2026)', version: 'julio_2026', notas: '' },
    { producto: 'Cono Chanchalafel', ingrediente: 'Aioli Preparado', cantidad: 35, unidad: 'g', tipo: 'plato', estado: 'activo', controla_disponibilidad: true, fuente: 'RECETAS_FINAL_DILANA_OS v3, hoja AMELIA (16 jul 2026)', version: 'julio_2026', notas: '' },
    { producto: 'Cono Chanchostilla', ingrediente: 'Costilla Preparada', cantidad: 85, unidad: 'g', tipo: 'plato', estado: 'activo', controla_disponibilidad: true, fuente: 'RECETAS_FINAL_DILANA_OS v3, hoja AMELIA (16 jul 2026)', version: 'julio_2026', notas: 'Confirmado 16 jul 2026: letrero físico de cocina (empleados confirman vigente) + WhatsApp Rafa/Carolina. Antes decía 80 g.' },
    { producto: 'Cono Chanchostilla', ingrediente: 'Panceta Pre-Ahumada', cantidad: 75, unidad: 'g', tipo: 'plato', estado: 'activo', controla_disponibilidad: true, fuente: 'RECETAS_FINAL_DILANA_OS v3, hoja AMELIA (16 jul 2026)', version: 'julio_2026', notas: 'Confirmado 16 jul 2026: letrero físico de cocina (empleados confirman vigente) + WhatsApp Rafa/Carolina. Antes decía 90 g.' },
    { producto: 'Cono Chanchostilla', ingrediente: 'Papas Listas', cantidad: 100, unidad: 'g', tipo: 'plato', estado: 'activo', controla_disponibilidad: true, fuente: 'RECETAS_FINAL_DILANA_OS v3, hoja AMELIA (16 jul 2026)', version: 'julio_2026', notas: '' },
    { producto: 'Cono Chanchostilla', ingrediente: 'Cebolla Elaborada', cantidad: 50, unidad: 'g', tipo: 'plato', estado: 'activo', controla_disponibilidad: true, fuente: 'RECETAS_FINAL_DILANA_OS v3, hoja AMELIA (16 jul 2026)', version: 'julio_2026', notas: '' },
    { producto: 'Cono Chanchostilla', ingrediente: 'Aioli Preparado', cantidad: 35, unidad: 'g', tipo: 'plato', estado: 'activo', controla_disponibilidad: true, fuente: 'RECETAS_FINAL_DILANA_OS v3, hoja AMELIA (16 jul 2026)', version: 'julio_2026', notas: '' },
    { producto: 'Combo Libra', ingrediente: 'Papas Listas', cantidad: 200, unidad: 'g', tipo: 'plato', estado: 'activo', controla_disponibilidad: true, fuente: 'RECETAS_FINAL_DILANA_OS v3, hoja AMELIA (16 jul 2026)', version: 'julio_2026', notas: '' },
    { producto: 'Combo Libra', ingrediente: 'Aioli Preparado', cantidad: 60, unidad: 'g', tipo: 'plato', estado: 'activo', controla_disponibilidad: true, fuente: 'RECETAS_FINAL_DILANA_OS v3, hoja AMELIA (16 jul 2026)', version: 'julio_2026', notas: '' },
    { producto: 'Combo Libra', ingrediente: 'Cebolla Elaborada', cantidad: 60, unidad: 'g', tipo: 'plato', estado: 'activo', controla_disponibilidad: true, fuente: 'RECETAS_FINAL_DILANA_OS v3, hoja AMELIA (16 jul 2026)', version: 'julio_2026', notas: '' },
    { producto: 'Combo Libra', ingrediente: 'Reducción Balsámica Preparada', cantidad: 70, unidad: 'g', tipo: 'plato', estado: 'revisar', controla_disponibilidad: true, fuente: 'RECETAS_FINAL_DILANA_OS v3, hoja AMELIA (16 jul 2026)', version: 'julio_2026', notas: 'Ver PENDIENTES: rendimiento de Reducción Balsámica aún sin confirmar (ver hoja SUBRECETAS).' },
    { producto: 'Combo Media Libra', ingrediente: 'Papas Listas', cantidad: 100, unidad: 'g', tipo: 'plato', estado: 'activo', controla_disponibilidad: true, fuente: 'RECETAS_FINAL_DILANA_OS v3, hoja AMELIA (16 jul 2026)', version: 'julio_2026', notas: '' },
    { producto: 'Combo Media Libra', ingrediente: 'Aioli Preparado', cantidad: 30, unidad: 'g', tipo: 'plato', estado: 'activo', controla_disponibilidad: true, fuente: 'RECETAS_FINAL_DILANA_OS v3, hoja AMELIA (16 jul 2026)', version: 'julio_2026', notas: '' },
    { producto: 'Combo Media Libra', ingrediente: 'Cebolla Elaborada', cantidad: 30, unidad: 'g', tipo: 'plato', estado: 'activo', controla_disponibilidad: true, fuente: 'RECETAS_FINAL_DILANA_OS v3, hoja AMELIA (16 jul 2026)', version: 'julio_2026', notas: '' },
    { producto: 'Combo Media Libra', ingrediente: 'Reducción Balsámica Preparada', cantidad: 35, unidad: 'g', tipo: 'plato', estado: 'revisar', controla_disponibilidad: true, fuente: 'RECETAS_FINAL_DILANA_OS v3, hoja AMELIA (16 jul 2026)', version: 'julio_2026', notas: 'Ver PENDIENTES.' },
    { producto: 'Costilafel', ingrediente: 'Costilla Preparada', cantidad: 85, unidad: 'g', tipo: 'plato', estado: 'activo', controla_disponibilidad: true, fuente: 'RECETAS_FINAL_DILANA_OS v3, hoja AMELIA (16 jul 2026)', version: 'julio_2026', notas: 'Confirmado 16 jul 2026: letrero físico de cocina (empleados confirman vigente) + WhatsApp Rafa/Carolina. Antes decía 90 g.' },
    { producto: 'Costilafel', ingrediente: 'Falafel Preparado', cantidad: 102, unidad: 'g', tipo: 'plato', estado: 'activo', controla_disponibilidad: true, fuente: 'RECETAS_FINAL_DILANA_OS v3, hoja AMELIA (16 jul 2026)', version: 'julio_2026', notas: 'Confirmado 16 jul 2026: letrero físico de cocina (empleados confirman vigente) + WhatsApp Rafa/Carolina. Antes decía 85 g (5 bolitas) — el letrero confirma 6 bolitas = 102 g.' },
    { producto: 'Costilafel', ingrediente: 'Papas Listas', cantidad: 100, unidad: 'g', tipo: 'plato', estado: 'activo', controla_disponibilidad: true, fuente: 'RECETAS_FINAL_DILANA_OS v3, hoja AMELIA (16 jul 2026)', version: 'julio_2026', notas: '' },
    { producto: 'Costilafel', ingrediente: 'Cebolla Elaborada', cantidad: 50, unidad: 'g', tipo: 'plato', estado: 'activo', controla_disponibilidad: true, fuente: 'RECETAS_FINAL_DILANA_OS v3, hoja AMELIA (16 jul 2026)', version: 'julio_2026', notas: '' },
    { producto: 'Costilafel', ingrediente: 'Aioli Preparado', cantidad: 35, unidad: 'g', tipo: 'plato', estado: 'activo', controla_disponibilidad: true, fuente: 'RECETAS_FINAL_DILANA_OS v3, hoja AMELIA (16 jul 2026)', version: 'julio_2026', notas: '' },
    { producto: 'Costilla', ingrediente: 'Costilla Preparada', cantidad: 180, unidad: 'g', tipo: 'plato', estado: 'activo', controla_disponibilidad: true, fuente: 'RECETAS_FINAL_DILANA_OS v3, hoja AMELIA (16 jul 2026)', version: 'julio_2026', notas: 'Confirmado 16 jul 2026: letrero físico de cocina (empleados confirman vigente) + WhatsApp Rafa/Carolina. Antes decía 130 g — cambio grande, confirmar que no es error de conteo de bolitas/gramos.' },
    { producto: 'Costilla', ingrediente: 'Papas Listas', cantidad: 120, unidad: 'g', tipo: 'plato', estado: 'activo', controla_disponibilidad: true, fuente: 'RECETAS_FINAL_DILANA_OS v3, hoja AMELIA (16 jul 2026)', version: 'julio_2026', notas: '' },
    { producto: 'Costilla', ingrediente: 'Cebolla Elaborada', cantidad: 50, unidad: 'g', tipo: 'plato', estado: 'activo', controla_disponibilidad: true, fuente: 'RECETAS_FINAL_DILANA_OS v3, hoja AMELIA (16 jul 2026)', version: 'julio_2026', notas: '' },
    { producto: 'Costilla', ingrediente: 'Aioli Preparado', cantidad: 35, unidad: 'g', tipo: 'plato', estado: 'activo', controla_disponibilidad: true, fuente: 'RECETAS_FINAL_DILANA_OS v3, hoja AMELIA (16 jul 2026)', version: 'julio_2026', notas: '' },
    { producto: 'Falafel', ingrediente: 'Falafel Preparado', cantidad: 187, unidad: 'g', tipo: 'plato', estado: 'activo', controla_disponibilidad: true, fuente: 'RECETAS_FINAL_DILANA_OS v3, hoja AMELIA (16 jul 2026)', version: 'julio_2026', notas: '11 bolitas de 17 g = 187 g. Confirmado por Carolina y por el letrero, sin cambios.' },
    { producto: 'Falafel', ingrediente: 'Papas Listas', cantidad: 100, unidad: 'g', tipo: 'plato', estado: 'activo', controla_disponibilidad: true, fuente: 'RECETAS_FINAL_DILANA_OS v3, hoja AMELIA (16 jul 2026)', version: 'julio_2026', notas: '' },
    { producto: 'Falafel', ingrediente: 'Cebolla Elaborada', cantidad: 50, unidad: 'g', tipo: 'plato', estado: 'activo', controla_disponibilidad: true, fuente: 'RECETAS_FINAL_DILANA_OS v3, hoja AMELIA (16 jul 2026)', version: 'julio_2026', notas: '' },
    { producto: 'Falafel', ingrediente: 'Aioli Preparado', cantidad: 35, unidad: 'g', tipo: 'plato', estado: 'activo', controla_disponibilidad: true, fuente: 'RECETAS_FINAL_DILANA_OS v3, hoja AMELIA (16 jul 2026)', version: 'julio_2026', notas: '' },
    { producto: 'Panceta', ingrediente: 'Panceta Pre-Ahumada', cantidad: 170, unidad: 'g', tipo: 'plato', estado: 'activo', controla_disponibilidad: true, fuente: 'RECETAS_FINAL_DILANA_OS v3, hoja AMELIA (16 jul 2026)', version: 'julio_2026', notas: 'Confirmado 16 jul 2026: letrero físico de cocina (empleados confirman vigente) + WhatsApp Rafa/Carolina. Antes decía 130 g.' },
    { producto: 'Panceta', ingrediente: 'Papas Listas', cantidad: 80, unidad: 'g', tipo: 'plato', estado: 'activo', controla_disponibilidad: true, fuente: 'RECETAS_FINAL_DILANA_OS v3, hoja AMELIA (16 jul 2026)', version: 'julio_2026', notas: '' },
    { producto: 'Panceta', ingrediente: 'Cebolla Elaborada', cantidad: 50, unidad: 'g', tipo: 'plato', estado: 'activo', controla_disponibilidad: true, fuente: 'RECETAS_FINAL_DILANA_OS v3, hoja AMELIA (16 jul 2026)', version: 'julio_2026', notas: '' },
    { producto: 'Panceta', ingrediente: 'Aioli Preparado', cantidad: 35, unidad: 'g', tipo: 'plato', estado: 'activo', controla_disponibilidad: true, fuente: 'RECETAS_FINAL_DILANA_OS v3, hoja AMELIA (16 jul 2026)', version: 'julio_2026', notas: '' },
    { producto: 'Porción de Papas', ingrediente: 'Papas Listas', cantidad: 100, unidad: 'g', tipo: 'plato', estado: 'activo', controla_disponibilidad: true, fuente: 'RECETAS_FINAL_DILANA_OS v3, hoja AMELIA (16 jul 2026)', version: 'julio_2026', notas: 'Confirmado directamente por Diana.' },
    { producto: 'Alioli de Amelia', ingrediente: 'Aioli Preparado', cantidad: 30, unidad: 'g', tipo: 'plato', estado: 'activo', controla_disponibilidad: true, fuente: 'RECETAS_FINAL_DILANA_OS v3, hoja AMELIA (16 jul 2026)', version: 'julio_2026', notas: 'Confirmado 16 jul 2026: letrero físico de cocina (empleados confirman vigente) + WhatsApp Rafa/Carolina. Antes decía 35 g.' },
    { producto: 'Cebollita de Amelia', ingrediente: 'Cebolla Elaborada', cantidad: 45, unidad: 'g', tipo: 'plato', estado: 'activo', controla_disponibilidad: true, fuente: 'RECETAS_FINAL_DILANA_OS v3, hoja AMELIA (16 jul 2026)', version: 'julio_2026', notas: 'Confirmado 16 jul 2026: letrero físico de cocina (empleados confirman vigente) + WhatsApp Rafa/Carolina. Antes decía 50 g.' },
    { producto: 'Adición de Costilla', ingrediente: 'Costilla Preparada', cantidad: 135, unidad: 'g', tipo: 'plato', estado: 'activo', controla_disponibilidad: true, fuente: 'RECETAS_FINAL_DILANA_OS v3, hoja AMELIA (16 jul 2026)', version: 'julio_2026', notas: 'Confirmado 16 jul 2026: letrero físico de cocina (empleados confirman vigente) + WhatsApp Rafa/Carolina. Antes decía 110 g.' },
    { producto: 'Adición de Falafel', ingrediente: 'Falafel Preparado', cantidad: 136, unidad: 'g', tipo: 'plato', estado: 'activo', controla_disponibilidad: true, fuente: 'RECETAS_FINAL_DILANA_OS v3, hoja AMELIA (16 jul 2026)', version: 'julio_2026', notas: 'Confirmado 16 jul 2026: letrero físico de cocina (empleados confirman vigente) + WhatsApp Rafa/Carolina. Antes decía 119 g (7 bolitas) — letrero y Carolina confirman 8 bolitas = 136 g.' },
    { producto: 'Adición de Panceta', ingrediente: 'Panceta Pre-Ahumada', cantidad: 125, unidad: 'g', tipo: 'plato', estado: 'activo', controla_disponibilidad: true, fuente: 'RECETAS_FINAL_DILANA_OS v3, hoja AMELIA (16 jul 2026)', version: 'julio_2026', notas: 'Confirmado 16 jul 2026: letrero físico de cocina (empleados confirman vigente) + WhatsApp Rafa/Carolina. Antes decía 100 g.' },
    { producto: 'Reducción Balsámica', ingrediente: 'Reducción Balsámica Preparada', cantidad: 35, unidad: 'g', tipo: 'plato', estado: 'revisar', controla_disponibilidad: true, fuente: 'RECETAS_FINAL_DILANA_OS v3, hoja AMELIA (16 jul 2026)', version: 'julio_2026', notas: 'Cantidad por adición sin cambios; ver SUBRECETAS para el cambio en la receta base.' },
    { producto: 'Arma tu Waffle', ingrediente: 'Salsa de mora', cantidad: 35, unidad: 'g', tipo: 'plato', estado: 'pendiente', controla_disponibilidad: true, fuente: 'RECETAS_FINAL_DILANA_OS v3, hoja LA WAFFLERIA (16 jul 2026)', version: 'julio_2026', notas: 'El rendimiento de la subreceta contiene el texto inválido \'752test\' — corregir la celda en la plantilla antes de automatizar.' },
    { producto: 'Waffle Bonitos', ingrediente: 'Mezcla de pandebono', cantidad: 120, unidad: 'g', tipo: 'plato', estado: 'activo', controla_disponibilidad: true, fuente: 'RECETAS_FINAL_DILANA_OS v3, hoja LA WAFFLERIA (16 jul 2026)', version: 'julio_2026', notas: '8 bolitas de 15 g = 120 g.' },
    { producto: 'Waffle Bonitos', ingrediente: 'Salsa de mora', cantidad: 35, unidad: 'g', tipo: 'plato', estado: 'pendiente', controla_disponibilidad: true, fuente: 'RECETAS_FINAL_DILANA_OS v3, hoja LA WAFFLERIA (16 jul 2026)', version: 'julio_2026', notas: 'Rendimiento inválido \'752test\' en la plantilla.' },
    { producto: 'Waffle Churros', ingrediente: 'Waffle tradicional', cantidad: 150, unidad: 'g', tipo: 'plato', estado: 'revisar', controla_disponibilidad: true, fuente: 'RECETAS_FINAL_DILANA_OS v3, hoja LA WAFFLERIA (16 jul 2026)', version: 'julio_2026', notas: 'La plantilla indica 150 g de waffle y 1 porción de azúcar con canela.' },
    { producto: 'Waffle Churros', ingrediente: 'Azúcar con canela', cantidad: 1, unidad: 'porción', tipo: 'plato', estado: 'activo', controla_disponibilidad: true, fuente: 'RECETAS_FINAL_DILANA_OS v3, hoja LA WAFFLERIA (16 jul 2026)', version: 'julio_2026', notas: '' },
    { producto: 'Waffle Churros', ingrediente: 'Salsa de mora', cantidad: 35, unidad: 'g', tipo: 'plato', estado: 'pendiente', controla_disponibilidad: true, fuente: 'RECETAS_FINAL_DILANA_OS v3, hoja LA WAFFLERIA (16 jul 2026)', version: 'julio_2026', notas: 'Rendimiento inválido \'752test\' en la plantilla.' },
  ];

  // 4) Líneas de referencia (OPCIÓN / REGLA ESPECIAL): no se automatizan, ver comentario arriba.
  const lineasReferencia = [
    { producto: 'Combo Libra', ingrediente: 'Reparto de 500 g entre las proteínas elegidas', cantidad: 500, unidad: 'g', tipo: 'plato', estado: 'referencia', controla_disponibilidad: false, fuente: 'RECETAS_FINAL_DILANA_OS v3, hoja AMELIA (16 jul 2026)', version: 'julio_2026', notas: '[SIN AUTOMATIZAR: requiere saber qué opción eligió el cliente; FUDO no registra ese detalle hoy] Grupo: Proteínas. CONFIRMADO por Diana 16 jul 2026: la proteína se reparte en partes iguales según cuántas elija el cliente — 1 proteína = 500 g; 2 proteínas = 250 g cada una; 3 proteínas = 166 g cada una (166×3≈500, redondeado).' },
    { producto: 'Combo Media Libra', ingrediente: 'Reparto de 250 g entre las proteínas elegidas', cantidad: 250, unidad: 'g', tipo: 'plato', estado: 'referencia', controla_disponibilidad: false, fuente: 'RECETAS_FINAL_DILANA_OS v3, hoja AMELIA (16 jul 2026)', version: 'julio_2026', notas: '[SIN AUTOMATIZAR: requiere saber qué opción eligió el cliente; FUDO no registra ese detalle hoy] Grupo: Proteínas. INFERIDO (no confirmado explícitamente): la mitad de la regla de Combo Libra — 1 proteína = 250 g; 2 = 125 g c/u; 3 = 83 g c/u. Confirmar con Diana/cocina.' },
    { producto: 'Arma tu Waffle', ingrediente: 'Waffle tradicional', cantidad: 150, unidad: 'g', tipo: 'plato', estado: 'referencia', controla_disponibilidad: false, fuente: 'RECETAS_FINAL_DILANA_OS v3, hoja LA WAFFLERIA (16 jul 2026)', version: 'julio_2026', notas: '[SIN AUTOMATIZAR: requiere saber qué opción eligió el cliente; FUDO no registra ese detalle hoy] Grupo: Masa - elegir 1. Validar la unidad del agua de la subreceta (aparece en 0 en la plantilla).' },
    { producto: 'Arma tu Waffle', ingrediente: 'Waffle Canela', cantidad: 150, unidad: 'g', tipo: 'plato', estado: 'referencia', controla_disponibilidad: false, fuente: 'RECETAS_FINAL_DILANA_OS v3, hoja LA WAFFLERIA (16 jul 2026)', version: 'julio_2026', notas: '[SIN AUTOMATIZAR: requiere saber qué opción eligió el cliente; FUDO no registra ese detalle hoy] Grupo: Masa - elegir 1. Mismo caso: unidad del agua sin confirmar.' },
    { producto: 'Arma tu Waffle', ingrediente: 'Arequipe', cantidad: 55, unidad: 'g', tipo: 'plato', estado: 'referencia', controla_disponibilidad: false, fuente: 'RECETAS_FINAL_DILANA_OS v3, hoja LA WAFFLERIA (16 jul 2026)', version: 'julio_2026', notas: '[SIN AUTOMATIZAR: requiere saber qué opción eligió el cliente; FUDO no registra ese detalle hoy] Grupo: Salsa - elegir 1.' },
    { producto: 'Arma tu Waffle', ingrediente: 'Salsa de chocolate', cantidad: 35, unidad: 'g', tipo: 'plato', estado: 'referencia', controla_disponibilidad: false, fuente: 'RECETAS_FINAL_DILANA_OS v3, hoja LA WAFFLERIA (16 jul 2026)', version: 'julio_2026', notas: '[SIN AUTOMATIZAR: requiere saber qué opción eligió el cliente; FUDO no registra ese detalle hoy] Grupo: Salsa - elegir 1.' },
    { producto: 'Arma tu Waffle', ingrediente: 'Salsa de maracuyá', cantidad: 1, unidad: 'porción', tipo: 'plato', estado: 'referencia', controla_disponibilidad: false, fuente: 'RECETAS_FINAL_DILANA_OS v3, hoja LA WAFFLERIA (16 jul 2026)', version: 'julio_2026', notas: '[SIN AUTOMATIZAR: requiere saber qué opción eligió el cliente; FUDO no registra ese detalle hoy] Grupo: Salsa - elegir 1. Validar que el lote realmente rinde 80 porciones.' },
    { producto: 'Arma tu Waffle', ingrediente: 'Salsa de pie de limón', cantidad: 35, unidad: 'g', tipo: 'plato', estado: 'referencia', controla_disponibilidad: false, fuente: 'RECETAS_FINAL_DILANA_OS v3, hoja LA WAFFLERIA (16 jul 2026)', version: 'julio_2026', notas: '[SIN AUTOMATIZAR: requiere saber qué opción eligió el cliente; FUDO no registra ese detalle hoy] Grupo: Salsa - elegir 1. Porción confirmada de 35 g.' },
    { producto: 'Waffle Bonitos', ingrediente: 'Arequipe', cantidad: 55, unidad: 'g', tipo: 'plato', estado: 'referencia', controla_disponibilidad: false, fuente: 'RECETAS_FINAL_DILANA_OS v3, hoja LA WAFFLERIA (16 jul 2026)', version: 'julio_2026', notas: '[SIN AUTOMATIZAR: requiere saber qué opción eligió el cliente; FUDO no registra ese detalle hoy] Grupo: Salsa - elegir 1.' },
    { producto: 'Waffle Bonitos', ingrediente: 'Salsa de chocolate', cantidad: 35, unidad: 'g', tipo: 'plato', estado: 'referencia', controla_disponibilidad: false, fuente: 'RECETAS_FINAL_DILANA_OS v3, hoja LA WAFFLERIA (16 jul 2026)', version: 'julio_2026', notas: '[SIN AUTOMATIZAR: requiere saber qué opción eligió el cliente; FUDO no registra ese detalle hoy] Grupo: Salsa - elegir 1.' },
    { producto: 'Waffle Bonitos', ingrediente: 'Salsa de maracuyá', cantidad: 1, unidad: 'porción', tipo: 'plato', estado: 'referencia', controla_disponibilidad: false, fuente: 'RECETAS_FINAL_DILANA_OS v3, hoja LA WAFFLERIA (16 jul 2026)', version: 'julio_2026', notas: '[SIN AUTOMATIZAR: requiere saber qué opción eligió el cliente; FUDO no registra ese detalle hoy] Grupo: Salsa - elegir 1. Validar que el lote realmente rinde 80 porciones.' },
    { producto: 'Waffle Bonitos', ingrediente: 'Salsa de pie de limón', cantidad: 35, unidad: 'g', tipo: 'plato', estado: 'referencia', controla_disponibilidad: false, fuente: 'RECETAS_FINAL_DILANA_OS v3, hoja LA WAFFLERIA (16 jul 2026)', version: 'julio_2026', notas: '[SIN AUTOMATIZAR: requiere saber qué opción eligió el cliente; FUDO no registra ese detalle hoy] Grupo: Salsa - elegir 1. Porción confirmada de 35 g.' },
    { producto: 'Waffle Churros', ingrediente: 'Arequipe', cantidad: 55, unidad: 'g', tipo: 'plato', estado: 'referencia', controla_disponibilidad: false, fuente: 'RECETAS_FINAL_DILANA_OS v3, hoja LA WAFFLERIA (16 jul 2026)', version: 'julio_2026', notas: '[SIN AUTOMATIZAR: requiere saber qué opción eligió el cliente; FUDO no registra ese detalle hoy] Grupo: Salsa - elegir 1.' },
    { producto: 'Waffle Churros', ingrediente: 'Salsa de chocolate', cantidad: 35, unidad: 'g', tipo: 'plato', estado: 'referencia', controla_disponibilidad: false, fuente: 'RECETAS_FINAL_DILANA_OS v3, hoja LA WAFFLERIA (16 jul 2026)', version: 'julio_2026', notas: '[SIN AUTOMATIZAR: requiere saber qué opción eligió el cliente; FUDO no registra ese detalle hoy] Grupo: Salsa - elegir 1.' },
    { producto: 'Waffle Churros', ingrediente: 'Salsa de maracuyá', cantidad: 1, unidad: 'porción', tipo: 'plato', estado: 'referencia', controla_disponibilidad: false, fuente: 'RECETAS_FINAL_DILANA_OS v3, hoja LA WAFFLERIA (16 jul 2026)', version: 'julio_2026', notas: '[SIN AUTOMATIZAR: requiere saber qué opción eligió el cliente; FUDO no registra ese detalle hoy] Grupo: Salsa - elegir 1. Validar que el lote realmente rinde 80 porciones.' },
    { producto: 'Waffle Churros', ingrediente: 'Salsa de pie de limón', cantidad: 35, unidad: 'g', tipo: 'plato', estado: 'referencia', controla_disponibilidad: false, fuente: 'RECETAS_FINAL_DILANA_OS v3, hoja LA WAFFLERIA (16 jul 2026)', version: 'julio_2026', notas: '[SIN AUTOMATIZAR: requiere saber qué opción eligió el cliente; FUDO no registra ese detalle hoy] Grupo: Salsa - elegir 1. Porción confirmada de 35 g.' },
    { producto: 'Toppings adicionales', ingrediente: 'M&M', cantidad: 30, unidad: 'g', tipo: 'plato', estado: 'referencia', controla_disponibilidad: false, fuente: 'RECETAS_FINAL_DILANA_OS v3, hoja LA WAFFLERIA (16 jul 2026)', version: 'julio_2026', notas: '[SIN AUTOMATIZAR: requiere saber qué opción eligió el cliente; FUDO no registra ese detalle hoy] Grupo: Topping - elegir el vendido.' },
    { producto: 'Toppings adicionales', ingrediente: 'Galleta Oreo', cantidad: 1, unidad: 'unidad', tipo: 'plato', estado: 'referencia', controla_disponibilidad: false, fuente: 'RECETAS_FINAL_DILANA_OS v3, hoja LA WAFFLERIA (16 jul 2026)', version: 'julio_2026', notas: '[SIN AUTOMATIZAR: requiere saber qué opción eligió el cliente; FUDO no registra ese detalle hoy] Grupo: Topping - elegir el vendido.' },
    { producto: 'Toppings adicionales', ingrediente: 'Maní', cantidad: 20, unidad: 'g', tipo: 'plato', estado: 'referencia', controla_disponibilidad: false, fuente: 'RECETAS_FINAL_DILANA_OS v3, hoja LA WAFFLERIA (16 jul 2026)', version: 'julio_2026', notas: '[SIN AUTOMATIZAR: requiere saber qué opción eligió el cliente; FUDO no registra ese detalle hoy] Grupo: Topping - elegir el vendido.' },
    { producto: 'Toppings adicionales', ingrediente: 'Barquillo', cantidad: 1, unidad: 'unidad', tipo: 'plato', estado: 'referencia', controla_disponibilidad: false, fuente: 'RECETAS_FINAL_DILANA_OS v3, hoja LA WAFFLERIA (16 jul 2026)', version: 'julio_2026', notas: '[SIN AUTOMATIZAR: requiere saber qué opción eligió el cliente; FUDO no registra ese detalle hoy] Grupo: Topping - elegir el vendido.' },
    { producto: 'Toppings adicionales', ingrediente: 'Chips de chocolate', cantidad: 35, unidad: 'g', tipo: 'plato', estado: 'referencia', controla_disponibilidad: false, fuente: 'RECETAS_FINAL_DILANA_OS v3, hoja LA WAFFLERIA (16 jul 2026)', version: 'julio_2026', notas: '[SIN AUTOMATIZAR: requiere saber qué opción eligió el cliente; FUDO no registra ese detalle hoy] Grupo: Topping - elegir el vendido.' },
  ];

  // 5) Líneas "producción" (subreceta -> insumo), generadas desde la hoja SUBRECETAS.
  const lineasSubreceta = [
    { producto: 'Zumo Limón', ingrediente: 'Limón entero', cantidad: 3165, unidad: 'g', rendimiento_producto: 1000, unidad_rendimiento: 'g', tipo: 'produccion', estado: 'revisar', controla_disponibilidad: true, fuente: 'RECETAS_FINAL_DILANA_OS v3, hoja SUBRECETAS (16 jul 2026)', version: 'julio_2026', notas: 'Lote real pesado = rendimiento 31,60%. CONTRADICE la fórmula de Guía Producción (28,92%). Diferencia ~10%, sin resolver aún.' },
    { producto: 'Ajo Preparado', ingrediente: 'Ajo', cantidad: 2000, unidad: 'g', rendimiento_producto: 2750, unidad_rendimiento: 'g', tipo: 'produccion', estado: 'activo', controla_disponibilidad: true, fuente: 'RECETAS_FINAL_DILANA_OS v3, hoja SUBRECETAS (16 jul 2026)', version: 'julio_2026', notas: 'Confirmado por ficha \'AJO PROCESADO\'.' },
    { producto: 'Ajo Preparado', ingrediente: 'Aceite de oliva', cantidad: 1100, unidad: 'ml', rendimiento_producto: 2750, unidad_rendimiento: 'g', tipo: 'produccion', estado: 'activo', controla_disponibilidad: true, fuente: 'RECETAS_FINAL_DILANA_OS v3, hoja SUBRECETAS (16 jul 2026)', version: 'julio_2026', notas: '' },
    { producto: 'Aioli Preparado', ingrediente: 'Aceite de oliva', cantidad: 1000, unidad: 'g', rendimiento_producto: 1303, unidad_rendimiento: 'g', tipo: 'produccion', estado: 'activo', controla_disponibilidad: true, fuente: 'RECETAS_FINAL_DILANA_OS v3, hoja SUBRECETAS (16 jul 2026)', version: 'julio_2026', notas: '' },
    { producto: 'Aioli Preparado', ingrediente: 'Huevos', cantidad: 4, unidad: 'unidades', rendimiento_producto: 1303, unidad_rendimiento: 'g', tipo: 'produccion', estado: 'activo', controla_disponibilidad: true, fuente: 'RECETAS_FINAL_DILANA_OS v3, hoja SUBRECETAS (16 jul 2026)', version: 'julio_2026', notas: '' },
    { producto: 'Aioli Preparado', ingrediente: 'Sal', cantidad: 10, unidad: 'g', rendimiento_producto: 1303, unidad_rendimiento: 'g', tipo: 'produccion', estado: 'activo', controla_disponibilidad: true, fuente: 'RECETAS_FINAL_DILANA_OS v3, hoja SUBRECETAS (16 jul 2026)', version: 'julio_2026', notas: '' },
    { producto: 'Aioli Preparado', ingrediente: 'Ajo Preparado', cantidad: 115, unidad: 'g', rendimiento_producto: 1303, unidad_rendimiento: 'g', tipo: 'produccion', estado: 'activo', controla_disponibilidad: true, fuente: 'RECETAS_FINAL_DILANA_OS v3, hoja SUBRECETAS (16 jul 2026)', version: 'julio_2026', notas: '' },
    { producto: 'Aioli Preparado', ingrediente: 'Zumo Limón', cantidad: 37, unidad: 'g', rendimiento_producto: 1303, unidad_rendimiento: 'g', tipo: 'produccion', estado: 'activo', controla_disponibilidad: true, fuente: 'RECETAS_FINAL_DILANA_OS v3, hoja SUBRECETAS (16 jul 2026)', version: 'julio_2026', notas: '' },
    { producto: 'Cebolla Elaborada', ingrediente: 'Cebolla roja', cantidad: 5430, unidad: 'g', rendimiento_producto: 3000, unidad_rendimiento: 'g', tipo: 'produccion', estado: 'activo', controla_disponibilidad: true, fuente: 'RECETAS_FINAL_DILANA_OS v3, hoja SUBRECETAS (16 jul 2026)', version: 'julio_2026', notas: 'Posible duplicado de \'Ensalada criolla peruana\' (ficha vieja) — mismos números exactos. Confirmar si son el mismo producto.' },
    { producto: 'Cebolla Elaborada', ingrediente: 'Zumo Limón', cantidad: 400, unidad: 'g', rendimiento_producto: 3000, unidad_rendimiento: 'g', tipo: 'produccion', estado: 'activo', controla_disponibilidad: true, fuente: 'RECETAS_FINAL_DILANA_OS v3, hoja SUBRECETAS (16 jul 2026)', version: 'julio_2026', notas: '' },
    { producto: 'Cebolla Elaborada', ingrediente: 'Vinagre', cantidad: 200, unidad: 'ml', rendimiento_producto: 3000, unidad_rendimiento: 'g', tipo: 'produccion', estado: 'activo', controla_disponibilidad: true, fuente: 'RECETAS_FINAL_DILANA_OS v3, hoja SUBRECETAS (16 jul 2026)', version: 'julio_2026', notas: '' },
    { producto: 'Papas Pre-Fritas', ingrediente: 'Papa Capira', cantidad: 1519.9203187, unidad: 'g', rendimiento_producto: 1000, unidad_rendimiento: 'g', tipo: 'produccion', estado: 'activo', controla_disponibilidad: true, fuente: 'RECETAS_FINAL_DILANA_OS v3, hoja SUBRECETAS (16 jul 2026)', version: 'julio_2026', notas: '' },
    { producto: 'Papas Pre-Fritas', ingrediente: 'Vinagre blanco', cantidad: 12.1115538, unidad: 'g', rendimiento_producto: 1000, unidad_rendimiento: 'g', tipo: 'produccion', estado: 'activo', controla_disponibilidad: true, fuente: 'RECETAS_FINAL_DILANA_OS v3, hoja SUBRECETAS (16 jul 2026)', version: 'julio_2026', notas: '' },
    { producto: 'Papas Pre-Fritas', ingrediente: 'Agua', cantidad: 834.8605578, unidad: 'g', rendimiento_producto: 1000, unidad_rendimiento: 'g', tipo: 'produccion', estado: 'activo', controla_disponibilidad: true, fuente: 'RECETAS_FINAL_DILANA_OS v3, hoja SUBRECETAS (16 jul 2026)', version: 'julio_2026', notas: '' },
    { producto: 'Papas Listas', ingrediente: 'Papas Pre-Fritas', cantidad: 1754.386, unidad: 'g', rendimiento_producto: 1000, unidad_rendimiento: 'g', tipo: 'produccion', estado: 'activo', controla_disponibilidad: true, fuente: 'RECETAS_FINAL_DILANA_OS v3, hoja SUBRECETAS (16 jul 2026)', version: 'julio_2026', notas: '' },
    { producto: 'Papas Listas', ingrediente: 'Ajo Preparado', cantidad: 20, unidad: 'g', rendimiento_producto: 1000, unidad_rendimiento: 'g', tipo: 'produccion', estado: 'activo', controla_disponibilidad: true, fuente: 'RECETAS_FINAL_DILANA_OS v3, hoja SUBRECETAS (16 jul 2026)', version: 'julio_2026', notas: '' },
    { producto: 'Papas Listas', ingrediente: 'Sal marina molida', cantidad: 10, unidad: 'g', rendimiento_producto: 1000, unidad_rendimiento: 'g', tipo: 'produccion', estado: 'activo', controla_disponibilidad: true, fuente: 'RECETAS_FINAL_DILANA_OS v3, hoja SUBRECETAS (16 jul 2026)', version: 'julio_2026', notas: '' },
    { producto: 'Papas Listas', ingrediente: 'Perejil Picado', cantidad: 20, unidad: 'g', rendimiento_producto: 1000, unidad_rendimiento: 'g', tipo: 'produccion', estado: 'activo', controla_disponibilidad: true, fuente: 'RECETAS_FINAL_DILANA_OS v3, hoja SUBRECETAS (16 jul 2026)', version: 'julio_2026', notas: '' },
    { producto: 'Falafel Preparado', ingrediente: 'Garbanzo', cantidad: 1000, unidad: 'g', rendimiento_producto: '', unidad_rendimiento: '', tipo: 'produccion', estado: 'activo', controla_disponibilidad: false, fuente: 'RECETAS_FINAL_DILANA_OS v3, hoja SUBRECETAS (16 jul 2026)', version: 'julio_2026', notas: '[No limita "Disponible Hoy": falta el rendimiento final del lote, no se proyecta producible desde materia prima, solo se usa lo contado] [Rendimiento del lote sin confirmar: "g (rendimiento final sin confirmar)"] WhatsApp Rafa, 16 jul 2026. REEMPLAZA la receta anterior (que salía de Guía Producción). Base = 1 kg de garbanzo.' },
    { producto: 'Falafel Preparado', ingrediente: 'Cilantro', cantidad: 750, unidad: 'g', rendimiento_producto: '', unidad_rendimiento: '', tipo: 'produccion', estado: 'activo', controla_disponibilidad: false, fuente: 'RECETAS_FINAL_DILANA_OS v3, hoja SUBRECETAS (16 jul 2026)', version: 'julio_2026', notas: '[No limita "Disponible Hoy": falta el rendimiento final del lote, no se proyecta producible desde materia prima, solo se usa lo contado] WhatsApp Rafa, 16 jul 2026. Antes eran ~425 g por kg de garbanzo — casi el doble ahora.' },
    { producto: 'Falafel Preparado', ingrediente: 'Perejil', cantidad: 750, unidad: 'g', rendimiento_producto: '', unidad_rendimiento: '', tipo: 'produccion', estado: 'revisar', controla_disponibilidad: false, fuente: 'RECETAS_FINAL_DILANA_OS v3, hoja SUBRECETAS (16 jul 2026)', version: 'julio_2026', notas: '[No limita "Disponible Hoy": falta el rendimiento final del lote, no se proyecta producible desde materia prima, solo se usa lo contado] WhatsApp Rafa, 16 jul 2026. Rafa aclaró que se pierde mucho en el tallo, así que la cantidad real comprada puede ser algo mayor a 750 g — confirmar cuánto se compra vs. cuánto entra limpio.' },
    { producto: 'Falafel Preparado', ingrediente: 'Cebolla corazones', cantidad: 200, unidad: 'g', rendimiento_producto: '', unidad_rendimiento: '', tipo: 'produccion', estado: 'revisar', controla_disponibilidad: false, fuente: 'RECETAS_FINAL_DILANA_OS v3, hoja SUBRECETAS (16 jul 2026)', version: 'julio_2026', notas: '[No limita "Disponible Hoy": falta el rendimiento final del lote, no se proyecta producible desde materia prima, solo se usa lo contado] WhatsApp Rafa, 16 jul 2026 (aclarado después: \'unos 7 corazones grandes por kilo de garbanzo, unos 200 gramos\'). Antes eran ~490 g por kg de garbanzo — bajó a menos de la mitad. La equivalencia \'corazones\' a gramos es aproximada, no una pesada exacta.' },
    { producto: 'Falafel Preparado', ingrediente: 'Pasta de ajo (Ajo Preparado)', cantidad: 100, unidad: 'g', rendimiento_producto: '', unidad_rendimiento: '', tipo: 'produccion', estado: 'activo', controla_disponibilidad: false, fuente: 'RECETAS_FINAL_DILANA_OS v3, hoja SUBRECETAS (16 jul 2026)', version: 'julio_2026', notas: '[No limita "Disponible Hoy": falta el rendimiento final del lote, no se proyecta producible desde materia prima, solo se usa lo contado] WhatsApp Rafa, 16 jul 2026. Antes ~82 g por kg de garbanzo — cercano, sin cambio material.' },
    { producto: 'Falafel Preparado', ingrediente: 'Limón entero (para zumo)', cantidad: 4, unidad: 'unidades', rendimiento_producto: '', unidad_rendimiento: '', tipo: 'produccion', estado: 'revisar', controla_disponibilidad: false, fuente: 'RECETAS_FINAL_DILANA_OS v3, hoja SUBRECETAS (16 jul 2026)', version: 'julio_2026', notas: '[No limita "Disponible Hoy": falta el rendimiento final del lote, no se proyecta producible desde materia prima, solo se usa lo contado] WhatsApp Rafa, 16 jul 2026. Falta convertir \'4 limones\' a gramos de zumo — no tengo el peso promedio de un limón entero en tu cocina. Antes eran ~16 g de zumo por kg de garbanzo, muy por debajo de lo que darían 4 limones enteros.' },
    { producto: 'Falafel Preparado', ingrediente: 'Especias / polvo para falafel', cantidad: 100, unidad: 'g', rendimiento_producto: '', unidad_rendimiento: '', tipo: 'produccion', estado: 'activo', controla_disponibilidad: false, fuente: 'RECETAS_FINAL_DILANA_OS v3, hoja SUBRECETAS (16 jul 2026)', version: 'julio_2026', notas: '[No limita "Disponible Hoy": falta el rendimiento final del lote, no se proyecta producible desde materia prima, solo se usa lo contado] WhatsApp Rafa, 16 jul 2026. Antes ~137 g por kg de garbanzo — cercano.' },
    { producto: 'Costilla Limpia Marinada', ingrediente: 'Costilla San Luis', cantidad: 15000, unidad: 'g', rendimiento_producto: '', unidad_rendimiento: '', tipo: 'produccion', estado: 'activo', controla_disponibilidad: false, fuente: 'RECETAS_FINAL_DILANA_OS v3, hoja SUBRECETAS (16 jul 2026)', version: 'julio_2026', notas: '[No limita "Disponible Hoy": falta el rendimiento final del lote, no se proyecta producible desde materia prima, solo se usa lo contado] [Rendimiento del lote sin confirmar: "g (máx. 15 kg de costilla cruda por tanda)"] WhatsApp Rafa, 16 jul 2026. REEMPLAZA la receta anterior de Guía Producción.' },
    { producto: 'Costilla Limpia Marinada', ingrediente: 'Sal', cantidad: 80, unidad: 'g', rendimiento_producto: '', unidad_rendimiento: '', tipo: 'produccion', estado: 'revisar', controla_disponibilidad: false, fuente: 'RECETAS_FINAL_DILANA_OS v3, hoja SUBRECETAS (16 jul 2026)', version: 'julio_2026', notas: '[No limita "Disponible Hoy": falta el rendimiento final del lote, no se proyecta producible desde materia prima, solo se usa lo contado] WhatsApp Rafa, 16 jul 2026 (\'máximo 100 g\'). Antes, escalado a esta misma tanda, daba ~123-153 g — no coincide, usar 80-100 g como rango real de cocina.' },
    { producto: 'Costilla Limpia Marinada', ingrediente: 'Polvo para costilla (especias)', cantidad: 500, unidad: 'g', rendimiento_producto: '', unidad_rendimiento: '', tipo: 'produccion', estado: 'revisar', controla_disponibilidad: false, fuente: 'RECETAS_FINAL_DILANA_OS v3, hoja SUBRECETAS (16 jul 2026)', version: 'julio_2026', notas: '[No limita "Disponible Hoy": falta el rendimiento final del lote, no se proyecta producible desde materia prima, solo se usa lo contado] WhatsApp Rafa, 16 jul 2026. Antes, escalado a esta misma tanda, daba ~347-767 g dependiendo de la fuente — confirmar 500 g como definitivo.' },
    { producto: 'Costilla Preparada', ingrediente: 'Costilla Limpia Marinada', cantidad: 7250, unidad: 'g', rendimiento_producto: 5305.288301, unidad_rendimiento: 'g', tipo: 'produccion', estado: 'activo', controla_disponibilidad: true, fuente: 'RECETAS_FINAL_DILANA_OS v3, hoja SUBRECETAS (16 jul 2026)', version: 'julio_2026', notas: 'Ratio (1,366561) coincide exacto con la fórmula independiente de Guía Producción — doble confirmado, sin cambios.' },
    { producto: 'Panceta Pre-Ahumada', ingrediente: 'Panceta entera', cantidad: 7150, unidad: 'g', rendimiento_producto: 5270, unidad_rendimiento: 'g', tipo: 'produccion', estado: 'activo', controla_disponibilidad: true, fuente: 'RECETAS_FINAL_DILANA_OS v3, hoja SUBRECETAS (16 jul 2026)', version: 'julio_2026', notas: 'Rendimiento real (incluyendo la sal del lote): 71,9%, coincide con el 71,31% de Guía Producción.' },
    { producto: 'Panceta Pre-Ahumada', ingrediente: 'Sal gruesa', cantidad: 180, unidad: 'g', rendimiento_producto: 5270, unidad_rendimiento: 'g', tipo: 'produccion', estado: 'activo', controla_disponibilidad: true, fuente: 'RECETAS_FINAL_DILANA_OS v3, hoja SUBRECETAS (16 jul 2026)', version: 'julio_2026', notas: '' },
    { producto: 'Panceta Pre-Ahumada', ingrediente: 'Carbón', cantidad: 3.8, unidad: 'kg', rendimiento_producto: 5270, unidad_rendimiento: 'g', tipo: 'produccion', estado: 'activo', controla_disponibilidad: false, fuente: 'RECETAS_FINAL_DILANA_OS v3, hoja SUBRECETAS (16 jul 2026)', version: 'julio_2026', notas: '[No limita "Disponible Hoy": insumo de proceso (ahumado), se descuenta por lote producido, no debe topar la disponibilidad proyectada] Insumo de proceso (ahumado), no ingrediente de plato — no descontar por plato vendido, solo por lote producido.' },
    { producto: 'Salsa de Costilla Nueva (insumos para reducción balsámica)', ingrediente: 'Vinagre balsámico de Módena', cantidad: 1620, unidad: 'g', rendimiento_producto: '', unidad_rendimiento: '', tipo: 'produccion', estado: 'pendiente', controla_disponibilidad: true, fuente: 'RECETAS_FINAL_DILANA_OS v3, hoja SUBRECETAS (16 jul 2026)', version: 'julio_2026', notas: '[Forzado a PENDIENTE: falta el peso real del lote después de reducir; confirmado con Diana 16 jul 2026] [Rendimiento del lote sin confirmar: "g (rendimiento final tras reducir sin confirmar)"] WhatsApp Rafa, 16 jul 2026. REEMPLAZA la receta anterior de Guía Producción.' },
    { producto: 'Salsa de Costilla Nueva (insumos para reducción balsámica)', ingrediente: 'Salsa de soya', cantidad: 1670, unidad: 'g', rendimiento_producto: '', unidad_rendimiento: '', tipo: 'produccion', estado: 'pendiente', controla_disponibilidad: true, fuente: 'RECETAS_FINAL_DILANA_OS v3, hoja SUBRECETAS (16 jul 2026)', version: 'julio_2026', notas: '[Forzado a PENDIENTE: falta el peso real del lote después de reducir; confirmado con Diana 16 jul 2026] WhatsApp Rafa, 16 jul 2026. Coincide casi exacto en proporción con la receta anterior.' },
    { producto: 'Salsa de Costilla Nueva (insumos para reducción balsámica)', ingrediente: 'Pasta de ajo (Ajo Preparado)', cantidad: 244, unidad: 'g', rendimiento_producto: '', unidad_rendimiento: '', tipo: 'produccion', estado: 'pendiente', controla_disponibilidad: true, fuente: 'RECETAS_FINAL_DILANA_OS v3, hoja SUBRECETAS (16 jul 2026)', version: 'julio_2026', notas: '[Forzado a PENDIENTE: falta el peso real del lote después de reducir; confirmado con Diana 16 jul 2026] WhatsApp Rafa, 16 jul 2026. Coincide casi exacto en proporción con la receta anterior.' },
    { producto: 'Salsa de Costilla Nueva (insumos para reducción balsámica)', ingrediente: 'Polvo de reducción (especias)', cantidad: 150, unidad: 'g', rendimiento_producto: '', unidad_rendimiento: '', tipo: 'produccion', estado: 'pendiente', controla_disponibilidad: true, fuente: 'RECETAS_FINAL_DILANA_OS v3, hoja SUBRECETAS (16 jul 2026)', version: 'julio_2026', notas: '[Forzado a PENDIENTE: falta el peso real del lote después de reducir; confirmado con Diana 16 jul 2026] WhatsApp Rafa, 16 jul 2026 (\'máximo 200 g\'). Cercano a lo esperado por proporción (~210 g), dentro de rango razonable.' },
    { producto: 'Salsa de Costilla Nueva (insumos para reducción balsámica)', ingrediente: 'Azúcar morena', cantidad: 1700, unidad: 'g', rendimiento_producto: '', unidad_rendimiento: '', tipo: 'produccion', estado: 'pendiente', controla_disponibilidad: true, fuente: 'RECETAS_FINAL_DILANA_OS v3, hoja SUBRECETAS (16 jul 2026)', version: 'julio_2026', notas: '[Forzado a PENDIENTE: falta el peso real del lote después de reducir; confirmado con Diana 16 jul 2026] WhatsApp Rafa, 16 jul 2026. Coincide casi exacto en proporción con la receta anterior.' },
    { producto: 'Salsa de Costilla Nueva (insumos para reducción balsámica)', ingrediente: 'Miel o maple', cantidad: 1000, unidad: 'g', rendimiento_producto: '', unidad_rendimiento: '', tipo: 'produccion', estado: 'pendiente', controla_disponibilidad: true, fuente: 'RECETAS_FINAL_DILANA_OS v3, hoja SUBRECETAS (16 jul 2026)', version: 'julio_2026', notas: '[Forzado a PENDIENTE: falta el peso real del lote después de reducir; confirmado con Diana 16 jul 2026] WhatsApp Rafa, 16 jul 2026. CAMBIA respecto a la receta anterior: por la proporción de los demás ingredientes se esperaría ~1.365 g, pero Rafa confirma 1.000 g — se toma como el dato correcto por venir directo de cocina.' },
    { producto: 'Reducción Balsámica Preparada', ingrediente: 'Salsa de Costilla Nueva (todo el lote de arriba)', cantidad: 6384, unidad: 'g', rendimiento_producto: '', unidad_rendimiento: '', tipo: 'produccion', estado: 'pendiente', controla_disponibilidad: true, fuente: 'RECETAS_FINAL_DILANA_OS v3, hoja SUBRECETAS (16 jul 2026)', version: 'julio_2026', notas: '[Forzado a PENDIENTE: falta el peso real del lote después de reducir; confirmado con Diana 16 jul 2026] Sigue sin confirmarse cuánto pesa el lote DESPUÉS de reducir (evaporar). El dato viejo (9.065 g de salida desde 6.809 g) era físicamente imposible — no reemplazarlo por otro número inventado. Falta pesar la olla antes y después de reducir.' },
    { producto: 'Waffle tradicional', ingrediente: 'Mezcla', cantidad: 1750, unidad: 'g', rendimiento_producto: 3000, unidad_rendimiento: 'g', tipo: 'produccion', estado: 'revisar', controla_disponibilidad: true, fuente: 'RECETAS_FINAL_DILANA_OS v3, hoja SUBRECETAS (16 jul 2026)', version: 'julio_2026', notas: 'La unidad del agua aparece en 0 en la plantilla original; confirmar.' },
    { producto: 'Waffle tradicional', ingrediente: 'Aceite', cantidad: 250, unidad: 'ml', rendimiento_producto: 3000, unidad_rendimiento: 'g', tipo: 'produccion', estado: 'revisar', controla_disponibilidad: true, fuente: 'RECETAS_FINAL_DILANA_OS v3, hoja SUBRECETAS (16 jul 2026)', version: 'julio_2026', notas: '' },
    { producto: 'Waffle tradicional', ingrediente: 'Agua grifo', cantidad: 1630, unidad: 'g', rendimiento_producto: 3000, unidad_rendimiento: 'g', tipo: 'produccion', estado: 'revisar', controla_disponibilidad: true, fuente: 'RECETAS_FINAL_DILANA_OS v3, hoja SUBRECETAS (16 jul 2026)', version: 'julio_2026', notas: '' },
    { producto: 'Waffle Canela', ingrediente: 'Mezcla', cantidad: 1750, unidad: 'g', rendimiento_producto: 3000, unidad_rendimiento: 'g', tipo: 'produccion', estado: 'revisar', controla_disponibilidad: true, fuente: 'RECETAS_FINAL_DILANA_OS v3, hoja SUBRECETAS (16 jul 2026)', version: 'julio_2026', notas: '' },
    { producto: 'Waffle Canela', ingrediente: 'Canela', cantidad: 60, unidad: 'g', rendimiento_producto: 3000, unidad_rendimiento: 'g', tipo: 'produccion', estado: 'revisar', controla_disponibilidad: true, fuente: 'RECETAS_FINAL_DILANA_OS v3, hoja SUBRECETAS (16 jul 2026)', version: 'julio_2026', notas: '' },
    { producto: 'Waffle Canela', ingrediente: 'Aceite', cantidad: 250, unidad: 'ml', rendimiento_producto: 3000, unidad_rendimiento: 'g', tipo: 'produccion', estado: 'revisar', controla_disponibilidad: true, fuente: 'RECETAS_FINAL_DILANA_OS v3, hoja SUBRECETAS (16 jul 2026)', version: 'julio_2026', notas: '' },
    { producto: 'Waffle Canela', ingrediente: 'Azúcar', cantidad: 125, unidad: 'g', rendimiento_producto: 3000, unidad_rendimiento: 'g', tipo: 'produccion', estado: 'revisar', controla_disponibilidad: true, fuente: 'RECETAS_FINAL_DILANA_OS v3, hoja SUBRECETAS (16 jul 2026)', version: 'julio_2026', notas: '' },
    { producto: 'Waffle Canela', ingrediente: 'Agua grifo', cantidad: 1630, unidad: 'g', rendimiento_producto: 3000, unidad_rendimiento: 'g', tipo: 'produccion', estado: 'revisar', controla_disponibilidad: true, fuente: 'RECETAS_FINAL_DILANA_OS v3, hoja SUBRECETAS (16 jul 2026)', version: 'julio_2026', notas: '' },
    { producto: 'Mezcla de pandebono', ingrediente: 'Premezcla Colmaíz', cantidad: 1000, unidad: 'g', rendimiento_producto: 3800, unidad_rendimiento: 'g', tipo: 'produccion', estado: 'activo', controla_disponibilidad: true, fuente: 'RECETAS_FINAL_DILANA_OS v3, hoja SUBRECETAS (16 jul 2026)', version: 'julio_2026', notas: 'Lote confirmado: 253 bolitas de 15 g y sobrante aproximado de 5 g.' },
    { producto: 'Mezcla de pandebono', ingrediente: 'Margarina', cantidad: 500, unidad: 'g', rendimiento_producto: 3800, unidad_rendimiento: 'g', tipo: 'produccion', estado: 'activo', controla_disponibilidad: true, fuente: 'RECETAS_FINAL_DILANA_OS v3, hoja SUBRECETAS (16 jul 2026)', version: 'julio_2026', notas: '' },
    { producto: 'Mezcla de pandebono', ingrediente: 'Queso costeño', cantidad: 1000, unidad: 'g', rendimiento_producto: 3800, unidad_rendimiento: 'g', tipo: 'produccion', estado: 'activo', controla_disponibilidad: true, fuente: 'RECETAS_FINAL_DILANA_OS v3, hoja SUBRECETAS (16 jul 2026)', version: 'julio_2026', notas: '' },
    { producto: 'Mezcla de pandebono', ingrediente: 'Agua', cantidad: 1300, unidad: 'g', rendimiento_producto: 3800, unidad_rendimiento: 'g', tipo: 'produccion', estado: 'activo', controla_disponibilidad: true, fuente: 'RECETAS_FINAL_DILANA_OS v3, hoja SUBRECETAS (16 jul 2026)', version: 'julio_2026', notas: '' },
    { producto: 'Salsa de pie de limón', ingrediente: 'Leche condensada', cantidad: 1580, unidad: 'g', rendimiento_producto: 2195, unidad_rendimiento: 'g', tipo: 'produccion', estado: 'activo', controla_disponibilidad: true, fuente: 'RECETAS_FINAL_DILANA_OS v3, hoja SUBRECETAS (16 jul 2026)', version: 'julio_2026', notas: '62 porciones enteras de 35 g y 25 g sobrantes.' },
    { producto: 'Salsa de pie de limón', ingrediente: 'Zumo de limón', cantidad: 615, unidad: 'g', rendimiento_producto: 2195, unidad_rendimiento: 'g', tipo: 'produccion', estado: 'activo', controla_disponibilidad: true, fuente: 'RECETAS_FINAL_DILANA_OS v3, hoja SUBRECETAS (16 jul 2026)', version: 'julio_2026', notas: '' },
    { producto: 'Azúcar con canela', ingrediente: 'Azúcar', cantidad: 1000, unidad: 'g', rendimiento_producto: 70, unidad_rendimiento: 'porciones', tipo: 'produccion', estado: 'activo', controla_disponibilidad: true, fuente: 'RECETAS_FINAL_DILANA_OS v3, hoja SUBRECETAS (16 jul 2026)', version: 'julio_2026', notas: '' },
    { producto: 'Azúcar con canela', ingrediente: 'Canela', cantidad: 75, unidad: 'g', rendimiento_producto: 70, unidad_rendimiento: 'porciones', tipo: 'produccion', estado: 'activo', controla_disponibilidad: true, fuente: 'RECETAS_FINAL_DILANA_OS v3, hoja SUBRECETAS (16 jul 2026)', version: 'julio_2026', notas: '' },
    { producto: 'Salsa de maracuyá', ingrediente: 'Maracuyá', cantidad: 2500, unidad: 'g', rendimiento_producto: 80, unidad_rendimiento: 'porciones', tipo: 'produccion', estado: 'revisar', controla_disponibilidad: true, fuente: 'RECETAS_FINAL_DILANA_OS v3, hoja SUBRECETAS (16 jul 2026)', version: 'julio_2026', notas: 'Validar que 80 und significa 80 porciones.' },
    { producto: 'Salsa de maracuyá', ingrediente: 'Azúcar', cantidad: 1250, unidad: 'g', rendimiento_producto: 80, unidad_rendimiento: 'porciones', tipo: 'produccion', estado: 'revisar', controla_disponibilidad: true, fuente: 'RECETAS_FINAL_DILANA_OS v3, hoja SUBRECETAS (16 jul 2026)', version: 'julio_2026', notas: '' },
    { producto: 'Salsa de mora', ingrediente: 'Mora licuada', cantidad: 500, unidad: 'g', rendimiento_producto: '', unidad_rendimiento: '', tipo: 'produccion', estado: 'pendiente', controla_disponibilidad: true, fuente: 'RECETAS_FINAL_DILANA_OS v3, hoja SUBRECETAS (16 jul 2026)', version: 'julio_2026', notas: 'El rendimiento de origen contiene el texto inválido \'752test\' — corregir en la plantilla de costeo antes de usar.' },
    { producto: 'Salsa de mora', ingrediente: 'Azúcar', cantidad: 150, unidad: 'g', rendimiento_producto: '', unidad_rendimiento: '', tipo: 'produccion', estado: 'pendiente', controla_disponibilidad: true, fuente: 'RECETAS_FINAL_DILANA_OS v3, hoja SUBRECETAS (16 jul 2026)', version: 'julio_2026', notas: '' },
  ];

  lineasPlato.concat(lineasReferencia).concat(lineasSubreceta).forEach(function (l) { upsert_(l); });

  SpreadsheetApp.flush();
  return { ok: true, resumen: resumen };
}

function respaldarHojaRecetasJulio2026_() {
  const ss = ss_();
  const marca = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd_HHmmss');
  const nombre = 'Respaldo_Recetas_20260716_' + marca;
  if (ss.getSheets().some(function (s) { return s.getName().indexOf('Respaldo_Recetas_20260716_') === 0; })) return;
  sheet_(SHEET_NAMES.RECETAS).copyTo(ss).setName(nombre);
}
