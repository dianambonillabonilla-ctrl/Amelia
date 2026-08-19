const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}
function write(rel, text) {
  fs.writeFileSync(path.join(ROOT, rel), text);
}
function replaceOnce(text, from, to, label) {
  const first = text.indexOf(from);
  if (first === -1) throw new Error('No se encontró patrón para ' + label);
  if (text.indexOf(from, first + from.length) !== -1) throw new Error('Patrón ambiguo para ' + label);
  return text.slice(0, first) + to + text.slice(first + from.length);
}
function replaceCount(text, from, to, expected, label) {
  const parts = text.split(from);
  const count = parts.length - 1;
  if (count !== expected) throw new Error(`${label}: se esperaban ${expected} ocurrencias y hay ${count}`);
  return parts.join(to);
}
function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const name of fs.readdirSync(dir)) {
    const abs = path.join(dir, name);
    const st = fs.statSync(abs);
    if (st.isDirectory()) walk(abs, out);
    else out.push(abs);
  }
  return out;
}
function rel(abs) { return path.relative(ROOT, abs).replace(/\\/g, '/'); }

// 1) Nombres canónicos de perfiles en todo el código y pruebas existentes.
const roleFiles = [
  ...walk(path.join(ROOT, 'apps-script')),
  ...walk(path.join(ROOT, 'assets')),
  ...walk(path.join(ROOT, 'tests')),
  ...fs.readdirSync(ROOT).filter(n => n.endsWith('.html')).map(n => path.join(ROOT, n))
].filter(f => /\.(gs|js|html)$/.test(f));

for (const file of roleFiles) {
  let s = fs.readFileSync(file, 'utf8');
  const before = s;
  s = s.replace(/\bEncargado\b/g, 'Caja').replace(/\bLectura\b/g, 'Gerencia');
  if (s !== before) fs.writeFileSync(file, s);
}

// 2) Backend central: compatibilidad legacy, separación lectura/escritura por sede y permisos finos.
let code = read('apps-script/Code.gs');

const requiereRolViejo = `function requiereRol_(usuario, rolesPermitidos) {
  if (rolesPermitidos.indexOf(usuario.rol) === -1) {
    throw new Error('Esta acción requiere uno de estos roles: ' + rolesPermitidos.join(', '));
  }
}`;
const requiereRolNuevo = `// Perfiles canónicos de DILANA OS. Las dos equivalencias legacy permiten que cuentas
// creadas antes de agosto de 2026 sigan funcionando hasta que Usuarios.gs normalice la hoja.
const ROLES_ALIAS_LEGACY_ = { 'Encargado': 'Caja', 'Lectura': 'Gerencia' };

function normalizarRol_(rol) {
  return ROLES_ALIAS_LEGACY_[rol] || rol;
}

function requiereRol_(usuario, rolesPermitidos) {
  const rolActual = normalizarRol_(usuario && usuario.rol);
  const rolesCanonicos = rolesPermitidos.map(normalizarRol_);
  if (rolesCanonicos.indexOf(rolActual) === -1) {
    throw new Error('Esta acción requiere uno de estos perfiles: ' + rolesCanonicos.join(', '));
  }
}`;
code = replaceOnce(code, requiereRolViejo, requiereRolNuevo, 'normalización de perfiles');
code = replaceOnce(code, 'rol: match.rol, sede: match.sede', 'rol: normalizarRol_(match.rol), sede: match.sede', 'rol canónico en login');
code = replaceOnce(code, 'rol: u.rol, sede: u.sede', 'rol: normalizarRol_(u.rol), sede: u.sede', 'rol canónico en validarToken');

const sedeConsultaVieja = `function sedeConsultaPermitida_(usuario, sedeSolicitada) {
  if (usuario.rol === 'Administrador' || usuario.sede === 'Ambas') return sedeSolicitada || null;
  if (sedeSolicitada && sedeSolicitada !== usuario.sede && sedeSolicitada !== 'Centro de Producción') {
    throw new Error('No puedes consultar datos de una sede distinta a la tuya (' + usuario.sede + ')');
  }
  return sedeSolicitada || usuario.sede;
}`;
const sedeConsultaNueva = `function sedeConsultaPermitida_(usuario, sedeSolicitada) {
  const rol = normalizarRol_(usuario.rol);
  // Administrador es superusuario. Gerencia es solo lectura y puede consultar todas las sedes.
  if (rol === 'Administrador' || rol === 'Gerencia' || usuario.sede === 'Ambas') return sedeSolicitada || null;
  if (sedeSolicitada && sedeSolicitada !== usuario.sede && sedeSolicitada !== 'Centro de Producción') {
    throw new Error('No puedes consultar datos operativos de una sede distinta a la tuya (' + usuario.sede + ')');
  }
  return sedeSolicitada || usuario.sede;
}

/**
 * Consulta de INVENTARIO entre sedes. Caja y Cocina pueden mirar existencias de San Antonio,
 * Capri y Centro de Producción para detectar faltantes y decidir si hace falta un traslado.
 * Esta función es deliberadamente distinta de sedeConsultaPermitida_: NO concede permiso de
 * escritura ni abre caja/compras/operación financiera de otra sede.
 */
function sedeConsultaInventarioPermitida_(usuario, sedeSolicitada) {
  requiereRol_(usuario, ['Administrador', 'Caja', 'Cocina', 'Gerencia']);
  const rol = normalizarRol_(usuario.rol);
  const sedesValidas = ['San Antonio', 'Capri', 'Centro de Producción', 'Ambas'];
  if (sedeSolicitada && sedesValidas.indexOf(sedeSolicitada) === -1) {
    throw new Error('Sede de inventario no válida: ' + sedeSolicitada);
  }
  if (sedeSolicitada === 'Ambas') return null;
  if (sedeSolicitada) return sedeSolicitada;
  if (rol === 'Administrador' || rol === 'Gerencia' || usuario.sede === 'Ambas') return null;
  return usuario.sede;
}`;
code = replaceOnce(code, sedeConsultaVieja, sedeConsultaNueva, 'consulta de sedes');

const sedeEscrituraVieja = `function sedeEscrituraPermitida_(usuario, sede) {
  return usuario.rol === 'Administrador' || usuario.sede === 'Ambas' ||
    sede === usuario.sede || sede === 'Centro de Producción';
}`;
const sedeEscrituraNueva = `function sedeEscrituraPermitida_(usuario, sede) {
  const rol = normalizarRol_(usuario.rol);
  // Ver inventario de otra sede NO autoriza a escribir en ella. Solo Administrador, una cuenta
  // asignada a "Ambas", o la propia sede pueden registrar movimientos.
  return rol === 'Administrador' || usuario.sede === 'Ambas' || sede === usuario.sede;
}`;
code = replaceOnce(code, sedeEscrituraVieja, sedeEscrituraNueva, 'escritura por sede');

function caseBlock(source, action) {
  const marker = `case '${action}':`;
  const start = source.indexOf(marker);
  if (start === -1) throw new Error('No existe action ' + action);
  const next = source.indexOf("\n      case '", start + marker.length);
  const end = next === -1 ? source.indexOf('\n      default:', start) : next;
  if (end === -1) throw new Error('No se pudo delimitar action ' + action);
  return { start, end, text: source.slice(start, end) };
}
function mutateCase(action, fn) {
  const b = caseBlock(code, action);
  const next = fn(b.text);
  if (next === b.text) throw new Error('La action ' + action + ' no cambió como se esperaba');
  code = code.slice(0, b.start) + next + code.slice(b.end);
}
function setGuard(action, guard) {
  mutateCase(action, block => block.replace(/requiere(?:Rol|Admin)_\(sesion\.usuario(?:, \[[^\n]+\])?\);/, guard));
}
function useInventoryScope(action) {
  mutateCase(action, block => {
    if (!block.includes('sedeConsultaPermitida_')) throw new Error(action + ' no usa sedeConsultaPermitida_');
    return block.replace(/sedeConsultaPermitida_/g, 'sedeConsultaInventarioPermitida_');
  });
}

// Caja registra, pero no corrige ni fuerza sincronizaciones. Resolver discrepancias queda en Admin.
setGuard('caja_sincronizar_ahora', 'requiereAdmin_(sesion.usuario);');
setGuard('traslado_resolver', 'requiereAdmin_(sesion.usuario);');
setGuard('base_caja_guardar', "requiereRol_(sesion.usuario, ['Administrador', 'Caja']);");
setGuard('base_caja_dia', "requiereRol_(sesion.usuario, ['Administrador', 'Caja']);");
setGuard('base_caja_listar', "requiereRol_(sesion.usuario, ['Administrador', 'Caja', 'Gerencia']);");

// Lecturas de inventario: Administrador, Caja, Cocina y Gerencia; con selector entre sedes.
const inventarioConGuard = [
  'movimientos_inventario_listar',
  'inventario_ubicacion_resumen',
  'movimientos_inventario_libro_listar',
  'inventario_teorico_calcular',
  'inventario_teorico_resumen',
  'movimientos_venta_dia_listar',
  'resumen_diferencias_inventario'
];
for (const action of inventarioConGuard) {
  setGuard(action, "requiereRol_(sesion.usuario, ['Administrador', 'Caja', 'Cocina', 'Gerencia']);");
  useInventoryScope(action);
}
for (const action of ['disponible_hoy', 'alertas_stock_bajo_listar', 'tendencia_ingrediente']) {
  useInventoryScope(action);
}

write('apps-script/Code.gs', code);

// 3) Usuarios: perfiles definitivos, sedes válidas y migración segura de nombres anteriores.
let usuarios = read('apps-script/Usuarios.gs');
usuarios = usuarios.replace(/^\/\*\*[\s\S]*?\*\/\n\nfunction usuariosListar_/, `/**
 * USUARIOS, PERFILES Y ALCANCE
 * - Administrador: superusuario; puede hacer todo y operar todas las sedes.
 * - Caja: perfil operativo amplio de su sede. Puede registrar caja, conteos, producción,
 *   recepciones, traslados y demás operaciones habilitadas; NO puede corregir registros ni
 *   forzar/reprocesar sincronizaciones. Sí puede consultar inventario de todas las sedes y ver
 *   el estado de sincronización con FUDO.
 * - Cocina: producción/conteos/operación de su sede. Puede consultar inventario de todas las sedes
 *   para detectar necesidades de traslado, pero no puede escribir en otra sede.
 * - Gerencia: consulta y control; no registra operaciones.
 *
 * Perfil, sede y sector son dimensiones distintas. Ver inventario de otra sede nunca amplía el
 * permiso de escritura: ese control vive en sedeEscrituraPermitida_ (Code.gs).
 */

function normalizarRolesPersistidos_(usuarioAdmin) {
  const sh = sheet_(SHEET_NAMES.USUARIOS);
  const data = sh.getDataRange().getValues();
  if (!data.length) return 0;
  const headers = data[0];
  const rolCol = headers.indexOf('rol');
  const idCol = headers.indexOf('id');
  const sedeCol = headers.indexOf('sede');
  if (rolCol === -1) return 0;
  let cambios = 0;
  for (let r = 1; r < data.length; r++) {
    const anterior = data[r][rolCol];
    const nuevo = normalizarRol_(anterior);
    if (nuevo && nuevo !== anterior) {
      sh.getRange(r + 1, rolCol + 1).setValue(nuevo);
      cambios++;
      if (usuarioAdmin && typeof auditoriaRegistrar_ === 'function') {
        auditoriaRegistrar_(usuarioAdmin, 'usuario_rol_normalizado', 'Usuario', data[r][idCol],
          { rol: anterior }, { rol: nuevo }, sedeCol === -1 ? '' : data[r][sedeCol]);
      }
    }
  }
  return cambios;
}

function usuariosListar_`);
usuarios = replaceOnce(usuarios,
`function usuariosListar_(usuario) {
  requiereAdmin_(usuario);
  const rows = leerTabla_(SHEET_NAMES.USUARIOS);
  return { ok: true, data: rows.map(function (r) { return { id: r.id, nombre: r.nombre, usuario: r.usuario, rol: r.rol, sede: r.sede, activo: r.activo, email: r.email, sectores_permitidos: r.sectores_permitidos || '' }; }) };
}`,
`function usuariosListar_(usuario) {
  requiereAdmin_(usuario);
  normalizarRolesPersistidos_(usuario);
  const rows = leerTabla_(SHEET_NAMES.USUARIOS);
  return { ok: true, data: rows.map(function (r) { return { id: r.id, nombre: r.nombre, usuario: r.usuario, rol: normalizarRol_(r.rol), sede: r.sede, activo: r.activo, email: r.email, sectores_permitidos: r.sectores_permitidos || '' }; }) };
}`,
'listar usuarios canónicos');
usuarios = replaceOnce(usuarios,
`  if (!item) return { ok: false, error: 'Faltan datos del usuario' };`,
`  if (!item) return { ok: false, error: 'Faltan datos del usuario' };
  if (item.rol !== undefined) item.rol = normalizarRol_(item.rol);
  if (item.rol === 'Administrador') item.sede = 'Ambas';
  if (item.sede !== undefined && SEDES_DISPONIBLES.indexOf(item.sede) === -1) {
    return { ok: false, error: 'Sede no válida: ' + item.sede };
  }`,
'validación rol/sede');
usuarios = replaceOnce(usuarios,
`const ROLES_DISPONIBLES = ['Administrador', 'Caja', 'Cocina', 'Gerencia'];`,
`const ROLES_DISPONIBLES = ['Administrador', 'Caja', 'Cocina', 'Gerencia'];
const SEDES_DISPONIBLES = ['Ambas', 'San Antonio', 'Capri', 'Centro de Producción'];`,
'catálogo perfiles/sedes');
write('apps-script/Usuarios.gs', usuarios);

// 4) Alertas: las cuentas legacy también reciben alertas hasta que se normalice la hoja.
let alertas = read('apps-script/Alertas.gs');
alertas = replaceCount(alertas,
`(u.rol === 'Administrador' || u.rol === 'Caja')`,
`(normalizarRol_(u.rol) === 'Administrador' || normalizarRol_(u.rol) === 'Caja')`,
2,
'roles de alertas');
write('apps-script/Alertas.gs', alertas);

// 5) Traslados: una discrepancia ya registrada solo la resuelve Administrador.
let traslados = read('apps-script/Traslados.gs');
traslados = replaceOnce(traslados,
`function trasladoResolver_(id, notaResolucion, usuario) {
  requiereRol_(usuario, ['Administrador', 'Caja']);`,
`function trasladoResolver_(id, notaResolucion, usuario) {
  requiereAdmin_(usuario);`,
'resolver traslado solo admin');
traslados = traslados.replace(
` * Administrador y usuarios con sede "Ambas" pueden operar cualquier traslado; los demás solo
 * pueden enviar desde su sede, recibir en su sede y ver traslados relacionados con ella —
 * EXCEPTO Centro de Producción, que cualquiera (San Antonio, Capri o Ambas) puede enviar/recibir/
 * ver además de su propia sede (ver sedeEscrituraPermitida_ en Code.gs).`,
` * Administrador y usuarios con sede "Ambas" pueden operar cualquier traslado; los demás solo
 * pueden enviar desde su sede y recibir en su sede. Consultar inventario de otras sedes es una
 * capacidad de solo lectura y NO amplía el permiso de escritura (ver Code.gs).`);
traslados = traslados.replace(
`    // sedeEscrituraPermitida_ (Code.gs) también deja ver traslados que involucren Centro de
    // Producción, no solo la sede propia — si San Antonio/Capri pueden registrar/confirmar ahí,
    // también necesitan verlo en la lista para poder hacerlo.`,
`    // La lista operativa de traslados se limita a movimientos relacionados con la sede autorizada.
    // Poder consultar inventario de otra sede no equivale a poder operar sus traslados.`);
write('apps-script/Traslados.gs', traslados);

// 6) Frontend común: nombres canónicos y menú preparado para los permisos acordados.
let config = read('assets/config.js');
config = replaceOnce(config,
`const Sesion = {`,
`// Compatibilidad visual con sesiones antiguas guardadas antes del cambio de nombres de perfiles.
function normalizarRolCliente_(rol) {
  return ({ 'Encargado': 'Caja', 'Lectura': 'Gerencia' })[rol] || rol;
}

const Sesion = {`,
'normalizador cliente');
config = replaceOnce(config,
`  guardar(token, usuario) {
    sessionStorage.setItem('dilana_token', token);
    sessionStorage.setItem('dilana_usuario', JSON.stringify(usuario));
  },`,
`  guardar(token, usuario) {
    const canonico = usuario ? Object.assign({}, usuario, { rol: normalizarRolCliente_(usuario.rol) }) : usuario;
    sessionStorage.setItem('dilana_token', token);
    sessionStorage.setItem('dilana_usuario', JSON.stringify(canonico));
  },`,
'guardar sesión canónica');
config = replaceOnce(config,
`  usuario() {
    try { return JSON.parse(sessionStorage.getItem('dilana_usuario')); }
    catch (e) { return null; }
  },`,
`  usuario() {
    try {
      const u = JSON.parse(sessionStorage.getItem('dilana_usuario'));
      if (u) u.rol = normalizarRolCliente_(u.rol);
      return u;
    }
    catch (e) { return null; }
  },`,
'leer sesión canónica');

config = replaceOnce(config,
`  { href: 'abastecimiento.html', texto: 'Inventario y abastecimiento', soloRol: ['Administrador','Caja','Gerencia'] },`,
`  { href: 'abastecimiento.html', texto: 'Inventario y abastecimiento', soloRol: ['Administrador','Caja','Cocina','Gerencia'] },`,
'menú abastecimiento');
config = replaceOnce(config,
`  { href: 'inventario-ubicacion.html', texto: 'Inventario por ubicación', soloRol: ['Administrador','Caja','Gerencia'] },`,
`  { href: 'inventario-ubicacion.html', texto: 'Inventario por ubicación', soloRol: ['Administrador','Caja','Cocina','Gerencia'] },`,
'menú inventario ubicación');
config = replaceOnce(config,
`  { href: 'libro-inventario.html', texto: 'Libro de inventario', soloRol: ['Administrador','Caja','Gerencia'] },`,
`  { href: 'libro-inventario.html', texto: 'Libro de inventario', soloRol: ['Administrador','Caja','Cocina','Gerencia'] },`,
'menú libro inventario');
config = replaceOnce(config,
`  { href: 'historiales.html', texto: 'Históricos', soloRol: ['Administrador','Caja','Gerencia'] },`,
`  { href: 'historiales.html', texto: 'Históricos', soloRol: ['Administrador','Caja','Cocina','Gerencia'] },`,
'menú históricos');
config = replaceOnce(config,
`  { href: 'catalogo.html', texto: 'Catálogo de productos', soloRol: ['Administrador','Caja','Cocina'] },`,
`  { href: 'catalogo.html', texto: 'Catálogo de productos', soloRol: ['Administrador','Caja','Cocina','Gerencia'] },`,
'menú catálogo consulta');
config = replaceOnce(config,
`  { href: 'fudo.html', texto: 'Panel FUDO', soloRol: ['Administrador','Caja'] },`,
`  { href: 'fudo.html', texto: 'Panel FUDO', soloRol: ['Administrador','Caja','Gerencia'] },`,
'menú FUDO consulta');
config = replaceOnce(config,
`function montarMenu_(rolActual) {
  const nav = document.getElementById('menu-nav');`,
`function montarMenu_(rolActual) {
  rolActual = normalizarRolCliente_(rolActual);
  const nav = document.getElementById('menu-nav');`,
'menú normaliza rol');
config = replaceOnce(config,
`function ocultarNavSegunRol_(rolActual) {
  document.querySelectorAll('[data-solo-rol]').forEach(el => {
    const permitidos = el.dataset.soloRol.split(',').map(r => r.trim());
    if (!permitidos.includes(rolActual)) el.style.display = 'none';
  });
}`,
`function ocultarNavSegunRol_(rolActual) {
  const rol = normalizarRolCliente_(rolActual);
  document.querySelectorAll('[data-solo-rol]').forEach(el => {
    const permitidos = el.dataset.soloRol.split(',').map(r => normalizarRolCliente_(r.trim()));
    if (!permitidos.includes(rol)) el.style.display = 'none';
  });
}`,
'navegación por rol');
config = replaceOnce(config,
`function requerirRol_(rolesPermitidos) {
  const u = Sesion.usuario();
  if (!u || !rolesPermitidos.includes(u.rol)) {`,
`function requerirRol_(rolesPermitidos) {
  const u = Sesion.usuario();
  const rol = u ? normalizarRolCliente_(u.rol) : null;
  const permitidos = rolesPermitidos.map(normalizarRolCliente_);
  if (!u || !permitidos.includes(rol)) {`,
'guard frontend');
write('assets/config.js', config);

// 7) Pantalla Usuarios: perfiles definitivos y edición de perfil/sede sin escribir texto libre.
let html = read('usuarios.html');
html = replaceOnce(html,
`            <option>Administrador</option>
            <option>Caja</option>
            <option>Cocina</option>
            <option>Gerencia</option>`,
`            <option value="">Selecciona un perfil</option>
            <option>Administrador</option>
            <option>Caja</option>
            <option>Cocina</option>
            <option>Gerencia</option>`,
'selector de perfil');
html = replaceOnce(html,
`        <button class="btn fantasma btn-resetear" data-id="${'${escapeHtml(u.id)}'}" data-nombre="${'${escapeHtml(u.nombre)}'}">Restablecer contraseña</button>
        <button class="btn fantasma btn-sectores"`,
`        <button class="btn fantasma btn-resetear" data-id="${'${escapeHtml(u.id)}'}" data-nombre="${'${escapeHtml(u.nombre)}'}">Restablecer contraseña</button>
        <button class="btn fantasma btn-perfil" data-id="${'${escapeHtml(u.id)}'}" data-nombre="${'${escapeHtml(u.nombre)}'}" data-rol="${'${escapeHtml(u.rol)}'}" data-sede="${'${escapeHtml(u.sede)}'}">Editar perfil y sede</button>
        <button class="btn fantasma btn-sectores"`,
'botón perfil/sede');

const helpersUsuarios = `
const PERFILES_USUARIO = ['Administrador', 'Caja', 'Cocina', 'Gerencia'];
const SEDES_USUARIO = ['Ambas', 'San Antonio', 'Capri', 'Centro de Producción'];
function opcionesSelect_(valores, actual) {
  return valores.map(v => \`<option value="\${escapeHtml(v)}" \${v === actual ? 'selected' : ''}>\${escapeHtml(v)}</option>\`).join('');
}
`;
html = replaceOnce(html,
`document.getElementById('nuevo-sectores-checks').innerHTML = sectoresChecksHtml_('nuevo', '');`,
`document.getElementById('nuevo-sectores-checks').innerHTML = sectoresChecksHtml_('nuevo', '');${helpersUsuarios}`,
'helpers perfil/sede');

const perfilHandlers = `
  document.querySelectorAll('.btn-perfil').forEach(btn => {
    btn.addEventListener('click', () => {
      const fila = btn.closest('tr');
      const siguiente = fila.nextElementSibling;
      const yaAbierta = siguiente && siguiente.classList.contains('fila-editar-perfil');
      document.querySelectorAll('.fila-editar-perfil').forEach(f => f.remove());
      if (yaAbierta) return;

      const tr = document.createElement('tr');
      tr.className = 'fila-editar-perfil';
      tr.innerHTML = \`<td colspan="8" style="background:var(--cream); padding:14px">
        <strong>Perfil y sede de \${escapeHtml(btn.dataset.nombre)}:</strong>
        <div class="grid grid-2" style="margin-top:10px">
          <div class="campo"><label>Perfil</label><select class="editar-rol">\${opcionesSelect_(PERFILES_USUARIO, btn.dataset.rol)}</select></div>
          <div class="campo"><label>Sede autorizada para registrar</label><select class="editar-sede">\${opcionesSelect_(SEDES_USUARIO, btn.dataset.sede)}</select></div>
        </div>
        <p style="color:var(--grey);font-size:.8rem;margin:6px 0 10px">Caja y Cocina pueden consultar inventario de otras sedes, pero esta sede sigue definiendo dónde pueden registrar. Administrador siempre queda en Ambas.</p>
        <button class="btn dorado btn-guardar-perfil" type="button">Guardar perfil y sede</button>
        <button class="btn fantasma btn-cancelar-perfil" type="button">Cancelar</button>
      </td>\`;
      fila.after(tr);

      const selRol = tr.querySelector('.editar-rol');
      const selSede = tr.querySelector('.editar-sede');
      const ajustarAdmin = () => {
        const esAdmin = selRol.value === 'Administrador';
        if (esAdmin) selSede.value = 'Ambas';
        selSede.disabled = esAdmin;
      };
      selRol.addEventListener('change', ajustarAdmin);
      ajustarAdmin();
      tr.querySelector('.btn-cancelar-perfil').addEventListener('click', () => tr.remove());
      const guardar = tr.querySelector('.btn-guardar-perfil');
      guardar.addEventListener('click', conBotonProtegido(guardar, async () => {
        const data = await llamar('usuarios_guardar', { item: { id: btn.dataset.id, rol: selRol.value, sede: selSede.value } });
        if (data.ok) {
          avisarGuardado(\`Perfil y sede de \${btn.dataset.nombre} actualizados.\`);
          cargar();
        } else alert(data.error);
      }));
    });
  });
`;
html = replaceOnce(html,
`  document.querySelectorAll('.btn-sectores').forEach(btn => {`,
`${perfilHandlers}\n  document.querySelectorAll('.btn-sectores').forEach(btn => {`,
'handlers perfil/sede');

const rolNuevoHandlers = `
const nuevoRol = document.getElementById('nuevo-rol');
const nuevaSede = document.getElementById('nuevo-sede');
function ajustarSedeNuevoAdmin_() {
  const esAdmin = nuevoRol.value === 'Administrador';
  if (esAdmin) nuevaSede.value = 'Ambas';
  nuevaSede.disabled = esAdmin;
}
nuevoRol.addEventListener('change', ajustarSedeNuevoAdmin_);
ajustarSedeNuevoAdmin_();
`;
html = replaceOnce(html,
`document.getElementById('btn-crear').addEventListener('click',`,
`${rolNuevoHandlers}\ndocument.getElementById('btn-crear').addEventListener('click',`,
'alta usuario admin/ambas');
html = replaceOnce(html,
`  if (!item.nombre || !item.usuario || item.password.length < 8) { alert('Nombre, usuario y una contraseña de mínimo 8 caracteres son obligatorios.'); return; }`,
`  if (!item.nombre || !item.usuario || !item.rol || item.password.length < 8) { alert('Nombre, usuario, perfil y una contraseña de mínimo 8 caracteres son obligatorios.'); return; }`,
'validación perfil alta');
write('usuarios.html', html);

// 8) Regresión dedicada a esta matriz de perfiles/permisos.
const test = `const fs = require('fs');
const assert = require('assert');
function read(p) { return fs.readFileSync(p, 'utf8'); }
function block(code, action) {
  const start = code.indexOf(\`case '\${action}':\`);
  assert(start >= 0, 'Falta action ' + action);
  const next = code.indexOf("\\n      case '", start + 8);
  const end = next >= 0 ? next : code.indexOf('\\n      default:', start);
  return code.slice(start, end);
}
const code = read('apps-script/Code.gs');
const usuarios = read('apps-script/Usuarios.gs');
const config = read('assets/config.js');
const html = read('usuarios.html');
const traslados = read('apps-script/Traslados.gs');

assert(code.includes("const ROLES_ALIAS_LEGACY_ = { 'Encargado': 'Caja', 'Lectura': 'Gerencia' }"));
assert(code.includes("function sedeConsultaInventarioPermitida_"));
assert(code.includes("['Administrador', 'Caja', 'Cocina', 'Gerencia']"));
assert(code.includes("return rol === 'Administrador' || usuario.sede === 'Ambas' || sede === usuario.sede;"));
assert(!code.includes("sede === usuario.sede || sede === 'Centro de Producción'"));

for (const action of ['movimientos_inventario_listar','inventario_ubicacion_resumen','movimientos_inventario_libro_listar','inventario_teorico_calcular','inventario_teorico_resumen','movimientos_venta_dia_listar','resumen_diferencias_inventario','disponible_hoy','alertas_stock_bajo_listar','tendencia_ingrediente']) {
  assert(block(code, action).includes('sedeConsultaInventarioPermitida_'), action + ' debe usar lectura de inventario entre sedes');
}
assert(block(code, 'fudo_panel_estado').includes("['Administrador', 'Caja']"), 'Caja debe poder ver estado FUDO');
assert(block(code, 'caja_sincronizar_ahora').includes('requiereAdmin_(sesion.usuario);'), 'Caja no puede forzar sync FUDO');
assert(block(code, 'caja_corregir').includes("['Administrador']"), 'corregir caja solo Admin');
assert(block(code, 'traslado_resolver').includes('requiereAdmin_(sesion.usuario);'), 'resolver discrepancia de traslado solo Admin');
assert(traslados.includes('function trasladoResolver_(id, notaResolucion, usuario) {\\n  requiereAdmin_(usuario);'));

assert(usuarios.includes("const ROLES_DISPONIBLES = ['Administrador', 'Caja', 'Cocina', 'Gerencia'];"));
assert(usuarios.includes("const SEDES_DISPONIBLES = ['Ambas', 'San Antonio', 'Capri', 'Centro de Producción'];"));
assert(usuarios.includes('normalizarRolesPersistidos_(usuario);'));
assert(html.includes('<option>Caja</option>'));
assert(html.includes('<option>Gerencia</option>'));
assert(html.includes('Editar perfil y sede'));
assert(config.includes("Inventario y abastecimiento', soloRol: ['Administrador','Caja','Cocina','Gerencia']"));
assert(config.includes("Panel FUDO', soloRol: ['Administrador','Caja','Gerencia']"));

console.log('✓ perfiles y permisos: matriz canónica, lectura entre sedes y escritura restringida');
`;
write('tests/perfiles-permisos.test.js', test);

let pkg = JSON.parse(read('package.json'));
if (!pkg.scripts.test.includes('tests/perfiles-permisos.test.js')) {
  pkg.scripts.test = pkg.scripts.test.replace('node tests/usuarios-reactivacion.test.js', 'node tests/usuarios-reactivacion.test.js && node tests/perfiles-permisos.test.js');
}
write('package.json', JSON.stringify(pkg, null, 2) + '\n');

console.log('Perfiles y permisos aplicados correctamente.');
