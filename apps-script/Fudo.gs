/**
 * Cuenta ocurrencias de cada llave en vez de solo existencia/inexistencia — con un simple
 * `existe[clave] = true`, la SEGUNDA fila real que comparte llave con otra (ej. el mismo producto
 * agregado dos veces a la misma mesa, incluso a la misma hora exacta) se confundía con "esta fila
 * ya se había importado antes" y se descartaba como duplicada, perdiendo una venta real. Contando
 * cuántas veces ya existía cada llave ANTES de este import, y cuántas se han "consumido" durante
 * este mismo import, una llave repetida dentro del archivo se sigue aceptando como nueva mientras
 * no se hayan agotado las coincidencias ya guardadas de una vez anterior.
 */
function contadorClaves_() {
  const estado = {};
  return {
    marcarPrevio: function (clave) {
      if (!estado[clave]) estado[clave] = { previos: 0, usados: 0 };
      estado[clave].previos++;
    },
    esDuplicadaPrevia: function (clave) {
      if (!estado[clave]) estado[clave] = { previos: 0, usados: 0 };
      const duplicada = estado[clave].usados < estado[clave].previos;
      estado[clave].usados++;
      return duplicada;
    }
  };
}

/**
 * Regla DILANA (ago 2026): las cantidades de FUDO solo son confiables para bebidas.
 * Se valida contra Catálogo Maestro. Si el producto es comida, otro tipo o no está clasificado,
 * su cantidad FUDO se descarta; el valor económico de la venta se conserva sin cambios.
 */
function cantidadFudoConfiableParaProducto_(nombreProducto) {
  const nombre = normalizar_(nombreProducto);
  if (!nombre) return false;
  const fila = leerTabla_(SHEET_NAMES.CATALOGO).find(function (c) {
    return normalizar_(c.nombre_fudo) === nombre || normalizar_(c.nombre_estandar) === nombre;
  });
  if (!fila) return false;
  const sector = normalizar_(fila.sector);
  const categoria = normalizar_(fila.categoria);
  return sector === 'bebidas' || categoria === 'bebidas' || categoria.indexOf('bebida') !== -1;
}

function importarFudo_(tipo, filas, usuario, opciones) {
  if (!tipo || !filas || !filas.length) return { ok: false, error: 'Falta tipo o filas' };
  opciones = opciones || {};

  const lock = LockService.getScriptLock();
  try {
    if (!lock.tryLock(30000)) {
      return { ok: false, error: 'Otra importación de FUDO está en curso ahora mismo — espera un momento y vuelve a intentarlo.' };
    }
    return importarFudoConLock_(tipo, filas, usuario, opciones);
  } finally {
    lock.releaseLock();
  }
}

function importarFudoConLock_(tipo, filas, usuario, opciones) {
  const ahora = new Date();
  const archivo = opciones.archivo || '';

  if (tipo === 'movimientos') {
    const contador = contadorClaves_();
    leerTabla_(SHEET_NAMES.MOVIMIENTOS_FUDO).forEach(function (m) { contador.marcarPrevio(claveMovimiento_(m)); });
    const nuevasFilas = [];
    let importados = 0;
    let omitidos = 0;
    let sinFecha = 0;
    let sinNombre = 0;
    let diferenciaInvalida = 0;
    filas.forEach(function (f) {
      const creadaPor = valorFudo_(f, ['Usuario', 'Creada por', 'Creado por']);
      const obj = {
        fecha: valorFudo_(f, ['Fecha']),
        tipo: valorFudo_(f, ['Tipo de movimiento', 'Movimiento', 'Tipo']),
        evento: valorFudo_(f, ['Evento']),
        nombre: valorFudo_(f, ['Nombre', 'Producto', 'Ingrediente']),
        stock_anterior: valorFudo_(f, ['Stock Anterior']),
        stock_actual: valorFudo_(f, ['Stock Actual']),
        diferencia: valorFudo_(f, ['Diferencia']),
        usuario: creadaPor,
        sede: opciones.sede && opciones.sede !== 'Automática' ? opciones.sede : sedeDesdeCreadaPor_(creadaPor),
        objeto_tipo: valorFudo_(f, ['Tipo_1', 'Tipo de objeto', 'Objeto', 'Entidad']),
        costo: valorFudo_(f, ['Costo']),
        archivo_origen: archivo,
        importado_por: usuario.nombre,
        importado_en: ahora
      };
      if (!obj.fecha) { sinFecha++; return; }
      if (!obj.nombre) { sinNombre++; return; }
      if (obj.diferencia !== '' && isNaN(Number(obj.diferencia))) { diferenciaInvalida++; return; }
      const clave = claveMovimiento_(obj);
      if (contador.esDuplicadaPrevia(clave)) { omitidos++; return; }
      nuevasFilas.push(obj);
      importados++;
    });
    appendRowsFromObjs_(SHEET_NAMES.MOVIMIENTOS_FUDO, nuevasFilas);
    return {
      ok: true,
      importados: importados,
      omitidos_duplicados: omitidos,
      tipo: tipo,
      diagnostico: importados === 0 ? {
        filas_recibidas: filas.length,
        descartadas_sin_fecha: sinFecha,
        descartadas_sin_nombre: sinNombre,
        descartadas_diferencia_invalida: diferenciaInvalida,
        columnas_detectadas: filas.length ? Object.keys(filas[0]) : []
      } : null
    };
  }

  if (tipo === 'ventas') {
    const esResumen = filas.some(function (f) { return valorFudo_(f, ['Cantidades vendidas']) !== ''; });
    const contador = contadorClaves_();
    leerTabla_(SHEET_NAMES.VENTAS_FUDO).forEach(function (v) { contador.marcarPrevio(claveVenta_(v)); });
    const sinIdentificar = {};
    const nuevasFilas = [];
    let importados = 0;
    let omitidos = 0;
    let sinFecha = 0;
    let sinProducto = 0;
    let cantidadInvalida = 0;
    let cantidadesOmitidasPorRegla = 0;

    filas.forEach(function (f, i) {
      const creadaPor = valorFudo_(f, ['Creada por', 'Usuario', 'Caja']);
      const sedeResuelta = valorFudo_(f, ['Sede']);
      const sede = opciones.sede && opciones.sede !== 'Automática'
        ? opciones.sede
        : (sedeResuelta && sedeResuelta !== 'Sin identificar' ? sedeResuelta : sedeDesdeCreadaPor_(creadaPor));
      const obj = esResumen ? {
        id_venta: 'RESUMEN-' + String(valorFudo_(f, ['Fecha']) || '') + '-' + (i + 1),
        creacion: valorFudo_(f, ['Fecha']),
        producto: valorFudo_(f, ['Producto']),
        categoria: valorFudo_(f, ['Categoría', 'Categoria']),
        cantidad: valorFudo_(f, ['Cantidades vendidas']),
        precio: valorFudo_(f, ['Monto total', 'Total bruto', 'Total neto']),
        cancelada: false,
        creada_por: creadaPor,
        sede: sede,
        formato_origen: 'reporte_productos_resumido',
        archivo_origen: archivo,
        importado_en: ahora
      } : {
        id_venta: valorFudo_(f, ['Id. Venta', 'Id Venta', 'ID Venta']),
        creacion: valorFudo_(f, ['Creación', 'Creacion', 'Fecha']),
        producto: valorFudo_(f, ['Producto']),
        categoria: valorFudo_(f, ['Categoría', 'Categoria']),
        cantidad: valorFudo_(f, ['Cantidad']),
        precio: valorFudo_(f, ['Precio']),
        cancelada: valorFudo_(f, ['Cancelada']),
        creada_por: creadaPor,
        sede: sede,
        formato_origen: 'ventas_detalladas',
        archivo_origen: archivo,
        importado_en: ahora
      };

      if (!obj.creacion) { sinFecha++; return; }
      if (!obj.producto) { sinProducto++; return; }

      const cantidadConfiable = cantidadFudoConfiableParaProducto_(obj.producto);
      if (cantidadConfiable) {
        if (!(Number(obj.cantidad) > 0)) { cantidadInvalida++; return; }
        obj.cantidad = Number(obj.cantidad);
      } else {
        if (obj.cantidad !== '' && obj.cantidad !== null && obj.cantidad !== undefined) cantidadesOmitidasPorRegla++;
        obj.cantidad = '';
      }

      if (sede === 'Sin identificar') {
        const k = String(creadaPor || 'reporte sin sede');
        sinIdentificar[k] = (sinIdentificar[k] || 0) + 1;
      }
      const clave = claveVenta_(obj);
      if (contador.esDuplicadaPrevia(clave)) { omitidos++; return; }
      nuevasFilas.push(obj);
      importados++;
    });
    appendRowsFromObjs_(SHEET_NAMES.VENTAS_FUDO, nuevasFilas);
    if (typeof fudoVentasEscribirDesdeFlat_ === 'function' && nuevasFilas.length) {
      fudoVentasEscribirDesdeFlat_(nuevasFilas);
    }

    const valores = Object.keys(sinIdentificar);
    return {
      ok: true,
      importados: importados,
      omitidos_duplicados: omitidos,
      cantidades_omitidas_no_bebidas: cantidadesOmitidasPorRegla,
      tipo: tipo,
      formato: esResumen ? 'resumido' : 'detallado',
      advertencia: esResumen && (!opciones.sede || opciones.sede === 'Automática')
        ? 'El reporte resumido no trae caja/terminal. Sus ventas quedaron Sin identificar y no se usarán en cálculos por sede.' : null,
      sin_identificar: valores.length ? {
        total: valores.reduce(function (acc, k) { return acc + sinIdentificar[k]; }, 0), valores: valores
      } : null,
      diagnostico: importados === 0 ? {
        filas_recibidas: filas.length,
        descartadas_sin_fecha: sinFecha,
        descartadas_sin_producto: sinProducto,
        descartadas_cantidad_invalida: cantidadInvalida,
        columnas_detectadas: filas.length ? Object.keys(filas[0]) : []
      } : null
    };
  }
  return { ok: false, error: 'Tipo de importación no reconocido: ' + tipo };
}

function fudoNombresVistos_() {
  const nombres = new Set();
  leerTabla_(SHEET_NAMES.MOVIMIENTOS_FUDO).forEach(function (m) {
    const n = String(m.nombre || '').trim();
    if (n) nombres.add(n);
  });
  leerTabla_(SHEET_NAMES.VENTAS_FUDO).forEach(function (v) {
    const n = String(v.producto || '').trim();
    if (n) nombres.add(n);
  });
  return Array.from(nombres).sort(function (a, b) { return a.localeCompare(b); });
}

function valorFudo_(fila, candidatos) {
  const indice = {};
  Object.keys(fila || {}).forEach(function (k) { indice[normalizar_(k)] = fila[k]; });
  for (let i = 0; i < candidatos.length; i++) {
    const v = indice[normalizar_(candidatos[i])];
    if (v !== undefined && v !== null) return v;
  }
  return '';
}

function claveMovimiento_(m) {
  return [formatearFechaHoraFudo_(m.fecha), normalizar_(m.evento), normalizar_(m.nombre), Number(m.stock_anterior),
    Number(m.stock_actual), Number(m.diferencia), normalizar_(m.usuario)].join('|');
}

function claveVenta_(v) {
  if (v.formato_origen === 'reporte_productos_resumido') {
    return ['resumen', formatearFecha_(v.creacion), normalizar_(v.producto), normalizar_(v.sede)].join('|');
  }
  return ['detalle', formatearFechaHoraFudo_(v.creacion), String(v.id_venta || ''), normalizar_(v.producto), normalizar_(v.sede)].join('|');
}

function formatearFechaHoraFudo_(valor) {
  if (valor instanceof Date) return Utilities.formatDate(valor, Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');
  return String(valor || '').trim();
}

function sedeDesdeCreadaPor_(creadaPor) {
  const valor = normalizar_(creadaPor);
  if (!valor) return 'Sin identificar';
  const mapeos = leerTabla_(SHEET_NAMES.FUDO_MAPEO_SEDES);
  const prioridad = ['Sala', 'Caja', 'Identificador', 'Usuario'];
  for (let i = 0; i < prioridad.length; i++) {
    const tipo = normalizar_(prioridad[i]);
    for (let j = 0; j < mapeos.length; j++) {
      if (normalizar_(mapeos[j].tipo_referencia) === tipo && normalizar_(mapeos[j].nombre) === valor) {
        return mapeos[j].sede;
      }
    }
  }
  const capri = ['cajacapri', 'terrazacapri', 'caja capri', 'terraza capri', 'la waffleria - capri'];
  const sanAntonio = ['terraza', 'caja', 'caja san antonio', 'terraza san antonio', 'salon sa', 'terraza sa'];
  if (capri.indexOf(valor) !== -1) return 'Capri';
  if (sanAntonio.indexOf(valor) !== -1) return 'San Antonio';
  return 'Sin identificar';
}
