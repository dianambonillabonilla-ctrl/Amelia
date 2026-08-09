/**
 * Cantidades raras, de punta a punta a través del router real (a diferencia de
 * tests/cantidades-raras.test.js, que solo prueba las funciones puras de CantidadesRaras.gs, y de
 * tests/inventory-controls.test.js, que carga cada .gs aislado con esa parte mockeada a propósito).
 * Aquí se confirma que Conteos.gs, AjustesInventario.gs, Produccion.gs y Traslados.gs de verdad
 * devuelven `requiere_confirmacion` cuando algo se ve raro, y que reenviar con
 * `opciones.confirmar_cantidades_raras:true` sí guarda — el ida y vuelta real que hace el frontend.
 */
const assert = require('assert');
const { crearEntorno } = require('./helpers/entorno-apps-script.js');

function envConAdmin() {
  const env = crearEntorno();
  env.ctx.configurarHojas();
  env.ctx.crearAdministradorInicial_('Diana', 'diana', 'contrasegura1', 'diana@example.com');
  const token = env.post({ action: 'login', usuario: 'diana', password: 'contrasegura1' }).token;
  return { env, token };
}

(function conteoRegistrarPideConfirmacionYLuegoGuarda() {
  const { env, token } = envConAdmin();
  env.agregar('Conteos_Manuales', [
    { id: 'k1', fecha: '2026-08-01', sede: 'San Antonio', punto_conteo: 'General', turno: 'Cierre', producto: 'Sal Marina', unidad: 'g', cantidad: 500 },
    { id: 'k2', fecha: '2026-08-02', sede: 'San Antonio', punto_conteo: 'General', turno: 'Cierre', producto: 'Sal Marina', unidad: 'g', cantidad: 480 },
    { id: 'k3', fecha: '2026-08-03', sede: 'San Antonio', punto_conteo: 'General', turno: 'Cierre', producto: 'Sal Marina', unidad: 'g', cantidad: 520 }
  ]);
  const items = [{ fecha: '2026-08-08', sede: 'San Antonio', punto_conteo: 'General', producto: 'Sal Marina', unidad: 'kg', cantidad: 6 }]; // 6 kg = 6000 g, error de tecleo típico

  const primero = env.post({ action: 'conteo_registrar', token, items });
  assert.strictEqual(primero.ok, false);
  assert.strictEqual(primero.requiere_confirmacion, true);
  assert.strictEqual(primero.cantidades_raras.length, 1);
  assert.strictEqual(primero.cantidades_raras[0].producto, 'Sal Marina');

  const segundo = env.post({ action: 'conteo_registrar', token, items, opciones: { confirmar_cantidades_raras: true } });
  assert.strictEqual(segundo.ok, true, 'con la confirmación sí debe guardar: ' + JSON.stringify(segundo));
  assert.strictEqual(segundo.registrados, 1);
  console.log('conteo_registrar pide confirmación y luego guarda: OK');
})();

(function compraRegistrarFacturaPideConfirmacionYLuegoGuarda() {
  const { env, token } = envConAdmin();
  env.agregar('Ajustes_Inventario', [
    { id: 'a1', fecha: '2026-08-01', sede: 'San Antonio', punto: 'Bodega', tipo: 'Compra cruda', producto: 'Aceite Girasol', unidad: 'g', cantidad: 5000 },
    { id: 'a2', fecha: '2026-08-02', sede: 'San Antonio', punto: 'Bodega', tipo: 'Compra cruda', producto: 'Aceite Girasol', unidad: 'g', cantidad: 4800 },
    { id: 'a3', fecha: '2026-08-03', sede: 'San Antonio', punto: 'Bodega', tipo: 'Compra cruda', producto: 'Aceite Girasol', unidad: 'g', cantidad: 5200 }
  ]);
  const factura = {
    fecha: '2026-08-08', proveedor: 'Mercamío', numero_factura: 'F-001', sede: 'San Antonio',
    lineas: [{ producto: 'Aceite Girasol', unidad: 'g', cantidad: 90000, costo: 20000 }]
  };

  const primero = env.post({ action: 'compra_registrar_factura', token, factura });
  assert.strictEqual(primero.ok, false);
  assert.strictEqual(primero.requiere_confirmacion, true);
  assert.strictEqual(primero.cantidades_raras[0].producto, 'Aceite Girasol');

  const segundo = env.post({ action: 'compra_registrar_factura', token, factura, opciones: { confirmar_cantidades_raras: true } });
  assert.strictEqual(segundo.ok, true, 'con la confirmación sí debe guardar: ' + JSON.stringify(segundo));
  console.log('compra_registrar_factura pide confirmación y luego guarda: OK');
})();

(function ajusteInventarioRegistrarPideConfirmacionYLuegoGuarda() {
  const { env, token } = envConAdmin();
  env.agregar('Ajustes_Inventario', [
    { id: 'a1', fecha: '2026-08-01', sede: 'San Antonio', punto: 'Bodega', tipo: 'Compra cruda', producto: 'Papa', unidad: 'g', cantidad: 5000 },
    { id: 'a2', fecha: '2026-08-02', sede: 'San Antonio', punto: 'Bodega', tipo: 'Compra cruda', producto: 'Papa', unidad: 'g', cantidad: 4800 },
    { id: 'a3', fecha: '2026-08-03', sede: 'San Antonio', punto: 'Bodega', tipo: 'Compra cruda', producto: 'Papa', unidad: 'g', cantidad: 5200 }
  ]);
  const item = { fecha: '2026-08-08', sede: 'San Antonio', punto: 'Bodega', tipo: 'Compra cruda', producto: 'Papa', unidad: 'g', cantidad: 90000, motivo: 'Compra semanal' };

  const primero = env.post({ action: 'ajuste_inventario_registrar', token, item });
  assert.strictEqual(primero.ok, false);
  assert.strictEqual(primero.requiere_confirmacion, true);

  const segundo = env.post({ action: 'ajuste_inventario_registrar', token, item, opciones: { confirmar_cantidades_raras: true } });
  assert.strictEqual(segundo.ok, true, 'con la confirmación sí debe guardar: ' + JSON.stringify(segundo));
  console.log('ajuste_inventario_registrar pide confirmación y luego guarda: OK');
})();

(function produccionRegistrarRevisaTantoElTerminadoComoElInsumo() {
  const { env, token } = envConAdmin();
  env.agregar('Producciones', [
    { id: 'p1', fecha: '2026-08-01', sede: 'Centro de Producción', item: 'Costilla Preparada', cantidad: 5000, unidad: 'g', insumo_producto: 'Costilla San Luis Entera', insumo_cantidad: 7000, insumo_unidad: 'g' },
    { id: 'p2', fecha: '2026-08-02', sede: 'Centro de Producción', item: 'Costilla Preparada', cantidad: 5200, unidad: 'g', insumo_producto: 'Costilla San Luis Entera', insumo_cantidad: 7200, insumo_unidad: 'g' },
    { id: 'p3', fecha: '2026-08-03', sede: 'Centro de Producción', item: 'Costilla Preparada', cantidad: 4900, unidad: 'g', insumo_producto: 'Costilla San Luis Entera', insumo_cantidad: 6900, insumo_unidad: 'g' }
  ]);
  // El terminado se ve normal, pero el insumo consumido tiene un cero de más.
  const items = [{ fecha: '2026-08-08', sede: 'Centro de Producción', item: 'Costilla Preparada', cantidad: 5100, unidad: 'g', insumo_producto: 'Costilla San Luis Entera', insumo_cantidad: 700000, insumo_unidad: 'g' }];

  const primero = env.post({ action: 'produccion_registrar', token, items });
  assert.strictEqual(primero.ok, false);
  assert.strictEqual(primero.requiere_confirmacion, true);
  assert.strictEqual(primero.cantidades_raras[0].producto, 'Costilla San Luis Entera');

  const segundo = env.post({ action: 'produccion_registrar', token, items, opciones: { confirmar_cantidades_raras: true } });
  assert.strictEqual(segundo.ok, true, 'con la confirmación sí debe guardar: ' + JSON.stringify(segundo));
  console.log('produccion_registrar revisa tanto el terminado como el insumo: OK');
})();

(function trasladoCrearPideConfirmacionYLuegoGuarda() {
  const { env, token } = envConAdmin();
  env.agregar('Traslados', [
    { id: 't1', fecha: '2026-08-01', producto: 'Costilla Preparada', unidad: 'g', cantidad_enviada: 5000, sede_origen: 'Centro de Producción', sede_destino: 'San Antonio', estado: 'Confirmado' },
    { id: 't2', fecha: '2026-08-02', producto: 'Costilla Preparada', unidad: 'g', cantidad_enviada: 4800, sede_origen: 'Centro de Producción', sede_destino: 'Capri', estado: 'Confirmado' },
    { id: 't3', fecha: '2026-08-03', producto: 'Costilla Preparada', unidad: 'g', cantidad_enviada: 5200, sede_origen: 'Centro de Producción', sede_destino: 'San Antonio', estado: 'Confirmado' }
  ]);
  const item = { fecha: '2026-08-08', producto: 'Costilla Preparada', unidad: 'g', cantidad: 90000, sede_origen: 'Centro de Producción', sede_destino: 'San Antonio' };

  const primero = env.post({ action: 'traslado_crear', token, item });
  assert.strictEqual(primero.ok, false);
  assert.strictEqual(primero.requiere_confirmacion, true);

  const segundo = env.post({ action: 'traslado_crear', token, item, opciones: { confirmar_cantidades_raras: true } });
  assert.strictEqual(segundo.ok, true, 'con la confirmación sí debe guardar: ' + JSON.stringify(segundo));
  console.log('traslado_crear pide confirmación y luego guarda: OK');
})();
