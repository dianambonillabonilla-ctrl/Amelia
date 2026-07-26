#!/usr/bin/env node
/**
 * PRUEBA CONTRA EL DESPLIEGUE REAL DE APPS SCRIPT
 *
 * A diferencia del resto de `tests/`, esta SÍ necesita red: habla con la Web App publicada y, por
 * tanto, con el Google Sheet de verdad. Por eso NO va dentro de `npm test` (que debe seguir
 * corriendo offline). Se lanza aparte:
 *
 *   npm run test:api                    # nivel 1: sin credenciales
 *   DILANA_USUARIO=... DILANA_PASSWORD=... npm run test:api   # nivel 1 + 2
 *
 * Nivel 1 (sin credenciales) — comprueba que el despliegue esté vivo y respete el contrato:
 *   GET rechazado, login procesado, JSON inválido manejado, sesión exigida.
 * Nivel 2 (con usuario y contraseña) — inicia sesión y recorre TODAS las acciones de LECTURA
 *   contra los datos reales, midiendo cuánto tarda cada una. Es la única forma de saber si una
 *   pantalla aguanta el volumen real de datos, porque el límite de Apps Script son 6 minutos por
 *   ejecución y las pruebas offline usan un Sheet simulado.
 *
 * NUNCA llama acciones que escriban, borren o migren: la lista de abajo es una lista blanca de
 * solo lectura. Se puede correr sobre producción sin miedo.
 *
 * Conviene usar un usuario dedicado con rol "Lectura" en vez de un Administrador. Las acciones que
 * exigen Administrador se reportan como "sin permiso (esperado)", no como fallo.
 */
const fs = require('fs');
const path = require('path');

// Umbrales pensados para Apps Script, no para una API normal: cada llamada paga arranque del script
// y apertura del spreadsheet antes de calcular nada.
const AVISO_MS = 10000;
const LENTO_MS = 30000;
const LIMITE_APPS_SCRIPT_MS = 360000; // 6 minutos: Google corta la ejecución aquí

function urlDesdeConfig() {
  const config = fs.readFileSync(path.join(__dirname, '..', 'assets', 'config.js'), 'utf8');
  const m = config.match(/const API_URL = '([^']+)'/);
  if (!m) throw new Error('No se encontró API_URL en assets/config.js');
  return m[1];
}

const API_URL = process.env.API_URL || urlDesdeConfig();
const USUARIO = process.env.DILANA_USUARIO || '';
const PASSWORD = process.env.DILANA_PASSWORD || '';

const fallos = [];
function ok(msg) { console.log('  OK    ' + msg); }
function fallo(msg) { console.log('  FALLA ' + msg); fallos.push(msg); }
function aviso(msg) { console.log('  AVISO ' + msg); }

/**
 * Mismo Content-Type que usa el frontend: 'text/plain' evita el preflight CORS (el /exec de Apps
 * Script no responde OPTIONS). `redirect: follow` es imprescindible porque Google responde con una
 * redirección a googleusercontent.com antes de entregar el JSON.
 */
async function llamar(cuerpo, tiempoMaxMs = LIMITE_APPS_SCRIPT_MS) {
  const t0 = Date.now();
  const control = new AbortController();
  const alarma = setTimeout(() => control.abort(), tiempoMaxMs);
  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo),
      redirect: 'follow',
      signal: control.signal
    });
    const texto = await res.text();
    const ms = Date.now() - t0;
    let data;
    try {
      data = JSON.parse(texto);
    } catch (e) {
      // Apps Script devuelve HTML cuando el proyecto no arranca (ej. un const duplicado) o cuando
      // la ejecución se pasó del límite. El texto crudo es la única pista útil.
      const syntax = texto.match(/SyntaxError:[^<]+/);
      return { ms, http: res.status, noJson: true, detalle: syntax ? syntax[0] : texto.slice(0, 300) };
    }
    return { ms, http: res.status, data };
  } catch (e) {
    return { ms: Date.now() - t0, abortado: e.name === 'AbortError', error: e.message };
  } finally {
    clearTimeout(alarma);
  }
}

// ---------------------------------------------------------------------------
// NIVEL 1 — sin credenciales
// ---------------------------------------------------------------------------
async function nivel1() {
  console.log('\n=== NIVEL 1: el despliegue está vivo y respeta el contrato ===');
  console.log('  URL: ' + API_URL.replace(/\/s\/[^/]+\//, '/s/…/'));

  const g = await (async () => {
    const t0 = Date.now();
    const res = await fetch(API_URL, { redirect: 'follow' });
    const texto = await res.text();
    try { return { ms: Date.now() - t0, http: res.status, data: JSON.parse(texto) }; }
    catch (e) { return { ms: Date.now() - t0, http: res.status, noJson: true, detalle: texto.slice(0, 200) }; }
  })();
  if (g.noJson) {
    fallo(`GET no devolvió JSON (HTTP ${g.http}). ¿Está publicada la Web App con acceso "Cualquier persona"? Detalle: ${g.detalle}`);
  } else if (g.data.ok === false && /solo acepta solicitudes POST/.test(g.data.error || '')) {
    ok(`GET rechazado como debe ser (${g.ms} ms) — no se aceptan credenciales por la URL.`);
  } else {
    fallo('GET respondió algo inesperado: ' + JSON.stringify(g.data).slice(0, 200));
  }

  const login = await llamar({ action: 'login', usuario: '__prueba_automatica__', password: '__no_valida__' });
  if (login.noJson) {
    fallo(`POST login no devolvió JSON (HTTP ${login.http}). Detalle: ${login.detalle}`);
  } else if (login.data && login.data.ok === false &&
      /incorrect|Demasiados intentos/i.test(login.data.error || '')) {
    // "Demasiados intentos" también vale: significa que la protección contra fuerza bruta está
    // activa para este usuario de prueba, que es justo lo que debe pasar si se corre muchas veces.
    ok(`POST login procesado (${login.ms} ms) — la API lee el JSON y ejecuta la autenticación.`);
  } else {
    fallo('POST login respondió algo inesperado: ' + JSON.stringify(login.data).slice(0, 200));
  }

  const malJson = await llamar('{esto no es json');
  if (malJson.data && malJson.data.ok === false && /JSON inválido/.test(malJson.data.error || '')) {
    ok(`Cuerpo mal formado se responde con un error claro (${malJson.ms} ms).`);
  } else {
    fallo('Un cuerpo mal formado no se manejó como se esperaba: ' + JSON.stringify(malJson).slice(0, 200));
  }

  const sinSesion = await llamar({ action: 'catalogo_listar' });
  if (sinSesion.data && sinSesion.data.ok === false) {
    ok(`Sin token no se puede leer nada (${sinSesion.ms} ms): "${sinSesion.data.error}"`);
  } else {
    fallo('¡Una acción de lectura respondió SIN token! ' + JSON.stringify(sinSesion.data).slice(0, 200));
  }
}

// ---------------------------------------------------------------------------
// NIVEL 2 — con credenciales: barrido de solo lectura sobre los datos reales
// ---------------------------------------------------------------------------
function hoyLocal() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function haceDias(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  const p = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * Lista BLANCA de solo lectura. Cualquier acción que escriba queda fuera a propósito, para que este
 * script se pueda correr contra producción sin riesgo.
 */
function accionesDeLectura(sede) {
  const hoy = hoyLocal();
  const hace7 = haceDias(7);
  const hace30 = haceDias(30);
  return [
    ['whoami', {}],
    ['catalogo_listar', {}],
    ['catalogo_alias_listar', {}],
    ['recetas_listar', { filtros: {} }],
    ['platos_fudo_sin_receta', {}],
    ['fudo_nombres_vistos', {}],
    ['disponible_hoy', { fecha: hoy, sede }],
    ['tendencia_ingrediente', { ingrediente: '', dias: 30, sede }], // se completa más abajo
    ['conteo_listar', { fecha: hoy, sede }],
    ['conteos_historial', { filtros: { fecha_desde: hace7, fecha_hasta: hoy } }],
    ['turno_sector_hoy', { fecha: hoy }],
    ['turno_faltantes_por_sector', { fecha: hoy, sede }],
    ['turno_cierre_estado', { fecha: hoy, sede }],
    ['turno_resumen_cierre', { fecha: hoy, sede }],
    ['cierres_turno_listar', { filtros: { fecha_desde: hace30, fecha_hasta: hoy } }],
    ['ajustes_inventario_listar', { fecha: hoy, sede, filtro: {} }],
    ['ajustes_inventario_historial', { filtros: { fecha_desde: hace7, fecha_hasta: hoy } }],
    ['compras_listar', { filtro: {} }],
    ['compras_resumen_gasto', { fecha_desde: hace30, fecha_hasta: hoy }],
    ['gestiones_listar', { filtro: {} }],
    ['produccion_listar', { fecha: hoy, filtro: {} }],
    ['produccion_historial', { filtros: { fecha_desde: hace7, fecha_hasta: hoy } }],
    ['traslados_listar', { filtro: {} }],
    ['conciliacion', { fecha: hoy }],
    ['conciliacion_historial_desfases', { fecha_desde: hace7, fecha_hasta: hoy }],
    ['movimientos_inventario_listar', { filtros: { fecha_desde: hace7, fecha_hasta: hoy, sede } }],
    ['movimientos_inventario_libro_listar', { filtros: { fecha_desde: hace7, fecha_hasta: hoy, sede } }],
    ['movimientos_venta_dia_listar', { fecha: hoy, sede }],
    ['resumen_diferencias_inventario', { fecha: hoy, sede }],
    ['inventario_libro_estado', {}],
    ['inventario_ubicacion_resumen', { fecha_desde: hace7, fecha_hasta: hoy, sede, punto: 'Cocina' }],
    ['fudo_panel_estado', {}],
    ['fudo_ventas_estado', {}],
    ['fudo_pagos_estado', {}],
    ['fudo_subitems_estado', {}],
    ['fudo_descuentos_propinas_estado', {}],
    ['fudo_ventas_listar', { filtros: { fecha_desde: hace7, fecha_hasta: hoy } }],
    ['fudo_items_listar', { filtros: { fecha_desde: hace7, fecha_hasta: hoy } }],
    ['fudo_pagos_listar', { filtros: { fecha_desde: hace7, fecha_hasta: hoy } }],
    ['fudo_mapeo_sede_listar', {}],
    ['usuarios_listar', {}],
    ['ventas_pendientes_sede_listar', {}],
    ['verificar_instalacion', {}],
    ['diagnostico_recetas', {}],
    ['diagnostico_recetas_sin_catalogo', {}],
    ['diagnostico_conteos_duplicados', {}],
    ['diagnostico_ventas_fudo', {}],
    ['diagnostico_compras_no_suman', {}],
    ['diagnostico_catalogo_duplicados', {}]
  ];
}

async function nivel2() {
  console.log('\n=== NIVEL 2: barrido de solo lectura sobre los datos REALES ===');
  const login = await llamar({ action: 'login', usuario: USUARIO, password: PASSWORD });
  if (!login.data || !login.data.ok) {
    fallo('No se pudo iniciar sesión: ' + JSON.stringify(login.data || login).slice(0, 250));
    return;
  }
  const token = login.data.token;
  const u = login.data.usuario;
  ok(`Sesión iniciada como "${u.nombre}" (rol ${u.rol}, sede ${u.sede}) en ${login.ms} ms.`);

  const sede = u.sede && u.sede !== 'Ambas' ? u.sede : 'San Antonio';
  console.log(`  Sede usada para las consultas por sede: ${sede}`);

  // La tendencia necesita un ingrediente que exista de verdad: se toma del catálogo.
  let ingrediente = '';
  const cat = await llamar({ action: 'catalogo_listar', token });
  if (cat.data && cat.data.ok && Array.isArray(cat.data.data) && cat.data.data.length) {
    const conNombre = cat.data.data.find((c) => c.nombre_estandar);
    if (conNombre) ingrediente = conNombre.nombre_estandar;
  }

  const resultados = [];
  for (const [accion, params] of accionesDeLectura(sede)) {
    const cuerpo = Object.assign({ action: accion, token }, params);
    if (accion === 'tendencia_ingrediente') {
      if (!ingrediente) { console.log('  (se omite tendencia_ingrediente: el catálogo está vacío)'); continue; }
      cuerpo.ingrediente = ingrediente;
    }
    const r = await llamar(cuerpo);
    let estado;
    if (r.abortado) estado = 'TIEMPO AGOTADO';
    else if (r.noJson) estado = 'SIN JSON';
    else if (r.data && r.data.ok) estado = 'ok';
    else if (r.data && /permiso|No puedes|Solo un Administrador|rol/i.test(r.data.error || '')) estado = 'sin permiso (esperado)';
    else estado = 'error';
    resultados.push({ accion, ms: r.ms, estado, detalle: r.data ? r.data.error : (r.detalle || r.error) });
  }

  const ancho = Math.max(...resultados.map((r) => r.accion.length));
  console.log('\n  ' + 'acción'.padEnd(ancho) + ' |      ms | estado');
  console.log('  ' + '-'.repeat(ancho) + '-+---------+--------');
  resultados.forEach((r) => {
    const marca = r.estado === 'ok' && r.ms > LENTO_MS ? '  <-- LENTO'
      : r.estado === 'ok' && r.ms > AVISO_MS ? '  <-- vigilar' : '';
    console.log('  ' + r.accion.padEnd(ancho) + ' | ' + String(r.ms).padStart(7) + ' | ' + r.estado + marca);
    if (r.estado === 'error' || r.estado === 'SIN JSON' || r.estado === 'TIEMPO AGOTADO') {
      console.log('      ^ ' + String(r.detalle).slice(0, 220));
    }
  });

  const conError = resultados.filter((r) => ['error', 'SIN JSON', 'TIEMPO AGOTADO'].includes(r.estado));
  conError.forEach((r) => fallos.push(`${r.accion}: ${r.estado} — ${String(r.detalle).slice(0, 150)}`));

  const lentas = resultados.filter((r) => r.estado === 'ok' && r.ms > LENTO_MS);
  const aVigilar = resultados.filter((r) => r.estado === 'ok' && r.ms > AVISO_MS && r.ms <= LENTO_MS);
  const buenas = resultados.filter((r) => r.estado === 'ok');
  const sinPermiso = resultados.filter((r) => r.estado === 'sin permiso (esperado)');

  console.log('');
  console.log(`  ${buenas.length} acción(es) respondieron ok, ${sinPermiso.length} sin permiso (esperado con rol Lectura), ${conError.length} con error.`);
  if (buenas.length) {
    const total = buenas.reduce((s, r) => s + r.ms, 0);
    const masLenta = buenas.slice().sort((a, b) => b.ms - a.ms)[0];
    console.log(`  Tiempo total: ${(total / 1000).toFixed(1)} s. La más lenta: ${masLenta.accion} (${masLenta.ms} ms).`);
  }
  if (aVigilar.length) aviso('por encima de ' + AVISO_MS / 1000 + ' s: ' + aVigilar.map((r) => r.accion).join(', '));
  if (lentas.length) fallo('por encima de ' + LENTO_MS / 1000 + ' s (riesgo real de pasarse del límite de 6 min): ' + lentas.map((r) => `${r.accion} ${r.ms}ms`).join(', '));

  // El informe de instalación trae los tiempos medidos DENTRO de Apps Script, sin el ida y vuelta.
  const verif = resultados.find((r) => r.accion === 'verificar_instalacion');
  if (verif && verif.estado === 'ok') {
    const info = await llamar({ action: 'verificar_instalacion', token });
    if (info.data && info.data.ok && info.data.informe) {
      const problemas = info.data.informe.split('\n').filter((l) => /PROBLEMA|AVISO/.test(l));
      if (problemas.length) {
        console.log('\n  El informe de instalación reporta:');
        problemas.forEach((p) => { console.log('   ' + p.trim()); fallos.push('instalación: ' + p.trim()); });
      } else {
        ok('El informe de instalación no reporta problemas.');
      }
      const tiempos = info.data.informe.split('\n').filter((l) => /: \d+\.\d+ s/.test(l));
      if (tiempos.length) {
        console.log('\n  Tiempo de "Disponible Hoy" medido dentro de Apps Script:');
        tiempos.forEach((t) => console.log('   ' + t.trim()));
      }
    }
  }

  await nivel3(token);

  await llamar({ action: 'logout', token });
  ok('Sesión cerrada.');
}

// ---------------------------------------------------------------------------
// NIVEL 3 — estado real de la integración con FUDO
// ---------------------------------------------------------------------------
function minutosDesde(iso) {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (isNaN(t)) return null;
  return Math.round((Date.now() - t) / 60000);
}

async function nivel3(token) {
  console.log('\n=== NIVEL 3: integración con FUDO ===');
  const r = await llamar({ action: 'fudo_panel_estado', token });
  if (!r.data || !r.data.ok) {
    fallo('No se pudo leer el estado del panel FUDO: ' + JSON.stringify(r.data || r).slice(0, 200));
    return;
  }
  const d = r.data.data || r.data;

  if (!d.credenciales_configuradas) {
    aviso('No hay credenciales de la API de FUDO configuradas — la sincronización automática no hace nada. ' +
      'Corre fudoApiConfigurarCredenciales_(apiKey, apiSecret) desde el editor de Apps Script.');
  } else {
    ok('Credenciales de la API de FUDO configuradas.');
  }

  const sync = d.ultima_sincronizacion || {};
  // La sincronización automática corre cada 15 min: más de 90 minutos sin una corrida buena son 3
  // intentos seguidos fallidos o un trigger que no está activo (mismo criterio que fudo.html).
  ['ventas', 'pagos'].forEach(function (tipo) {
    const s = sync[tipo];
    if (!s) { aviso(`Nunca se ha sincronizado ${tipo}.`); return; }
    const min = minutosDesde(s.timestamp);
    const cuando = min === null ? s.timestamp : `hace ${min} min`;
    if (s.ok === false) fallo(`La última sincronización de ${tipo} falló (${cuando}).`);
    else if (min !== null && min > 90) aviso(`La última sincronización buena de ${tipo} fue ${cuando} — debería ser cada 15 min.`);
    else ok(`Sincronización de ${tipo} al día (${cuando}).`);
  });

  const stock = sync.stock;
  if (stock) {
    const min = minutosDesde(stock.timestamp);
    // El snapshot de stock es diario a propósito (es una referencia secundaria), no cada 15 min.
    if (min !== null && min > 60 * 36) aviso(`El snapshot de stock de FUDO tiene ${Math.round(min / 60)} h (debería ser diario).`);
    else ok(`Snapshot de stock de FUDO tomado hace ${min === null ? '?' : min} min.`);
  } else {
    aviso('Nunca se ha tomado el snapshot de stock de FUDO.');
  }

  const hoy = d.resumen_hoy || {};
  console.log(`  Hoy (${hoy.fecha}): ${hoy.ventas_lineas} línea(s) de venta [fuente ${hoy.fuente_ventas}], ` +
    `${hoy.pagos_registros} pago(s) [fuente ${hoy.fuente_pagos}].`);

  const pendientes = d.ventas_pendientes_sede || {};
  if (pendientes.grupos) {
    aviso(`${pendientes.grupos} grupo(s) de ventas (${pendientes.lineas} línea(s)) sin sede identificada — ` +
      'asígnalas en el Panel Fudo para que cuenten en conciliación e inventario.');
  } else {
    ok('Todas las ventas tienen sede identificada.');
  }

  const sinCatalogo = d.productos_sin_catalogo || {};
  if (sinCatalogo.total) {
    aviso(`${sinCatalogo.total} producto(s) de FUDO no existen en el catálogo` +
      (sinCatalogo.muestra && sinCatalogo.muestra.length ? ': ' + sinCatalogo.muestra.slice(0, 5).join(', ') : '') + '.');
  }

  [['ventas_normalizadas', 'Fudo_Ventas/Fudo_Items'], ['pagos_normalizados', 'Fudo_Pagos'],
    ['subitems_normalizados', 'Fudo_Subitems'], ['descuentos_propinas', 'Fudo_Descuentos/Fudo_Propinas']]
    .forEach(function (par) {
      const t = d[par[0]];
      if (t) console.log(`  ${par[1]}: ${JSON.stringify(t)}`);
    });
}

// ---------------------------------------------------------------------------

(async () => {
  console.log('===== PRUEBA DEL DESPLIEGUE REAL DE DILANA OS =====');
  await nivel1();
  if (USUARIO && PASSWORD) {
    await nivel2();
  } else {
    console.log('\n=== NIVEL 2: omitido ===');
    console.log('  Para recorrer las acciones de lectura contra los datos reales hace falta un usuario.');
    console.log('  Crea uno con rol "Lectura" en la pantalla Usuarios y corre:');
    console.log('    DILANA_USUARIO=usuario DILANA_PASSWORD=contraseña npm run test:api');
  }

  console.log('\n===== RESULTADO =====');
  if (fallos.length) {
    console.log(`${fallos.length} problema(s):`);
    fallos.forEach((f) => console.log('  - ' + f));
    process.exit(1);
  }
  console.log('Todo en orden.');
})().catch((e) => {
  console.error('\nLa prueba no pudo completarse: ' + e.message);
  process.exit(1);
});
