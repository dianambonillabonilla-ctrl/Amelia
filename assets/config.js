// ============================================================================
// CONFIGURACIÓN — Dilana OS
// Reemplaza API_URL por tu URL de despliegue de Apps Script (termina en /exec)
// La obtienes en Apps Script: Implementar > Nueva implementación > Aplicación web
// ============================================================================
const API_URL = 'https://script.google.com/macros/s/TU_ID_DE_DESPLIEGUE/exec';

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
  cerrar() {
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
  if (!data.ok && data.error && data.error.indexOf('Sesión') !== -1) {
    Sesion.cerrar();
  }
  return data;
}

// Pinta el nombre/rol del usuario y engancha el botón de salir en cualquier página que lo incluya
function montarBarraUsuario() {
  const u = Sesion.usuario();
  const el = document.getElementById('barra-usuario');
  if (el && u) {
    el.innerHTML = `<span>${u.nombre} · ${u.rol} · ${u.sede}</span><button id="btn-salir">Salir</button>`;
    document.getElementById('btn-salir').addEventListener('click', () => Sesion.cerrar());
  }
}
