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

  function fechaHora(valor) {
    if (!valor) return '—';
    const d = new Date(valor);
    return isNaN(d.getTime()) ? String(valor) : d.toLocaleString('es-CO', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit'
    });
  }

  function asegurarEstadoFudo() {
    let el = document.getElementById('estado-fudo-caja');
    if (el) return el;
    el = document.createElement('div');
    el.id = 'estado-fudo-caja';
    el.style.cssText = 'margin:0 0 18px;padding:14px 16px;border-radius:10px;border:1px solid var(--line);font-size:.86rem;font-weight:600';
    const cabecera = document.querySelector('.cabecera-caja');
    if (cabecera && cabecera.parentNode) cabecera.parentNode.insertBefore(el, cabecera.nextSibling);
    return el;
  }

  function pintarEstadoFudo() {
    const el = asegurarEstadoFudo();
    if (!el) return;
    if (typeof estadoActual === 'undefined' || !estadoActual) {
      el.textContent = 'Consultando estado de sincronización con FUDO…';
      el.style.background = '#FFF8E8';
      el.style.color = 'var(--amber)';
      el.style.borderColor = 'var(--gold)';
      return;
    }

    const sync = estadoActual.fudo_sync || null;
    if (sync && sync.ok) {
      el.innerHTML = '✓ FUDO sincronizado · ' + fechaHora(sync.sincronizado_en) +
        (estadoActual.apertura ? ' · Efectivo FUDO desde apertura: <strong>' + moneda(estadoActual.pagos_efectivo_esperado || 0) + '</strong>' : '');
      el.style.background = '#F2F8F4';
      el.style.color = 'var(--green)';
      el.style.borderColor = 'var(--green)';
    } else {
      const error = sync && sync.error ? sync.error : 'No fue posible confirmar datos actualizados de FUDO.';
      el.innerHTML = '⚠ Cuadre no confiable: ' + String(error);
      el.style.background = '#FEF4F3';
      el.style.color = 'var(--red)';
      el.style.borderColor = 'var(--red)';
    }
  }

  function validarAntesDeAbrir(evento) {
    const boton = document.getElementById('abrir');
    if (!boton || evento.target !== boton) return;

    if (typeof estadoActual !== 'undefined' && estadoActual && estadoActual.cuadre_confiable === false) {
      evento.preventDefault();
      evento.stopImmediatePropagation();
      alert('No se puede abrir la caja porque FUDO no está sincronizado. Actualiza e inténtalo nuevamente.');
      return;
    }

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

  function validarAntesDeCerrar(evento) {
    const boton = document.getElementById('cerrar');
    if (!boton || evento.target !== boton) return;
    if (typeof estadoActual !== 'undefined' && estadoActual && estadoActual.cuadre_confiable === false) {
      evento.preventDefault();
      evento.stopImmediatePropagation();
      alert('No se puede cerrar la caja como cuadrada porque FUDO no está sincronizado. Presiona Actualizar y vuelve a intentarlo.');
    }
  }

  function iniciar() {
    ['base-contada', 'fuerte-contada-apertura'].forEach(function (id) {
      const el = document.getElementById(id);
      if (el) el.addEventListener('input', pintarDiferencias);
    });
    document.addEventListener('click', validarAntesDeAbrir, true);
    document.addEventListener('click', validarAntesDeCerrar, true);
    setInterval(pintarEstadoFudo, 700);
    setTimeout(function () {
      pintarDiferencias();
      pintarEstadoFudo();
    }, 400);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar);
  else iniciar();
})();
