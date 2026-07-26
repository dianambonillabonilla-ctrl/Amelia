/**
 * UBICACIONES (sub-zonas dentro de cada sede)
 * Traslados/Conteos_Manuales/Ajustes_Inventario ya guardan un "punto"/"punto_conteo"/
 * "punto_origen"/"punto_destino" de texto libre (ej. "Cocina", "Almacén") — nunca hubo un catálogo
 * central de qué puntos son válidos por sede, cada pantalla escribía lo que el usuario tipeara.
 * Esta lista formaliza el modelo de ubicaciones acordado (docs/modelo-inventario.md, sección 4)
 * para que la app pueda ofrecer un desplegable en vez de texto libre, sin cambiar cómo ya se
 * guardan esos campos (siguen siendo texto: "punto"/"punto_conteo"/"punto_origen"/"punto_destino").
 *
 * No se migra ni se valida retroactivamente lo ya guardado — un "punto" que un usuario haya
 * escrito distinto (o antes de que existiera esta lista) sigue funcionando igual que hoy.
 */
const UBICACIONES_POR_SEDE_ = {
  'Centro de Producción': [
    'Materia prima cruda', 'Productos en proceso', 'Productos terminados',
    'Despachos pendientes', 'Mermas de producción'
  ],
  'San Antonio': ['Cocina', 'Barra o bebidas', 'Almacén', 'Terraza o servicio', 'Caja'],
  'Capri': ['Cocina', 'Café y barra', 'Waflería', 'Almacén', 'Caja']
};

/** Sin `sede`, devuelve el catálogo completo { sede: [ubicaciones...] }. Con `sede`, solo su lista. */
function ubicacionesListar_(sede) {
  if (!sede) return UBICACIONES_POR_SEDE_;
  return UBICACIONES_POR_SEDE_[sede] || [];
}
