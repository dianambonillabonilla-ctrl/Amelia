/**
 * CORRECCIÓN DE 2 LÍNEAS DE RECETA — confirmadas por Diana en chat, ago 2026 (ejecutar una sola vez
 * desde el editor de Apps Script). No es una decisión que yo tomé: son las respuestas directas de
 * Diana a las dudas que dejó pendientes `migrarRecetasJulio2026_` en estas dos líneas concretas.
 *
 * 1) Zumo Limón <- Limón entero: el lote real pesado rindió 31,60%, pero la fórmula de la Guía de
 *    Producción daba 28,92% — un 10% de diferencia sin resolver. Diana (ago 2026): "con el limón
 *    dejemos el rendimiento más bajo para tener margen de error". `rendimiento_producto` es lo que
 *    ese lote de materia prima rinde de producto final (ver DisponibleHoy.gs) — bajarlo, manteniendo
 *    fija la cantidad de limón realmente pesada (3165 g), hace que el cálculo de "cuánto zumo se
 *    puede seguir produciendo" sea conservador en vez de optimista: 3165 g × 28,92% ≈ 915 g (antes
 *    1000 g, que correspondía al 31,60% real).
 *
 * 2) Costilla Limpia Marinada (con polvo) <- Polvo para costilla (especias): Rafa ya había dado 500 g
 *    por WhatsApp; la nota solo pedía confirmar que esa cifra reemplaza el rango viejo (347-767 g).
 *    Diana (ago 2026): "500 gramos" — confirma la cantidad, no cambia. `controla_disponibilidad`
 *    sigue en false porque el rendimiento final del lote (cuánta Costilla Limpia Marinada rinde ese
 *    Polvo) sigue sin pesarse — eso no lo confirmó Diana, sigue pendiente de balanza.
 *
 * Identifica cada línea por producto + ingrediente + version='julio_2026' (mismo criterio que
 * migrarRecetasJulio2026_, para no tocar por error otra versión de la misma receta). Es idempotente:
 * si ya está en estado='activo' con el valor esperado, no vuelve a escribir nada.
 */
function corregirRecetasConfirmadasAgosto2026_() {
  configurarHojas();
  const sh = sheet_(SHEET_NAMES.RECETAS);
  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  const data = sh.getDataRange().getValues();
  const col = {};
  headers.forEach(function (h, i) { col[h] = i; });
  const resumen = { actualizadas: 0, ya_estaban: 0, errores: [] };

  function buscar_(producto, ingrediente, version) {
    for (let r = 1; r < data.length; r++) {
      if (normalizar_(data[r][col.producto]) !== normalizar_(producto)) continue;
      if (normalizar_(data[r][col.ingrediente]) !== normalizar_(ingrediente)) continue;
      if (String(data[r][col.version] || '') === String(version)) return r;
    }
    return -1;
  }

  function aplicar_(producto, ingrediente, version, cambios) {
    const r = buscar_(producto, ingrediente, version);
    if (r === -1) {
      resumen.errores.push('No se encontró "' + producto + '" <- "' + ingrediente + '" (versión ' + version + ')');
      return;
    }
    const yaAplicado = Object.keys(cambios).every(function (campo) {
      return String(data[r][col[campo]]) === String(cambios[campo]);
    });
    if (yaAplicado) {
      resumen.ya_estaban++;
      return;
    }
    Object.keys(cambios).forEach(function (campo) {
      sh.getRange(r + 1, col[campo] + 1).setValue(cambios[campo]);
      data[r][col[campo]] = cambios[campo];
    });
    resumen.actualizadas++;
  }

  aplicar_('Zumo Limón', 'Limón entero', 'julio_2026', {
    rendimiento_producto: 915,
    estado: 'activo',
    notas: 'Rendimiento bajado a 28,92% (el más bajo de los dos registrados) a propósito, para dejar ' +
      'margen de error — confirmado por Diana, ago 2026. Sobre los 3165 g de limón realmente pesados, ' +
      '3165 × 0,2892 ≈ 915 g. El lote real había rendido 31,60% (≈1000 g), pero se prefiere la cifra ' +
      'conservadora.'
  });

  aplicar_('Costilla Limpia Marinada (con polvo)', 'Polvo para costilla (especias)', 'julio_2026', {
    estado: 'activo',
    notas: '[No limita "Disponible Hoy": falta el rendimiento final del lote, no se proyecta ' +
      'producible desde materia prima, solo se usa lo contado] 500 g confirmado como definitivo por ' +
      'Diana (ago 2026), reemplaza el rango viejo de 347-767 g.'
  });

  Logger.log('Corrección de recetas confirmadas (ago 2026): ' + JSON.stringify(resumen));
  return resumen;
}
