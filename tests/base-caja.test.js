const fs = require('fs');
const vm = require('vm');
const assert = require('assert');

function cargar(path, extras = {}) {
  const ctx = Object.assign({ console }, extras);
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path, 'utf8'), ctx, { filename: path });
  return ctx;
}

// Espejo de sedeEscrituraPermitida_ en Code.gs (ver mismo mock en gestiones.test.js).
function sedeEscrituraPermitidaMock_(usuario, sede) {
  return usuario.rol === 'Administrador' || usuario.sede === 'Ambas' ||
    sede === usuario.sede || sede === 'Centro de Producción';
}

function neutralizarFormulaMock_(v) {
  return (typeof v === 'string' && /^[=+\-@]/.test(v)) ? "'" + v : v;
}
function neutralizarObjetoFormulasMock_(obj) {
  const limpio = {};
  Object.keys(obj || {}).forEach((k) => { limpio[k] = neutralizarFormulaMock_(obj[k]); });
  return limpio;
}

const HEADERS = ['id', 'fecha', 'sede', 'efectivo_fudo', 'caja_fuerte', 'efectivo_caja_menor',
  'pendiente', 'gastos', 'cuadre', 'usuario', 'timestamp', 'observacion'];

function objFromRow_(row) {
  const obj = {};
  HEADERS.forEach((h, i) => { obj[h] = row[i] !== undefined ? row[i] : ''; });
  return obj;
}

let filas;
function reiniciar_() { filas = [HEADERS.slice()]; }
reiniciar_();

const fakeSheet = {
  getDataRange: () => ({ getValues: () => filas }),
  getRange: (r, c) => ({
    setValue: (v) => {
      while (filas.length <= r - 1) filas.push(new Array(HEADERS.length).fill(''));
      filas[r - 1][c - 1] = v;
    }
  })
};

let auditoriaLlamadas = [];
const bc = cargar('apps-script/BaseCaja.gs', {
  auditoriaRegistrar_: (usuario, accion, entidadTipo, entidadId, anterior, nuevo, sede, motivo) => {
    auditoriaLlamadas.push({ usuario, accion, entidadTipo, entidadId, anterior, nuevo, sede, motivo });
  },
  neutralizarFormula_: neutralizarFormulaMock_,
  neutralizarObjetoFormulas_: neutralizarObjetoFormulasMock_,
  sedeEscrituraPermitida_: sedeEscrituraPermitidaMock_,
  SHEET_NAMES: { BASE_CAJA: 'Base_Caja' },
  Utilities: { getUuid: () => 'bc-' + filas.length },
  formatearFecha_: (v) => String(v).slice(0, 10),
  sheet_: (name) => name === 'Base_Caja' ? fakeSheet : null,
  leerTabla_: (name) => name === 'Base_Caja'
    ? filas.slice(1).filter(r => r.some(v => v !== '' && v !== null)).map(objFromRow_)
    : [],
  appendRowFromObj_: (name, obj) => {
    if (name !== 'Base_Caja') return;
    filas.push(HEADERS.map(h => obj[h] !== undefined ? obj[h] : ''));
  }
});

const admin = { id: 'u1', nombre: 'Diana', rol: 'Administrador', sede: 'Ambas' };
const encargadoSA = { id: 'u2', nombre: 'Bryan', rol: 'Encargado', sede: 'San Antonio' };

// --- baseCajaCalcularCuadre_ ---
{
  reiniciar_();
  // Cuadra exacto: caja menor sube justo lo que debía subir (FUDO entra, gastos y caja fuerte salen).
  const cuadre = bc.baseCajaCalcularCuadre_(
    { efectivo_caja_menor: 100000, pendiente: 0 },
    { efectivo_fudo: 50000, gastos: 10000, caja_fuerte: 20000, efectivo_caja_menor: 120000, pendiente: 0 }
  );
  assert.strictEqual(cuadre, 0, 'debe cuadrar exacto: ' + cuadre);
  console.log('baseCajaCalcularCuadre_ cuadre exacto en 0: OK');
}
{
  // Falta plata: caja menor quedó 10.000 por debajo de lo esperado -> cuadre negativo.
  const cuadre = bc.baseCajaCalcularCuadre_(
    { efectivo_caja_menor: 100000, pendiente: 0 },
    { efectivo_fudo: 50000, gastos: 10000, caja_fuerte: 20000, efectivo_caja_menor: 110000, pendiente: 0 }
  );
  assert.strictEqual(cuadre, -10000, 'debe detectar faltante: ' + cuadre);
  console.log('baseCajaCalcularCuadre_ detecta faltante: OK');
}
{
  // Sobra plata: cuadre positivo.
  const cuadre = bc.baseCajaCalcularCuadre_(
    { efectivo_caja_menor: 100000, pendiente: 0 },
    { efectivo_fudo: 50000, gastos: 10000, caja_fuerte: 20000, efectivo_caja_menor: 130000, pendiente: 0 }
  );
  assert.strictEqual(cuadre, 10000, 'debe detectar sobrante: ' + cuadre);
  console.log('baseCajaCalcularCuadre_ detecta sobrante: OK');
}
{
  // Aparece un Pendiente nuevo hoy (sin que cambie nada más) — se ve como faltante hasta que se
  // resuelva. Caso real verificado contra el Excel de San Antonio (10-jul-2026: Pendiente $400.000
  // nuevo ese día, Cuadre -$400.000 ese mismo día).
  const cuadre = bc.baseCajaCalcularCuadre_(
    { efectivo_caja_menor: 100000, pendiente: 0 },
    { efectivo_fudo: 0, gastos: 0, caja_fuerte: 0, efectivo_caja_menor: 100000, pendiente: 400000 }
  );
  assert.strictEqual(cuadre, -400000, 'un pendiente nuevo sin nada que lo respalde debe verse como faltante: ' + cuadre);
  console.log('baseCajaCalcularCuadre_ refleja un pendiente nuevo: OK');
}

// --- baseCajaGuardar_ ---
{
  // Primer día que se registra una sede: no hay contra qué comparar, así que el cuadre se deja en
  // 0 en vez de calcular una diferencia sin sentido contra "nada" (mismo criterio que el Excel
  // original, cuya primera fila de cada sede también quedaba en 0 a mano).
  reiniciar_();
  const r = bc.baseCajaGuardar_({
    fecha: '2026-07-04', sede: 'San Antonio', efectivo_fudo: 460000, caja_fuerte: 0,
    efectivo_caja_menor: 460000, pendiente: 0, gastos: 450000
  }, admin);
  assert.ok(r.ok, 'debe guardar el primer día de una sede sin registro anterior');
  assert.strictEqual(r.cuadre, 0, 'primer día de una sede: cuadre forzado a 0, sin línea base');
  console.log('baseCajaGuardar_ primer registro de una sede (sin anterior): OK');
}
{
  reiniciar_();
  bc.baseCajaGuardar_({ fecha: '2026-07-04', sede: 'Capri', efectivo_caja_menor: 100000, efectivo_fudo: 0, gastos: 0, caja_fuerte: 0, pendiente: 0 }, admin);
  const r2 = bc.baseCajaGuardar_({ fecha: '2026-07-05', sede: 'Capri', efectivo_caja_menor: 150000, efectivo_fudo: 50000, gastos: 0, caja_fuerte: 0, pendiente: 0 }, admin);
  assert.strictEqual(r2.cuadre, 0, 'segundo día encadena contra el anterior guardado: ' + r2.cuadre);
  assert.ok(auditoriaLlamadas.every(a => a.accion !== 'base_caja_no_cuadra'), 'no debe auditar cuando sí cuadra');
  console.log('baseCajaGuardar_ encadena contra el día anterior real: OK');
}
{
  reiniciar_();
  auditoriaLlamadas = [];
  bc.baseCajaGuardar_({ fecha: '2026-07-09', sede: 'San Antonio', efectivo_caja_menor: 100000, efectivo_fudo: 0, gastos: 0, caja_fuerte: 0, pendiente: 0 }, admin);
  auditoriaLlamadas = [];
  const r = bc.baseCajaGuardar_({ fecha: '2026-07-10', sede: 'San Antonio', efectivo_caja_menor: 100000, efectivo_fudo: 500000, gastos: 0, caja_fuerte: 0, pendiente: 0 }, admin);
  assert.strictEqual(r.cuadre, -500000, '$500.000 de FUDO que nunca llegó a la caja menor debe verse como faltante: ' + r.cuadre);
  assert.strictEqual(auditoriaLlamadas.length, 1, 'debe auditar cuando no cuadra');
  assert.strictEqual(auditoriaLlamadas[0].accion, 'base_caja_no_cuadra');
  assert.strictEqual(auditoriaLlamadas[0].motivo, 'Faltante en caja');
  console.log('baseCajaGuardar_ audita cuando no cuadra (faltante): OK');
}
{
  reiniciar_();
  const r = bc.baseCajaGuardar_({ fecha: '2026-07-04', sede: 'Capri' }, admin);
  assert.strictEqual(r.ok, false, 'debe exigir el efectivo contado en caja menor');
  console.log('baseCajaGuardar_ exige efectivo_caja_menor: OK');
}
{
  reiniciar_();
  const r = bc.baseCajaGuardar_({ fecha: '2026-07-04', sede: 'Capri', efectivo_caja_menor: 100000 }, encargadoSA);
  assert.strictEqual(r.ok, false, 'un Encargado de San Antonio no debe poder guardar la caja de Capri');
  console.log('baseCajaGuardar_ respeta sedeEscrituraPermitida_: OK');
}
{
  // Guardar dos veces el mismo día/sede actualiza la misma fila en vez de duplicarla.
  reiniciar_();
  bc.baseCajaGuardar_({ fecha: '2026-07-04', sede: 'Capri', efectivo_caja_menor: 100000, efectivo_fudo: 0, gastos: 0, caja_fuerte: 0, pendiente: 0 }, admin);
  const r2 = bc.baseCajaGuardar_({ fecha: '2026-07-04', sede: 'Capri', efectivo_caja_menor: 120000, efectivo_fudo: 0, gastos: 0, caja_fuerte: 0, pendiente: 0, observacion: 'corrección' }, admin);
  assert.strictEqual(r2.actualizado, true);
  const guardadas = bc.baseCajaListar_({ sede: 'Capri' }, admin);
  assert.strictEqual(guardadas.length, 1, 'no debe duplicar fila del mismo día/sede: ' + guardadas.length);
  assert.strictEqual(guardadas[0].observacion, 'corrección');
  console.log('baseCajaGuardar_ actualiza en vez de duplicar el mismo día/sede: OK');
}

// --- baseCajaDia_ / baseCajaListar_ ---
{
  reiniciar_();
  bc.baseCajaGuardar_({ fecha: '2026-07-04', sede: 'San Antonio', efectivo_caja_menor: 100000, efectivo_fudo: 0, gastos: 0, caja_fuerte: 0, pendiente: 0 }, admin);
  bc.baseCajaGuardar_({ fecha: '2026-07-05', sede: 'San Antonio', efectivo_caja_menor: 100000, efectivo_fudo: 0, gastos: 0, caja_fuerte: 0, pendiente: 0 }, admin);
  bc.baseCajaGuardar_({ fecha: '2026-07-04', sede: 'Capri', efectivo_caja_menor: 50000, efectivo_fudo: 0, gastos: 0, caja_fuerte: 0, pendiente: 0 }, admin);

  const dia = bc.baseCajaDia_('2026-07-04', 'San Antonio');
  assert.ok(dia.ok && dia.item, 'debe encontrar el registro existente');
  const vacio = bc.baseCajaDia_('2026-07-06', 'San Antonio');
  assert.strictEqual(vacio.item, null, 'un día sin registro debe devolver null, no error');

  const soloSA = bc.baseCajaListar_({ sede: 'San Antonio' }, admin);
  assert.strictEqual(soloSA.length, 2, 'debe filtrar por sede');
  assert.strictEqual(soloSA[0].fecha, '2026-07-05', 'más reciente primero');

  const vistaEncargado = bc.baseCajaListar_({}, encargadoSA);
  assert.ok(vistaEncargado.every(r => r.sede === 'San Antonio'), 'un Encargado de una sede no debe ver la caja de otra sede');
  console.log('baseCajaDia_/baseCajaListar_: OK');
}

console.log('base-caja: OK');
