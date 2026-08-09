/**
 * CANTIDADES RARAS — aviso, nunca bloqueo (mismo criterio que el resto de la app: una diferencia
 * de Caja o un FUDO sin sincronizar tampoco bloquean, solo avisan y piden confirmar).
 *
 * Detecta un posible error de tecleo (ej. escribir 50000 en vez de 500, o elegir "kg" en vez de
 * "g" sin querer — eso también se agarra, porque todo se compara ya convertido a la unidad base)
 * comparando la cantidad nueva contra el máximo de lo que ese MISMO producto ha registrado antes
 * en esa MISMA hoja de movimientos (Conteos, Ajustes/Compras, Producciones o Traslados).
 *
 * No es un umbral que Diana tenga que configurar por producto (a diferencia de `stock_minimo`) —
 * se adapta solo al historial real de cada uno. Sin historial suficiente, no hay con qué comparar
 * y no se avisa: no tiene sentido "sorprenderse" con la primera vez que se registra algo.
 *
 * Usado por Conteos.gs, AjustesInventario.gs, Produccion.gs y Traslados.gs: cada uno arma su propio
 * historial (nombres de columna distintos por hoja) y llama cantidadEsRara_ con la cantidad nueva
 * ya en unidad base. Si algo sale raro y quien llama no mandó `confirmar_cantidades_raras` en las
 * opciones, la función de registro correspondiente devuelve `{ ok:false, requiere_confirmacion:true,
 * cantidades_raras:[...] }` en vez de guardar — el frontend muestra el detalle y, si la persona
 * confirma que sí es correcto, reenvía la misma solicitud con esa opción en true para guardar igual.
 */
const CANTIDAD_RARA_MULTIPLO_ = 10;
const CANTIDAD_RARA_MIN_HISTORIAL_ = 3;

/** `historial` ya debe venir en la misma unidad base que `cantidadBase` (ver historialCantidadesBase_). */
function cantidadEsRara_(historial, cantidadBase) {
  if (!historial || historial.length < CANTIDAD_RARA_MIN_HISTORIAL_) return null;
  const referencia = Math.max.apply(null, historial);
  if (!(referencia > 0) || !(cantidadBase > 0)) return null;
  if (cantidadBase > referencia * CANTIDAD_RARA_MULTIPLO_) {
    return { referencia: referencia, veces: Number((cantidadBase / referencia).toFixed(1)) };
  }
  return null;
}

/**
 * Cantidades históricas de `producto` en `filas` (de UNA hoja ya leída con leerTabla_, para no
 * releerla una vez por producto), convertidas a unidad base y filtradas a las que SÍ quedaron en
 * `unidadBaseEsperada` — una fila vieja en otra unidad no comparable simplemente no cuenta como
 * referencia, no rompe la comparación. `campoProducto`/`campoCantidad`/`campoUnidad` existen
 * porque cada hoja nombra sus columnas distinto (Conteos: producto/cantidad/unidad; Producciones:
 * item/cantidad/unidad...).
 */
function historialCantidadesBase_(filas, campoProducto, campoCantidad, campoUnidad, producto, unidadBaseEsperada) {
  const claveBuscada = normalizar_(producto);
  const historial = [];
  filas.forEach(function (f) {
    if (normalizar_(f[campoProducto]) !== claveBuscada) return;
    const base = aUnidadBase_(f[campoCantidad], f[campoUnidad]);
    if (base.unidad !== unidadBaseEsperada) return;
    if (base.cantidad > 0) historial.push(base.cantidad);
  });
  return historial;
}

/**
 * Arma la entrada de aviso para el frontend a partir de un item con producto/cantidad/unidad (el
 * shape común entre Conteos, Ajustes, Producciones y Traslados) y el resultado de cantidadEsRara_.
 */
function avisoCantidadRara_(producto, cantidad, unidad, unidadBase, rara) {
  return {
    producto: producto, cantidad: cantidad, unidad: unidad,
    referencia: rara.referencia, unidad_base: unidadBase, veces: rara.veces
  };
}
