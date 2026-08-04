// ============================================================================
// CONFIGURACIÓN — Dilana OS
// Reemplaza API_URL por tu URL de despliegue de Apps Script (termina en /exec)
// La obtienes en Apps Script: Implementar > Nueva implementación > Aplicación web
// No pegues tokens, contraseñas ni secretos aquí; el frontend es público para quien lo abra.
// ============================================================================
const API_URL = 'https://script.google.com/macros/s/AKfycbxOkVbJtM1QAzAVqPjHHRxHeReHZS5kxcuOPURApSpOT7z_7NSQ5gIwvVAlv3aRrEaWYQ/exec';

// sessionStorage (no localStorage): el token vive solo mientras la pestaña sigue abierta — se borra
// solo al cerrar la pestaña o el navegador, en vez de quedar guardado indefinidamente. Con
// localStorage, un token filtrado (ej. por una futura falla de XSS) seguía siendo válido y legible
// días después sin que cerrar el navegador ayudara en nada; con sessionStorage, un token robado
// deja de estar disponible ahí en cuanto se cierra esa pestaña, aunque el token en sí siga vivo en
// el servidor hasta sus 12h (auditoría de seguridad, jul 2026). En el uso real (una pestaña abierta
// todo el turno en la tablet de caja) esto no cambia nada del día a día — solo pide iniciar sesión
// de nuevo si de verdad se cerró la pestaña/el navegador.
const Sesion = {
  guardar(token, usuario) {
    sessionStorage.setItem('dilana_token', token);
    sessionStorage.setItem('dilana_usuario', JSON.stringify(usuario));
  },
  token() {
    return sessionStorage.getItem('dilana_token');
  },
  usuario() {
    try { return JSON.parse(sessionStorage.getItem('dilana_usuario')); } catch (e) { return null; }
  },
  async cerrar() {
    try { await llamar('logout'); } catch (e) { /* si falla, igual cerramos localmente */ }
    sessionStorage.removeItem('dilana_token');
    sessionStorage.removeItem('dilana_usuario');
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
    // Content-Type 'text/plain' a propósito (no 'application/json'): un Content-Type que no sea
    // "simple" (application/json lo es) hace que el navegador mande antes una solicitud CORS
    // preflight (OPTIONS) — y el /exec de Apps Script no responde OPTIONS, así que ese preflight
    // siempre falla con "Response to preflight request doesn't pass access control check", aunque
    // el propio backend y el deploy estén perfectamente bien configurados. El backend igual lee el
    // cuerpo con JSON.parse(e.postData.contents) sin mirar el Content-Type declarado (handleRequest_
    // en Code.gs), así que el cambio no le afecta en nada.
    res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(body)
    });
  } catch (err) {
    return { ok: false, error: 'No se pudo conectar con el servidor. Revisa que API_URL en config.js termine en /exec y que abras la app con http(s), no como archivo local (file://).' };
  }
  const texto = await res.text();
  let data;
  try {
    data = JSON.parse(texto);
  } catch (err) {
    // Apps Script devuelve una página HTML cuando el proyecto no arranca (ej. const duplicado
    // en FudoEstado.gs pegado dos veces en el editor). Mostrar el error real ayuda a diagnosticar.
    const syntax = texto.match(/SyntaxError:[^<]+/);
    if (syntax) {
      return { ok: false, error: 'El backend de Apps Script no arranca: ' + syntax[0].replace(/&#39;/g, "'") + '. Abre el editor de Apps Script, busca el archivo indicado y elimina código duplicado; luego Implementar > Nueva implementación.' };
    }
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

/** Lee un <input type="file"> y devuelve { nombre, mime_type, contenido_base64 } para evidencia_subir. */
function leerArchivoBase64_(input) {
  const file = input.files[0];
  if (!file) return Promise.resolve(null);
  if (file.size > 8 * 1024 * 1024) return Promise.reject(new Error('La foto no puede superar 8 MB'));
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = String(reader.result || '').split(',')[1];
      if (!base64) { reject(new Error('No se pudo leer la foto')); return; }
      resolve({ nombre: file.name, mime_type: file.type || 'image/jpeg', contenido_base64: base64 });
    };
    reader.onerror = () => reject(new Error('No se pudo leer la foto'));
    reader.readAsDataURL(file);
  });
}

/** Extrae el ID de Drive de una referencia interna (evidencia:ID) o de una URL legacy de Drive. */
function evidenciaExtraerId_(ref) {
  if (!ref) return '';
  const s = String(ref);
  if (s.indexOf('evidencia:') === 0) return s.slice(10);
  const m = s.match(/\/file\/d\/([^/]+)/);
  if (m) return m[1];
  const m2 = s.match(/[?&]id=([^&]+)/);
  if (m2) return m2[1];
  return '';
}

/** HTML seguro para enlazar una evidencia (abre vía API autenticada si hay ID conocido). */
function evidenciaEnlaceHtml_(ref, texto) {
  if (!ref) return '—';
  const etiqueta = texto || 'Ver foto';
  const id = evidenciaExtraerId_(ref);
  if (id) {
    return `<a href="#" class="evidencia-enlace" data-evidencia-id="${escapeHtml(id)}">${escapeHtml(etiqueta)}</a>`;
  }
  return `<a href="${escapeHtml(ref)}" target="_blank" rel="noopener">${escapeHtml(etiqueta)}</a>`;
}

/** Abre una evidencia en una pestaña nueva (descarga vía evidencia_obtener con sesión). */
async function evidenciaAbrir_(refOrId) {
  const id = evidenciaExtraerId_(refOrId) || refOrId;
  if (!id) { alert('Enlace de evidencia inválido'); return; }
  const data = await llamar('evidencia_obtener', { file_id: id });
  if (!data.ok) { alert(data.error || 'No se pudo abrir la evidencia'); return; }
  const mime = data.mime_type || 'application/octet-stream';
  const bin = atob(data.contenido_base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const blob = new Blob([bytes], { type: mime });
  const url = URL.createObjectURL(blob);
  window.open(url, '_blank', 'noopener');
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

document.addEventListener('click', (e) => {
  const enlace = e.target.closest('.evidencia-enlace');
  if (!enlace) return;
  e.preventDefault();
  evidenciaAbrir_(enlace.dataset.evidenciaId);
});

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

// Puntos de conteo disponibles por sede — fuente única compartida entre conteo, traslados,
// producción e históricos. Los nombres deben coincidir con el histórico operativo real
// ("Cocina terraza", "Bodega segundo piso", etc.) — no usar listas genéricas del modelo.
const PUNTOS_POR_SEDE = {
  'San Antonio': ['Cocina terraza', 'Primer piso', 'Bodega'],
  'Capri': ['Cocina terraza', 'Nevera terraza', 'Neveras Primer piso', 'Cocina primer piso', 'Bodega segundo piso', 'Bodega Cocina'],
  'Centro de Producción': ['General']
};

let ubicacionesCatalogo_ = null;

async function cargarUbicaciones_() {
  if (ubicacionesCatalogo_) return ubicacionesCatalogo_;
  ubicacionesCatalogo_ = PUNTOS_POR_SEDE;
  return ubicacionesCatalogo_;
}

async function ubicacionesPorSede_(sede) {
  const cat = await cargarUbicaciones_();
  return cat[sede] || [];
}

async function ubicacionesTodasFlat_() {
  const cat = await cargarUbicaciones_();
  return Array.from(new Set(Object.values(cat).flat())).sort((a, b) => a.localeCompare(b, 'es'));
}

function ubicacionPredeterminada_(sede, lista) {
  const preferidas = {
    'San Antonio': 'Cocina terraza',
    'Capri': 'Cocina terraza',
    'Centro de Producción': 'General'
  };
  const pref = preferidas[sede];
  if (pref && lista.includes(pref)) return pref;
  return lista[0] || '';
}

async function poblarSelectUbicaciones_(select, sede, opciones) {
  if (!select) return;
  opciones = opciones || {};
  const anterior = select.value;
  const ubicaciones = opciones.todasLasSedes
    ? await ubicacionesTodasFlat_()
    : await ubicacionesPorSede_(sede);
  const vacio = opciones.opcionVacia !== undefined
    ? `<option value="">${escapeHtml(opciones.opcionVacia)}</option>`
    : '';
  select.innerHTML = vacio + ubicaciones.map(p => `<option>${escapeHtml(p)}</option>`).join('');
  if (ubicaciones.includes(anterior)) select.value = anterior;
  else if (opciones.seleccionarPrimera && ubicaciones.length) select.value = ubicaciones[0];
}

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

// Menú lateral — antes copiado y pegado a mano en cada una de las 21 páginas con <nav>, así que
// agregar/quitar un enlace significaba editar 21 archivos y, en la práctica, algunas páginas ya
// habían quedado con la lista desactualizada (faltaban enlaces que otras sí tenían). Ahora es una
// sola fuente: cada página solo trae `<nav id="menu-nav"></nav>` vacío y montarMenu_() lo llena
// según el rol de quien entró, marcando como activo el enlace de la página actual.
const MENU_PRINCIPAL = [
  { grupo: 'HOY' },
  { href: 'inicio.html', texto: 'Inicio de turno' },
  { href: 'abastecimiento.html', texto: 'Inventario y abastecimiento', soloRol: ['Administrador', 'Encargado', 'Lectura'] },
  { href: 'caja.html', texto: 'Caja', soloRol: ['Administrador', 'Encargado', 'Cocina'] },

  { grupo: 'REGISTRAR OPERACIÓN' },
  { href: 'conteo.html', texto: 'Conteo de inventario', soloRol: ['Administrador', 'Encargado', 'Cocina'] },
  { href: 'producir.html', texto: 'Producción', soloRol: ['Administrador', 'Encargado', 'Cocina'] },
  { href: 'traslados.html', texto: 'Traslados', soloRol: ['Administrador', 'Encargado', 'Cocina'] },
  { href: 'compras.html', texto: 'Compras', soloRol: ['Administrador', 'Encargado', 'Cocina'] },
  { href: 'gestiones.html', texto: 'Novedades', soloRol: ['Administrador', 'Encargado', 'Cocina'] },

  { grupo: 'CONTROL Y REVISIÓN' },
  { href: 'conciliacion.html', texto: 'Conciliación', soloRol: ['Administrador', 'Encargado', 'Lectura'] },
  { href: 'inventario-ubicacion.html', texto: 'Inventario por ubicación', soloRol: ['Administrador', 'Encargado', 'Lectura'] },
  { href: 'libro-inventario.html', texto: 'Libro de inventario', soloRol: ['Administrador', 'Encargado', 'Lectura'] },
  { href: 'historial-conteos.html', texto: 'Histórico de conteos', soloRol: ['Administrador', 'Encargado', 'Lectura'] },
  { href: 'historial-producciones.html', texto: 'Histórico de producción', soloRol: ['Administrador', 'Encargado', 'Lectura'] },
  { href: 'historial-mermas.html', texto: 'Histórico de mermas', soloRol: ['Administrador', 'Encargado', 'Lectura'] },
  { href: 'historial-conciliacion.html', texto: 'Histórico de conciliación', soloRol: ['Administrador', 'Encargado', 'Lectura'] },
  { href: 'historial-cierres-turno.html', texto: 'Histórico de cierres', soloRol: ['Administrador', 'Encargado', 'Lectura'] },

  { grupo: 'CONFIGURACIÓN' },
  { href: 'recetas.html', texto: 'Recetas', soloRol: ['Administrador'] },
  { href: 'catalogo.html', texto: 'Catálogo de productos', soloRol: ['Administrador', 'Encargado', 'Cocina'] },
  { href: 'fudo.html', texto: 'Panel FUDO', soloRol: ['Administrador', 'Encargado'] },
  { href: 'importar.html', texto: 'Importar de FUDO', soloRol: ['Administrador'] },
  { href: 'diagnostico.html', texto: 'Diagnóstico', soloRol: ['Administrador'] },
  { href: 'usuarios.html', texto: 'Usuarios', soloRol: ['Administrador'] },
  { href: 'base-caja.html', texto: 'Base de caja anterior', soloRol: ['Administrador'] }
];

/** Pinta el <nav id="menu-nav"> de la página actual con los enlaces que le tocan a `rolActual`,
 * marcando como activo el que corresponde al archivo abierto. Si la página no trae ese <nav> (ej.
 * cambiar-password.html), no hace nada. */
function montarMenu_(rolActual) {
  const nav = document.getElementById('menu-nav');
  if (!nav) return;
  const actual = window.location.pathname.split('/').pop();
  let html = '';
  let grupoPendiente = '';
  MENU_PRINCIPAL.forEach(function (item) {
    if (item.grupo) {
      grupoPendiente = item.grupo;
      return;
    }
    const visible = !item.soloRol || item.soloRol.indexOf(rolActual) !== -1;
    if (!visible) return;
    if (grupoPendiente) {
      html += `<div class="nav-grupo">${escapeHtml(grupoPendiente)}</div>`;
      grupoPendiente = '';
    }
    const clase = item.href === actual ? ' class="activo"' : '';
    html += `<a href="${escapeHtml(item.href)}"${clase}>${escapeHtml(item.texto)}</a>`;
  });
  nav.innerHTML = html;
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
  montarMenu_(u ? u.rol : null);
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
