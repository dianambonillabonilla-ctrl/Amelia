/** Ajustes de compatibilidad para Caja V3. */
function cajaV3CredencialesFudoConfiguradas_() {
  if (typeof PropertiesService === 'undefined') return false;
  const p = PropertiesService.getScriptProperties();
  return !!(p.getProperty('FUDO_API_KEY') && p.getProperty('FUDO_API_SECRET'));
}

/**
 * En una instalación sin credenciales, sincronizar no es un error: simplemente FUDO no aplica.
 * Esto permite configurar/probar Caja desde cero sin depender de red ni credenciales.
 */
function cajaV3SincronizarFudo_(fecha, sede, usuario) {
  const f = cajaV3Fecha_(fecha);
  if (!cajaV3CredencialesFudoConfiguradas_()) {
    return {
      ok:true, aplica:false, fecha:f, sede:sede,
      ventas:null, pagos:null, gastos:null, errores:[],
      resumen:cajaV3FudoResumen_(f,sede)
    };
  }

  const res = { ok:true, aplica:true, fecha:f, sede:sede, ventas:null, pagos:null, gastos:null, errores:[] };
  try {
    if (typeof fudoApiSincronizarVentas_ === 'function') res.ventas = fudoApiSincronizarVentas_(f,f,usuario,{sede:'Automática'});
  } catch(e) { res.ok=false; res.errores.push('Ventas: '+(e.message||e)); }
  try {
    if (typeof fudoApiSincronizarPagos_ === 'function') res.pagos = fudoApiSincronizarPagos_(f,f,usuario,{sede:'Automática'});
  } catch(e) { res.ok=false; res.errores.push('Pagos: '+(e.message||e)); }
  try {
    if (typeof fudoApiSincronizarGastosArqueo_ === 'function') res.gastos = fudoApiSincronizarGastosArqueo_(f,f,usuario);
  } catch(e) { res.ok=false; res.errores.push('Gastos: '+(e.message||e)); }
  res.resumen = cajaV3FudoResumen_(f,sede);
  res.error = res.ok ? '' : res.errores.join(' | ');
  return res;
}
