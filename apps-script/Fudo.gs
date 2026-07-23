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
    // true = esta ocurrencia coincide con una que ya existía de un import anterior (omitir).
    // false = ocurrencia nueva (no vista antes, o ya se agotaron las coincidencias previas) —
    // importar, aunque la llave se repita dentro de este mismo archivo.
    esDuplicadaPrevia: function (clave) {
      if (!estado[clave]) estado[clave] = { previos: 0, usados: 0 };
      const duplicada = estado[clave].usados < estado[clave].previos;
      estado[clave].usados++;
      return duplicada;
    }
  };
}

/**
 * Importa los dos formatos reales entregados por FUDO: movimientos y reporte resumido/detallado de
 * ventas. Toma un lock de todo el script mientras dura la importación: el algoritmo de
 * deduplicación (contadorClaves_) primero LEE todo lo ya guardado y después ESCRIBE lo nuevo — sin
 * este lock, dos importaciones al mismo tiempo (dos administradores, o el mismo archivo subido dos
 * veces por accidente en pestañas distintas) podrían leer el mismo estado "antes" y las dos
 * concluir que las mismas filas son nuevas, duplicándolas. Con archivos grandes divididos en lotes
 * (ver importar.html) cada lote pide y suelta el lock por separado, así que un lote no bloquea al
 * siguiente de la misma importación, solo a una importación distinta que intente cruzarse.
 */
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
      // Antes se descartaba la fila en silencio si faltaba fecha o nombre — el resultado decía
      // "Importadas 0 filas" sin ninguna pista de por qué. Ahora se cuenta cada motivo de descarte
      // por separado para poder explicarlo (ver diagnóstico más abajo).
      if (!obj.fecha) { sinFecha++; return; }
      if (!obj.nombre) { sinNombre++; return; }
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

    filas.forEach(function (f, i) {
      const creadaPor = valorFudo_(f, ['Creada por', 'Usuario', 'Caja']);
      const sede = opciones.sede && opciones.sede !== 'Automática'
        ? opciones.sede
        : sedeDesdeCreadaPor_(creadaPor);
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
      // Igual que en 'movimientos': antes esto descartaba la fila sin decir por qué. Se cuenta
      // cada motivo por separado (fecha/creación, producto o cantidad inválida) para poder armar
      // un diagnóstico legible cuando el resultado sea 0 filas importadas.
      if (!obj.creacion) { sinFecha++; return; }
      if (!obj.producto) { sinProducto++; return; }
      if (!(Number(obj.cantidad) > 0)) { cantidadInvalida++; return; }
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

    const valores = Object.keys(sinIdentificar);
    return {
      ok: true,
      importados: importados,
      omitidos_duplicados: omitidos,
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

/**
 * Nombres crudos que FUDO realmente ha usado, tomados de lo ya importado (Movimientos_FUDO y
 * Ventas_FUDO), para que Registrar producto ofrezca una lista de dónde elegir en vez de que el
 * Administrador tenga que adivinar/tipear "Nombre en FUDO" a mano. Evita el problema de fondo:
 * un nombre mal tipeado ahí nunca vuelve a cruzar con nada en Conciliación, sin ningún aviso.
 */
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
  // La fecha/hora de creación va en la llave además de id_venta (no en su lugar): antes, si el
  // archivo de FUDO no traía la columna "Id. Venta" con ese nombre exacto (o venía vacía), TODAS
  // las ventas de un mismo producto en la misma sede colapsaban en la misma llave sin importar el
  // día — la venta de hoy se descartaba como "duplicada" de la de ayer, aunque fuera un día y hora
  // distintos. Con id_venta presente y confiable esto no cambia nada (sigue siendo único); es una
  // protección para cuando no lo es.
  return ['detalle', formatearFechaHoraFudo_(v.creacion), String(v.id_venta || ''), normalizar_(v.producto), normalizar_(v.sede)].join('|');
}

function formatearFechaHoraFudo_(valor) {
  if (valor instanceof Date) return Utilities.formatDate(valor, Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');
  return String(valor || '').trim();
}

/** FUDO no trae sede explícita: para exportes detallados se infiere de la caja/terminal. */
function sedeDesdeCreadaPor_(creadaPor) {
  const valor = normalizar_(creadaPor);
  const capri = ['cajacapri', 'terrazacapri', 'caja capri'];
  const sanAntonio = ['terraza', 'caja', 'caja san antonio', 'terraza san antonio'];
  if (capri.indexOf(valor) !== -1) return 'Capri';
  if (sanAntonio.indexOf(valor) !== -1) return 'San Antonio';
  return 'Sin identificar';
}
