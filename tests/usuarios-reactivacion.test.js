const fs = require('fs');
const assert = require('assert');

const usuarios = fs.readFileSync('apps-script/Usuarios.gs', 'utf8');
const config = fs.readFileSync('assets/config.js', 'utf8');
const login = fs.readFileSync('index.html', 'utf8');
const fudoPanel = fs.readFileSync('fudo.html', 'utf8');
const cajaHtml = fs.readFileSync('caja.html', 'utf8');
const cajaBackend = fs.readFileSync('apps-script/Caja.gs', 'utf8');
const reactivacionCaja = fs.readFileSync('apps-script/ZZ_ReactivacionCaja.gs', 'utf8');
const fudo = fs.readFileSync('apps-script/Fudo.gs', 'utf8');
const fudoVentas = fs.readFileSync('apps-script/FudoVentas.gs', 'utf8');

assert.match(usuarios,/sectores_permitidos:\s*item\.sectores_permitidos\s*\|\|\s*''/);
assert.match(usuarios,/item\.id === usuarioSesion\.id && item\.activo === false/);
assert.match(config,/const MODO_REACTIVACION = true;/);
assert.match(config,/const MODULOS_ACTIVOS = \['usuarios', 'sincronizacion', 'caja', 'reservas'\];/);
assert.match(config,/href: 'usuarios\.html', texto: 'Usuarios'/);

// La nueva Caja controla acceso por sesión y backend; ya no depende del helper visual requerirRol_.
assert.match(cajaHtml,/Sesion\.requerir\(\)/);
assert.match(cajaHtml,/const admin=u\.rol==='Administrador'/);
assert.match(cajaHtml,/Qué dice FUDO y qué dice DILANA/);
assert.match(cajaHtml,/Debes recibir del cierre anterior/);
assert.match(cajaBackend,/const CAJA_V3_VERSION_ = 'CAJA_V3'/);
assert.match(reactivacionCaja,/usuario && usuario\.rol === 'Caja' \? 'Encargado'/);

['caja_estado','caja_abrir','caja_movimiento_registrar','caja_movimientos_listar','caja_cerrar','caja_sincronizar_ahora','caja_resumen_admin','caja_historial_listar']
  .forEach(action => assert.ok((config + reactivacionCaja).includes(`'${action}'`), `Falta acción activa ${action}`));

assert.match(login,/data\.usuario\.rol === 'Administrador'/);
// Reservas (ago 2026, pedido de Diana): quien atiende reservas ("Caja"/"Gerencia") debe caer directo
// en el panel de Reservas al abrir el sistema, no en Caja — Caja sigue un clic de distancia en el menú.
assert.match(login,/data\.usuario\.rol === 'Caja' && MODULOS_ACTIVOS\.includes\('reservas'\)/);
assert.match(login,/data\.usuario\.rol === 'Gerencia' && MODULOS_ACTIVOS\.includes\('reservas'\)/);
assert.match(login,/window\.location\.href = 'caja\.html';/);
assert.match(login,/window\.location\.href = 'reservas\.html';/);
assert.match(fudoPanel,/requerirRol_\(\['Administrador'\]\)/);

// Sincronización FUDO (ago 2026, pedido de Diana): ya no es un link aparte en el menú — Caja tiene
// su propio botón de sincronizar y es el destino por defecto del Administrador. fudo.html se
// conserva alcanzable por URL directa (sincronizar un rango, probar conexión) pero no se promociona
// en la navegación ni en los redirects de "sin permiso"/"módulo bloqueado"/login.
assert.doesNotMatch(config,/texto: 'Sincronización FUDO'/,'Sincronización FUDO ya no debe ser un link del menú');
assert.doesNotMatch(config,/'fudo\.html'\)/,'ningún redirect de config.js debe seguir mandando al Administrador a fudo.html');
assert.doesNotMatch(login,/'fudo\.html'/,'el login del Administrador ya no debe aterrizar en fudo.html');

console.log('usuarios-reactivacion: fudo.html ya no es destino de menú/redirects, solo Caja: OK');

assert.match(fudo,/function cantidadFudoConfiableParaProducto_/);
assert.match(fudo,/sector === 'bebidas'/);
assert.match(fudo,/obj\.cantidad = '';/);
assert.match(fudoVentas,/const cantidadVacia =/);
assert.match(fudoVentas,/cantidad:\s*cantidadVacia \? ''/);

console.log('usuarios-reactivacion: OK');
