const fs = require('fs');
const assert = require('assert');

const usuarios = fs.readFileSync('apps-script/Usuarios.gs', 'utf8');
const config = fs.readFileSync('assets/config.js', 'utf8');
const login = fs.readFileSync('index.html', 'utf8');
const fudoPanel = fs.readFileSync('fudo.html', 'utf8');
const fudo = fs.readFileSync('apps-script/Fudo.gs', 'utf8');
const fudoVentas = fs.readFileSync('apps-script/FudoVentas.gs', 'utf8');

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

// Solo los módulos aprobados (Usuarios, Sincronización FUDO y Caja) aparecen en reactivación.
assert.match(config, /const MODO_REACTIVACION = true;/);
assert.match(config, /const MODULOS_ACTIVOS = \['usuarios', 'sincronizacion', 'caja'\];/);
assert.match(config, /href: 'fudo\.html', texto: 'Sincronización FUDO', soloRol: \['Administrador'\]/);
assert.match(config, /href: 'usuarios\.html', texto: 'Usuarios', soloRol: \['Administrador'\]/);
assert.match(config, /const PAGINAS_PERMITIDAS_REACTIVACION = \['index\.html', 'usuarios\.html', 'fudo\.html', 'caja\.html', 'cambiar-password\.html', ''\]/);

// API cliente: solo seguridad, Usuarios y conexión/sync FUDO.
['usuarios_listar','usuarios_guardar','usuario_resetear_password','fudo_panel_estado','fudo_api_probar_conexion','fudo_api_sincronizar_ventas','fudo_api_sincronizar_pagos']
  .forEach(action => assert.ok(config.includes(`'${action}'`), `Falta acción activa ${action}`));
assert.match(config, /MODO_REACTIVACION && !ACCIONES_PERMITIDAS_REACTIVACION\.includes\(action\)/);
assert.match(config, /codigo:\s*'MODULO_INACTIVO'/);

// Durante esta fase Administración entra a Sincronización FUDO (o Caja si esa no está activa) y
// el perfil Caja entra directo a su módulo, limitado a su sede; cualquier otro rol queda fuera.
assert.match(login, /data\.usuario\.rol === 'Administrador'/);
assert.match(login, /MODULOS_ACTIVOS\.includes\('sincronizacion'\) \? 'fudo\.html' : 'caja\.html'/);
assert.match(login, /data\.usuario\.rol === 'Caja' && MODULOS_ACTIVOS\.includes\('caja'\)/);
assert.match(login, /window\.location\.href = 'caja\.html';/);
assert.match(login, /todavía no hay un módulo habilitado para tu perfil en esta etapa de reactivación/);
assert.match(fudoPanel, /requerirRol_\(\['Administrador'\]\)/);

// Panel limpio: conexión/sync, sin herramientas viejas de espejo, stock o migraciones.
assert.match(fudoPanel, /Conexión, no espejo completo/);
assert.match(fudoPanel, /Cantidad de alimentos para inventario/);
assert.doesNotMatch(fudoPanel, /Tomar snapshot desde API|Migrar histórico|Importar de FUDO|catalogo\.html|importar\.html/);

// Regla crítica de inventario: solo bebida conserva cantidad FUDO.
assert.match(fudo, /function cantidadFudoConfiableParaProducto_/);
assert.match(fudo, /sector === 'bebidas'/);
assert.match(fudo, /obj\.cantidad = '';/);
assert.match(fudo, /cantidades_omitidas_no_bebidas/);
assert.match(fudoVentas, /const cantidadVacia =/);
assert.match(fudoVentas, /cantidad:\s*cantidadVacia \? ''/);

console.log('usuarios-reactivacion: OK');
