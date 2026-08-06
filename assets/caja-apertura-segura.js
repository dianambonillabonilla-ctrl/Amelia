(function () {
  if (!/caja\.html$/i.test(window.location.pathname)) return;

  function numero(id) {
    const el = document.getElementById(id);
    return Number(el && el.value !== '' ? el.value : 0) || 0;
  }

  function esperadoFuerte() {
    if (window.estadoActual && estadoActual.caja_fuerte_esperada !== undefined) {
      return Number(estadoActual.caja_fuerte_esperada) || 0;
    }
    const texto = (document.getElementById('fuerte-esperada') || {}).textContent || '0';
    return Number(texto.replace(/[^0-9-]/g, '')) || 0;
  }

  function esperadoBase() {
    if (window.estadoActual && estadoActual.base_esperada !== undefined) {
      return Number(estadoActual.base_esperada) || 0;
    }
    const texto = (document.getElementById('base-esperada') || {}).textContent || '0';
    return Number(texto.replace(/[^0-9-]/g, '')) || 0;
  }

  function moneda(n) {
    return Number(n || 0).toLocaleString('es-CO', {
      style: 'currency', currency: 'COP', maximumFractionDigits: 0
    });
  }

  function pintarDiferencias() {
    const salida = document.getElementById('diferencia-apertura');
    if (!salida) return;
    const diferenciaBase = numero('base-contada') - esperadoBase();
    const diferenciaFuerte = numero('fuerte-contada-apertura') - esperadoFuerte();
    const coincide = diferenciaBase === 0 && diferenciaFuerte === 0;

    if (coincide) {
      salida.textContent = '✓ El efectivo operativo y la caja fuerte coinciden.';
      salida.style.color = 'var(--green)';
      return;
    }

    const partes = [];
    if (diferenciaBase !== 0) partes.push('Caja operativa: ' + (diferenciaBase > 0 ? '+' : '') + moneda(diferenciaBase));
    if (diferenciaFuerte !== 0) partes.push('Caja fuerte: ' + (diferenciaFuerte > 0 ? '+' : '') + moneda(diferenciaFuerte));
    salida.textContent = '⚠ Diferencia al abrir — ' + partes.join(' · ');
    salida.style.color = 'var(--red)';
  }

  function validarAntesDeAbrir(evento) {
    const boton = document.getElementById('abrir');
    if (!boton || evento.target !== boton) return;

    const diferenciaBase = numero('base-contada') - esperadoBase();
    const diferenciaFuerte = numero('fuerte-contada-apertura') - esperadoFuerte();
    if (diferenciaBase === 0 && diferenciaFuerte === 0) return;

    const observacion = (document.getElementById('observacion-apertura') || {}).value || '';
    if (!observacion.trim()) {
      evento.preventDefault();
      evento.stopImmediatePropagation();
      alert('El dinero contado no coincide con lo esperado. Debes explicar la diferencia antes de abrir la caja.');
      return;
    }

    const usuario = typeof Sesion !== 'undefined' ? Sesion.usuario() : null;
    if (!usuario || usuario.rol !== 'Administrador') {
      evento.preventDefault();
      evento.stopImmediatePropagation();
      alert('Hay una diferencia en la caja fuerte. Solo un Administrador puede autorizar la apertura después de revisar el dinero.');
      return;
    }

    const detalle = diferenciaFuerte !== 0
      ? 'La caja fuerte tiene una diferencia de ' + moneda(diferenciaFuerte) + '.'
      : 'La caja operativa tiene una diferencia de ' + moneda(diferenciaBase) + '.';
    if (!confirm(detalle + '\n\nLa apertura quedará registrada con tu nombre y la observación escrita. ¿Confirmas que deseas abrir?')) {
      evento.preventDefault();
      evento.stopImmediatePropagation();
    }
  }

  document.addEventListener('DOMContentLoaded', function () {
    ['base-contada', 'fuerte-contada-apertura'].forEach(function (id) {
      const el = document.getElementById(id);
      if (el) el.addEventListener('input', pintarDiferencias);
    });
    document.addEventListener('click', validarAntesDeAbrir, true);
    setTimeout(pintarDiferencias, 300);
  });
})();
