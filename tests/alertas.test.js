/**
 * Alertas de stock bajo: además de la alerta ya existente sobre "preparaciones posibles" de un
 * plato, revisarAlertas_ ahora también avisa cuando un INGREDIENTE (materia prima) cae por debajo
 * del `stock_minimo` que Diana configura por producto en Catalogo_Maestro (catalogo.html). Diana
 * (ago 2026): "quiero enterarme cuando un insumo se está agotando, no solo cuando ya tumbó las
 * preparaciones posibles de un plato".
 */
const assert = require('assert');
const { crearEntorno } = require('./helpers/entorno-apps-script.js');

function envBase() {
  const env = crearEntorno();
  env.ctx.configurarHojas();
  env.agregar('Usuarios', [
    { id: 'u1', nombre: 'Diana', usuario: 'diana', rol: 'Administrador', sede: 'Ambas', activo: true, email: 'diana@example.com' }
  ]);
  return env;
}

function correosEnviados(env) {
  const enviados = [];
  env.ctx.MailApp.sendEmail = (args) => enviados.push(args);
  return enviados;
}

(function avisaCuandoElStockCaePorDebajoDelMinimo() {
  const env = envBase();
  const enviados = correosEnviados(env);
  env.agregar('Catalogo_Maestro', [
    { id: 'c1', nombre_estandar: 'Costilla San Luis Entera', unidad_base: 'g', stock_minimo: 5000 }
  ]);
  env.agregar('Conteos_Manuales', [
    { id: 'k1', fecha: '2026-08-08', sede: 'Centro de Producción', punto_conteo: 'General', turno: 'Cierre', producto: 'Costilla San Luis Entera', unidad: 'g', cantidad: 3000, usuario: 'Antonio', timestamp: '2026-08-08T20:00:00' }
  ]);

  const r = env.ctx.revisarAlertas_('2026-08-08');
  assert.strictEqual(r.enviados, 1, 'debe contar 1 alerta enviada');
  assert.strictEqual(enviados.length, 1, 'debe mandar exactamente un correo');
  assert.match(enviados[0].subject, /Stock mínimo en 1 insumo/);
  assert.match(enviados[0].body, /Costilla San Luis Entera: 3000 g \(mínimo 5000 g\)/);

  const filas = env.ctx.leerTabla_(env.evaluar('SHEET_NAMES.ALERTAS_ENVIADAS'));
  assert.strictEqual(filas.length, 1);
  assert.strictEqual(filas[0].tipo, 'ingrediente');
  assert.strictEqual(filas[0].plato, 'Costilla San Luis Entera');
  console.log('avisa cuando el stock cae por debajo del mínimo: OK');
})();

(function noRepiteElMismoAvisoElMismoDia() {
  const env = envBase();
  const enviados = correosEnviados(env);
  env.agregar('Catalogo_Maestro', [
    { id: 'c1', nombre_estandar: 'Sal Marina Gruesa', unidad_base: 'g', stock_minimo: 1000 }
  ]);
  env.agregar('Conteos_Manuales', [
    { id: 'k1', fecha: '2026-08-08', sede: 'San Antonio', punto_conteo: 'General', turno: 'Cierre', producto: 'Sal Marina Gruesa', unidad: 'g', cantidad: 200, usuario: 'Antonio', timestamp: '2026-08-08T20:00:00' }
  ]);

  env.ctx.revisarAlertas_('2026-08-08');
  const r2 = env.ctx.revisarAlertas_('2026-08-08');
  assert.strictEqual(r2.enviados, 0, 'la segunda corrida del mismo día no debe reenviar nada');
  assert.strictEqual(enviados.length, 1, 'solo se manda un correo aunque el chequeo corra varias veces');
  console.log('no repite el mismo aviso el mismo día: OK');
})();

(function noAvisaSinMinimoConfiguradoOConMinimoCero() {
  const env = envBase();
  const enviados = correosEnviados(env);
  env.agregar('Catalogo_Maestro', [
    { id: 'c1', nombre_estandar: 'Sin Minimo', unidad_base: 'g', stock_minimo: '' },
    { id: 'c2', nombre_estandar: 'Minimo Cero', unidad_base: 'g', stock_minimo: 0 }
  ]);
  env.agregar('Conteos_Manuales', [
    { id: 'k1', fecha: '2026-08-08', sede: 'San Antonio', punto_conteo: 'General', turno: 'Cierre', producto: 'Sin Minimo', unidad: 'g', cantidad: 1, usuario: 'Antonio', timestamp: '2026-08-08T20:00:00' },
    { id: 'k2', fecha: '2026-08-08', sede: 'San Antonio', punto_conteo: 'General', turno: 'Cierre', producto: 'Minimo Cero', unidad: 'g', cantidad: 1, usuario: 'Antonio', timestamp: '2026-08-08T20:00:00' }
  ]);

  env.ctx.revisarAlertas_('2026-08-08');
  assert.strictEqual(enviados.length, 0, 'sin un mínimo real configurado no debe mandar nada');
  console.log('no avisa sin mínimo configurado o con mínimo cero: OK');
})();

(function ignoraUnaCeldaDeStockMinimoConTextoInvalido() {
  const env = envBase();
  const enviados = correosEnviados(env);
  env.agregar('Catalogo_Maestro', [
    // Caso real encontrado en el Sheet: una nota de texto quedó en la celda de stock_minimo por error.
    { id: 'c1', nombre_estandar: 'Cebolla en Pluma (sin limon)', unidad_base: 'g', stock_minimo: 'Preparación intermedia distinta.' },
    { id: 'c2', nombre_estandar: 'Costilla San Luis Entera', unidad_base: 'g', stock_minimo: 5000 }
  ]);
  env.agregar('Conteos_Manuales', [
    { id: 'k1', fecha: '2026-08-08', sede: 'San Antonio', punto_conteo: 'General', turno: 'Cierre', producto: 'Cebolla en Pluma (sin limon)', unidad: 'g', cantidad: 1, usuario: 'Antonio', timestamp: '2026-08-08T20:00:00' },
    { id: 'k2', fecha: '2026-08-08', sede: 'San Antonio', punto_conteo: 'General', turno: 'Cierre', producto: 'Costilla San Luis Entera', unidad: 'g', cantidad: 100, usuario: 'Antonio', timestamp: '2026-08-08T20:00:00' }
  ]);

  const r = env.ctx.revisarAlertas_('2026-08-08');
  assert.strictEqual(r.enviados, 1, 'el dato inválido se ignora, pero el otro producto sí se revisa');
  assert.match(enviados[0].body, /Costilla San Luis Entera/);
  assert.doesNotMatch(enviados[0].body, /Cebolla en Pluma/);
  console.log('ignora una celda de stock_minimo con texto inválido: OK');
})();

(function convierteElMinimoDesdeKgYLAntesDeComparar() {
  const env = envBase();
  const enviados = correosEnviados(env);
  env.agregar('Catalogo_Maestro', [
    // stock_minimo se escribe en kg/l en el catálogo, pero el stock ya calculado por Disponible Hoy
    // siempre queda en gramos/mililitros — sin convertir, 0.5 nunca sería menor que 400.
    { id: 'c1', nombre_estandar: 'Vinagre Blanco', unidad_base: 'l', stock_minimo: 0.5 }
  ]);
  env.agregar('Conteos_Manuales', [
    { id: 'k1', fecha: '2026-08-08', sede: 'Centro de Producción', punto_conteo: 'General', turno: 'Cierre', producto: 'Vinagre Blanco', unidad: 'ml', cantidad: 400, usuario: 'Antonio', timestamp: '2026-08-08T20:00:00' }
  ]);

  const r = env.ctx.revisarAlertas_('2026-08-08');
  assert.strictEqual(r.enviados, 1, '0.5 l de mínimo (=500 ml) debe compararse contra 400 ml contados, no contra "0.5"');
  assert.match(enviados[0].body, /Vinagre Blanco: 400 ml \(mínimo 500 ml\)/);
  console.log('convierte el mínimo desde kg/l a la unidad base antes de comparar: OK');
})();

(function noRompeLaAlertaExistenteDePlatosPorPreparacionesPosibles() {
  const env = envBase();
  const enviados = correosEnviados(env);
  env.agregar('Recetas', [
    { id: 'r1', producto: 'Falafel', ingrediente: 'Falafel Preparado', cantidad: 187, unidad: 'g', tipo: 'plato', estado: 'activo', controla_disponibilidad: true, umbral_alerta: 3 }
  ]);
  env.agregar('Conteos_Manuales', [
    { id: 'k1', fecha: '2026-08-08', sede: 'San Antonio', punto_conteo: 'General', turno: 'Cierre', producto: 'Falafel Preparado', unidad: 'g', cantidad: 187, usuario: 'Antonio', timestamp: '2026-08-08T20:00:00' }
  ]);

  const r = env.ctx.revisarAlertas_('2026-08-08');
  assert.strictEqual(r.enviados, 1, 'sigue avisando por plato con menos de 3 preparaciones posibles (187/187 = 1)');
  assert.match(enviados[0].subject, /Stock bajo en 1 plato/);
  console.log('no rompe la alerta existente de platos por preparaciones posibles: OK');
})();
