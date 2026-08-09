/**
 * MIGRACIÓN DE CATÁLOGO — nombres de materia prima de Centro de Producción sin resolver (ago 2026)
 *
 * Diana (ago 2026): "materias primas del centro de producción resolvamos los nombres pero deben de
 * quedar unificados". Se revisaron Producciones/Ajustes_Inventario de Centro de Producción contra
 * el catálogo y salieron dos problemas distintos:
 *
 * 1) "Costilla San Luis", "Costilla Cruda" y "Panceta Cruda" YA tienen una fila en Catalogo_Alias
 *    apuntando a "Costilla San Luis Entera"/"Panceta Entera" (creadas 27 jul 2026) — pero esos
 *    alias nunca funcionaron: los tres siguen existiendo TAMBIÉN como su propia fila independiente
 *    en Catalogo_Maestro con exactamente ese mismo nombre. indiceCatalogo_ (Catalogo.gs) arma
 *    primero el mapa nombre->nombre desde Catalogo_Maestro y NO lo sobrescribe con un alias, así
 *    que esas tres filas siguen tratándose como productos propios, distintos de "Costilla San Luis
 *    Entera"/"Panceta Entera", en Disponible Hoy/Conciliación. La corrección de ESTO no es una
 *    migración de código: es fusionarlas de verdad, con el botón "Fusionar" que ya existe en
 *    diagnostico.html → "Catálogo: posibles duplicados" (catalogoFusionar_ reescribe el historial Y
 *    borra la fila duplicada, a diferencia de un alias nuevo, que aquí ya demostró no bastar).
 *
 * 2) Nombres sueltos usados en producción que nunca tuvieron ni fila propia ni alias — variantes de
 *    escritura de un insumo que sí existe en el catálogo con otro nombre. Es lo que esta función
 *    corrige: crea el alias que falta para cada uno (catalogoAliasCrear_, idempotente).
 *
 * Casos que NO se tocan aquí porque no hay con qué decidir sin preguntar a Diana (quedan en
 * CLAUDE.md como pendientes):
 *  - "Aceite" (5.000 l registrados dos veces en Producciones, 22 jul 2026): no está claro a cuál de
 *    Aceite Girasol/Aceite Freidora/Bidones de Aceite Nuevos corresponde, y la cantidad es enorme
 *    para cualquiera de los tres — huele a error de tecleo, no solo de nombre.
 *  - "bolsa de basura negra" (Ajustes, Compra cruda): el catálogo tiene "Bolsas de Basura Negras
 *    Grandes" Y "...Pequeñas" — no hay forma de saber cuál sin preguntar.
 *  - "Gordo costilla" / "gordo panceta" (grasa retirada al preparar): no existen en el catálogo de
 *    ninguna forma — no es un nombre distinto de algo que ya existe, parece un concepto nuevo
 *    (merma/subproducto) que Diana debe decidir si vale la pena registrar de verdad.
 *
 * Es idempotente: catalogoAliasCrear_ ya no hace nada si el alias apunta al mismo producto.
 */
function migrarCatalogoCPAgosto2026_() {
  configurarHojas();
  const usuarioMigracion = { nombre: 'Migración histórica' };
  const resumen = { creados: 0, ya_existian: 0, errores: [] };

  // [alias tal como aparece en Producciones/Ajustes de Centro de Producción, nombre_estandar destino]
  const mapeos = [
    ['salsa de soya', 'Salsa Soya'],
    ['pasta de ajo', 'Ajo Preparado'],
    ['panceta', 'Panceta Entera'],
    ['polvo de la falafel', 'Especias Falafel'],
    ['polvo falafel', 'Especias Falafel'],
    ['polvos falafel', 'Especias Falafel'],
    ['polvo de marinar costillas', 'Especias de Marinar Costilla'],
    ['polvo marinar costilla', 'Especias de Marinar Costilla'],
    ['polvos costilla', 'Especias de Marinar Costilla'],
    ['polvo para reduccion costilla', 'Especias Salsa Costilla']
  ];

  mapeos.forEach(function (par) {
    const alias = par[0], nombreEstandar = par[1];
    const producto = catalogoBuscar_(nombreEstandar);
    if (!producto) {
      resumen.errores.push('No existe "' + nombreEstandar + '" en el catálogo — revisar antes de repetir la migración.');
      return;
    }
    const r = catalogoAliasCrear_(producto.id, alias, 'migracion_cp_agosto_2026', usuarioMigracion);
    if (!r.ok) {
      resumen.errores.push('"' + alias + '" -> "' + nombreEstandar + '": ' + r.error);
    } else if (r.ya_existia) {
      resumen.ya_existian++;
    } else {
      resumen.creados++;
    }
  });

  Logger.log('Migración catálogo CP (ago 2026): ' + JSON.stringify(resumen));
  return resumen;
}
