(function () {
  if (!/caja\.html$/i.test(window.location.pathname)) return;

  // Antes esto usaba alert()/confirm() nativos del navegador para avisar y "aceptar" una
  // diferencia al abrir caja. Problema real reportado: un confirm() es fácil de cancelar sin
  // querer (un toque de más, un clic fuera del diálogo) y, si eso pasa, el clic en "Abrir caja"
  // se cancela EN SILENCIO — sin ningún aviso de que la apertura no se guardó. Quien lo vivió
  // creía haber abierto la caja (pasó por todo el flujo) y después la veía "sin abrir", sin
  // ningún rastro de qué pasó. Ahora el aviso queda fijo en la pantalla (no un popup que se
  // pueda cerrar sin querer) y "aprobar" es simplemente que el botón "Abrir caja" esté
  // habilitado.

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

  function esAdministrador() {
    const usuario = typeof Sesion !== 'undefined' ? Sesion.usuario() : null;
    return !!usuario && usuario.rol === 'Administrador';
  }

  function pintarDiferencias() {
    const salida = document.getElementById('diferencia-apertura');
    const boton = document.getElementById('abrir');
    if (!salida || !boton) return;
    const d = diferencias();
    const hayDiferencia = d.base !== 0 || d.fuerte !== 0;

    if (!hayDiferencia) {
      salida.innerHTML = '✓ El efectivo operativo y la caja fuerte coinciden.';
      salida.style.color = 'var(--green)';
      boton.disabled = false;
      return;
    }

    const partes = [];
    if (d.base !== 0) partes.push('Caja operativa: ' + (d.base > 0 ? '+' : '') + moneda(d.base));
    if (d.fuerte !== 0) partes.push('Caja fuerte: ' + (d.fuerte > 0 ? '+' : '') + moneda(d.fuerte));
    let html = '⚠ Diferencia al abrir — ' + partes.join(' · ');

    const observacionEl = document.getElementById('observacion-apertura');
    const tieneObservacion = !!(observacionEl && observacionEl.value.trim());

    if (!esAdministrador()) {
      html += '<br><strong>Hay una diferencia — solo un Administrador puede aprobar la apertura.</strong>';
      boton.disabled = true;
    } else if (!tieneObservacion) {
      html += '<br><strong>Escribe abajo qué pasó con la diferencia para poder aprobar la apertura.</strong>';
      boton.disabled = true;
    } else {
      html += '<br><strong style="color:var(--green)">Puedes aprobar la apertura con esta diferencia — quedará registrada a tu nombre con la observación.</strong>';
      boton.disabled = false;
    }
    salida.innerHTML = html;
    salida.style.color = 'var(--red)';
  }

  // Cerrar SÍ depende de que FUDO esté al día (el efectivo esperado se calcula con los pagos de
  // hoy) — si no se pudo confirmar una sincronización reciente, un Encargado/Cocina no puede
  // cerrar; un Administrador sí puede, dejando una observación (ver calculoCierre en caja.html,
  // que ya exige eso). Abrir NO depende de esto (la base esperada viene del cierre anterior), así
  // que no hay ningún bloqueo aquí para el botón "Abrir caja".
  function validarAntesDeCerrar(evento) {
    const boton = document.getElementById('cerrar');
    if (!boton || evento.target !== boton) return;
    if (typeof estadoActual !== 'undefined' && estadoActual && estadoActual.cuadre_confiable === false && !esAdministrador()) {
      evento.preventDefault();
      evento.stopImmediatePropagation();
      alert('No se puede cerrar la caja como cuadrada porque FUDO no está sincronizado. Presiona Actualizar y vuelve a intentarlo, o pide a un Administrador que autorice el cierre.');
    }
  }

  function iniciar() {
    ['base-contada', 'fuerte-contada-apertura', 'observacion-apertura'].forEach(function (id) {
      const el = document.getElementById(id);
      if (el) el.addEventListener('input', pintarDiferencias);
    });
    document.addEventListener('click', validarAntesDeCerrar, true);
    setTimeout(pintarDiferencias, 400);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar);
  else iniciar();
})();
