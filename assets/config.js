const API_URL = 'https://script.google.com/macros/s/AKfycbxOkVbJtM1QAzAVqPjHHRxHeReHZS5kxcuOPURApSpOT7z_7NSQ5gIwvVAlv3aRrEaWYQ/exec';

const Sesion = {
  guardar(token, usuario) {
    sessionStorage.setItem('dilana_token', token);
    sessionStorage.setItem('dilana_usuario', JSON.stringify(usuario));
  },
  token() { return sessionStorage.getItem('dilana_token'); },
  usuario() {
    try { return JSON.parse(sessionStorage.getItem('dilana_usuario')); }
    catch (e) { return null; }
  },
  async cerrar() {
    try { await llamar('logout'); } catch (e) {}
    sessionStorage.removeItem('dilana_token');
    sessionStorage.removeItem('dilana_usuario');
    window.location.href = 'index.html';
  },
  requerir() {
    if (!this.token()) window.location.href = 'index.html';
  }
};

// Sin límite, una petición lenta deja la pantalla esperando indefinidamente: no hay error, no hay
// reintento, solo un "Consultando…" que nunca termina y que quien está en la sede interpreta como
// que la aplicación se dañó. Se corta y se explica. Las acciones que de verdad tardan (sincronizar
// con FUDO) pasan su propio límite más holgado.
const LLAMAR_TIMEOUT_MS = 45000;

async function llamar(action, params = {}, opciones = {}) {
  const body = Object.assign({ action, token: Sesion.token() }, params);
  const limite = Number(opciones.timeoutMs) > 0 ? Number(opciones.timeoutMs) : LLAMAR_TIMEOUT_MS;
  const control = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const cortar = control ? setTimeout(() => control.abort(), limite) : null;
  let res;
  try {
    res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(body),
      signal: control ? control.signal : undefined
    });
  } catch (err) {
    if (err && err.name === 'AbortError') {
      return {
        ok: false, codigo: 'TIEMPO_AGOTADO',
        error: 'El servidor tardó más de ' + Math.round(limite / 1000) + ' segundos en responder. Vuelve a intentarlo; si sigue igual, revisa la conexión.'
      };
    }
    return { ok: false, error: 'No se pudo conectar con el servidor. Revisa la conexión e inténtalo nuevamente.' };
  } finally {
    if (cortar) clearTimeout(cortar);
  }
  const texto = await res.text();
  let data;
  try { data = JSON.parse(texto); }
  catch (err) {
    const syntax = texto.match(/SyntaxError:[^<]+/);
    if (syntax) return { ok: false, error: 'El backend de Apps Script no arranca: ' + syntax[0].replace(/&#39;/g, "'") };
    return { ok: false, error: 'El servidor respondió algo que no se pudo leer. Cierra sesión e inicia nuevamente.' };
  }
  if (!data.ok && data.codigo === 'SESION_INVALIDA') Sesion.cerrar();
  return data;
}

function escapeHtml(valor) {
  return String(valor === null || valor === undefined ? '' : valor).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function fechaLocalHoy_() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function leerArchivoBase64_(input) {
  const file = input.files[0];
  if (!file) return Promise.resolve(null);
  if (file.size > 8 * 1024 * 1024) return Promise.reject(new Error('La foto no puede superar 8 MB'));
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = String(reader.result || '').split(',')[1];
      if (!base64) return reject(new Error('No se pudo leer la foto'));
      resolve({ nombre: file.name, mime_type: file.type || 'image/jpeg', contenido_base64: base64 });
    };
    reader.onerror = () => reject(new Error('No se pudo leer la foto'));
    reader.readAsDataURL(file);
  });
}

function evidenciaExtraerId_(ref) {
  if (!ref) return '';
  const s = String(ref);
  if (s.indexOf('evidencia:') === 0) return s.slice(10);
  const m = s.match(/\/file\/d\/([^/]+)/);
  if (m) return m[1];
  const m2 = s.match(/[?&]id=([^&]+)/);
  return m2 ? m2[1] : '';
}

function evidenciaEnlaceHtml_(ref, texto) {
  if (!ref) return '—';
  const etiqueta = texto || 'Ver foto';
  const id = evidenciaExtraerId_(ref);
  if (id) return `<a href="#" class="evidencia-enlace" data-evidencia-id="${escapeHtml(id)}">${escapeHtml(etiqueta)}</a>`;
  return `<a href="${escapeHtml(ref)}" target="_blank" rel="noopener">${escapeHtml(etiqueta)}</a>`;
}

async function evidenciaAbrir_(refOrId) {
  const id = evidenciaExtraerId_(refOrId) || refOrId;
  if (!id) return alert('Enlace de evidencia inválido');
  const data = await llamar('evidencia_obtener', { file_id: id });
  if (!data.ok) return alert(data.error || 'No se pudo abrir la evidencia');
  const bin = atob(data.contenido_base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const url = URL.createObjectURL(new Blob([bytes], { type: data.mime_type || 'application/octet-stream' }));
  window.open(url, '_blank', 'noopener');
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

document.addEventListener('click', e => {
  const enlace = e.target.closest('.evidencia-enlace');
  if (!enlace) return;
  e.preventDefault();
  evidenciaAbrir_(enlace.dataset.evidenciaId);
});

function normalizarTexto(s) {
  return String(s || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ');
}

function frecuenciasDelDia_(fechaStr) {
  if (!fechaStr) return ['Diario'];
  const [y, m, d] = fechaStr.split('-').map(Number);
  const dia = new Date(y, m - 1, d).getDay();
  const frecuencias = ['Diario'];
  if (dia === 3) frecuencias.push('Miércoles');
  if (dia === 5) frecuencias.push('Viernes');
  if (d >= 1 && d <= 5) frecuencias.push('Mensual');
  return frecuencias;
}

const PUNTOS_POR_SEDE = {
  'San Antonio': ['Cocina terraza', 'Primer piso', 'Bodega'],
  'Capri': ['Cocina terraza', 'Nevera terraza', 'Neveras Primer piso', 'Cocina primer piso', 'Bodega segundo piso', 'Bodega Cocina'],
  'Centro de Producción': ['General']
};
let ubicacionesCatalogo_ = null;
async function cargarUbicaciones_() { return ubicacionesCatalogo_ || (ubicacionesCatalogo_ = PUNTOS_POR_SEDE); }
async function ubicacionesPorSede_(sede) { const cat = await cargarUbicaciones_(); return cat[sede] || []; }
async function ubicacionesTodasFlat_() { const cat = await cargarUbicaciones_(); return Array.from(new Set(Object.values(cat).flat())).sort((a,b)=>a.localeCompare(b,'es')); }
function ubicacionPredeterminada_(sede, lista) {
  const preferidas = { 'San Antonio': 'Cocina terraza', 'Capri': 'Cocina terraza', 'Centro de Producción': 'General' };
  return preferidas[sede] && lista.includes(preferidas[sede]) ? preferidas[sede] : (lista[0] || '');
}
async function poblarSelectUbicaciones_(select, sede, opciones = {}) {
  if (!select) return;
  const anterior = select.value;
  const ubicaciones = opciones.todasLasSedes ? await ubicacionesTodasFlat_() : await ubicacionesPorSede_(sede);
  const vacio = opciones.opcionVacia !== undefined ? `<option value="">${escapeHtml(opciones.opcionVacia)}</option>` : '';
  select.innerHTML = vacio + ubicaciones.map(p => `<option>${escapeHtml(p)}</option>`).join('');
  if (ubicaciones.includes(anterior)) select.value = anterior;
  else if (opciones.seleccionarPrimera && ubicaciones.length) select.value = ubicaciones[0];
}

const SECTORES_DISPONIBLES = ['Cocina', 'Café', 'Caja', 'Bebidas'];
function partesCategoria(categoriaCompleta) {
  const texto = String(categoriaCompleta || '').trim();
  const i = texto.indexOf('/');
  return i === -1 ? { principal: texto, sub: '' } : { principal: texto.slice(0,i).trim(), sub: texto.slice(i+1).trim() };
}

function avisarGuardado(texto) {
  let el = document.getElementById('toast-confirmacion');
  if (!el) {
    el = document.createElement('div'); el.id = 'toast-confirmacion';
    el.style.cssText = 'position:fixed;top:18px;left:50%;transform:translateX(-50%);z-index:9999;background:var(--green);color:#fff;padding:14px 26px;border-radius:8px;font-weight:700;font-size:1rem;box-shadow:0 10px 30px rgba(0,0,0,.3);text-align:center;max-width:90vw';
    document.body.appendChild(el);
  }
  el.textContent = '✓ ' + texto; el.style.display = 'block';
  clearTimeout(el._ocultarEn); el._ocultarEn = setTimeout(() => { el.style.display = 'none'; }, 4000);
}

function conBotonProtegido(boton, fn) {
  return async (...args) => {
    if (boton.disabled) return;
    boton.disabled = true;
    try { await fn(...args); }
    catch (err) { alert('Algo salió mal y no se pudo completar la acción: ' + (err?.message || err)); }
    finally { boton.disabled = false; }
  };
}

const MENU_PRINCIPAL = [
  { grupo: 'HOY' },
  { href: 'inicio.html', texto: 'Inicio de turno' },
  { href: 'abastecimiento.html', texto: 'Inventario y abastecimiento', soloRol: ['Administrador','Encargado','Lectura'] },
  { href: 'caja.html', texto: 'Caja', soloRol: ['Administrador','Encargado','Cocina'] },
  { grupo: 'REGISTRAR OPERACIÓN' },
  { href: 'conteo.html', texto: 'Conteo de inventario', soloRol: ['Administrador','Encargado','Cocina'] },
  { href: 'producir.html', texto: 'Producción', soloRol: ['Administrador','Encargado','Cocina'] },
  { href: 'traslados.html', texto: 'Traslados', soloRol: ['Administrador','Encargado','Cocina'] },
  { href: 'compras.html', texto: 'Compras', soloRol: ['Administrador','Encargado','Cocina'] },
  { href: 'gestiones.html', texto: 'Novedades', soloRol: ['Administrador','Encargado','Cocina'] },
  { grupo: 'CONTROL Y REVISIÓN' },
  { href: 'conciliacion.html', texto: 'Conciliación', soloRol: ['Administrador','Encargado','Lectura'] },
  { href: 'inventario-ubicacion.html', texto: 'Inventario por ubicación', soloRol: ['Administrador','Encargado','Lectura'] },
  { href: 'libro-inventario.html', texto: 'Libro de inventario', soloRol: ['Administrador','Encargado','Lectura'] },
  { href: 'historiales.html', texto: 'Históricos', soloRol: ['Administrador','Encargado','Lectura'] },
  { grupo: 'CONFIGURACIÓN' },
  { href: 'recetas.html', texto: 'Recetas', soloRol: ['Administrador'] },
  { href: 'catalogo.html', texto: 'Catálogo de productos', soloRol: ['Administrador','Encargado','Cocina'] },
  { href: 'fudo.html', texto: 'Panel FUDO', soloRol: ['Administrador','Encargado'] },
  { href: 'importar.html', texto: 'Importar de FUDO', soloRol: ['Administrador'] },
  { href: 'diagnostico.html', texto: 'Diagnóstico', soloRol: ['Administrador'] },
  { href: 'usuarios.html', texto: 'Usuarios', soloRol: ['Administrador'] }
];

function montarMenu_(rolActual) {
  const nav = document.getElementById('menu-nav');
  if (!nav) return;
  const actual = window.location.pathname.split('/').pop();
  let html = '', grupoPendiente = '';
  MENU_PRINCIPAL.forEach(item => {
    if (item.grupo) { grupoPendiente = item.grupo; return; }
    if (item.soloRol && !item.soloRol.includes(rolActual)) return;
    if (grupoPendiente) { html += `<div class="nav-grupo">${escapeHtml(grupoPendiente)}</div>`; grupoPendiente = ''; }
    html += `<a href="${escapeHtml(item.href)}"${item.href === actual ? ' class="activo"' : ''}>${escapeHtml(item.texto)}</a>`;
  });
  nav.innerHTML = html;
}

function montarBarraUsuario() {
  const u = Sesion.usuario();
  const el = document.getElementById('barra-usuario');
  if (el && u) {
    el.innerHTML = `<span>${escapeHtml(u.nombre)} · ${escapeHtml(u.rol)} · ${escapeHtml(u.sede)}</span><a href="cambiar-password.html" style="font-size:.8rem">Cambiar contraseña</a><button id="btn-salir">Salir</button>`;
    document.getElementById('btn-salir').addEventListener('click', () => Sesion.cerrar());
  }
  montarMenu_(u ? u.rol : null);
  ocultarNavSegunRol_(u ? u.rol : null);
}

function ocultarNavSegunRol_(rolActual) {
  document.querySelectorAll('[data-solo-rol]').forEach(el => {
    const permitidos = el.dataset.soloRol.split(',').map(r => r.trim());
    if (!permitidos.includes(rolActual)) el.style.display = 'none';
  });
}

function requerirRol_(rolesPermitidos) {
  const u = Sesion.usuario();
  if (!u || !rolesPermitidos.includes(u.rol)) {
    alert('No tienes permiso para entrar aquí.');
    window.location.href = 'inicio.html';
  }
}

function restringirSelectorSede_(select) {
  if (!select) return;
  const u = Sesion.usuario();
  if (!u || u.rol === 'Administrador' || u.sede === 'Ambas') return;
  const permitidas = u.sede === 'Centro de Producción' ? [u.sede] : [u.sede, 'Centro de Producción'];
  Array.from(select.options).forEach(opt => { if (!permitidas.includes(opt.value)) opt.remove(); });
  permitidas.forEach(sede => {
    if (!Array.from(select.options).some(opt => opt.value === sede)) {
      const opt = document.createElement('option'); opt.value = sede; opt.textContent = sede; select.appendChild(opt);
    }
  });
  if (!permitidas.includes(select.value)) select.value = u.sede;
  select.disabled = permitidas.length <= 1;
}

// Carga reglas adicionales solo en el módulo de Caja.
if (/caja\.html$/i.test(window.location.pathname)) {
  const scriptCajaSegura = document.createElement('script');
  scriptCajaSegura.src = 'assets/caja-apertura-segura.js';
  document.head.appendChild(scriptCajaSegura);
}
