// ============================================================================
// CONFIGURACIÓN — Dilana OS
// Reemplaza API_URL por tu URL de despliegue de Apps Script (termina en /exec)
// La obtienes en Apps Script: Implementar > Nueva implementación > Aplicación web
// ============================================================================
const API_URL = 'https://script.google.com/macros/s/AKfycbwwuq9adLQy7IbZG5ld_rMjow9YH_oJD_zI8sd368SWuML_r69LKlcyn4oNVxwvfZxgVg/exec';

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
