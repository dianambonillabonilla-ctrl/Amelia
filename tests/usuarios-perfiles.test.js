const fs = require('fs');
const assert = require('assert');

const usuarios = fs.readFileSync('apps-script/Usuarios.gs', 'utf8');
const html = fs.readFileSync('usuarios.html', 'utf8');

assert(usuarios.includes("const ROLES_DISPONIBLES = ['Administrador', 'Caja', 'Cocina', 'Gerencia'];"), 'Deben existir los cuatro perfiles definitivos');
assert(usuarios.includes("const SEDES_DISPONIBLES = ['Ambas', 'San Antonio', 'Capri', 'Centro de Producción'];"), 'Deben existir las sedes autorizadas');
assert(usuarios.includes("const ROLES_LEGACY_ = { Encargado: 'Caja', Lectura: 'Gerencia' };"), 'Debe conservarse compatibilidad visual con perfiles antiguos');
assert(usuarios.includes("if (item.rol === 'Administrador') item.sede = 'Ambas';"), 'Administrador debe quedar siempre con alcance Ambas');
assert(usuarios.includes("sectores_permitidos: item.sectores_permitidos || ''"), 'Los sectores deben guardarse al crear usuario');
assert(usuarios.includes("No puedes desactivar tu propia cuenta"), 'Debe protegerse al administrador actual');
assert(usuarios.includes("No puedes quitarte a ti mismo el perfil de Administrador"), 'Debe protegerse el perfil del administrador actual');

for (const perfil of ['Administrador', 'Caja', 'Cocina', 'Gerencia']) {
  assert(html.includes(`<option>${perfil}</option>`), `Falta perfil ${perfil} en la pantalla`);
}
assert(html.includes('<option value="">Selecciona un perfil</option>'), 'La creación debe obligar a seleccionar un perfil');
assert(html.includes('Editar perfil y sede'), 'Debe poder editarse perfil y sede desde Usuarios');
assert(html.includes('Caja y Cocina podrán consultar inventario de otras sedes'), 'La pantalla debe explicar el alcance de consulta entre sedes');
assert(html.includes("const PERFILES_USUARIO = ['Administrador', 'Caja', 'Cocina', 'Gerencia'];"), 'La UI debe usar la misma lista de perfiles');
assert(html.includes("if (esAdmin) nuevaSede.value = 'Ambas';"), 'La UI debe fijar Ambas para Administrador');

console.log('✓ Usuarios: perfiles, sedes y edición definidos correctamente');
