const fs = require('fs');
const assert = require('assert');

const usuarios = fs.readFileSync('apps-script/Usuarios.gs', 'utf8');
const config = fs.readFileSync('assets/config.js', 'utf8');
const login = fs.readFileSync('index.html', 'utf8');
const fudoPanel = fs.readFileSync('fudo.html', 'utf8');
const fudo = fs.readFileSync('apps-script/Fudo.gs', 'utf8');
const fudoVentas = fs.readFileSync('apps-script/FudoVentas.gs', 'utf8');

// Regresión real encontrada al reactivar Usuarios: la UI mandaba sectores_permitidos,
// pero el alta del backend no lo incluía al escribir la fila nueva.
assert.match(
  usuarios,
  /sectores_permitidos:\s*item\.sectores_permitidos\s*\|\|\s*''/,
  'El alta de usuarios debe guardar sectores_permitidos'
);

assert.match(
  usuarios,
  /item\.id === usuarioSesion\.id && item\.activo === false/,
  'Debe existir protección contra autodesactivación del Administrador'
);

// Reactivación por etapas: únicamente Usuarios y Sincronización FUDO están activos.
assert.match(config, /const MODO_REACTIVACION = true;/);
assert.match(config, /const MODULOS_ACTIVOS = \['usuarios', 'sincronizacion'\];/);
assert.match(config, /href: 'fudo\.html', texto: 'Sincronización FUDO'/);
assert.match(config, /href: 'usuarios\.html', texto: 'Usuarios'/);
assert.doesNotMatch(
  config.match(/const MENU_PRINCIPAL = MODO_REACTIVACION[\s\S]*?: MENU_PRINCIPAL_COMPLETO;/)[0],
  /caja\.html|conteo\.html|producir\.html|traslados\.html|compras\.html|catalogo\.html|importar\.html/,
  'El menú activo no debe exponer módulos todavía inactivos'
);

// Cliente común: las acciones operativas antiguas siguen bloqueadas.
assert.match(config, /const ACCIONES_PERMITIDAS_REACTIVACION = \[/);
['usuarios_listar','usuarios_guardar','usuario_resetear_password','fudo_panel_estado','fudo_api_probar_conexion','fudo_api_sincronizar_ventas','fudo_api_sincronizar_pagos']
  .forEach(action => assert.ok(config.includes(`'${action}'`), `Falta acción activa ${action}`));
assert.match(config, /MODO_REACTIVACION && !ACCIONES_PERMITIDAS_REACTIVACION\.includes\(action\)/);
assert.match(config, /codigo:\s*'MODULO_INACTIVO'/);

// Login limpio: Administrador y Encargado entran al panel de sincronización; otros roles no
// reciben acceso a módulos antiguos.
assert.match(login, /\['Administrador', 'Encargado'\]\.includes\(data\.usuario\.rol\)/);
assert.match(login, /window\.location\.href = 'fudo\.html';/);
assert.match(login, /solo están habilitados Usuarios y Sincronización FUDO/);

// El panel activo no debe volver a ofrecer el espejo/stock FUDO ni links a módulos apagados.
assert.match(fudoPanel, /Conexión, no espejo completo/);
assert.match(fudoPanel, /Cantidad de alimentos para inventario/);
assert.doesNotMatch(fudoPanel, /Tomar snapshot desde API|Migrar histórico|Importar de FUDO|catalogo\.html|importar\.html/);

// Regla crítica: FUDO conserva cantidad únicamente si DILANA identifica el producto como bebida.
assert.match(fudo, /function cantidadFudoConfiableParaProducto_/);
assert.match(fudo, /sector === 'bebidas'/);
assert.match(fudo, /obj\.cantidad = '';/);
assert.match(fudo, /cantidades_omitidas_no_bebidas/);

// La capa normalizada debe mantener el vacío: no convertir una cantidad no confiable en cero.
assert.match(fudoVentas, /const cantidadVacia =/);
assert.match(fudoVentas, /cantidad:\s*cantidadVacia \? ''/);

console.log('usuarios-reactivacion: OK');
