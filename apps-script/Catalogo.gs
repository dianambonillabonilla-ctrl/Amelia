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

/**
 * Si `nombre` no existe todavía en el catálogo (ni como nombre_estandar ni como nombre_fudo), lo
 * crea sin categoría — así queda una entrada "oficial" contra la que comparar la próxima vez que
 * alguien escriba ese mismo producto, en vez de que cada conteo/compra lo escriba distinto. El
 * Administrador completa categoría/stock mínimo/nombre FUDO después desde Registrar producto.
 * No lanza error si falla: crear el producto es un efecto secundario, no debe tumbar el
 * conteo/compra que lo disparó.
 */
function catalogoAsegurar_(nombre, unidad) {
  const limpio = String(nombre || '').trim();
  if (!limpio) return;
  try {
    if (catalogoBuscar_(limpio)) return;
    catalogoGuardar_({ nombre_estandar: limpio, unidad_base: normalizarUnidad_(unidad) || '', categoria: '' });
  } catch (err) {
    Logger.log('catalogoAsegurar_ falló para "' + limpio + '": ' + err.message);
  }
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
 * Etiqueta en el catálogo qué productos se cuentan TODOS LOS DÍAS ('Diario') y cuáles solo un día
 * específico de la semana ('Miércoles' o 'Viernes') — tomado tal cual de las hojas
 * Diario/Miercoles/Viernes del Excel histórico de San Antonio. Esto alimenta la lista fija que
 * conteo.html precarga en Registrar conteo (ver cargarListaFija_ allí), para que el personal no
 * tenga que buscar cada producto desde cero en cada cierre.
 *
 * Si el producto ya existe en el catálogo (por nombre, sin importar tildes/mayúsculas/espacios),
 * solo se le pone la frecuencia — no se toca categoría, unidad ni nada más que ya tenga. Si no
 * existe, se crea sin categoría (el Administrador la completa después en Registrar producto).
 *
 * "Papel higienico" aparece en Diario Y en Miércoles en el Excel original; aquí gana Miércoles
 * (se procesa después) — revísalo en Registrar producto si en realidad debía quedar Diario.
 *
 * Es la lista de San Antonio únicamente: si Capri o Centro de Producción necesitan una lista
 * distinta, frecuencia_conteo tendría que volverse un dato por sede — hoy no lo es.
 *
 * Corre esta función UNA vez desde el editor de Apps Script (requiere haber corrido
 * configurarHojas() después de que se agregó la columna frecuencia_conteo). Es segura de repetir.
 */
function importarFrecuenciasConteoInicial_() {
  const listas = {
    Diario: [
      ['Limon Tahiti', 'g'],
      ['Perejil Picado', ''],
      ['Perejil', 'g'],
      ['Papa Capira', 'g'],
      ['Pepino', ''],
      ['Hinojo', ''],
      ['Relleno de Limon', 'g'],
      ['Masa Beignets', 'g'],
      ['Porciones Pie Manzana', 'u'],
      ['Helado', 'g'],
      ['Yoghurt Griego', ''],
      ['Costilla Preparada', 'g'],
      ['Costilla Preparada Picada', 'g'],
      ['Panceta  Pre-Ahumada', 'g'],
      ['Reducción Balsamica', 'g'],
      ['Ajo Preparado', 'g'],
      ['Cebolla en Pluma (sin limon)', 'g'],
      ['Cebollita de Amelia', ''],
      ['Falafel', 'g'],
      ['Papas Pre-Fritas', 'g'],
      ['Aioli', 'g'],
      ['Tzatziki', 'g'],
      ['Salsita Picante de Amelia', 'g'],
      ['Zumo Limón', 'g'],
      ['Sirope Neutro', 'g'],
      ['Sirope Naranja', 'g'],
      ['Sirope Panela', 'g'],
      ['Ginger Beer', 'g'],
      ['Papel higienico', 'u'],
      ['AB Rubia Lager', 'u'],
      ['Aguila Light 330 ml', 'u'],
      ['CC Dorada 330 ml', 'u'],
      ['Poker', 'u'],
      ['Stella Artois 330 ml', 'u'],
      ['Torre Anturio (Porter Ale)', 'u'],
      ['Torre Camelia (Amber Ale)', 'u'],
      ['Torre Magnolia (Blonde Ale)', 'u'],
      ['Torre Silvana (IPA)', 'u'],
      ['Agua Manantial 500ml', 'u'],
      ['Coca-Cola Original 10 Oz (Domicilio)', 'u'],
      ['Coca-Cola Original  350 ml', 'u'],
      ['Coca-Cola Sin Azucar 10 Oz (Domicilio)', 'u'],
      ['Coca-Cola Sin Azucar 350 ml', 'u'],
      ['Ginger Ale 240 ml', 'u'],
      ['Soda 350 ml', 'u'],
      ['Kefir 240 ml', 'u'],
      ['Hielo', 'u']
    ],
    Miércoles: [
      ['Lavaloza', 'g'],
      ['Detergente', 'g'],
      ['Aceite Freidora', 'g'],
      ['Limpido', 'u'],
      ['Desengrasante Industrial', 'g'],
      ['Jabón Manos', 'g'],
      ['Bolsas Domiclio Grandes', 'u'],
      ['Bolsas Domicilio Pequeñas', 'u'],
      ['Cajas Domicilio', 'u'],
      ['Recibos de Caja', 'u'],
      ['Gel Antibacterial', 'g'],
      ['Papel Conos', 'paq'],
      ['Pegante de Conos', 'u'],
      ['Rollo Impresora Caja', 'u'],
      ['Rollo Impresora DATAFONO', 'u'],
      ['mezclador de bebidas', 'u'],
      ['Servilletas', 'paq'],
      ['Salseros 2 oz', 'u'],
      ['Tapas Salsero', 'u'],
      ['Papel Aluminio', 'g'],
      ['Papel higienico', 'u'],
      ['Esponja Lavaplatos', 'u'],
      ['Esponja Metalica', 'u'],
      ['Esponja de Brillo', 'u'],
      ['Cepillo Parrilla', 'u'],
      ['Bolas de basura verdes', 'u'],
      ['Bolsas de basura Negras grandes', 'u'],
      ['Bolsas de basura Negras pequeñas', 'u'],
      ['Toalla de manos para baño', 'u'],
      ['Papel indusrial cocina', 'u'],
      ['Trapos Servicio', 'u'],
      ['Tapas Salsero otro tamaño', 'u'],
      ['Lapiceros', 'u'],
      ['Tijeras', 'u'],
      ['Alcohol', 'u'],
      ['Tapabocas', 'paq'],
      ['Pines', 'u'],
      ['varsol', 'g'],
      ['limpia piso', ''],
      ['bananas', '']
    ],
    Viernes: [
      ['Panela Orgánica', 'u'],
      ['Azucar Blanca', ''],
      ['Sal Marina Media', 'g'],
      ['Sal Marina Fina', 'g'],
      ['Vinagre Blanco', 'g'],
      ['Aceite de Oliva', 'g'],
      ['Aceite Girasol', 'g'],
      ['Huevos A', 'u'],
      ['Botellas Vino', 'u'],
      ['Botellas Tequila', 'u'],
      ['Botellas Triple Sec', 'u'],
      ['Botellas Viche', 'u'],
      ['Naranjas', 'g'],
      ['Ginger 1.5 L', 'u'],
      ['azucar  morena', ''],
      ['sal', 'g'],
      ['Azucar pulverizada', 'g']
    ]
  };

  let etiquetados = 0;
  let creados = 0;
  Object.keys(listas).forEach(function (frecuencia) {
    listas[frecuencia].forEach(function (p) {
      const nombre = p[0];
      const unidad = p[1] || 'u';
      const existente = catalogoBuscar_(nombre);
      if (existente) {
        catalogoGuardar_({ id: existente.id, nombre_estandar: existente.nombre_estandar, frecuencia_conteo: frecuencia });
      } else {
        catalogoGuardar_({ nombre_estandar: nombre, unidad_base: normalizarUnidad_(unidad) || 'u', categoria: '', frecuencia_conteo: frecuencia });
        creados++;
      }
      etiquetados++;
    });
  });
  Logger.log('Frecuencias de conteo: ' + etiquetados + ' productos etiquetados (' + creados + ' creados de nuevo).');
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
