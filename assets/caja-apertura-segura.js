(function () {
  if (!/caja\.html$/i.test(window.location.pathname)) return;

  function numero(id) {
    const el = document.getElementById(id);
    return Number(el && el.value !== '' ? el.value : 0) || 0;
  }

  function esperado(id, propiedad) {
    if (typeof estadoActual !== 'undefined' && estadoActual && estadoActual[propiedad] !== undefined) {
      return Number(estadoActual[propiedad]) || 0;
    }
    const texto = (document.getElementById(id) || {}).textContent || '0';
    return Number(texto.replace(/[^0-9-]/g, '')) || 0;
  }

  function moneda(n) {
    return Number(n || 0).toLocaleString('es-CO', {
      style: 'currency', currency: 'COP', maximumFractionDigits: 0
    });
  }

  function diferencias() {
    return {
      base: numero('base-contada') - esperado('base-esperada', 'base_esperada'),
      fuerte: numero('fuerte-contada-apertura') - esperado('fuerte-esperada', 'caja_fuerte_esperada')
    };
  }

  function pintarDiferencias() {
    const salida = document.getElementById('diferencia-apertura');
    if (!salida) return;
    const d = diferencias();
    if (d.base === 0 && d.fuerte === 0) {
      salida.textContent = '✓ El efectivo operativo y la caja fuerte coinciden.';
      salida.style.color = 'var(--green)';
      return;
    }
    const partes = [];
    if (d.base !== 0) partes.push('Caja operativa: ' + (d.base > 0 ? '+' : '') + moneda(d.base));
    if (d.fuerte !== 0) partes.push('Caja fuerte: ' + (d.fuerte > 0 ? '+' : '') + moneda(d.fuerte));
    salida.textContent = '⚠ Diferencia al abrir — ' + partes.join(' · ');
    salida.style.color = 'var(--red)';
  }

  function validarAntesDeAbrir(evento) {
    const boton = document.getElementById('abrir');
    if (!boton || evento.target !== boton) return;
    const d = diferencias();
    if (d.base === 0 && d.fuerte === 0) return;

    const observacionEl = document.getElementById('observacion-apertura');
    const observacion = observacionEl ? observacionEl.value.trim() : '';
    if (!observacion) {
      evento.preventDefault();
      evento.stopImmediatePropagation();
      alert('El dinero contado no coincide con lo esperado. Debes explicar la diferencia antes de abrir la caja.');
      if (observacionEl) observacionEl.focus();
      return;
    }

    const usuario = typeof Sesion !== 'undefined' ? Sesion.usuario() : null;
    if (!usuario || usuario.rol !== 'Administrador') {
      evento.preventDefault();
      evento.stopImmediatePropagation();
      alert('Hay una diferencia en el dinero recibido. Solo un Administrador puede autorizar la apertura después de revisarla.');
      return;
    }

    const detalle = [
      d.base !== 0 ? 'Caja operativa: ' + (d.base > 0 ? '+' : '') + moneda(d.base) : '',
      d.fuerte !== 0 ? 'Caja fuerte: ' + (d.fuerte > 0 ? '+' : '') + moneda(d.fuerte) : ''
    ].filter(Boolean).join('\n');

    if (!confirm(detalle + '\n\nLa apertura quedará registrada con tu nombre y la observación. ¿Confirmas que deseas abrir?')) {
      evento.preventDefault();
      evento.stopImmediatePropagation();
    }
  }

  function iniciar() {
    ['base-contada', 'fuerte-contada-apertura'].forEach(function (id) {
      const el = document.getElementById(id);
      if (el) el.addEventListener('input', pintarDiferencias);
    });
    document.addEventListener('click', validarAntesDeAbrir, true);
    setTimeout(pintarDiferencias, 400);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar);
  else iniciar();
})();
