'use strict';

Sesion.requerir();
requerirRol_(['Administrador', 'Encargado', 'Lectura']);
montarBarraUsuario();

const SEDES = ['Centro de Producción', 'San Antonio', 'Capri'];
const ESTADO = {
  sede: 'Empresa',
  productos: {},
  alias: {},
  stock: {},
  platosBackend: {},
  recetas: {},
  ventas: {},
  fecha: ''
};

const fechaInput = document.getElementById('fecha');
fechaInput.value = fechaLocalHoy_();

function numero(valor, decimales = 1) {
  const n = Number(valor);
  return Number.isFinite(n)
    ? n.toLocaleString('es-CO', { maximumFractionDigits: decimales })
    : '—';
}

function filas(respuesta) {
  if (!respuesta || !respuesta.ok) return [];
  if (Array.isArray(respuesta.data)) return respuesta.data;
  if (Array.isArray(respuesta.data?.filas)) return respuesta.data.filas;
  if (Array.isArray(respuesta.data?.items)) return respuesta.data.items;
  if (Array.isArray(respuesta.filas)) return respuesta.filas;
  return [];
}

function fechaISO(valor) {
  const s = String(valor || '');
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const m = s.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : '';
}

function restarDias(fecha, dias) {
  const [y, m, d] = fecha.split('-').map(Number);
  const x = new Date(y, m - 1, d - dias, 12);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
}

function diasHastaMartes(fecha) {
  const [y, m, d] = fecha.split('-').map(Number);
  const x = new Date(y, m - 1, d, 12);
  const diferencia = (2 - x.getDay() + 7) % 7;
  return diferencia === 0 ? 7 : diferencia;
}

function canonical(nombre) {
  const k = normalizarTexto(nombre);
  const grupos = {
    'alioli': 'alioli',
    'aioli': 'alioli',
    'cebolla pluma': 'cebolla pluma',
    'cebolla en pluma': 'cebolla pluma',
    'cebolla en pluma (sin limon)': 'cebolla pluma',
    'cebolla en pluma (sin limón)': 'cebolla pluma',
    'cebolla elaborada': 'cebolla pluma',
    'cebollita de amelia': 'cebolla pluma',
    'aceite girasol': 'aceite girasol',
    'aceite de girasol': 'aceite girasol',
    'aceite de cocina': 'aceite girasol',
    'aceite freidora': 'aceite freidora'
  };
  return grupos[k] || ESTADO.alias[k] || k;
}

function construirCatalogo(rows) {
  const productos = {};
  const alias = {};
  rows.forEach(row => {
    const nombre = row.nombre_estandar || row.producto || row.nombre || '';
    if (!nombre) return;
    const clave = normalizarTexto(nombre);
    productos[clave] = {
      nombre,
      categoria: row.categoria || 'Sin categoría',
      unidad: row.unidad_base || row.unidad || ''
    };
    alias[clave] = clave;
    if (row.nombre_fudo) alias[normalizarTexto(row.nombre_fudo)] = clave;
  });
  ESTADO.productos = productos;
  ESTADO.alias = alias;
}

function construirStock(respuesta) {
  const raw = respuesta?.data?.stock_ingredientes || {};
  const out = {};
  Object.keys(raw).forEach(key => {
    const row = raw[key] || {};
    const nombre = row.producto || key;
    const clave = canonical(nombre);
    const cantidad = row.cantidad === null || row.cantidad === undefined || row.cantidad === ''
      ? null
      : Number(row.cantidad);
    out[clave] = {
      nombre,
      cantidad: Number.isFinite(cantidad) ? cantidad : null,
      unidad: row.unidad || '',
      banderaSinDato: Boolean(row.sin_dato)
    };
  });
  return out;
}

function construirPlatosBackend(respuesta) {
  const out = {};
  const lista = Array.isArray(respuesta?.data?.platos) ? respuesta.data.platos : [];
  lista.forEach(row => {
    const nombre = row.producto || row.nombre || '';
    if (!nombre) return;
    const clave = canonical(nombre);
    const valor = row.preparaciones_posibles;
    out[clave] = {
      nombre,
      platos: valor === null || valor === undefined ? null : Math.max(0, Number(valor) || 0),
      limitante: row.cadena_limitante || row.ingrediente_limitante || '',
      limitanteSinDato: Boolean(row.limitante_sin_dato)
    };
  });
  return out;
}

function construirRecetas(rows) {
  const out = {};
  rows.forEach(row => {
    if (!row.producto || !row.ingrediente) return;
    const estado = normalizarTexto(row.estado || 'activo');
    if (['archivado', 'inactivo', 'borrador', 'pendiente'].includes(estado)) return;
    const tipo = normalizarTexto(row.tipo || 'plato');
    const productoClave = canonical(row.producto);
    if (!out[productoClave]) {
      out[productoClave] = { nombre: row.producto, tipo, lineas: [] };
    }
    out[productoClave].lineas.push({
      ingrediente: row.ingrediente,
      clave: canonical(row.ingrediente),
      cantidad: Number(row.cantidad) || 0,
      unidad: row.unidad || '',
      rendimiento: Number(row.rendimiento_producto) || 0
    });
  });

  out[canonical('Chanchostilla')] = {
    nombre: 'Chanchostilla',
    tipo: 'plato',
    lineas: [
      { ingrediente: 'Costilla Preparada Picada', clave: canonical('Costilla Preparada Picada'), cantidad: 85, unidad: 'g' },
      { ingrediente: 'Panceta Pre-Ahumada', clave: canonical('Panceta Pre-Ahumada'), cantidad: 75, unidad: 'g' },
      { ingrediente: 'Papas Listas', clave: canonical('Papas Listas'), cantidad: 100, unidad: 'g' },
      { ingrediente: 'Cebolla Pluma', clave: canonical('Cebolla Pluma'), cantidad: 50, unidad: 'g' },
      { ingrediente: 'Alioli', clave: canonical('Alioli'), cantidad: 30, unidad: 'g' }
    ]
  };
  ESTADO.recetas = out;
}

function construirVentas(rows, desde, hasta) {
  const porLinea = new Map();
  const dias = new Set();
  rows.forEach(row => {
    const fecha = fechaISO(row.creacion || row.fecha);
    if (!fecha || fecha < desde || fecha > hasta) return;
    if (!['San Antonio', 'Capri'].includes(row.sede)) return;
    if (row.cancelada === true || ['si', 'sí', 'true', '1'].includes(normalizarTexto(row.cancelada))) return;
    const producto = row.producto || '';
    if (!producto) return;
    const claveProducto = canonical(producto);
    const idLinea = row.id_item || row.item_id || row.linea_id || row.id_detalle || '';
    const idVenta = row.id_venta || row.venta_id || row.id || '';
    const clave = idLinea
      ? `linea|${idLinea}`
      : `venta|${idVenta}|${claveProducto}|${row.sede}|${fecha}`;
    const cantidad = Math.max(0, Number(row.cantidad) || 1);
    porLinea.set(clave, Math.max(porLinea.get(clave) || 0, cantidad));
    dias.add(fecha);
  });
  const totales = {};
  porLinea.forEach((cantidad, clave) => {
    let productoClave = '';
    if (clave.startsWith('venta|')) productoClave = clave.split('|')[2];
    else {
      const id = clave.slice(6);
      const original = rows.find(r => String(r.id_item || r.item_id || r.linea_id || r.id_detalle || '') === id);
      productoClave = canonical(original?.producto || '');
    }
    if (productoClave) totales[productoClave] = (totales[productoClave] || 0) + cantidad;
  });
  const divisor = Math.max(1, dias.size);
  const out = {};
  Object.keys(totales).forEach(clave => {
    out[clave] = { total: totales[clave], promedio: totales[clave] / divisor };
  });
  ESTADO.ventas = out;
}

function convertir(cantidad, desde, hasta) {
  const a = normalizarTexto(desde);
  const b = normalizarTexto(hasta);
  if (!a || !b || a === b) return cantidad;
  if (a === 'kg' && b === 'g') return cantidad * 1000;
  if (a === 'g' && b === 'kg') return cantidad / 1000;
  if (a === 'l' && b === 'ml') return cantidad * 1000;
  if (a === 'ml' && b === 'l') return cantidad / 1000;
  return cantidad;
}

function stockDe(sede, clave) {
  return ESTADO.stock[sede]?.[canonical(clave)] || null;
}

function calculoDirecto(platoClave, sede) {
  const receta = ESTADO.recetas[platoClave];
  if (!receta || receta.tipo === 'produccion' || !receta.lineas.length) return null;
  let minimo = Infinity;
  let limitante = '';
  const faltantes = [];
  receta.lineas.forEach(linea => {
    if (!(linea.cantidad > 0)) return;
    const item = stockDe(sede, linea.clave);
    if (!item || item.cantidad === null) {
      faltantes.push(linea.ingrediente);
      minimo = 0;
      return;
    }
    const disponible = convertir(item.cantidad, item.unidad, linea.unidad);
    const posibles = disponible / linea.cantidad;
    if (posibles < minimo) {
      minimo = posibles;
      limitante = linea.ingrediente;
    }
  });
  return {
    platos: Number.isFinite(minimo) ? Math.max(0, Math.floor(minimo)) : 0,
    limitante,
    faltantes
  };
}

function alcancePlato(platoClave, sede) {
  const backend = ESTADO.platosBackend[sede]?.[platoClave];
  const directo = calculoDirecto(platoClave, sede);
  const valorBackend = backend?.platos === null || backend?.platos === undefined ? 0 : backend.platos;
  const valorDirecto = directo?.platos ?? 0;
  if (valorDirecto > valorBackend) {
    return {
      platos: valorDirecto,
      fuente: 'Componentes preparados contados',
      limitante: directo.limitante,
      corregido: true,
      backend: valorBackend
    };
  }
  return {
    platos: valorBackend,
    fuente: 'Backend',
    limitante: backend?.limitante || directo?.limitante || '',
    corregido: false,
    backend: valorBackend
  };
}

function aceiteFreidoraInconsistente(clave, item) {
  return canonical(clave) === 'aceite freidora' && normalizarTexto(item?.unidad) === 'l' && Number(item?.cantidad) > 1000;
}

function celdaStock(item, clave) {
  if (!item || item.cantidad === null) return '<span class="sin-dato">Sin conteo</span>';
  if (aceiteFreidoraInconsistente(clave, item)) {
    return `<span class="alerta">${numero(item.cantidad)} l ⚠</span><span class="detalle">Posiblemente ${numero(item.cantidad / 1000)} l; revisar unidad</span>`;
  }
  return `${numero(item.cantidad, 2)} ${escapeHtml(item.unidad)}`;
}

function poblarCategorias() {
  const select = document.getElementById('categoria');
  const anterior = select.value;
  const categorias = [...new Set(Object.values(ESTADO.productos).map(p => p.categoria).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, 'es'));
  select.innerHTML = '<option value="">Todas</option>' + categorias.map(c => `<option>${escapeHtml(c)}</option>`).join('');
  if (categorias.includes(anterior)) select.value = anterior;
}

function renderInventario() {
  const sede = ESTADO.sede;
  const categoria = document.getElementById('categoria').value;
  const mostrarSinConteo = document.getElementById('mostrar-sin-conteo').checked;
  let claves = Object.keys(ESTADO.productos).filter(clave => !categoria || ESTADO.productos[clave].categoria === categoria);
  claves = claves.filter(clave => {
    if (mostrarSinConteo) return true;
    if (sede === 'Empresa') return SEDES.some(s => stockDe(s, clave)?.cantidad !== null && stockDe(s, clave)?.cantidad !== undefined);
    const item = stockDe(sede, clave);
    return item?.cantidad !== null && item?.cantidad !== undefined;
  });
  claves.sort((a, b) => ESTADO.productos[a].categoria.localeCompare(ESTADO.productos[b].categoria, 'es') || ESTADO.productos[a].nombre.localeCompare(ESTADO.productos[b].nombre, 'es'));

  const head = document.getElementById('inventario-head');
  const body = document.getElementById('inventario-body');
  if (sede === 'Empresa') {
    head.innerHTML = '<tr><th>Producto</th><th>Centro de Producción</th><th>San Antonio</th><th>Capri</th><th>Total confiable</th></tr>';
    body.innerHTML = claves.map(clave => {
      const producto = ESTADO.productos[clave];
      const items = SEDES.map(s => stockDe(s, clave));
      const validos = items.filter(item => item && item.cantidad !== null && !aceiteFreidoraInconsistente(clave, item));
      const unidad = producto.unidad || validos[0]?.unidad || '';
      const total = validos.reduce((acc, item) => acc + convertir(item.cantidad, item.unidad, unidad), 0);
      return `<tr><td><strong>${escapeHtml(producto.nombre)}</strong><span class="detalle">${escapeHtml(producto.categoria)}</span></td>${items.map(item => `<td>${celdaStock(item, clave)}</td>`).join('')}<td><strong>${validos.length ? numero(total, 2) + ' ' + escapeHtml(unidad) : '—'}</strong></td></tr>`;
    }).join('') || '<tr><td colspan="5">No hay productos para este filtro.</td></tr>';
  } else {
    head.innerHTML = `<tr><th>Producto</th><th>${escapeHtml(sede)}</th><th>Estado</th></tr>`;
    body.innerHTML = claves.map(clave => {
      const producto = ESTADO.productos[clave];
      const item = stockDe(sede, clave);
      const estado = !item || item.cantidad === null
        ? 'Sin conteo en esta sede'
        : aceiteFreidoraInconsistente(clave, item)
          ? 'Revisar unidad'
          : 'Dato disponible';
      return `<tr><td><strong>${escapeHtml(producto.nombre)}</strong><span class="detalle">${escapeHtml(producto.categoria)}</span></td><td>${celdaStock(item, clave)}</td><td>${escapeHtml(estado)}</td></tr>`;
    }).join('') || '<tr><td colspan="3">No hay productos para este filtro.</td></tr>';
  }

  const conDatos = claves.filter(clave => sede === 'Empresa'
    ? SEDES.some(s => stockDe(s, clave)?.cantidad !== null && stockDe(s, clave)?.cantidad !== undefined)
    : stockDe(sede, clave)?.cantidad !== null && stockDe(sede, clave)?.cantidad !== undefined).length;
  document.getElementById('inventario-resumen').innerHTML = `
    <div class="kpi"><span>Vista</span><strong>${escapeHtml(sede)}</strong></div>
    <div class="kpi"><span>Productos mostrados</span><strong>${claves.length}</strong></div>
    <div class="kpi"><span>Con información</span><strong>${conDatos}</strong></div>
    <div class="kpi"><span>Próxima compra</span><strong>${diasHastaMartes(ESTADO.fecha)} días</strong></div>`;
}

function badgeCobertura(dias) {
  if (!Number.isFinite(dias)) return '<span class="badge medio">Sin promedio</span>';
  const clase = dias < 2 ? 'critico' : dias < 4 ? 'medio' : 'bien';
  return `<span class="badge ${clase}">${numero(dias)} días</span>`;
}

function renderAlcance() {
  const claves = [...new Set([
    ...Object.keys(ESTADO.ventas),
    ...Object.keys(ESTADO.recetas),
    ...SEDES.flatMap(s => Object.keys(ESTADO.platosBackend[s] || {}))
  ])].filter(clave => ESTADO.ventas[clave] || SEDES.some(s => ESTADO.platosBackend[s]?.[clave]));
  claves.sort((a, b) => (ESTADO.ventas[b]?.total || 0) - (ESTADO.ventas[a]?.total || 0));

  const acciones = { trasladar: [], producir: [], revisar: [] };
  const objetivoDias = diasHastaMartes(ESTADO.fecha) + Number(document.getElementById('seguridad').value || 1);
  const rows = claves.map((clave, index) => {
    const referencia = ESTADO.recetas[clave] || ESTADO.platosBackend['San Antonio']?.[clave] || ESTADO.platosBackend.Capri?.[clave] || ESTADO.platosBackend['Centro de Producción']?.[clave];
    if (!referencia) return '';
    const venta = ESTADO.ventas[clave] || { total: 0, promedio: 0 };
    const sa = alcancePlato(clave, 'San Antonio');
    const capri = alcancePlato(clave, 'Capri');
    const cp = alcancePlato(clave, 'Centro de Producción');
    const operativo = sa.platos + capri.platos;
    const cobertura = venta.promedio > 0 ? operativo / venta.promedio : Infinity;
    const meta = Math.ceil(venta.promedio * objetivoDias);
    const faltante = Math.max(0, meta - operativo);
    if (faltante > 0) {
      const trasladable = Math.min(faltante, cp.platos);
      if (trasladable > 0) acciones.trasladar.push({ producto: referencia.nombre, cantidad: trasladable });
      const restante = faltante - trasladable;
      if (restante > 0) {
        const tieneCalculo = sa.corregido || capri.corregido || sa.platos > 0 || capri.platos > 0;
        if (tieneCalculo) acciones.producir.push({ producto: referencia.nombre, cantidad: restante });
        else acciones.revisar.push({ producto: referencia.nombre, motivo: sa.limitante || capri.limitante || 'Revisar receta y conteos' });
      }
    }
    const corregido = sa.corregido || capri.corregido || cp.corregido;
    const explicacion = corregido
      ? [sa.corregido ? `San Antonio ${sa.backend}→${sa.platos}` : '', capri.corregido ? `Capri ${capri.backend}→${capri.platos}` : '', cp.corregido ? `CP ${cp.backend}→${cp.platos}` : ''].filter(Boolean).join(' · ')
      : (sa.limitante || capri.limitante || '—');
    return `<tr class="${corregido ? 'corregida' : ''}"><td>${index + 1}</td><td><strong>${escapeHtml(referencia.nombre)}</strong>${corregido ? '<span class="detalle">Corregido con componentes preparados</span>' : ''}</td><td>${numero(venta.total)}</td><td>${numero(venta.promedio)}</td><td>${numero(sa.platos)}</td><td>${numero(capri.platos)}</td><td><strong>${numero(operativo)}</strong></td><td>${numero(cp.platos)}</td><td>${badgeCobertura(cobertura)}</td><td>${escapeHtml(explicacion)}</td></tr>`;
  }).join('');
  document.getElementById('alcance-body').innerHTML = rows || '<tr><td colspan="10">No se recibieron platos o ventas para analizar.</td></tr>';
  renderAcciones(acciones, objetivoDias);
}

function tablaAcciones(lista, columnas) {
  if (!lista.length) return '<p class="vacio">No hay acciones en este paso.</p>';
  return `<div class="tabla-wrap"><table><thead><tr>${columnas.map(c => `<th>${escapeHtml(c.titulo)}</th>`).join('')}</tr></thead><tbody>${lista.map(item => `<tr>${columnas.map(c => `<td>${c.render(item)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}

function renderAcciones(acciones, objetivoDias) {
  const columnasCantidad = [
    { titulo: 'Producto', render: x => `<strong>${escapeHtml(x.producto)}</strong>` },
    { titulo: 'Cantidad sugerida', render: x => `${numero(x.cantidad)} platos` }
  ];
  const columnasRevision = [
    { titulo: 'Producto', render: x => `<strong>${escapeHtml(x.producto)}</strong>` },
    { titulo: 'Qué revisar', render: x => escapeHtml(x.motivo) }
  ];
  document.getElementById('acciones').innerHTML = `
    <div class="paso"><h3><span>1</span> Trasladar o despachar desde Centro de Producción</h3>${tablaAcciones(acciones.trasladar, columnasCantidad)}</div>
    <div class="paso"><h3><span>2</span> Producir</h3>${tablaAcciones(acciones.producir, columnasCantidad)}</div>
    <div class="paso"><h3><span>3</span> Revisar materia prima antes de comprar</h3><p class="nota">La compra debe hacerse sobre materia prima, nunca sobre platos terminados. Objetivo: ${numero(objetivoDias)} días de cobertura.</p>${tablaAcciones(acciones.revisar, columnasRevision)}</div>`;
}

async function cargar() {
  const estado = document.getElementById('estado');
  const boton = document.getElementById('actualizar');
  boton.disabled = true;
  estado.className = 'estado aviso';
  estado.textContent = 'Consultando inventario, recetas y ventas FUDO…';
  try {
    const fecha = fechaInput.value;
    const desde = restarDias(fecha, 28);
    const [cp, sa, capri, catalogoRes, recetasRes, ventasRes] = await Promise.all([
      llamar('disponible_hoy', { fecha, sede: 'Centro de Producción' }),
      llamar('disponible_hoy', { fecha, sede: 'San Antonio' }),
      llamar('disponible_hoy', { fecha, sede: 'Capri' }),
      llamar('catalogo_listar', { filtros: {} }),
      llamar('recetas_listar', { filtros: {} }),
      llamar('fudo_items_listar', { filtros: { fecha_desde: desde, fecha_hasta: fecha } })
    ]);
    construirCatalogo(filas(catalogoRes));
    ESTADO.stock = {
      'Centro de Producción': construirStock(cp),
      'San Antonio': construirStock(sa),
      'Capri': construirStock(capri)
    };
    ESTADO.platosBackend = {
      'Centro de Producción': construirPlatosBackend(cp),
      'San Antonio': construirPlatosBackend(sa),
      'Capri': construirPlatosBackend(capri)
    };
    construirRecetas(filas(recetasRes));
    construirVentas(filas(ventasRes), desde, fecha);
    ESTADO.fecha = fecha;
    poblarCategorias();
    renderInventario();
    renderAlcance();
    const fallas = [];
    if (!cp?.ok) fallas.push('Centro de Producción');
    if (!sa?.ok) fallas.push('San Antonio');
    if (!capri?.ok) fallas.push('Capri');
    if (!catalogoRes?.ok) fallas.push('Catálogo');
    if (!recetasRes?.ok) fallas.push('Recetas');
    if (!ventasRes?.ok) fallas.push('Ventas FUDO');
    if (fallas.length) {
      estado.className = 'estado error';
      estado.textContent = `Análisis parcial. No respondió: ${fallas.join(', ')}.`;
    } else {
      estado.className = 'estado ok';
      estado.textContent = 'Análisis actualizado correctamente.';
    }
  } catch (error) {
    console.error(error);
    estado.className = 'estado error';
    estado.textContent = `Error al cargar: ${error.message || error}`;
  } finally {
    boton.disabled = false;
  }
}

document.querySelectorAll('.tab-principal').forEach(button => {
  button.addEventListener('click', () => {
    document.querySelectorAll('.tab-principal').forEach(x => x.classList.remove('activo'));
    document.querySelectorAll('.panel-principal').forEach(x => x.classList.remove('activo'));
    button.classList.add('activo');
    document.getElementById(`panel-${button.dataset.panel}`).classList.add('activo');
  });
});

document.querySelectorAll('.tab-sede').forEach(button => {
  button.addEventListener('click', () => {
    document.querySelectorAll('.tab-sede').forEach(x => x.classList.remove('activo'));
    button.classList.add('activo');
    ESTADO.sede = button.dataset.sede;
    renderInventario();
  });
});

document.getElementById('categoria').addEventListener('change', renderInventario);
document.getElementById('mostrar-sin-conteo').addEventListener('change', renderInventario);
document.getElementById('seguridad').addEventListener('change', renderAlcance);
document.getElementById('actualizar').addEventListener('click', cargar);

cargar();