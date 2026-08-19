const fs = require('fs');
const assert = require('assert');

const usuarios = fs.readFileSync('apps-script/Usuarios.gs', 'utf8');
const config = fs.readFileSync('assets/config.js', 'utf8');
const login = fs.readFileSync('index.html', 'utf8');

// Regresión real encontrada al reactivar Usuarios: la UI mandaba sectores_permitidos,
// pero el alta del backend no lo incluía al escribir la fila nueva.
assert.match(
  usuarios,
  /sectores_permitidos:\s*item\.sectores_permitidos\s*\|\|\s*''/,
  'El alta de usuarios debe guardar sectores_permitidos'
);

// No permitir que quien administra se desactive accidentalmente desde su propia sesión.
assert.match(
  usuarios,
  /item\.id === usuarioSesion\.id && item\.activo === false/,
  'Debe existir protección contra autodesactivación del Administrador'
);

// Reactivación por etapas: por ahora únicamente Usuarios aparece como módulo activo.
assert.match(config, /const MODO_REACTIVACION = true;/);
assert.match(config, /const MODULOS_ACTIVOS = \['usuarios'\];/);
assert.match(
  config,
  /MODO_REACTIVACION\s*\?\s*\[\s*\{ grupo: 'MÓDULO ACTIVO' \},\s*\{ href: 'usuarios\.html'/s,
  'En modo reactivación el menú debe contener únicamente Usuarios'
);

// Abrir una URL vieja no debe permitir que su JavaScript opere contra la API desde el cliente común.
assert.match(config, /const ACCIONES_PERMITIDAS_REACTIVACION = \[/);
assert.match(config, /'usuarios_listar'/);
assert.match(config, /'usuarios_guardar'/);
assert.match(config, /'usuario_resetear_password'/);
assert.match(
  config,
  /MODO_REACTIVACION && !ACCIONES_PERMITIDAS_REACTIVACION\.includes\(action\)/,
  'llamar() debe bloquear acciones de módulos que siguen inactivos'
);
assert.match(config, /codigo:\s*'MODULO_INACTIVO'/);

// El login de esta etapa no debe enviar a Inicio de turno: Administración entra a Usuarios.
assert.match(login, /data\.usuario\.rol === 'Administrador'/);
assert.match(login, /window\.location\.href = 'usuarios\.html';/);
assert.match(login, /Por ahora solo está activo el módulo Usuarios para Administración\./);

console.log('usuarios-reactivacion: OK');
