/**
 * CATÁLOGO MAESTRO
 * Une el nombre que usan las hojas manuales (Diario/Miércoles/Viernes) con el nombre y unidad
 * que usa FUDO, para que el resto del sistema pueda comparar sin depender de coincidencias de texto.
 */

function catalogoGuardar_(item, usuario) {
  if (!item || !item.nombre_estandar) return { ok: false, error: 'Falta nombre_estandar' };
  const sh = sheet_(SHEET_NAMES.CATALOGO);
  const data = sh.getDataRange().getValues();
  const headers = data[0];
  const idCol = headers.indexOf('id');

  if (item.id) {
    for (let r = 1; r < data.length; r++) {
      if (data[r][idCol] === item.id) {
        headers.forEach(function (h, c) {
          if (item[h] !== undefined) sh.getRange(r + 1, c + 1).setValue(item[h]);
        });
        return { ok: true, actualizado: true };
      }
    }
    return { ok: false, error: 'No se encontró el id ' + item.id };
  }

  item.id = Utilities.getUuid();
  appendRowFromObj_(SHEET_NAMES.CATALOGO, item);
  return { ok: true, creado: true, id: item.id };
}

function catalogoBuscar_(nombre) {
  const catalogo = leerTabla_(SHEET_NAMES.CATALOGO);
  const directo = catalogo.find(function (c) {
    return c.nombre_estandar === nombre || c.nombre_fudo === nombre;
  });
  if (directo) return directo;

  const norm = normalizar_(nombre);
  return catalogo.find(function (c) {
    return normalizar_(c.nombre_estandar) === norm || normalizar_(c.nombre_fudo) === norm;
  }) || null;
}

function normalizar_(s) {
  return String(s || '')
    .trim()
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ');
}

/**
 * Índice nombre_normalizado -> nombre_estandar, construido una sola vez a partir del catálogo
 * maestro (incluye tanto nombre_estandar como nombre_fudo apuntando al mismo nombre_estandar).
 * Pásalo a claveProducto_/nombreCanonico_ para no releer la hoja Catalogo_Maestro en cada
 * comparación — construirlo una vez por función y reutilizarlo.
 */
function indiceCatalogo_() {
  const indice = {};
  leerTabla_(SHEET_NAMES.CATALOGO).forEach(function (c) {
    if (c.nombre_estandar) indice[normalizar_(c.nombre_estandar)] = c.nombre_estandar;
    if (c.nombre_fudo && !indice[normalizar_(c.nombre_fudo)]) indice[normalizar_(c.nombre_fudo)] = c.nombre_estandar;
  });
  return indice;
}

/**
 * Llave estable para comparar/agrupar cualquier texto de producto o ingrediente (de Conteos,
 * Recetas, Producciones, Ventas_FUDO, etc.) sin importar tildes, mayúsculas o con qué nombre
 * (estándar o FUDO) se haya escrito — este es el mecanismo central que evita que "Costilla
 * Preparada" y "costilla preparada" (o su nombre en FUDO) se traten como productos distintos
 * en distintas partes del sistema.
 */
function claveProducto_(texto, indice) {
  const norm = normalizar_(texto);
  const canonico = indice && indice[norm];
  return canonico ? normalizar_(canonico) : norm;
}

/** Nombre "bonito" para mostrar: el nombre_estandar del catálogo si hay coincidencia, si no el texto tal cual. */
function nombreCanonico_(texto, indice) {
  const norm = normalizar_(texto);
  const canonico = indice && indice[norm];
  return canonico || String(texto || '').trim();
}

/**
 * Siembra inicial de materia prima / insumos de bodega, tomada de los inventarios reales de
 * San Antonio (hojas Diario/Miércoles/Viernes/Inicio del Mes/Inventario Centro Producción).
 * Deliberadamente NO incluye Bebidas: esa categoría ya está curada a mano en Catalogo_Maestro
 * con su propio mapeo a FUDO (ej. "Vino tinto", "Ginger COCTEL") y con nombres que no coinciden
 * uno a uno con los del inventario de bodega — sembrarla desde aquí crearía casi-duplicados.
 *
 * `categoria` sigue la convención que ya usa la hoja: un solo texto "Categoría/Subcategoría"
 * (ej. "Materia Prima/Fruver"), no una columna aparte.
 *
 * Corre esta función UNA vez desde el editor de Apps Script. Es segura de repetir: cada
 * producto se busca primero con catalogoBuscar_ (nombre normalizado) y solo se agrega si
 * todavía no existe, así que nunca duplica lo que ya haya en la hoja.
 */
function importarCatalogoInicial_() {
  const productos = [
    ['Limon Tahiti', 'Materia Prima/Fruver', 'g'],
    ['Cebolla Roja', 'Materia Prima/Fruver', 'g'],
    ['Ajo en Cabezas', 'Materia Prima/Fruver', 'g'],
    ['Perejil', 'Materia Prima/Fruver', 'g'],
    ['Cilantro', 'Materia Prima/Fruver', 'g'],
    ['Papa Capira', 'Materia Prima/Fruver', 'g'],
    ['Pepino', 'Materia Prima/Fruver', 'g'],
    ['Hinojo', 'Materia Prima/Fruver', 'g'],
    ['Naranjas', 'Materia Prima/Fruver', 'g'],
    ['Costilla San Luis Entera', 'Materia Prima/Cárnicos', 'g'],
    ['Panceta Entera', 'Materia Prima/Cárnicos', 'g'],
    ['Azucar Morena', 'Materia Prima/No Perecederos', 'g'],
    ['Azucar Blanca', 'Materia Prima/No Perecederos', 'g'],
    ['Sal Marina Gruesa', 'Materia Prima/No Perecederos', 'g'],
    ['Sal Marina Molida', 'Materia Prima/No Perecederos', 'g'],
    ['Sal Marina Media', 'Materia Prima/No Perecederos', 'g'],
    ['Sal Marina Fina', 'Materia Prima/No Perecederos', 'g'],
    ['Miel Maple', 'Materia Prima/No Perecederos', 'g'],
    ['Salsa Soya', 'Materia Prima/No Perecederos', 'g'],
    ['Vinagre Balsamico', 'Materia Prima/No Perecederos', 'g'],
    ['Vinagre Blanco', 'Materia Prima/No Perecederos', 'g'],
    ['Aceite de Oliva', 'Materia Prima/No Perecederos', 'g'],
    ['Aceite Vegetal', 'Materia Prima/No Perecederos', 'g'],
    ['Aceite Girasol', 'Materia Prima/No Perecederos', 'g'],
    ['Aceite Freidora', 'Materia Prima/No Perecederos', 'g'],
    ['Garbanzo', 'Materia Prima/No Perecederos', 'g'],
    ['Huevos A', 'Materia Prima/No Perecederos', 'u'],
    ['Especias Salsa Costilla', 'Materia Prima/No Perecederos', 'g'],
    ['Especias Falafel', 'Materia Prima/No Perecederos', 'g'],
    ['Especias de Marinar Costilla', 'Materia Prima/No Perecederos', 'g'],
    ['Panela Orgánica', 'Materia Prima/No Perecederos', 'g'],
    ['Helado', 'Materia Prima/No Perecederos', 'g'],
    ['Yoghurt Griego', 'Materia Prima/No Perecederos', 'g'],
    ['Costilla Limpia Marinada (con polvo)', 'Elaborados/Preparaciones de Cocina', 'g'],
    ['Costilla Preparada', 'Elaborados/Preparaciones de Cocina', 'g'],
    ['Costilla Preparada Picada', 'Elaborados/Preparaciones de Cocina', 'g'],
    ['Panceta Limpia Marinada', 'Elaborados/Preparaciones de Cocina', 'g'],
    ['Panceta Pre-Ahumada', 'Elaborados/Preparaciones de Cocina', 'g'],
    ['Reducción Balsámica', 'Elaborados/Preparaciones de Cocina', 'g'],
    ['Ajo Preparado', 'Elaborados/Preparaciones de Cocina', 'g'],
    ['Cebolla en Pluma (sin limon)', 'Elaborados/Preparaciones de Cocina', 'g'],
    ['Falafel', 'Elaborados/Preparaciones de Cocina', 'g'],
    ['Aioli', 'Elaborados/Preparaciones de Cocina', 'g'],
    ['Tzatziki', 'Elaborados/Preparaciones de Cocina', 'g'],
    ['Salsita Picante de Amelia', 'Elaborados/Preparaciones de Cocina', 'g'],
    ['Zumo Limón', 'Elaborados/Preparaciones de Cocina', 'g'],
    ['Sirope Neutro', 'Elaborados/Preparaciones de Cocina', 'g'],
    ['Sirope Naranja', 'Elaborados/Preparaciones de Cocina', 'g'],
    ['Sirope Panela', 'Elaborados/Preparaciones de Cocina', 'g'],
    ['Ginger Beer', 'Elaborados/Preparaciones de Cocina', 'g'],
    ['Papas Pre-Fritas', 'Elaborados/Preparaciones de Cocina', 'g'],
    ['Papas Listas', 'Elaborados/Preparaciones de Cocina', 'g'],
    ['Costilla Lista', 'Elaborados/Preparaciones de Cocina', 'g'],
    ['Relleno de Limon', 'Elaborados/Preparaciones de Cocina', 'g'],
    ['Masa Beignets', 'Elaborados/Preparaciones de Cocina', 'g'],
    ['Cebollita de Amelia', 'Elaborados/Preparaciones de Cocina', 'g'],
    ['Perejil Picado', 'Elaborados/Preparaciones de Cocina', 'g'],
    ['Azucar Pulverizada', 'Elaborados/Preparaciones de Cocina', 'g'],
    ['Gordos Panceta', 'Elaborados/Preparaciones de Cocina', 'g'],
    ['Gordos Costilla', 'Elaborados/Preparaciones de Cocina', 'g'],
    ['Porciones Pie Manzana', 'Elaborados/Postres y Panadería', 'u'],
    ['Beignet Limon', 'Elaborados/Postres y Panadería', 'u'],
    ['Beignet Maple', 'Elaborados/Postres y Panadería', 'u'],
    ['Cono Beignet', 'Elaborados/Postres y Panadería', 'u'],
    ['Beignets Cortados', 'Elaborados/Postres y Panadería', 'u'],
    ['Lavaloza', 'Aseo e Insumos/Limpieza', 'g'],
    ['Detergente', 'Aseo e Insumos/Limpieza', 'g'],
    ['Limpido', 'Aseo e Insumos/Limpieza', 'u'],
    ['Desengrasante Industrial', 'Aseo e Insumos/Limpieza', 'g'],
    ['Jabón Manos', 'Aseo e Insumos/Limpieza', 'g'],
    ['Esponja Lavaplatos', 'Aseo e Insumos/Limpieza', 'u'],
    ['Esponja Metalica', 'Aseo e Insumos/Limpieza', 'u'],
    ['Esponja de Brillo', 'Aseo e Insumos/Limpieza', 'u'],
    ['Cepillo Parrilla', 'Aseo e Insumos/Limpieza', 'u'],
    ['Bolsas de Basura Verdes', 'Aseo e Insumos/Limpieza', 'u'],
    ['Bolsas de Basura Negras Grandes', 'Aseo e Insumos/Limpieza', 'u'],
    ['Bolsas de Basura Negras Pequeñas', 'Aseo e Insumos/Limpieza', 'u'],
    ['Toalla de Manos para Baño', 'Aseo e Insumos/Limpieza', 'u'],
    ['Papel Industrial Cocina', 'Aseo e Insumos/Limpieza', 'u'],
    ['Trapos Servicio', 'Aseo e Insumos/Limpieza', 'u'],
    ['Papel Higienico', 'Aseo e Insumos/Limpieza', 'u'],
    ['Gel Antibacterial', 'Aseo e Insumos/Limpieza', 'u'],
    ['Carbón', 'Aseo e Insumos/Limpieza', 'u'],
    ['Pastillas Rojas Horno', 'Aseo e Insumos/Limpieza', 'u'],
    ['Pastillas Azules Horno', 'Aseo e Insumos/Limpieza', 'u'],
    ['Bolsas Domicilio Grandes', 'Papelería y Empaques/Domicilios', 'u'],
    ['Bolsas Domicilio Pequeñas', 'Papelería y Empaques/Domicilios', 'u'],
    ['Cajas Domicilio', 'Papelería y Empaques/Domicilios', 'u'],
    ['Recibos de Caja', 'Papelería y Empaques/Caja', 'u'],
    ['Papel Conos', 'Papelería y Empaques/Servicio', 'u'],
    ['Pegante de Conos', 'Papelería y Empaques/Servicio', 'u'],
    ['Rollo Impresora Caja', 'Papelería y Empaques/Caja', 'u'],
    ['Rollo Impresora Datafono', 'Papelería y Empaques/Caja', 'u'],
    ['Palitos', 'Papelería y Empaques/Servicio', 'u'],
    ['Servilletas', 'Papelería y Empaques/Servicio', 'u'],
    ['Salseros 2 oz', 'Papelería y Empaques/Servicio', 'u'],
    ['Tapas Salsero', 'Papelería y Empaques/Servicio', 'u'],
    ['Papel Aluminio', 'Papelería y Empaques/Cocina', 'g'],
    ['Valeas', 'Papelería y Empaques/Servicio', 'u'],
    ['Tenedores', 'Menaje y Utensilios/Comedor', 'u'],
    ['Vasos', 'Menaje y Utensilios/Comedor', 'u'],
    ['Copas', 'Menaje y Utensilios/Comedor', 'u'],
    ['Tupper Grande', 'Menaje y Utensilios/Cocina', 'u'],
    ['Tupper Mediano', 'Menaje y Utensilios/Cocina', 'u'],
    ['Tupper Redondo', 'Menaje y Utensilios/Cocina', 'u'],
    ['Piedras/Platos', 'Menaje y Utensilios/Comedor', 'u'],
    ['Sillas', 'Menaje y Utensilios/Mobiliario', 'u'],
    ['Mesas', 'Menaje y Utensilios/Mobiliario', 'u'],
    ['Escoba', 'Menaje y Utensilios/Aseo', 'u'],
    ['Trapero', 'Menaje y Utensilios/Aseo', 'u'],
    ['Trapos', 'Menaje y Utensilios/Aseo', 'u'],
    ['Recogedor', 'Menaje y Utensilios/Aseo', 'u'],
    ['Bidones Aceite Usado', 'Menaje y Utensilios/Cocina', 'u'],
    ['Guantes', 'Menaje y Utensilios/Cocina', 'u']
  ];

  let creados = 0;
  let existentes = 0;
  productos.forEach(function (p) {
    const nombre = p[0];
    if (catalogoBuscar_(nombre)) { existentes++; return; }
    catalogoGuardar_({ nombre_estandar: nombre, categoria: p[1], unidad_base: p[2] });
    creados++;
  });
  Logger.log('Catálogo inicial: ' + creados + ' productos creados, ' + existentes + ' ya existían y se dejaron intactos.');
}
