(function () {
  if (!/conteo\.html$/i.test(window.location.pathname)) return;

  const PRODUCTOS_CP = [
    { nombre: 'Vinagre', unidad: 'ml' },
    { nombre: 'Salsa de soya', unidad: 'ml' },
    { nombre: 'Vinagre balsámico', unidad: 'ml' },
    { nombre: 'Miel', unidad: 'g' },
    { nombre: 'Aceite de girasol', unidad: 'ml' },
    { nombre: 'Cebolla', unidad: 'g' },
    { nombre: 'Ajo', unidad: 'g' },
    { nombre: 'Perejil', unidad: 'g' },
    { nombre: 'Cilantro', unidad: 'g' },
    { nombre: 'Sal', unidad: 'g' },
    { nombre: 'Azúcar morena', unidad: 'g' },
    { nombre: 'Polvos de falafel', unidad: 'g' },
    { nombre: 'Polvo de reducción', unidad: 'g' },
    { nombre: 'Garbanzos', unidad: 'g' },
    { nombre: 'Límpido', unidad: 'ml' },
    { nombre: 'Lavaloza', unidad: 'ml' },
    { nombre: 'Costilla cruda', unidad: 'g' },
    { nombre: 'Panceta cruda', unidad: 'g' },
    { nombre: 'Costilla adobada', unidad: 'g' },
    { nombre: 'Panceta adobada', unidad: 'g' }
  ];

  const normalizar = window.normalizarTexto || function (s) {
    return String(s || '').trim().toLowerCase().normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ');
  };

  function esCentroProduccion() {
    const sede = document.getElementById('sede');
    return sede && sede.value === 'Centro de Producción';
  }

  function ultimoConteoPorProducto() {
    const mapa = {};
    document.querySelectorAll('#filas tr').forEach(function (tr) {
      const producto = tr.querySelector('.in-producto');
      const unidad = tr.querySelector('.in-unidad');
      const celdaAnterior = tr.children[2];
      if (!producto) return;
      const clave = normalizar(producto.value);
      if (!clave) return;
      mapa[clave] = {
        unidad: unidad ? unidad.value : 'g',
        anterior: celdaAnterior ? celdaAnterior.textContent.trim() : '—'
      };
    });
    return mapa;
  }

  function aplicarListaCentroProduccion() {
    if (!esCentroProduccion() || typeof window.nuevaFila !== 'function') return;

    const anteriores = ultimoConteoPorProducto();
    const cuerpo = document.getElementById('filas');
    if (!cuerpo) return;
    cuerpo.innerHTML = '';

    PRODUCTOS_CP.forEach(function (item) {
      const previo = anteriores[normalizar(item.nombre)];
      const anterior = previo && previo.anterior !== '—' ? previo.anterior : null;
      nuevaFila(item.nombre, item.unidad, anterior, true);
    });

    const info = document.getElementById('info-anterior');
    if (info) {
      info.textContent = 'Centro de Producción: estos 20 productos son obligatorios en cada conteo. Debes poner una cantidad, incluso cuando sea 0. Para cualquier producto adicional usa “+ Agregar producto”.';
    }

    const boton = document.getElementById('btn-agregar-fila');
    if (boton) {
      boton.style.display = '';
      boton.textContent = '+ Agregar otro producto';
    }
  }

  function instalar() {
    if (typeof window.cargarConteoAnterior_ === 'function' && !window.cargarConteoAnterior_._cpAjustado) {
      const original = window.cargarConteoAnterior_;
      const ajustada = async function () {
        await original.apply(this, arguments);
        aplicarListaCentroProduccion();
      };
      ajustada._cpAjustado = true;
      window.cargarConteoAnterior_ = ajustada;
    }

    const sede = document.getElementById('sede');
    if (sede) sede.addEventListener('change', function () {
      setTimeout(aplicarListaCentroProduccion, 250);
    });

    setTimeout(function () {
      if (esCentroProduccion()) {
        if (typeof window.cargarConteoAnterior_ === 'function') window.cargarConteoAnterior_();
        else aplicarListaCentroProduccion();
      }
    }, 400);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', instalar);
  else instalar();
})();
