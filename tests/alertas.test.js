/**
 * Alertas de stock bajo: además de la alerta ya existente sobre "preparaciones posibles" de un
 * plato, revisarAlertas_ ahora también avisa cuando un INGREDIENTE (materia prima) cae por debajo
 * del `stock_minimo` que Diana configura por producto en Catalogo_Maestro (catalogo.html). Diana
 * (ago 2026): "quiero enterarme cuando un insumo se está agotando, no solo cuando ya tumbó las
 * preparaciones posibles de un plato" — y "la alerta debería llegar por la app y a los correos de
 * San Antonio y Capri respectivamente para que cada uno sepa": el chequeo de ingredientes es POR
 * SEDE (San Antonio no se entera de lo que le falta a Capri ni viceversa), y alertasStockBajoListar_
 * expone el mismo chequeo en vivo para inicio.html, sin depender de si ya se mandó el correo hoy.
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

(function elChequeoEsPorSedeNoAgregado() {
  const env = envBase();
  const enviados = correosEnviados(env);
  env.agregar('Catalogo_Maestro', [
    { id: 'c1', nombre_estandar: 'Costilla San Luis Entera', unidad_base: 'g', stock_minimo: 5000 }
  ]);
  env.agregar('Conteos_Manuales', [
    // San Antonio está bajo el mínimo; Capri sola tiene de sobra. Antes (cálculo agregado) las dos
    // sumadas (12000 g) escondían el faltante real de San Antonio.
    { id: 'k1', fecha: '2026-08-08', sede: 'San Antonio', punto_conteo: 'General', turno: 'Cierre', producto: 'Costilla San Luis Entera', unidad: 'g', cantidad: 2000, usuario: 'Antonio', timestamp: '2026-08-08T20:00:00' },
    { id: 'k2', fecha: '2026-08-08', sede: 'Capri', punto_conteo: 'General', turno: 'Cierre', producto: 'Costilla San Luis Entera', unidad: 'g', cantidad: 10000, usuario: 'Karen', timestamp: '2026-08-08T20:00:00' }
  ]);

  const r = env.ctx.revisarAlertas_('2026-08-08');
  assert.strictEqual(r.enviados, 1, 'solo San Antonio está bajo el mínimo');
  assert.strictEqual(enviados.length, 1);
  assert.match(enviados[0].subject, /San Antonio/);
  assert.match(enviados[0].body, /Costilla San Luis Entera: 2000 g \(mínimo 5000 g\)/);
  console.log('el chequeo de ingredientes es por sede, no agregado: OK');
})();

(function cadaSedeAvisaSoloASuPropiaGente() {
  const env = envBase(); // ya trae un Administrador (sede 'Ambas')
  const enviados = correosEnviados(env);
  env.agregar('Usuarios', [
    { id: 'u2', nombre: 'Giselle', usuario: 'giselle', rol: 'Encargado', sede: 'San Antonio', activo: true, email: 'sanantonio@example.com' },
    { id: 'u3', nombre: 'Karen', usuario: 'karen', rol: 'Encargado', sede: 'Capri', activo: true, email: 'capri@example.com' }
  ]);
  env.agregar('Catalogo_Maestro', [
    { id: 'c1', nombre_estandar: 'Costilla San Luis Entera', unidad_base: 'g', stock_minimo: 5000 }
  ]);
  env.agregar('Conteos_Manuales', [
    { id: 'k1', fecha: '2026-08-08', sede: 'San Antonio', punto_conteo: 'General', turno: 'Cierre', producto: 'Costilla San Luis Entera', unidad: 'g', cantidad: 1000, usuario: 'Antonio', timestamp: '2026-08-08T20:00:00' }
  ]);

  env.ctx.revisarAlertas_('2026-08-08');
  assert.strictEqual(enviados.length, 1, 'solo se manda un correo (San Antonio está bajo, Capri no tiene ni conteo)');
  const destinatarios = enviados[0].to.split(',');
  assert.ok(destinatarios.includes('sanantonio@example.com'), 'San Antonio debe enterarse de lo suyo');
  assert.ok(destinatarios.includes('diana@example.com'), 'el Administrador (sede Ambas) se entera de todo');
  assert.ok(!destinatarios.includes('capri@example.com'), 'Capri no debe recibir un aviso que no es suyo');
  console.log('cada sede avisa solo a su propia gente: OK');
})();

(function elListadoEnVivoNoDependeDeSiYaSeMandoElCorreo() {
  const env = envBase();
  env.ctx.MailApp.sendEmail = () => {}; // no interesa el correo en esta prueba
  env.agregar('Catalogo_Maestro', [
    { id: 'c1', nombre_estandar: 'Costilla San Luis Entera', unidad_base: 'g', stock_minimo: 5000 }
  ]);
  env.agregar('Conteos_Manuales', [
    { id: 'k1', fecha: '2026-08-08', sede: 'San Antonio', punto_conteo: 'General', turno: 'Cierre', producto: 'Costilla San Luis Entera', unidad: 'g', cantidad: 1000, usuario: 'Antonio', timestamp: '2026-08-08T20:00:00' }
  ]);

  // El correo del día ya se mandó y quedó registrado en AlertasEnviadas...
  env.ctx.revisarAlertas_('2026-08-08');
  // ...pero el listado en vivo para inicio.html debe seguir mostrando el faltante real, no "ya avisado = ocultar".
  const soloSanAntonio = env.ctx.alertasStockBajoListar_('2026-08-08', 'San Antonio');
  assert.strictEqual(soloSanAntonio.bajos.length, 1);
  assert.strictEqual(soloSanAntonio.bajos[0].sede, 'San Antonio');

  const capriNoVeLoDeSanAntonio = env.ctx.alertasStockBajoListar_('2026-08-08', 'Capri');
  assert.strictEqual(capriNoVeLoDeSanAntonio.bajos.length, 0, 'Capri no tiene conteo de este producto, no debe aparecer nada');

  // Administrador (sede 'Ambas', o sin sede) ve las 3 sedes juntas.
  const administrador = env.ctx.alertasStockBajoListar_('2026-08-08', null);
  assert.strictEqual(administrador.bajos.length, 1);
  console.log('el listado en vivo no depende de si ya se mandó el correo: OK');
})();
