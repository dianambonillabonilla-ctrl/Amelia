/**
 * INTEGRACIÓN DE LA API COMPLETA (offline)
 *
 * Carga TODOS los .gs en un solo espacio global (como los une Apps Script) contra un Google Sheet
 * simulado en memoria, y ejerce el flujo real: configurarHojas() -> crearAdministradorInicial_() ->
 * login por doPost -> todas las acciones de lectura del router.
 *
 * Cubre dos clases de fallo que las pruebas por módulo no pueden ver, porque solo aparecen cuando
 * los archivos conviven y hay datos de verdad:
 *
 *  1. Una hoja o una constante de SHEET_NAMES que un módulo usa y Code.gs no declara — el síntoma
 *     real fue 'No existe la hoja "undefined"' nada más abrir la app.
 *  2. Un cálculo que pide el Sheet tantas veces que no cabe en el límite de 6 minutos de Apps
 *     Script. Cada leerTabla_ es una llamada real a la API de Sheets, así que aquí se cuentan.
 *
 * Incluye la ruta de ACTUALIZACIÓN (hojas que ya existen con columnas viejas y con datos), que es
 * el estado en el que está una instalación que lleva tiempo funcionando.
 */
const fs = require('fs');
const assert = require('assert');
const { crearEntorno } = require('./helpers/entorno-apps-script.js');

// Acciones que escriben, borran, migran o necesitan red: fuera de este recorrido de lectura.
// El camino de escritura se prueba aparte, en tests/flujo-escritura.test.js.
const ACCIONES_OMITIDAS = new Set([
  'logout', 'cambiar_password', 'catalogo_guardar', 'catalogo_eliminar', 'catalogo_reparar_ids',
  'catalogo_fusionar', 'catalogo_alias_crear', 'catalogo_alias_eliminar', 'receta_guardar',
  'receta_aprobar', 'conteo_registrar', 'turno_sector_elegir', 'turno_cerrar',
  'ajuste_inventario_registrar', 'ajuste_inventario_avalar', 'ajuste_inventario_corregir_unidad',
  'compra_registrar_factura', 'gestion_crear', 'gestion_actualizar_estado', 'importar_fudo',
  'fudo_api_probar_conexion', 'fudo_api_sincronizar_ventas', 'fudo_api_sincronizar_pagos',
  'fudo_api_sincronizar_catalogo', 'catalogo_enviar_nombre_fudo', 'catalogo_enviar_nombres_fudo',
  'stock_fudo_base_importar', 'fudo_api_tomar_snapshot_stock', 'fudo_ventas_migrar',
  'fudo_pagos_migrar', 'fudo_descuentos_propinas_migrar', 'fudo_subitems_migrar',
  'fudo_mapeo_sede_guardar', 'fudo_mapeo_sede_eliminar', 'ventas_pendientes_sede_asignar',
  'inventario_libro_configurar', 'migracion_inventario_simular', 'migracion_inventario_ejecutar',
  'evidencia_subir', 'evidencia_obtener', 'produccion_registrar',
  'produccion_con_obligatorios_registrar', 'usuarios_guardar', 'usuario_resetear_password',
  'traslado_crear', 'traslado_confirmar', 'traslado_observar', 'traslado_resolver',
  'migrar_recetas_julio_2026', 'base_caja_guardar',
  'caja_abrir', 'caja_rappi_marcar', 'caja_movimiento_registrar', 'caja_cerrar'
]);

const HOY = '2026-07-26';
const SEDE = 'San Antonio';

function parametrosPorAccion() {
  return {
    conteo_listar: { fecha: HOY, sede: SEDE },
    conteos_historial: { filtros: {} },
    turno_sector_hoy: { fecha: HOY },
    turno_faltantes_por_sector: { fecha: HOY, sede: SEDE },
    turno_cierre_estado: { fecha: HOY, sede: SEDE },
    turno_resumen_cierre: { fecha: HOY, sede: SEDE },
    cierres_turno_listar: { filtros: {} },
    base_caja_dia: { fecha: HOY, sede: SEDE },
    caja_estado: { fecha: HOY, sede: SEDE },
    caja_movimientos_listar: { fecha: HOY, sede: SEDE },
    ajustes_inventario_listar: { fecha: HOY, sede: SEDE, filtro: {} },
    ajustes_inventario_historial: { filtros: {} },
    compras_listar: { filtro: {} },
    compras_resumen_gasto: { fecha_desde: '2026-07-01', fecha_hasta: HOY },
    gestiones_listar: { filtro: {} },
    recetas_listar: { filtros: {} },
    produccion_listar: { fecha: HOY, filtro: {} },
    produccion_historial: { filtros: {} },
    traslados_listar: { filtro: {} },
    disponible_hoy: { fecha: HOY, sede: SEDE },
    tendencia_ingrediente: { ingrediente: 'Papa', dias: 30, sede: SEDE },
    conciliacion: { fecha: HOY },
    conciliacion_historial_desfases: { fecha_desde: '2026-07-01', fecha_hasta: HOY },
    movimientos_inventario_listar: { filtros: { fecha_desde: '2026-07-01', fecha_hasta: HOY, sede: SEDE } },
    movimientos_inventario_libro_listar: { filtros: {} },
    movimientos_venta_dia_listar: { fecha: HOY, sede: SEDE },
    resumen_diferencias_inventario: { fecha: HOY, sede: SEDE },
    inventario_ubicacion_resumen: { fecha_desde: '2026-07-01', fecha_hasta: HOY, sede: SEDE, punto: 'Cocina' },
    inventario_teorico_calcular: { producto: 'Papa', sede: SEDE, fecha_corte: HOY },
    inventario_teorico_resumen: { fecha: HOY, sede: SEDE, productos: ['Papa'] },
    fudo_ventas_listar: { filtros: {} },
    fudo_items_listar: { filtros: {} },
    fudo_pagos_listar: { filtros: {} },
    fudo_descuentos_listar: { filtros: {} },
    fudo_propinas_listar: { filtros: {} },
    fudo_subitems_listar: { filtros: {} },
    base_caja_dia: { fecha: HOY, sede: SEDE }
  };
}

function accionesDelRouter() {
  const code = fs.readFileSync('apps-script/Code.gs', 'utf8');
  return [...code.matchAll(/case '([a-z0-9_]+)':/g)].map((m) => m[1]);
}

/** Datos mínimos pero representativos: catálogo, recetas encadenadas, conteos, ventas y ajustes. */
function sembrarDatos(env) {
  env.agregar('Catalogo_Maestro', [
    { id: 'i1', nombre_estandar: 'Papa', categoria: 'Insumos', unidad_base: 'g', tipo: 'insumo', stock_minimo: 500, frecuencia_conteo: 'diario', sede: SEDE },
    // "Banano" nunca se cuenta: solo se compra. Es el caso que hacía escanear el calendario entero.
    { id: 'i2', nombre_estandar: 'Banano', categoria: 'Insumos', unidad_base: 'g', tipo: 'insumo', sede: SEDE },
    { id: 'p1', nombre_estandar: 'Papa Frita', categoria: 'Preparados', unidad_base: 'g', tipo: 'preparado', sede: SEDE },
    { id: 'v1', nombre_estandar: 'Salchipapa', categoria: 'Platos', unidad_base: 'u', tipo: 'plato', sede: SEDE }
  ]);
  env.agregar('Recetas', [
    { id: 'r1', producto: 'Salchipapa', ingrediente: 'Papa Frita', cantidad: 150, unidad: 'g', tipo: 'plato', estado: 'activo' },
    { id: 'r2', producto: 'Papa Frita', ingrediente: 'Papa', cantidad: 1200, unidad: 'g', rendimiento_producto: 1000, unidad_rendimiento: 'g', tipo: 'produccion', estado: 'activo' }
  ]);
  env.agregar('Conteos_Manuales', [
    { id: 'c1', fecha: '2026-07-25', sede: SEDE, punto_conteo: 'Cocina', turno: 'AM', producto: 'Papa', unidad: 'g', cantidad: 20000, usuario: 'Diana', timestamp: new Date(2026, 6, 25, 8) }
  ]);
  env.agregar('Ajustes_Inventario', [
    { id: 'a1', fecha: HOY, sede: SEDE, punto: 'Bodega', tipo: 'Compra cruda', producto: 'Banano', unidad: 'g', cantidad: 5000, usuario: 'Diana', timestamp: new Date(2026, 6, 26, 9), costo: 12000 },
    { id: 'a2', fecha: HOY, sede: SEDE, punto: 'Cocina', tipo: 'Merma / desperdicio', producto: 'Papa', unidad: 'g', cantidad: 500, usuario: 'Diana', timestamp: new Date(2026, 6, 26, 16) }
  ]);
  env.agregar('Producciones', [
    { id: 'pr1', fecha: HOY, sede: SEDE, item: 'Papa Frita', cantidad: 3000, unidad: 'g', usuario: 'Diana', timestamp: new Date(2026, 6, 26, 10) }
  ]);
  env.agregar('Traslados', [
    { id: 't1', fecha: HOY, producto: 'Papa', unidad: 'g', cantidad_enviada: 1000, sede_origen: 'Centro de Producción', punto_origen: 'Bodega', sede_destino: SEDE, punto_destino: 'Cocina', usuario_envia: 'Diana', timestamp_envio: new Date(2026, 6, 26, 11), estado: 'Enviado' }
  ]);
  env.agregar('Fudo_Ventas', [
    { id_venta: 'V1', creacion: new Date(2026, 6, 26, 13), sede: SEDE, items_count: 1, monto_total: 20000, lineas_canceladas: 0 }
  ]);
  env.agregar('Fudo_Items', [
    { id: 'I1', clave_item: 'I1', id_venta: 'V1', creacion: new Date(2026, 6, 26, 13), producto: 'Salchipapa', categoria: 'Platos', cantidad: 2, precio: 10000, cancelada: false, sede: SEDE }
  ]);
  env.agregar('Fudo_Pagos', [
    { id_pago: 'P1', id_venta: 'V1', fecha: new Date(2026, 6, 26, 13), creacion: new Date(2026, 6, 26, 13), monto: 20000, cancelado: false, metodo_pago: 'Efectivo', metodo_tipo: 'CASH', sede: SEDE, es_efectivo: true }
  ]);
}

// --- 1. Instalación nueva: configurarHojas() crea todas las hojas que el código espera ----------

(function () {
  const env = crearEntorno();
  env.ctx.configurarHojas();

  const creadas = env.hojas.map((h) => h.getName());
  const nombresDeHojas = env.evaluar('SHEET_NAMES');
  const declaradas = Object.values(nombresDeHojas);
  declaradas.forEach((nombre) => {
    assert.ok(creadas.includes(nombre), `configurarHojas() debe crear la hoja "${nombre}" declarada en SHEET_NAMES`);
  });
  // Y al revés: ninguna constante de SHEET_NAMES puede quedar sin valor, porque sheet_(undefined)
  // es exactamente el error 'No existe la hoja "undefined"' que veía el usuario.
  Object.keys(nombresDeHojas).forEach((clave) => {
    assert.ok(nombresDeHojas[clave], `SHEET_NAMES.${clave} no puede estar vacío`);
  });
  console.log(`configurarHojas() crea las ${declaradas.length} hojas declaradas: OK`);
})();

// --- 2. sheet_ avisa claramente cuando el nombre llega undefined ---------------------------------

(function () {
  const env = crearEntorno();
  env.ctx.configurarHojas();
  assert.throws(
    () => env.ctx.sheet_(undefined),
    /desactualizado/,
    'sheet_(undefined) debe explicar que el Code.gs desplegado está incompleto, no pedir crear una hoja llamada "undefined"'
  );
  console.log('sheet_(undefined) explica la causa real: OK');
})();

// --- 2b. verificarInstalacion(): el autodiagnóstico que se corre desde el editor -----------------

(function () {
  const env = crearEntorno();
  env.ctx.configurarHojas();
  env.ctx.crearAdministradorInicial_('Diana', 'diana', 'contrasegura1', 'diana@example.com');
  sembrarDatos(env);

  const informe = env.ctx.verificarInstalacion();
  assert.match(informe, /AUTODIAGNÓSTICO DILANA OS/);
  assert.match(informe, /OK — están todas las funciones/);
  assert.match(informe, /OK — existen las \d+ hojas esperadas/);
  assert.match(informe, /TIEMPO REAL DE "DISPONIBLE HOY"/);
  assert.match(informe, /San Antonio: \d+\.\d+ s/, 'debe medir el tiempo real de Disponible Hoy');
  assert.doesNotMatch(informe, /PROBLEMA/, 'una instalación sana no debe reportar problemas');

  // Y con una hoja borrada a mano, tiene que decir cuál falta y qué hacer.
  const gestiones = env.hoja('Gestiones');
  env.spreadsheet.deleteSheet(gestiones);
  const informeRoto = env.ctx.verificarInstalacion();
  assert.match(informeRoto, /faltan estas hojas: Gestiones/);
  assert.match(informeRoto, /configurarHojas\(\)/);
  console.log('verificarInstalacion() informa el estado y detecta una hoja faltante: OK');
})();

// --- 2c. El autodiagnóstico detecta un Code.gs desactualizado ------------------------------------

(function () {
  const env = crearEntorno();
  env.ctx.configurarHojas();
  env.ctx.crearAdministradorInicial_('Diana', 'diana', 'contrasegura1', 'diana@example.com');
  sembrarDatos(env);

  // Simula el caso real: el proyecto desplegado tiene los módulos nuevos pero un Code.gs viejo,
  // sin las funciones que esos módulos esperan encontrar. Se sobrescribe en vez de borrar porque
  // una función declarada en el ámbito global no es configurable y `delete` no la quita.
  env.ctx.conCacheDeTablas_ = undefined;
  const informe = env.ctx.verificarInstalacion();
  assert.match(informe, /faltan estas funciones/);
  assert.match(informe, /conCacheDeTablas_/);
  assert.match(informe, /clasp push/, 'debe decir cómo se arregla, no solo que falta algo');
  console.log('verificarInstalacion() detecta un Code.gs desactualizado: OK');
})();

// --- 3. Ruta de actualización: hojas viejas, con datos y con menos columnas ----------------------

(function () {
  const env = crearEntorno();
  // Una instalación anterior: solo algunas hojas, con las columnas de entonces.
  const vieja = (nombre, cabeceras, filas) => {
    const sh = env.spreadsheet.insertSheet(nombre);
    sh.getRange(1, 1, 1, cabeceras.length).setValues([cabeceras]);
    filas.forEach((f) => sh.appendRow(f));
  };
  vieja('Usuarios', ['id', 'nombre', 'usuario', 'password_hash', 'salt', 'rol', 'sede', 'activo', 'email'], []);
  vieja('Catalogo_Maestro', ['id', 'nombre_estandar', 'nombre_fudo', 'categoria', 'unidad_base', 'tipo', 'notas'],
    [['i1', 'Papa', 'PAPA', 'Insumos', 'g', 'insumo', 'nota vieja']]);
  vieja('Conteos_Manuales', ['id', 'fecha', 'sede', 'punto_conteo', 'turno', 'producto', 'unidad', 'cantidad', 'usuario', 'timestamp'],
    [['c1', '2026-07-25', SEDE, 'Cocina', 'AM', 'Papa', 'g', 20000, 'Diana', new Date(2026, 6, 25, 8)]]);
  vieja('Sesiones', ['token', 'usuario_id', 'creado_en', 'expira_en'], []);

  env.ctx.configurarHojas();

  Object.values(env.evaluar('SHEET_NAMES')).forEach((nombre) => {
    assert.ok(env.hoja(nombre), `tras actualizar debe existir la hoja "${nombre}"`);
  });

  // Las columnas nuevas se agregan sin dejar cabeceras vacías (una cabecera '' rompería el mapeo
  // nombre->columna de leerTabla_/appendRowFromObj_).
  ['Catalogo_Maestro', 'Usuarios', 'Conteos_Manuales'].forEach((nombre) => {
    const sh = env.hoja(nombre);
    const cabeceras = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
    assert.ok(
      cabeceras.every((c) => c !== '' && c !== null),
      `"${nombre}" no debe quedar con cabeceras vacías tras actualizar: ${JSON.stringify(cabeceras)}`
    );
  });

  // Y los datos que ya estaban siguen alineados con su columna.
  const catalogo = env.ctx.leerTabla_('Catalogo_Maestro');
  assert.equal(catalogo[0].nombre_estandar, 'Papa');
  assert.equal(catalogo[0].notas, 'nota vieja');
  const conteos = env.ctx.leerTabla_('Conteos_Manuales');
  assert.equal(conteos[0].cantidad, 20000);
  assert.equal(conteos[0].sede, SEDE);
  console.log('la actualización de un Sheet viejo conserva los datos y no deja cabeceras vacías: OK');
})();

// --- 4. Login y recorrido de TODAS las acciones de lectura del router ---------------------------

(function () {
  const env = crearEntorno();
  env.ctx.configurarHojas();
  env.ctx.crearAdministradorInicial_('Diana', 'diana', 'contrasegura1', 'diana@example.com');
  sembrarDatos(env);

  const login = env.post({ action: 'login', usuario: 'diana', password: 'contrasegura1' });
  assert.ok(login.ok, 'el login debe funcionar: ' + JSON.stringify(login));
  assert.equal(login.usuario.rol, 'Administrador');
  const token = login.token;

  const params = parametrosPorAccion();
  const fallos = [];
  let probadas = 0;
  accionesDelRouter().forEach((accion) => {
    if (ACCIONES_OMITIDAS.has(accion)) return;
    probadas++;
    const r = env.post(Object.assign({ action: accion, token }, params[accion] || {}));
    if (!r.ok) fallos.push(`${accion} -> ${r.error}`);
  });
  assert.deepEqual(fallos, [], 'ninguna acción de lectura debe fallar con un Sheet recién configurado');
  assert.ok(probadas >= 40, `se esperaban al menos 40 acciones de lectura probadas, fueron ${probadas}`);
  console.log(`${probadas} acciones de lectura del router responden ok: OK`);

  // Una acción inexistente debe responder un error claro, no reventar.
  const desconocida = env.post({ action: 'no_existe_esta_accion', token });
  assert.equal(desconocida.ok, false);
  assert.match(desconocida.error, /Acción desconocida/);

  // Y sin token no se puede leer nada.
  const sinToken = env.post({ action: 'catalogo_listar' });
  assert.equal(sinToken.ok, false);
  console.log('acción desconocida y falta de token se responden sin excepción: OK');
})();

// --- 5. Presupuesto de lecturas al Sheet por acción ---------------------------------------------
// Apps Script corta a los 6 minutos y cada leerTabla_ es una llamada a la API de Sheets. Estos
// topes son holgados a propósito: no buscan afinar milisegundos, sino delatar el patrón "una
// lectura del Sheet completo por cada día del calendario", que fue lo que dejó el dashboard sin
// poder abrir (disponible_hoy llegaba a ~62.000 lecturas por cada producto sin conteo previo).

(function () {
  const env = crearEntorno();
  env.ctx.configurarHojas();
  env.ctx.crearAdministradorInicial_('Diana', 'diana', 'contrasegura1', 'diana@example.com');
  sembrarDatos(env);
  const token = env.post({ action: 'login', usuario: 'diana', password: 'contrasegura1' }).token;

  const TOPES = {
    disponible_hoy: 40,
    tendencia_ingrediente: 40,
    conciliacion: 40,
    turno_resumen_cierre: 40,
    resumen_diferencias_inventario: 40,
    movimientos_inventario_listar: 40,
    conciliacion_historial_desfases: 40,
    inventario_teorico_resumen: 40,
    fudo_panel_estado: 40
  };
  const params = parametrosPorAccion();

  Object.keys(TOPES).forEach((accion) => {
    env.reiniciarStats();
    const r = env.post(Object.assign({ action: accion, token }, params[accion] || {}));
    assert.ok(r.ok, `${accion} debe responder ok: ${r.error}`);
    const lecturas = env.stats.lecturas;
    assert.ok(
      lecturas <= TOPES[accion],
      `${accion} costó ${lecturas} lecturas al Sheet (tope ${TOPES[accion]}). ` +
      `Detalle: ${JSON.stringify(env.stats.porHoja)}`
    );
  });
  console.log('ninguna acción de lectura supera su presupuesto de lecturas al Sheet: OK');
})();

console.log('integracion-api: OK');
