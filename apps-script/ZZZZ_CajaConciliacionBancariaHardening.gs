/**
 * Endurecimiento final de Conciliación bancaria.
 * Se carga después de ZZZ_CajaConciliacionBancaria.gs y reemplaza únicamente el escritor genérico
 * para aplicar la misma defensa contra formula injection que usa el resto de DILANA OS.
 */
function cajaConcBancoAppend_(nombre, obj) {
  const sh = ss_().getSheetByName(nombre), hm = cajaConcBancoHeaderMap_(sh);
  sh.appendRow(hm.headers.map(function(h){
    const valor = obj[h] === undefined ? '' : obj[h];
    return typeof neutralizarFormula_ === 'function' ? neutralizarFormula_(valor) : valor;
  }));
}
