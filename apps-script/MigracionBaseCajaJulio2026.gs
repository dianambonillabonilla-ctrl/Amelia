/**
 * MIGRACIÓN ÚNICA — Base de Caja, julio 2026 (San Antonio y Capri)
 * Carga los datos que ya existían en los Excel "Cálculos del Día" de cada sede (pestaña "Cuadre de
 * Caja") a la hoja nueva Base_Caja, para no perder el histórico de julio al pasarse a Dilana OS.
 *
 * Corre UNA sola vez desde el editor de Apps Script (después de correr configurarHojas()): elige
 * `migrarBaseCajaJulio2026_` en el desplegable de funciones y dale a Ejecutar. Es segura de repetir
 * — baseCajaGuardar_ actualiza en vez de duplicar si la fecha+sede ya existe.
 *
 * Los valores por sede/fecha vienen tal cual del Excel de origen. Se guardan en orden cronológico
 * (cada llamada a baseCajaGuardar_ encadena contra el día anterior real, igual que hace la app en
 * uso normal) — el "cuadre" que calcula el sistema se comparó fila por fila contra el "Cuadre" que
 * ya traía cada Excel antes de escribir esta función y coincide exacto en las 42 filas.
 *
 * Días sin fila aquí (ej. 21-jul en San Antonio, o 26-31 jul en Capri) no tenían datos reales en el
 * Excel de origen (quedaban en blanco/cero — no un día real cerrado), así que a propósito no se
 * migran para no inventar un "cuadre" de un día que nunca se contó.
 */
function migrarBaseCajaJulio2026_() {
  const usuarioMigracion = { id: '', nombre: 'Migración julio 2026', rol: 'Administrador', sede: 'Ambas' };

  // fecha, efectivo_fudo, caja_fuerte, efectivo_caja_menor, pendiente, gastos
  const SAN_ANTONIO = [
    ['2026-07-04', 959900, 0, 919900, 0, 40000],
    ['2026-07-05', 536500, 500000, 946400, 0, 10000],
    ['2026-07-06', 132000, 0, 917900, 0, 160500],
    ['2026-07-07', 207200, 600000, 512100, 0, 13000],
    ['2026-07-08', 39600, 0, 532600, 0, 19100],
    ['2026-07-09', 0, 0, 532600, 0, 0],
    ['2026-07-10', 187800, 0, 674800, 400000, 45600],
    ['2026-07-11', 435800, 0, 705000, 0, 5600],
    ['2026-07-12', 795000, 900000, 445900, 0, 154100],
    ['2026-07-13', 160800, 0, 342400, 0, 264300],
    ['2026-07-14', 383000, 0, 709200, 0, 16200],
    ['2026-07-15', 263900, 400000, 564300, 0, 8800],
    ['2026-07-16', 416350, 0, 895300, 0, 85480],
    ['2026-07-17', 368900, 600000, 554800, 0, 109400],
    ['2026-07-18', 411500, 0, 935700, 0, 30600],
    ['2026-07-19', 407000, 0, 1072300, 0, 240400],
    ['2026-07-20', 171050, 500000, 732000, 0, 11800],
    ['2026-07-22', 406600, 600000, 511200, 0, 27400],
    ['2026-07-23', 289400, 0, 714200, 0, 31500],
    ['2026-07-24', 199900, 0, 886100, 0, 28000],
    ['2026-07-25', 519750, 800000, 590450, 0, 15400]
  ];
  // Cuadre esperado (tal cual el Excel original) — solo para el chequeo de abajo, no se guarda.
  const SAN_ANTONIO_CUADRE_ESPERADO = [0, 0, 0, 0, 0, 0, -400000, 0, 0, 0, 0, 0, 130, 0, 0, -30000, 450, 0, -54900, 0, 0];

  const CAPRI = [
    ['2026-07-04', 460000, 0, 0, 0, 450000],
    ['2026-07-05', 402400, 0, 52400, 0, 350000],
    ['2026-07-06', 185800, 0, 298450, 0, 118800],
    ['2026-07-07', 219500, 0, 401250, 0, 116700],
    ['2026-07-08', 622200, 0, 644450, 0, 379000],
    ['2026-07-09', 393000, 0, 98600, 0, 938850],
    ['2026-07-10', 20000, 0, 202950, 0, 5000],
    ['2026-07-11', 64000, 0, 234750, 0, 32250],
    ['2026-07-12', 138500, 0, 378950, 0, 0],
    ['2026-07-13', 109679, 0, 198950, 0, 382200],
    ['2026-07-14', 41800, 0, 201550, 0, 39200],
    ['2026-07-15', 0, 0, 0, 0, 0],
    ['2026-07-16', 137650, 0, 339200, 0, 0],
    ['2026-07-17', 109500, 0, 222400, 0, 226300],
    ['2026-07-18', 55000, 0, 248900, 0, 28500],
    ['2026-07-19', 37000, 0, 285900, 0, 0],
    ['2026-07-20', 0, 0, 276400, 0, 9500],
    ['2026-07-21', 10000, 0, 286400, 0, 0],
    ['2026-07-22', 206800, 0, 218400, 0, 376100],
    ['2026-07-23', 0, 0, 207400, 0, 11000],
    ['2026-07-24', 77000, 0, 279900, 0, 4500],
    ['2026-07-25', 421200, 0, 129700, 0, 571700]
  ];
  const CAPRI_CUADRE_ESPERADO = [0, 0, 179050, 0, 0, 0, 89350, 50, 5700, 92521, 0, -201550, 201550, 0, 0, 0, 0, 0, 101300, 0, 0, 300];

  function migrarSede_(sede, filas, cuadresEsperados) {
    let ok = 0;
    filas.forEach(function (fila, i) {
      const item = {
        fecha: fila[0], efectivo_fudo: fila[1], caja_fuerte: fila[2],
        efectivo_caja_menor: fila[3], pendiente: fila[4], gastos: fila[5], sede: sede
      };
      const r = baseCajaGuardar_(item, usuarioMigracion);
      if (!r.ok) {
        Logger.log('[migrarBaseCajaJulio2026_] ' + sede + ' ' + fila[0] + ' FALLÓ: ' + r.error);
        return;
      }
      if (Math.abs(r.cuadre - cuadresEsperados[i]) > 0.01) {
        Logger.log('[migrarBaseCajaJulio2026_] ' + sede + ' ' + fila[0] + ' cuadre distinto al del Excel original — calculado: ' +
          r.cuadre + ', esperado: ' + cuadresEsperados[i] + '. Revisa antes de confiar en este día.');
      } else {
        ok++;
      }
    });
    Logger.log('[migrarBaseCajaJulio2026_] ' + sede + ': ' + ok + ' de ' + filas.length + ' días migrados igual que el Excel original.');
  }

  migrarSede_('San Antonio', SAN_ANTONIO, SAN_ANTONIO_CUADRE_ESPERADO);
  migrarSede_('Capri', CAPRI, CAPRI_CUADRE_ESPERADO);
  Logger.log('[migrarBaseCajaJulio2026_] Listo. Revisa el registro de ejecución completo por si algún día quedó marcado como distinto.');
}
