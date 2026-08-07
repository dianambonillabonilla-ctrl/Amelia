'use strict';

ESTADO.produccionCP = {};
ESTADO.cargando = false;

function conTiempoLimite_(promesa, nombre, milisegundos) {
  const limite = Number(milisegundos) || 45000;
  return Promise.race([
    promesa,
    new Promise(resolve => setTimeout(() => resolve({ ok: false, error: nombre + ' tardó demasiado en responder' }), limite))
  ]);
}

function construirProduccionCP(respuesta) {
  const out = {};
  filas(respuesta).forEach(row => {
    if (row.sede && row.sede !== 'Centro de Producción') return;
    const nombre = row.item || row.producto || row.nombre || '';
    if (!nombre) return;
    const clave = canonical(nombre);
    const cantidad = Number(row.cantidad);
    if (!Number.isFinite(cantidad)) return;
    const unidad = row.unidad || '';
    if (!out[clave]) out[clave] = { nombre, cantidad: 0, unidad, banderaSinDato: false };
    if (out[clave].unidad && unidad && normalizarTexto(out[clave].unidad) !== normalizarTexto(unidad)) return;
    out[clave].cantidad += cantidad;
    if (!ESTADO.productos[clave]) ESTADO.productos[clave] = { nombre, categoria: 'Producción', unidad };
  });
  return out;
}

stockDe = function (sede, clave) {
  const k = canonical(clave);
  if (sede === 'Centro de Producción') return ESTADO.produccionCP[k] || null;
  return ESTADO.stock[sede]?.[k] || null;
};

alcancePlato = function (platoClave, sede) {
  const directo = calculoDirecto(platoClave, sede);
  if (sede === 'Centro de Producción') {
    return { platos: directo?.platos ?? 0, fuente: 'Producción registrada en CP', limitante: directo?.limitante || '', corregido: false, backend: 0 };
  }
  const backend = ESTADO.platosBackend[sede]?.[platoClave];
  const valorBackend = backend?.platos === null || backend?.platos === undefined ? 0 : backend.platos;
  const valorDirecto = directo?.platos ?? 0;
  if (valorDirecto > valorBackend) {
    return { platos: valorDirecto, fuente: 'Componentes preparados contados', limitante: directo?.limitante || '', corregido: true, backend: valorBackend };
  }
  return { platos: valorBackend, fuente: 'Backend', limitante: backend?.limitante || directo?.limitante || '', corregido: false, backend: valorBackend };
};

function diasCompraSeguro_() {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(ESTADO.fecha || '')) ? diasHastaMartes(ESTADO.fecha) + ' días' : 'Calculando…';
}

renderInventario = function () {
  const sede = ESTADO.sede;
  const categoria = document.getElementById('categoria').value;
  const mostrarSinConteo = document.getElementById('mostrar-sin-conteo').checked;
  let claves = Object.keys(ESTADO.productos || {}).filter(clave => !categoria || ESTADO.productos[clave].categoria === categoria);

  claves = claves.filter(clave => {
    if (sede === 'Centro de Producción') return Boolean(ESTADO.produccionCP[canonical(clave)]);
    if (sede === 'Empresa') {
      const existeCP = Boolean(ESTADO.produccionCP[canonical(clave)]);
      const existeSede = ['San Antonio', 'Capri'].some(s => {
        const item = stockDe(s, clave);
        return item?.cantidad !== null && item?.cantidad !== undefined;
      });
      return mostrarSinConteo ? true : existeCP || existeSede;
    }
    if (mostrarSinConteo) return true;
    const item = stockDe(sede, clave);
    return item?.cantidad !== null && item?.cantidad !== undefined;
  });

  claves.sort((a, b) => (ESTADO.productos[a].categoria || '').localeCompare(ESTADO.productos[b].categoria || '', 'es') || ESTADO.productos[a].nombre.localeCompare(ESTADO.productos[b].nombre, 'es'));

  const head = document.getElementById('inventario-head');
  const body = document.getElementById('inventario-body');
  if (sede === 'Empresa') {
    head.innerHTML = '<tr><th>Producto</th><th>Producción registrada en CP</th><th>San Antonio</th><th>Capri</th><th>Total sedes (sin CP)</th></tr>';
    body.innerHTML = claves.map(clave => {
      const producto = ESTADO.productos[clave];
      const cp = stockDe('Centro de Producción', clave);
      const sa = stockDe('San Antonio', clave);
      const capri = stockDe('Capri', clave);
      const validos = [sa, capri].filter(item => item && item.cantidad !== null && !aceiteFreidoraInconsistente(clave, item));
      const unidad = producto.unidad || validos[0]?.unidad || cp?.unidad || '';
      const total = validos.reduce((acc, item) => acc + convertir(item.cantidad, item.unidad, unidad), 0);
      return `<tr><td><strong>${escapeHtml(producto.nombre)}</strong><span class="detalle">${escapeHtml(producto.categoria)}</span></td><td>${celdaStock(cp, clave)}</td><td>${celdaStock(sa, clave)}</td><td>${celdaStock(capri, clave)}</td><td><strong>${validos.length ? numero(total, 2) + ' ' + escapeHtml(unidad) : '—'}</strong></td></tr>`;
    }).join('') || `<tr><td colspan="5">${ESTADO.cargando ? 'Cargando productos…' : 'No hay productos para este filtro.'}</td></tr>`;
  } else {
    head.innerHTML = `<tr><th>Producto</th><th>${escapeHtml(sede)}</th><th>Estado</th></tr>`;
    body.innerHTML = claves.map(clave => {
      const producto = ESTADO.productos[clave];
      const item = stockDe(sede, clave);
      const estado = sede === 'Centro de Producción' ? 'Producción registrada para la fecha' : !item || item.cantidad === null ? 'Sin conteo en esta sede' : aceiteFreidoraInconsistente(clave, item) ? 'Revisar unidad' : 'Dato disponible';
      return `<tr><td><strong>${escapeHtml(producto.nombre)}</strong><span class="detalle">${escapeHtml(producto.categoria)}</span></td><td>${celdaStock(item, clave)}</td><td>${escapeHtml(estado)}</td></tr>`;
    }).join('') || `<tr><td colspan="3">${ESTADO.cargando ? 'Cargando productos…' : sede === 'Centro de Producción' ? 'No hay producción registrada para esta fecha.' : 'No hay productos para este filtro.'}</td></tr>`;
  }

  const conDatos = claves.filter(clave => sede === 'Empresa'
    ? Boolean(ESTADO.produccionCP[canonical(clave)]) || ['San Antonio', 'Capri'].some(s => stockDe(s, clave)?.cantidad !== null && stockDe(s, clave)?.cantidad !== undefined)
    : stockDe(sede, clave)?.cantidad !== null && stockDe(sede, clave)?.cantidad !== undefined).length;
  document.getElementById('inventario-resumen').innerHTML = `
    <div class="kpi"><span>Vista</span><strong>${escapeHtml(sede)}</strong></div>
    <div class="kpi"><span>Productos mostrados</span><strong>${claves.length}</strong></div>
    <div class="kpi"><span>Con información</span><strong>${conDatos}</strong></div>
    <div class="kpi"><span>Próxima compra</span><strong>${diasCompraSeguro_()}</strong></div>`;
};

cargar = async function () {
  if (ESTADO.cargando) return;
  const estado = document.getElementById('estado');
  const boton = document.getElementById('actualizar');
  ESTADO.cargando = true;
  boton.disabled = true;
  estado.className = 'estado aviso';
  estado.textContent = 'Consultando catálogo e inventario…';
  renderInventario();

  const fecha = fechaInput.value;
  ESTADO.fecha = /^\d{4}-\d{2}-\d{2}$/.test(fecha) ? fecha : fechaLocalHoy_();
  const desde = restarDias(ESTADO.fecha, 28);
  const fallas = [];

  try {
    const catalogoRes = await conTiempoLimite_(llamar('catalogo_listar', { filtros: {} }), 'Catálogo', 30000);
    if (catalogoRes?.ok) construirCatalogo(filas(catalogoRes)); else fallas.push('Catálogo: ' + (catalogoRes?.error || 'sin respuesta'));

    estado.textContent = 'Consultando inventario de las sedes…';
    const [sa, capri, produccionCPRes] = await Promise.all([
      conTiempoLimite_(llamar('disponible_hoy', { fecha: ESTADO.fecha, sede: 'San Antonio' }), 'San Antonio', 45000),
      conTiempoLimite_(llamar('disponible_hoy', { fecha: ESTADO.fecha, sede: 'Capri' }), 'Capri', 45000),
      conTiempoLimite_(llamar('produccion_listar', { fecha: ESTADO.fecha }), 'Producción de CP', 45000)
    ]);

    ESTADO.stock = {
      'Centro de Producción': {},
      'San Antonio': construirStock(sa),
      'Capri': construirStock(capri)
    };
    ESTADO.platosBackend = {
      'Centro de Producción': {},
      'San Antonio': construirPlatosBackend(sa),
      'Capri': construirPlatosBackend(capri)
    };
    ESTADO.produccionCP = construirProduccionCP(produccionCPRes);
    if (!sa?.ok) fallas.push('San Antonio: ' + (sa?.error || 'sin respuesta'));
    if (!capri?.ok) fallas.push('Capri: ' + (capri?.error || 'sin respuesta'));
    if (!produccionCPRes?.ok) fallas.push('Producción de CP: ' + (produccionCPRes?.error || 'sin respuesta'));

    poblarCategorias();
    renderInventario();

    estado.textContent = 'Consultando recetas, conteos y ventas FUDO…';
    const [recetasRes, ventasRes, conteoRes] = await Promise.all([
      conTiempoLimite_(llamar('recetas_listar', { filtros: {} }), 'Recetas', 45000),
      conTiempoLimite_(llamar('fudo_items_listar', { filtros: { fecha_desde: desde, fecha_hasta: ESTADO.fecha } }), 'Ventas FUDO', 45000),
      conTiempoLimite_(llamar('conteo_listar', { fecha: ESTADO.fecha }), 'Conteos', 45000)
    ]);

    construirRecetas(filas(recetasRes));
    construirVentas(filas(ventasRes), desde, ESTADO.fecha);
    construirConteoHoy(filas(catalogoRes), conteoRes, ESTADO.fecha);
    ESTADO.cargado = true;
    renderAlcance();
    renderConteoHoy();
    if (!recetasRes?.ok) fallas.push('Recetas: ' + (recetasRes?.error || 'sin respuesta'));
    if (!ventasRes?.ok) fallas.push('Ventas FUDO: ' + (ventasRes?.error || 'sin respuesta'));
    if (!conteoRes?.ok) fallas.push('Conteos: ' + (conteoRes?.error || 'sin respuesta'));
  } catch (error) {
    fallas.push(error.message || String(error));
  } finally {
    ESTADO.cargando = false;
    boton.disabled = false;
    renderInventario();
    if (fallas.length) {
      estado.className = 'estado error';
      estado.textContent = 'Análisis parcial. ' + fallas.join(' · ');
    } else {
      estado.className = 'estado ok';
      estado.textContent = 'Análisis actualizado correctamente.';
    }
  }
};

const botonAnterior = document.getElementById('actualizar');
const botonNuevo = botonAnterior.cloneNode(true);
botonAnterior.replaceWith(botonNuevo);
botonNuevo.addEventListener('click', cargar);

cargar();