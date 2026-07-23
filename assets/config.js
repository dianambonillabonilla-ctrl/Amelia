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

// Diario se cuenta todos los días; Miércoles/Viernes solo si la fecha elegida cae en ese día de
// la semana; Mensual solo del 1 al 5 de cada mes (menaje/utensilios/equipos — ver "Inicio del
// Mes" del Excel histórico). Ver Registrar producto → Frecuencia de conteo. Se arma la fecha con
// año/mes/día locales, no parseando el string ISO directo, para que la zona horaria no corra el
// día. Compartida entre conteo.html (bloquea guardar si falta algo obligatorio de hoy) y
// dashboard.html (avisa al abrir la app qué toca contar hoy además de lo diario).
function frecuenciasDelDia_(fechaStr) {
  if (!fechaStr) return ['Diario'];
  const [y, m, d] = fechaStr.split('-').map(Number);
  const dia = new Date(y, m - 1, d).getDay(); // 0=domingo … 3=miércoles … 5=viernes
  const frecuencias = ['Diario'];
  if (dia === 3) frecuencias.push('Miércoles');
  if (dia === 5) frecuencias.push('Viernes');
  if (d >= 1 && d <= 5) frecuencias.push('Mensual');
  return frecuencias;
}

// Puntos de conteo disponibles por sede — compartido entre conteo.html y traslados.html.
const PUNTOS_POR_SEDE = {
  'San Antonio': ['Cocina terraza', 'Primer piso', 'Bodega'],
  'Capri': ['Cocina terraza', 'Nevera terraza', 'Neveras Primer piso', 'Cocina primer piso', 'Bodega segundo piso', 'Bodega Cocina'],
  'Centro de Producción': ['General']
};

// Lista fija de sectores (compartida entre usuarios.html y catalogo.html) — pedido explícito: "que
// se dejen seleccionar con selección múltiple nada de escribir y comas porque eso hace que si me
// equivoco escribiendo no se organice bien". Antes "Sectores que puede elegir" (Usuarios) y "Sector
// responsable" (Registrar producto) eran campos de texto libre, y el sistema los compara letra por
// letra (turnoFaltantesPorSector_ en Turnos.gs) — un typo o una mayúscula distinta entre los dos
// rompía en silencio el chequeo de "qué sector falta contar" sin ningún aviso. Con una lista fija
// en los dos lados, siempre coinciden exactamente. Si algún día hace falta un sector nuevo, se
// agrega aquí (una sola vez) en vez de dejar que cualquiera lo escriba distinto cada vez.
const SECTORES_DISPONIBLES = ['Cocina', 'Café', 'Caja', 'Bebidas'];

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
//
// El catch es lo que de verdad resuelve "a veces guarda, a veces no guarda, no se sabe": llamar()
// ya atrapa los errores de red/JSON, pero si el código del propio botón lanzaba un error
// inesperado (ej. un elemento que no existía en esa pantalla, algo null donde no debía) esa
// excepción se perdía como un "unhandled promise rejection" — no salía ni el aviso verde ni una
// alerta de error, la pantalla se quedaba muda y quien hizo clic no tenía forma de saber si guardó
// o no. Ahora cualquier error inesperado, sea cual sea, siempre termina en una alerta visible.
function conBotonProtegido(boton, fn) {
  return async (...args) => {
    if (boton.disabled) return;
    boton.disabled = true;
    try {
      await fn(...args);
    } catch (err) {
      alert('Algo salió mal y no se pudo completar la acción. Vuelve a intentarlo — si sigue pasando, avisa con este detalle: ' + (err && err.message ? err.message : err));
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

// Bloquea un <select> de sede a lo que el usuario realmente puede ver/registrar (Administrador y
// sede "Ambas" ven todas las opciones, sin cambios). El backend ya rechaza consultar/registrar en
// otra sede (sedeConsultaPermitida_/sedeEscrituraPermitida_ en Code.gs), pero sin esto la interfaz
// seguía OFRECIENDO elegir una sede ajena, dejando intentar algo que de todas formas iba a fallar
// (o, en pantallas de solo lectura, sin nada que se lo impidiera desde el navegador).
//
// Centro de Producción es la excepción: además de su propia sede, San Antonio y Capri también
// pueden ver/registrar cosas ahí (ese personal también lo cubre en la práctica — mismo criterio
// que sedeEscrituraPermitida_ del lado del servidor), así que se deja como segunda opción en vez
// de quitarla. Un usuario cuya sede YA es Centro de Producción no gana ninguna sede extra.
function restringirSelectorSede_(select) {
  if (!select) return;
  const u = Sesion.usuario();
  if (!u || u.rol === 'Administrador' || u.sede === 'Ambas') return;
  const permitidas = u.sede === 'Centro de Producción' ? [u.sede] : [u.sede, 'Centro de Producción'];
  Array.from(select.options).forEach(opt => {
    if (!permitidas.includes(opt.value)) opt.remove();
  });
  permitidas.forEach(sede => {
    if (!Array.from(select.options).some(opt => opt.value === sede)) {
      const opt = document.createElement('option');
      opt.value = sede; opt.textContent = sede;
      select.appendChild(opt);
    }
  });
  if (!permitidas.includes(select.value)) select.value = u.sede;
  // Con una sola opción posible no hay nada que elegir: se deja fija como antes. Con dos (su sede
  // + Centro de Producción) se deja elegir entre las dos.
  select.disabled = permitidas.length <= 1;
}
