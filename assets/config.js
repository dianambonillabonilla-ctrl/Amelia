// ============================================================================
// CONFIGURACIÓN — Dilana OS
// Reemplaza API_URL por tu URL de despliegue de Apps Script (termina en /exec)
// La obtienes en Apps Script: Implementar > Nueva implementación > Aplicación web
// ============================================================================
const API_URL = 'https://script.google.com/macros/s/AKfycbxOkVbJtM1QAzAVqPjHHRxHeReHZS5kxcuOPURApSpOT7z_7NSQ5gIwvVAlv3aRrEaWYQ/exec';

const Sesion = {
  guardar(token, usuario) {
    localStorage.setItem('dilana_token', token);
    localStorage.setItem('dilana_usuario', JSON.stringify(usuario));
  },
  token() {
    return localStorage.getItem('dilana_token');
  },
  usuario() {
    try { return JSON.parse(localStorage.getItem('dilana_usuario')); } catch (e) { return null; }
  },
  async cerrar() {
    try { await llamar('logout'); } catch (e) { /* si falla, igual cerramos localmente */ }
    localStorage.removeItem('dilana_token');
    localStorage.removeItem('dilana_usuario');
    window.location.href = 'index.html';
  },
  requerir() {
    if (!this.token()) window.location.href = 'index.html';
  }
};

async function llamar(action, params = {}) {
  const body = Object.assign({ action, token: Sesion.token() }, params);
  const res = await fetch(API_URL, {
    method: 'POST',
    body: JSON.stringify(body)
  });
  const data = await res.json();
  if (!data.ok && data.codigo === 'SESION_INVALIDA') {
    Sesion.cerrar();
  }
  return data;
}

// Escapa texto que viene del backend (nombres de producto/ingrediente, etc. son campos libres
// que cualquier usuario autenticado puede escribir) antes de insertarlo con innerHTML.
function escapeHtml(valor) {
  return String(valor === null || valor === undefined ? '' : valor).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

// Espejo de normalizar_() en Catalogo.gs — para comparar nombres de producto en el navegador
// (sin tildes, minúsculas, espacios colapsados) antes de mandar nada al backend.
function normalizarTexto(s) {
  return String(s || '')
    .trim()
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ');
}

// La hoja Catalogo_Maestro guarda categoría y subcategoría juntas en un solo campo "categoria",
// separadas por "/" (ej. "Bebidas/Cerveza", "Materia Prima/Fruver") — no hay columna aparte.
// Parte ese texto para poder filtrar/agrupar por cada parte.
function partesCategoria(categoriaCompleta) {
  const texto = String(categoriaCompleta || '').trim();
  const i = texto.indexOf('/');
  if (i === -1) return { principal: texto, sub: '' };
  return { principal: texto.slice(0, i).trim(), sub: texto.slice(i + 1).trim() };
}

// Aviso grande y fijo en la parte de arriba de la pantalla para confirmar que algo se guardó —
// reemplaza los textitos pequeños junto a los botones, que en la práctica el personal no notaba
// (el guardado sí funcionaba, pero la confirmación pasaba desapercibida).
function avisarGuardado(texto) {
  let el = document.getElementById('toast-confirmacion');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast-confirmacion';
    el.style.cssText = 'position:fixed; top:18px; left:50%; transform:translateX(-50%); z-index:9999;' +
      'background:var(--green); color:#fff; padding:14px 26px; border-radius:8px; font-weight:700;' +
      'font-size:1rem; box-shadow:0 10px 30px rgba(0,0,0,.3); text-align:center; max-width:90vw;';
    document.body.appendChild(el);
  }
  el.textContent = '✓ ' + texto;
  el.style.display = 'block';
  clearTimeout(el._ocultarEn);
  el._ocultarEn = setTimeout(() => { el.style.display = 'none'; }, 4000);
}

// Pinta el nombre/rol del usuario y engancha el botón de salir en cualquier página que lo incluya
function montarBarraUsuario() {
  const u = Sesion.usuario();
  const el = document.getElementById('barra-usuario');
  if (el && u) {
    el.innerHTML = `<span>${escapeHtml(u.nombre)} · ${escapeHtml(u.rol)} · ${escapeHtml(u.sede)}</span>` +
      `<a href="cambiar-password.html" style="font-size:.8rem">Cambiar contraseña</a>` +
      `<button id="btn-salir">Salir</button>`;
    document.getElementById('btn-salir').addEventListener('click', () => Sesion.cerrar());
  }
}
