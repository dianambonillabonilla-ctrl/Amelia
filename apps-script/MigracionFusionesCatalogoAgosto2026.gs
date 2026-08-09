/**
 * FUSIÓN DE DUPLICADOS DE CATÁLOGO (ago 2026) — ejecutar una sola vez desde el editor de Apps Script
 *
 * Diana (ago 2026, sobre la auditoría completa de nombres duplicados en CLAUDE.md → "Catálogo: alias
 * que no funcionan..."): "las fusiones de nombres las haces tú". Estos 7 pares tienen evidencia dura
 * (un alias en Catalogo_Alias que quedó eclipsado por una fila con el mismo nombre — ver CLAUDE.md
 * para el detalle de cada caso — o directamente una fila marcada `tipo = "Alias inactivo"` con nota
 * manual explicando en qué producto consolidarse), así que no dependen de que Diana decida nada: solo
 * de ejecutar de verdad lo que ya estaba decidido pero nunca tuvo efecto por el bug de indiceCatalogo_.
 *
 * Usa catalogoFusionar_ (Catalogo.gs), que reescribe el historial (Conteos/Ajustes/Recetas/
 * Producciones/Traslados), reasigna los alias que ya existían del producto eliminado, y borra la
 * fila duplicada. Es idempotente: si una fila ya no existe (porque esta función ya corrió antes, o
 * porque alguien ya la fusionó a mano con el botón "Fusionar"), no hace nada ni falla.
 *
 * Los otros 3 de la auditoría con confirmación directa de Diana (ago 2026):
 *  - "Falafel Preparado" -> "Falafel": "es la misma preparación, fusionar". Se conserva "Falafel"
 *    (no "Falafel Preparado") porque es la fila con datos completos (categoría, sede, stock_minimo);
 *    "Falafel Preparado" era una fila vacía — mismo patrón que salió en el resto de filas sin
 *    categoría del catálogo: catalogoAsegurar_ crea una fila nueva en blanco la primera vez que
 *    alguien escribe un texto que no matchea nada existente, así que "sin categoría" en este
 *    catálogo casi siempre significa "nadie completó esta fila fantasma todavía", no un dato real
 *    distinto. "Falafel Crudo" no se toca: es la etapa cruda, un producto real aparte.
 *  - "Vino" -> "Vino tinto": confirmado como error de tecleo.
 *  - "Salsa pie de limon" -> "Salsa de pie de limón": confirmado como error de tecleo.
 *
 * "Sal" vs. "Sal Marina Gruesa"/"Sal Marina Media" y "Vasos" vs. "Vasos Gold 140nz" NO se tocan:
 * Diana confirmó que son productos reales distintos, no duplicados — quedan como están.
 */
function fusionarDuplicadosCatalogoAgosto2026_() {
  configurarHojas();
  const usuarioMigracion = { nombre: 'Migración histórica' };
  const resumen = { fusionados: 0, ya_resueltos: 0, errores: [] };

  // [nombre_estandar de la fila duplicada a eliminar, nombre_estandar del producto real a conservar]
  const pares = [
    ['Costilla San Luis', 'Costilla San Luis Entera'],
    ['Costilla Cruda', 'Costilla San Luis Entera'],
    ['Panceta Cruda', 'Panceta Entera'],
    ['Cebollita de Amelia', 'Cebolla Pluma'],
    ['cebolla cruda', 'Cebolla Roja'],
    ['Cebolla en Pluma (sin limon)', 'Cebolla Pluma'],
    ['Cebolla Elaborada', 'Cebolla Pluma'],
    ['Falafel Preparado', 'Falafel'],
    ['Vino', 'Vino tinto'],
    ['Salsa pie de limon', 'Salsa de pie de limón']
  ];

  pares.forEach(function (par) {
    const nombreEliminar = par[0], nombreConservar = par[1];
    const eliminar = catalogoBuscarPorNombreEstandar_(nombreEliminar);
    if (!eliminar) {
      resumen.ya_resueltos++;
      return;
    }
    const conservar = catalogoBuscarPorNombreEstandar_(nombreConservar);
    if (!conservar) {
      resumen.errores.push('No existe "' + nombreConservar + '" en el catálogo — revisar antes de repetir la migración.');
      return;
    }
    const r = catalogoFusionar_(conservar.id, eliminar.id);
    if (!r.ok) {
      resumen.errores.push('"' + nombreEliminar + '" -> "' + nombreConservar + '": ' + r.error);
      return;
    }
    resumen.fusionados++;
    // Deja el nombre eliminado como alias del que se conserva: si alguien lo vuelve a escribir en un
    // conteo/compra/producción futura, se resuelve solo en vez de que catalogoAsegurar_ le cree otra
    // fila fantasma (el mismo mecanismo que generó buena parte de estos duplicados en primer lugar).
    catalogoAliasCrear_(conservar.id, nombreEliminar, 'fusion_catalogo_agosto_2026', usuarioMigracion);
  });

  Logger.log('Fusión de duplicados de catálogo (ago 2026): ' + JSON.stringify(resumen));
  return resumen;
}

/**
 * Busca por nombre_estandar EXACTO (normalizado). A diferencia de catalogoBuscar_ (que también mira
 * nombre_fudo), aquí eso sería un error: el producto a CONSERVAR suele tener como nombre_fudo el
 * mismo texto que la fila duplicada a ELIMINAR (ej. "Costilla San Luis Entera" tiene nombre_fudo
 * "Costilla San Luis", que es justo el nombre_estandar de la fila duplicada) — con catalogoBuscar_,
 * buscar la fila a eliminar podría devolver por error la fila a conservar.
 */
function catalogoBuscarPorNombreEstandar_(nombreEstandar) {
  const norm = normalizar_(nombreEstandar);
  const catalogo = leerTabla_(SHEET_NAMES.CATALOGO);
  return catalogo.find(function (c) { return normalizar_(c.nombre_estandar) === norm; }) || null;
}
