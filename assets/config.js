// ============================================================================
// CONFIGURACIÓN — Dilana OS
// Reemplaza API_URL por tu URL de despliegue de Apps Script (termina en /exec)
// La obtienes en Apps Script: Implementar > Nueva implementación > Aplicación web
// No pegues tokens, contraseñas ni secretos aquí; el frontend es público para quien lo abra.
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

// Nunca deja que un fallo de red o de sesión se convierta en una promesa rechazada sin atrapar:
// eso dejaba pantallas enteras (ej. el botón "Guardar conteo") sin ningún aviso — ni el letrero
// verde ni una alerta de error, como si el clic no hubiera hecho nada, aunque a veces el dato sí
// se hubiera guardado del lado del servidor y solo fallara la respuesta de vuelta al navegador.
// Con esto, cualquier página que ya haga `if (data.ok) {...} else { alert(data.error) }` queda
// protegida automáticamente, sin tener que repetir un try/catch en cada botón.
async function llamar(action, params = {}) {
  const body = Object.assign({ action, token: Sesion.token() }, params);
  let res;
  try {
    res = await fetch(API_URL, { method: 'POST', body: JSON.stringify(body) });
  } catch (err) {
    return { ok: false, error: 'No se pudo conectar con el servidor. Revisa tu conexión e inténtalo de nuevo.' };
  }
  let data;
  try {
    data = await res.json();
  } catch (err) {
    // Ej. la sesión venció y Apps Script devolvió una página de login en vez del JSON esperado.
    return { ok: false, error: 'El servidor respondió algo que no se pudo leer. Vuelve a intentarlo; si sigue igual, cierra sesión y entra de nuevo.' };
  }
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

// Fecha de HOY en hora local como "yyyy-MM-dd", para precargar <input type="date">.
// OJO: no usar `input.valueAsDate = new Date()` para esto — valueAsDate siempre interpreta el
// Date en UTC, y en Bogotá (UTC-5) eso hace que después de ~7pm hora local el input ya muestre
// el día siguiente (la fecha en UTC ya cruzó la medianoche aunque acá todavía sea "hoy").
// Asignar este string a `input.value` en cambio usa la fecha tal como la ve el reloj del navegador.
function fechaLocalHoy_() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
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

// Puntos de conteo disponibles por sede — compartido entre conteo.html y traslados.html.
const PUNTOS_POR_SEDE = {
  'San Antonio': ['Cocina terraza', 'Primer piso', 'Bodega'],
  'Capri': ['Cocina terraza', 'Nevera terraza', 'Neveras Primer piso', 'Cocina primer piso', 'Bodega segundo piso', 'Bodega Cocina'],
  'Centro de Producción': ['General']
};

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

// Evita registros duplicados por doble clic: desactiva el botón mientras la operación está en
// curso y lo reactiva al terminar (con éxito o con error).
function conBotonProtegido(boton, fn) {
  return async (...args) => {
    if (boton.disabled) return;
    boton.disabled = true;
    try {
      await fn(...args);
    } finally {
      boton.disabled = false;
    }
  };
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
  ocultarNavSegunRol_(u ? u.rol : null);
}

// Oculta cualquier elemento marcado con data-solo-rol (links del menú, tarjetas de formulario, etc.)
// si el usuario no tiene ese rol (ej. "Importar de FUDO" o "Usuarios" son solo Administrador — el
// backend ya lo rechaza, pero además no debe aparecer como opción para no confundir a
// Encargado/Cocina/Lectura). Antes solo se buscaba dentro de <nav>, así que tarjetas fuera del
// menú (ej. "Nueva línea de receta" en recetas.html) quedaban con el atributo pero visibles.
function ocultarNavSegunRol_(rolActual) {
  document.querySelectorAll('[data-solo-rol]').forEach(a => {
    const permitidos = a.dataset.soloRol.split(',').map(r => r.trim());
    if (!permitidos.includes(rolActual)) a.style.display = 'none';
  });
}

// Corta en seco el acceso a una página completa si el rol no está permitido (ej. importar.html) —
// por si alguien entra directo por URL en vez de por el menú. Redirige al dashboard.
function requerirRol_(rolesPermitidos) {
  const u = Sesion.usuario();
  if (!u || !rolesPermitidos.includes(u.rol)) {
    alert('No tienes permiso para entrar aquí.');
    window.location.href = 'dashboard.html';
  }
}

// Bloquea un <select> de sede a la sede propia del usuario (Administrador y sede "Ambas" ven todas
// las opciones, sin cambios). El backend ya rechaza consultar/registrar en otra sede
// (sedeConsultaPermitida_ en Code.gs, y las validaciones de cada _registrar_), pero sin esto la
// interfaz seguía OFRECIENDO elegir "Capri" o "Centro de Producción" a alguien de San Antonio,
// dejándolo intentar algo que de todas formas iba a fallar (o, en pantallas de solo lectura, sin
// nada que se lo impidiera desde el navegador). Quita las demás opciones del <select> (para que no
// aparezcan ni como lectura) y lo deja fijo en la sede del usuario.
function restringirSelectorSede_(select) {
  if (!select) return;
  const u = Sesion.usuario();
  if (!u || u.rol === 'Administrador' || u.sede === 'Ambas') return;
  Array.from(select.options).forEach(opt => {
    if (opt.value !== u.sede) opt.remove();
  });
  if (!select.options.length) {
    const opt = document.createElement('option');
    opt.value = u.sede; opt.textContent = u.sede;
    select.appendChild(opt);
  }
  select.value = u.sede;
  select.disabled = true;
}
