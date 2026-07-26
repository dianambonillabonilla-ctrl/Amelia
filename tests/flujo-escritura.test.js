/**
 * FLUJO COMPLETO DE ESCRITURA — un día de operación de punta a punta (offline)
 *
 * Las demás pruebas de integración solo LEEN, y la prueba contra el despliegue real
 * (tests/api-desplegada.js) tampoco escribe a propósito, para poder correrla sobre producción sin
 * riesgo. Eso deja sin cubrir justo la mitad que más le importa al personal: registrar cosas.
 *
 * Aquí se recorre un día entero por `doPost`, como lo haría la app: crear productos y recetas,
 * elegir sector, contar, comprar, producir, trasladar y recibir, registrar una merma, abrir y
 * resolver una gestión, y cerrar el turno. Después se comprueba que "Disponible Hoy" refleje todo
 * lo registrado, que es lo que de verdad ve el usuario.
 *
 * También cubre las reglas que protegen los datos y que solo se pueden ver escribiendo:
 * idempotencia (doble clic no duplica), permisos por sede y por rol, y validaciones de cantidad.
 */
const assert = require('assert');
const { crearEntorno } = require('./helpers/entorno-apps-script.js');

const HOY = '2026-07-26';
const SEDE = 'San Antonio';
const OTRA_SEDE = 'Capri';

function nuevoEntornoConAdmin() {
  const env = crearEntorno();
  env.ctx.configurarHojas();
  env.ctx.crearAdministradorInicial_('Diana', 'diana', 'contrasegura1', 'diana@example.com');
  const login = env.post({ action: 'login', usuario: 'diana', password: 'contrasegura1' });
  assert.ok(login.ok, 'el administrador inicial debe poder entrar: ' + JSON.stringify(login));
  return { env, token: login.token, usuario: login.usuario };
}

/** Envuelve post() para que un `ok:false` inesperado falle con el error real, no con `undefined`. */
function exigir(env, cuerpo, queHace) {
  const r = env.post(cuerpo);
  assert.ok(r.ok, `${queHace} debió funcionar, respondió: ${JSON.stringify(r).slice(0, 300)}`);
  return r;
}

// --- 1. Un día completo de operación -------------------------------------------------------------

(function () {
  const { env, token } = nuevoEntornoConAdmin();
  const p = (cuerpo) => Object.assign({ token }, cuerpo);

  // Catálogo: un insumo crudo, un preparado y un plato vendible.
  exigir(env, p({ action: 'catalogo_guardar', item: { nombre_estandar: 'Papa', categoria: 'Insumos', unidad_base: 'g', tipo: 'insumo', stock_minimo: 2000, frecuencia_conteo: 'diario', sede: SEDE } }), 'crear el insumo');
  exigir(env, p({ action: 'catalogo_guardar', item: { nombre_estandar: 'Papa Frita', categoria: 'Preparados', unidad_base: 'g', tipo: 'preparado', sede: SEDE } }), 'crear el preparado');
  exigir(env, p({ action: 'catalogo_guardar', item: { nombre_estandar: 'Salchipapa', categoria: 'Platos', unidad_base: 'u', tipo: 'plato', sede: SEDE } }), 'crear el plato');

  const catalogo = exigir(env, p({ action: 'catalogo_listar' }), 'listar el catálogo').data;
  assert.equal(catalogo.length, 3, 'el catálogo debe tener los 3 productos creados');
  assert.ok(catalogo.every((c) => c.id), 'cada producto del catálogo debe quedar con id');

  // Recetas encadenadas: el plato gasta preparado, y el preparado gasta el insumo crudo.
  exigir(env, p({ action: 'receta_guardar', item: { producto: 'Salchipapa', ingrediente: 'Papa Frita', cantidad: 150, unidad: 'g', tipo: 'plato', estado: 'activo' } }), 'guardar la receta del plato');
  exigir(env, p({ action: 'receta_guardar', item: { producto: 'Papa Frita', ingrediente: 'Papa', cantidad: 1200, unidad: 'g', rendimiento_producto: 1000, unidad_rendimiento: 'g', tipo: 'produccion', estado: 'activo' } }), 'guardar la subreceta');

  const recetas = exigir(env, p({ action: 'recetas_listar', filtros: {} }), 'listar recetas').data;
  assert.equal(recetas.length, 2);

  // Conteo físico de la mañana: 20 kg de papa cruda.
  const conteo = exigir(env, p({
    action: 'conteo_registrar',
    items: [{ fecha: HOY, sede: SEDE, punto_conteo: 'Cocina', producto: 'Papa', unidad: 'kg', cantidad: 20 }]
  }), 'registrar el conteo');
  assert.equal(conteo.registrados, 1, 'debe registrar 1 conteo');

  // Volver a guardar el MISMO conteo con otra cantidad corrige la fila, no crea una segunda.
  const correccion = exigir(env, p({
    action: 'conteo_registrar',
    items: [{ fecha: HOY, sede: SEDE, punto_conteo: 'Cocina', producto: 'Papa', unidad: 'kg', cantidad: 22 }]
  }), 'corregir el conteo');
  assert.equal(correccion.actualizados, 1, 'el segundo envío del mismo conteo debe ACTUALIZAR, no duplicar');
  const conteosDelDia = exigir(env, p({ action: 'conteo_listar', fecha: HOY, sede: SEDE }), 'listar conteos del día').data;
  assert.equal(conteosDelDia.length, 1, 'no puede haber dos filas para el mismo producto/punto/turno');
  assert.equal(Number(conteosDelDia[0].cantidad), 22);

  // Compra con factura: entran 5 kg más de papa.
  const compra = exigir(env, p({
    action: 'compra_registrar_factura',
    factura: {
      fecha: HOY, proveedor: 'Distribuidora El Campo', numero_factura: 'F-1001', sede: SEDE,
      lineas: [{ producto: 'Papa', unidad: 'kg', cantidad: 5, costo: 18000 }]
    }
  }), 'registrar la factura de compra');
  assert.ok(compra.factura_id, 'la compra debe devolver un factura_id');

  // La misma factura otra vez (doble clic) no debe duplicar el inventario.
  const compraRepetida = env.post(p({
    action: 'compra_registrar_factura',
    factura: {
      fecha: HOY, proveedor: 'Distribuidora El Campo', numero_factura: 'F-1001', sede: SEDE,
      lineas: [{ producto: 'Papa', unidad: 'kg', cantidad: 5, costo: 18000 }]
    }
  }));
  const comprasRegistradas = exigir(env, p({ action: 'compras_listar', filtro: {} }), 'listar compras').data;
  assert.equal(
    comprasRegistradas.filter((c) => c.numero_factura === 'F-1001').length, 1,
    'la misma factura no puede entrar dos veces al inventario: ' + JSON.stringify(compraRepetida).slice(0, 200)
  );

  // Producción: se preparan 3 kg de papa frita gastando 3,6 kg de papa cruda.
  const produccion = exigir(env, p({
    action: 'produccion_registrar',
    items: [{
      fecha: HOY, sede: SEDE, item: 'Papa Frita', cantidad: 3, unidad: 'kg',
      insumo_producto: 'Papa', insumo_cantidad: 3.6, insumo_unidad: 'kg'
    }],
    opciones: { request_id: 'req-produccion-1' }
  }), 'registrar la producción');
  assert.equal(produccion.registrados, 1);

  // El mismo request_id (reintento de red o doble clic) no vuelve a registrar.
  const produccionRepetida = exigir(env, p({
    action: 'produccion_registrar',
    items: [{ fecha: HOY, sede: SEDE, item: 'Papa Frita', cantidad: 3, unidad: 'kg' }],
    opciones: { request_id: 'req-produccion-1' }
  }), 'reintentar la producción con el mismo request_id');
  assert.equal(produccionRepetida.repetido, true, 'el mismo request_id debe reconocerse como repetido');
  const producciones = exigir(env, p({ action: 'produccion_listar', fecha: HOY, filtro: {} }), 'listar producciones').data;
  assert.equal(producciones.length, 1, 'no puede quedar producción duplicada');

  // Merma: se botan 500 g de papa.
  exigir(env, p({
    action: 'ajuste_inventario_registrar',
    item: { fecha: HOY, sede: SEDE, punto: 'Cocina', tipo: 'Merma / desperdicio', producto: 'Papa', unidad: 'g', cantidad: 500, motivo: 'Se pasó de cocción' }
  }), 'registrar la merma');

  // Traslado desde el Centro de Producción, y su recepción.
  const traslado = exigir(env, p({
    action: 'traslado_crear',
    item: { fecha: HOY, producto: 'Papa', unidad: 'kg', cantidad: 4, sede_origen: 'Centro de Producción', punto_origen: 'Bodega', sede_destino: SEDE, punto_destino: 'Cocina' }
  }), 'crear el traslado');
  assert.ok(traslado.id);

  const pendientes = exigir(env, p({ action: 'traslados_listar', filtro: { estado: 'Enviado' } }), 'listar traslados enviados').data;
  assert.equal(pendientes.length, 1, 'el traslado debe quedar pendiente de aceptar');

  exigir(env, p({ action: 'traslado_confirmar', id: traslado.id, cantidad_recibida: 3.8 }), 'confirmar el traslado');
  const trasladosTras = exigir(env, p({ action: 'traslados_listar', filtro: {} }), 'listar traslados').data;
  const confirmado = trasladosTras.find((t) => t.id === traslado.id);
  assert.equal(confirmado.estado, 'Confirmado');
  assert.equal(Number(confirmado.cantidad_recibida), 3.8, 'debe guardar lo REALMENTE recibido, no lo enviado');

  // Gestión de faltante: se abre y se marca como pedida.
  const gestion = exigir(env, p({ action: 'gestion_crear', item: { producto: 'Papa', sede: SEDE, nota: 'Se está acabando' } }), 'abrir la gestión');
  exigir(env, p({ action: 'gestion_actualizar_estado', id: gestion.id, estado: 'Pedido realizado', nota: 'Ya se llamó al proveedor' }), 'actualizar la gestión');
  const abiertas = exigir(env, p({ action: 'gestiones_listar', filtro: { estado: 'abiertas' } }), 'listar gestiones abiertas').data;
  assert.equal(abiertas.length, 1);
  assert.equal(abiertas[0].estado, 'Pedido realizado');

  // "Disponible Hoy" tiene que reflejar TODO lo anterior.
  const disponible = exigir(env, p({ action: 'disponible_hoy', fecha: HOY, sede: SEDE }), 'consultar Disponible Hoy').data;
  const papa = disponible.stock_ingredientes.papa;
  assert.ok(papa, 'la papa debe aparecer en Disponible Hoy');

  // 22 kg contados + 5 kg comprados + 3,8 kg recibidos - 0,5 kg de merma = 30,3 kg = 30300 g.
  // La papa consumida al producir NO se resta todavía: hoy solo el próximo conteo físico lo refleja
  // (limitación documentada en DisponibleHoy.gs, no un fallo de esta prueba).
  assert.equal(papa.unidad, 'g', 'todo debe quedar normalizado a la unidad base');
  assert.equal(
    Math.round(papa.cantidad), 30300,
    `la papa debía quedar en 30300 g (22000 contados + 5000 comprados + 3800 recibidos - 500 de merma), quedó en ${papa.cantidad}`
  );

  const salchipapa = disponible.platos.find((x) => x.producto === 'Salchipapa');
  assert.ok(salchipapa, 'el plato con receta debe aparecer en "¿Para cuántos platos alcanza?"');
  assert.ok(salchipapa.preparaciones_posibles > 0, 'con 30 kg de papa deben alcanzar varias salchipapas');

  console.log(`día completo de operación: OK (papa en ${papa.cantidad} g, ${salchipapa.preparaciones_posibles} salchipapas posibles)`);
})();

// --- 2. Cierre de turno ---------------------------------------------------------------------------

(function () {
  const { env, token } = nuevoEntornoConAdmin();
  const p = (cuerpo) => Object.assign({ token }, cuerpo);

  exigir(env, p({ action: 'catalogo_guardar', item: { nombre_estandar: 'Papa', unidad_base: 'g', tipo: 'insumo', frecuencia_conteo: 'diario', sede: SEDE } }), 'crear producto');
  exigir(env, p({ action: 'conteo_registrar', items: [{ fecha: HOY, sede: SEDE, punto_conteo: 'Cocina', producto: 'Papa', unidad: 'kg', cantidad: 10 }] }), 'contar');

  const antes = exigir(env, p({ action: 'turno_cierre_estado', fecha: HOY, sede: SEDE }), 'consultar estado de cierre');
  assert.equal(antes.cerrado, false, 'el turno no puede estar cerrado antes de cerrarlo');

  const resumen = exigir(env, p({ action: 'turno_resumen_cierre', fecha: HOY, sede: SEDE }), 'pedir el resumen de cierre');
  assert.ok('ventas_fudo_total' in resumen, 'el resumen debe traer el total de ventas de FUDO');
  assert.ok('pagos_efectivo_esperado' in resumen, 'y el efectivo esperado, para comparar con la caja');

  const cierre = exigir(env, p({
    action: 'turno_cerrar', fecha: HOY, sede: SEDE,
    datos_cierre: { efectivo_contado: 150000, observaciones: 'Todo cuadró' }
  }), 'cerrar el turno');
  assert.ok(cierre.ok);

  const despues = exigir(env, p({ action: 'turno_cierre_estado', fecha: HOY, sede: SEDE }), 'consultar estado tras cerrar');
  assert.equal(despues.cerrado, true, 'el turno debe quedar cerrado');
  assert.equal(Number(despues.efectivo_contado), 150000, 'debe guardar el efectivo contado');

  // El histórico guarda el resumen del momento del cierre, no lo recalcula después.
  const historico = exigir(env, p({ action: 'cierres_turno_listar', filtros: {} }), 'listar cierres').data;
  assert.equal(historico.length, 1);
  assert.equal(historico[0].sede, SEDE);
  assert.equal(historico[0].observaciones, 'Todo cuadró');
  console.log('cierre de turno se guarda y queda en el histórico: OK');
})();

// --- 3. Permisos: nadie escribe en una sede que no es la suya -------------------------------------

(function () {
  const { env, token } = nuevoEntornoConAdmin();
  const p = (cuerpo) => Object.assign({ token }, cuerpo);

  // Un usuario de Cocina limitado a San Antonio.
  exigir(env, p({
    action: 'usuarios_guardar',
    item: { nombre: 'Rafa', usuario: 'rafa', password: 'claveSegura99', rol: 'Cocina', sede: SEDE, activo: true, sectores_permitidos: 'Cocina' }
  }), 'crear el usuario de Cocina');

  const loginRafa = env.post({ action: 'login', usuario: 'rafa', password: 'claveSegura99' });
  assert.ok(loginRafa.ok, 'el usuario nuevo debe poder entrar: ' + JSON.stringify(loginRafa));
  const tokenRafa = loginRafa.token;

  // En su propia sede sí puede registrar.
  const propia = env.post({
    action: 'conteo_registrar', token: tokenRafa,
    items: [{ fecha: HOY, sede: SEDE, punto_conteo: 'Cocina', producto: 'Papa', unidad: 'kg', cantidad: 5 }]
  });
  assert.ok(propia.ok, 'debe poder contar en su sede: ' + JSON.stringify(propia));

  // En la otra sede, no.
  const ajena = env.post({
    action: 'conteo_registrar', token: tokenRafa,
    items: [{ fecha: HOY, sede: OTRA_SEDE, punto_conteo: 'Cocina', producto: 'Papa', unidad: 'kg', cantidad: 5 }]
  });
  assert.equal(ajena.ok, false, 'no debe poder contar en una sede ajena');
  assert.match(ajena.error, /sede distinta/i);

  // Centro de Producción es la excepción explícita: cualquiera puede registrar ahí.
  const centro = env.post({
    action: 'conteo_registrar', token: tokenRafa,
    items: [{ fecha: HOY, sede: 'Centro de Producción', punto_conteo: 'Bodega', producto: 'Papa', unidad: 'kg', cantidad: 5 }]
  });
  assert.ok(centro.ok, 'Centro de Producción debe estar permitido para cualquier sede: ' + JSON.stringify(centro));

  // Y no puede tocar lo que es solo de Administrador.
  const soloAdmin = env.post({ action: 'usuarios_listar', token: tokenRafa });
  assert.equal(soloAdmin.ok, false, 'Cocina no debe poder listar usuarios');

  const cerrarTurno = env.post({ action: 'turno_cerrar', token: tokenRafa, fecha: HOY, sede: SEDE, datos_cierre: {} });
  assert.equal(cerrarTurno.ok, false, 'Cocina no debe poder cerrar el turno (no tiene el sector Caja)');
  console.log('permisos por sede y por rol se respetan al escribir: OK');
})();

// --- 4. Validaciones: los datos que no tienen sentido se rechazan ---------------------------------

(function () {
  const { env, token } = nuevoEntornoConAdmin();
  const p = (cuerpo) => Object.assign({ token }, cuerpo);

  const casos = [
    ['un conteo sin producto', { action: 'conteo_registrar', items: [{ fecha: HOY, sede: SEDE, unidad: 'kg', cantidad: 5 }] }],
    ['un conteo con cantidad negativa', { action: 'conteo_registrar', items: [{ fecha: HOY, sede: SEDE, producto: 'Papa', unidad: 'kg', cantidad: -3 }] }],
    ['una producción con cantidad cero', { action: 'produccion_registrar', items: [{ fecha: HOY, sede: SEDE, item: 'Papa Frita', unidad: 'kg', cantidad: 0 }] }],
    ['una producción con el insumo a medias', { action: 'produccion_registrar', items: [{ fecha: HOY, sede: SEDE, item: 'Papa Frita', unidad: 'kg', cantidad: 2, insumo_producto: 'Papa' }] }],
    ['una factura sin número', { action: 'compra_registrar_factura', factura: { fecha: HOY, proveedor: 'X', sede: SEDE, lineas: [{ producto: 'Papa', unidad: 'kg', cantidad: 1 }] } }],
    ['una factura sin líneas', { action: 'compra_registrar_factura', factura: { fecha: HOY, proveedor: 'X', numero_factura: 'F-2', sede: SEDE, lineas: [] } }],
    ['una compra con cantidad cero', { action: 'compra_registrar_factura', factura: { fecha: HOY, proveedor: 'X', numero_factura: 'F-3', sede: SEDE, lineas: [{ producto: 'Papa', unidad: 'kg', cantidad: 0 }] } }],
    ['un traslado al mismo sitio', { action: 'traslado_crear', item: { producto: 'Papa', unidad: 'kg', cantidad: 1, sede_origen: SEDE, punto_origen: 'Cocina', sede_destino: SEDE, punto_destino: 'Cocina' } }],
    ['un traslado con cantidad negativa', { action: 'traslado_crear', item: { producto: 'Papa', unidad: 'kg', cantidad: -1, sede_origen: 'Centro de Producción', sede_destino: SEDE } }],
    ['una receta sin cantidad', { action: 'receta_guardar', item: { producto: 'Salchipapa', ingrediente: 'Papa', unidad: 'g' } }],
    ['una gestión sin sede', { action: 'gestion_crear', item: { producto: 'Papa' } }],
    ['una gestión con estado inventado', { action: 'gestion_actualizar_estado', id: 'x', estado: 'Cualquier cosa' }],
    ['un producto de catálogo sin nombre', { action: 'catalogo_guardar', item: { categoria: 'Insumos' } }]
  ];

  casos.forEach(([descripcion, cuerpo]) => {
    const r = env.post(p(cuerpo));
    assert.equal(r.ok, false, `${descripcion} NO debió aceptarse, respondió: ${JSON.stringify(r).slice(0, 200)}`);
    assert.ok(r.error && r.error.length > 5, `${descripcion} debe explicar por qué se rechaza, dijo: ${r.error}`);
  });
  console.log(`${casos.length} datos inválidos se rechazan con un mensaje claro: OK`);
})();

// --- 5. Texto libre no puede convertirse en fórmula de Sheets -------------------------------------

(function () {
  const { env, token } = nuevoEntornoConAdmin();
  const p = (cuerpo) => Object.assign({ token }, cuerpo);

  // Un campo libre que empieza con '=' lo interpretaría Sheets como fórmula al abrir la hoja.
  exigir(env, p({
    action: 'ajuste_inventario_registrar',
    item: { fecha: HOY, sede: SEDE, punto: 'Cocina', tipo: 'Merma / desperdicio', producto: 'Papa', unidad: 'g', cantidad: 100, motivo: '=HYPERLINK("http://malo","clic")' }
  }), 'registrar una merma con un motivo que parece fórmula');

  const filas = exigir(env, p({ action: 'ajustes_inventario_listar', fecha: HOY, sede: SEDE, filtro: {} }), 'listar ajustes').data;
  assert.equal(filas.length, 1);
  assert.ok(
    String(filas[0].motivo).startsWith("'="),
    `el motivo debía guardarse neutralizado con una comilla delante, se guardó: ${filas[0].motivo}`
  );
  console.log('el texto libre se guarda neutralizado y Sheets no lo evalúa: OK');
})();

// --- 6. Auditoría: las escrituras sensibles quedan registradas ------------------------------------

(function () {
  const { env, token } = nuevoEntornoConAdmin();
  const p = (cuerpo) => Object.assign({ token }, cuerpo);

  exigir(env, p({ action: 'catalogo_guardar', item: { nombre_estandar: 'Papa', unidad_base: 'g', tipo: 'insumo', sede: SEDE } }), 'crear producto');
  exigir(env, p({ action: 'conteo_registrar', items: [{ fecha: HOY, sede: SEDE, punto_conteo: 'Cocina', producto: 'Papa', unidad: 'kg', cantidad: 10 }] }), 'contar');
  exigir(env, p({ action: 'conteo_registrar', items: [{ fecha: HOY, sede: SEDE, punto_conteo: 'Cocina', producto: 'Papa', unidad: 'kg', cantidad: 12 }] }), 'corregir el conteo');

  // Corregir un conteo ya guardado es justo el caso que hay que poder rastrear después.
  const eventos = env.ctx.leerTabla_('Auditoria_Eventos');
  assert.ok(eventos.length > 0, 'corregir un conteo debe dejar rastro en Auditoria_Eventos');
  const evento = eventos[eventos.length - 1];
  assert.ok(evento.usuario_nombre, 'el evento de auditoría debe decir quién lo hizo');
  assert.ok(evento.accion, 'y qué hizo');
  console.log(`las correcciones dejan rastro en auditoría: OK (${eventos.length} evento(s))`);
})();

console.log('flujo-escritura: OK');
