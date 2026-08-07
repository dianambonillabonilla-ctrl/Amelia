/**
 * CajaTurno.gs (consolidado — antes esta prueba cargaba CajaTurno.gs + CajaV2.gs por separado,
 * hasta que ambos archivos declaraban las mismas funciones globales y competían entre sí según el
 * orden de carga; CajaV2.gs se eliminó y todo quedó en un solo archivo): al abrir o cerrar con una
 * diferencia (efectivo o caja fuerte), solo un Administrador puede aprobarlo — Encargado/Cocina
 * deben poder hacerlo libremente cuando todo cuadra, pero una descuadre necesita que alguien con
 * ese rol lo revise antes de dar el turno por abierto/cerrado.
 *
 * Sin FUDO_API_KEY/SECRET configuradas (como en esta prueba), cajaSincronizarFudo_ no aplica —
 * cajaAbrir_/cajaCerrar_/cajaEstado_ se comportan exactamente igual que si esa validación no
 * existiera, así que estas pruebas no necesitan simular CacheService ni la API de FUDO.
 */
const fs = require('fs');
const vm = require('vm');
const assert = require('assert');

const TURNO_HEADERS = [
  'id', 'fecha', 'sede', 'estado',
  'base_esperada', 'base_inicial', 'diferencia_apertura', 'observacion_apertura',
  'caja_fuerte_esperada_apertura', 'caja_fuerte_inicial', 'diferencia_caja_fuerte_apertura',
  'hora_apertura', 'usuario_apertura_id', 'usuario_apertura', 'efectivo_fudo_al_abrir',
  'rappi_encendido', 'rappi_confirmado_por', 'rappi_confirmado_en',
  'efectivo_contado', 'efectivo_esperado', 'diferencia',
  'caja_fuerte_contada', 'caja_fuerte_esperada', 'diferencia_caja_fuerte', 'caja_fuerte_siguiente',
  'entrega_cierre', 'persona_recibe_cierre', 'persona_verifica_cierre', 'base_siguiente',
  'usuario_cierre', 'hora_cierre', 'observacion_cierre', 'timestamp_cierre'
];
const MOVIMIENTOS_HEADERS = [
  'id', 'fecha', 'sede', 'tipo', 'valor', 'persona_entrega', 'persona_recibe',
  'hora', 'motivo', 'evidencia_url', 'usuario_id', 'usuario', 'timestamp'
];

// Hoja falsa que vive sobre un array de OBJETOS (no arrays crudos): leerTabla_ lee ese mismo
// array directamente, y sh.getRange(fila, col).setValue(v) (cajaTurnoActualizarFila_ escribe
// celda por celda, no por lotes) escribe de vuelta en el objeto correspondiente.
function fakeHojaObjetos_(headers, filas) {
  return {
    getDataRange: () => ({
      getValues: () => [headers].concat(filas.map((o) => headers.map((h) => (o[h] !== undefined ? o[h] : ''))))
    }),
    getRange: (fila, col) => ({
      setValue: (v) => { filas[fila - 2][headers[col - 1]] = v; }
    })
  };
}

function construirEntorno_() {
  const turnos = [];
  const propiedadesScript = new Map();
  // cajaMigrarHistorico_ inyecta, la primera vez que no encuentra su propio id ya guardado, tres
  // movimientos históricos fijos (San Antonio y Capri, agosto 2026). Son correcciones de hechos
  // reales (una migración de datos, no algo que estas pruebas deban ejercitar), así que se
  // pre-cargan sus IDs para que la migración los vea como "ya existentes" y no los repita — igual
  // que en el deployment real después de la primera vez que corrió.
  const movimientos = [
    { id: 'migracion-caja-fuerte-sa-20260802', fecha: '2026-08-02', sede: 'San Antonio', tipo: 'Envío a caja fuerte', valor: 1000000 },
    { id: 'migracion-entrega-admin-capri-20260803', fecha: '2026-08-03', sede: 'Capri', tipo: 'Entrega administrador desde caja', valor: 550000 },
    { id: 'migracion-retiro-fuerte-sa-20260803', fecha: '2026-08-03', sede: 'San Antonio', tipo: 'Entrega administrador desde caja fuerte', valor: 1000000 }
  ];
  const SHEET_NAMES = { CAJA_TURNO: 'caja_turno', CAJA_MOVIMIENTOS: 'caja_movimientos' };
  const hojas = {
    [SHEET_NAMES.CAJA_TURNO]: () => fakeHojaObjetos_(TURNO_HEADERS, turnos),
    [SHEET_NAMES.CAJA_MOVIMIENTOS]: () => fakeHojaObjetos_(MOVIMIENTOS_HEADERS, movimientos)
  };
  const tablas = { [SHEET_NAMES.CAJA_TURNO]: turnos, [SHEET_NAMES.CAJA_MOVIMIENTOS]: movimientos };

  const ctx = {
    console,
    SHEET_NAMES,
    sheet_: (nombre) => hojas[nombre](),
    leerTabla_: (nombre) => tablas[nombre] || [],
    appendRowFromObj_: (nombre, fila) => { if (tablas[nombre]) tablas[nombre].push(fila); },
    asegurarColumnas_: () => {},
    formatearFecha_: (v) => String(v).slice(0, 10),
    neutralizarObjetoFormulas_: (obj) => obj,
    sedeEscrituraPermitida_: () => true,
    auditoriaRegistrar_: () => {},
    // cajaPuedeCerrar_ solo cae aquí cuando el rol no es Administrador/Encargado (Cocina) — se
    // simula que sí tiene el sector "Caja" asignado hoy, para que estas pruebas ejerciten la regla
    // de diferencia (lo que de verdad les interesa) y no la de asignación de sector.
    turnoSectorDeHoy_: () => ({ sector: 'Caja' }),
    Utilities: { getUuid: () => 'caja-turno-' + (turnos.length + movimientos.length + 1) },
    // Propiedades del Script en memoria: real (getProperty/setProperty sobre un Map), no un mock
    // que siempre devuelve null — cajaMigrarHistorico_ ahora se marca "hecho" aquí después de
    // correr una vez. FUDO_API_KEY/SECRET nunca se ponen, así que cajaFudoCredencialesConfiguradas_
    // sigue dando false y cajaSincronizarFudo_ nunca toca la API real.
    PropertiesService: { getScriptProperties: () => ({
      getProperty: (k) => (propiedadesScript.has(k) ? propiedadesScript.get(k) : null),
      setProperty: (k, v) => propiedadesScript.set(k, String(v))
    }) },
    CacheService: { getScriptCache: () => ({ get: () => null, put: () => {} }) },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }) }
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync('apps-script/CajaTurno.gs', 'utf8'), ctx, { filename: 'CajaTurno.gs' });
  return { ctx, turnos, movimientos };
}

function abrirTurno_(ctx, turnos, overrides) {
  turnos.push(Object.assign({
    id: 't1', fecha: '2026-07-15', sede: 'San Antonio', estado: 'Abierto',
    base_esperada: 0, base_inicial: 100000, efectivo_fudo_al_abrir: 0,
    caja_fuerte_inicial: 0
  }, overrides));
}

const administrador = { nombre: 'Diana', rol: 'Administrador' };
const encargada = { nombre: 'Ana', rol: 'Encargado' };
const cocina = { nombre: 'Luis', rol: 'Cocina' };

// --- cajaCerrar_ ----------------------------------------------------------------------------------

// Sin ninguna diferencia: Encargado/Cocina cierran sin problema.
{
  const { ctx, turnos } = construirEntorno_();
  abrirTurno_(ctx, turnos, { base_inicial: 100000, caja_fuerte_inicial: 0 });
  const r = ctx.cajaCerrar_({ fecha: '2026-07-15', sede: 'San Antonio', efectivo_contado: 100000, caja_fuerte_contada: 0, persona_recibe_cierre: 'Diana', persona_verifica_cierre: 'Carolina' }, encargada);
  assert.equal(r.ok, true, 'Encargado debe poder cerrar cuando lo contado coincide exactamente con lo esperado');
  assert.equal(r.diferencia, 0);
}

// Diferencia en efectivo: Encargado NO puede cerrar.
{
  const { ctx, turnos } = construirEntorno_();
  abrirTurno_(ctx, turnos, { base_inicial: 100000, caja_fuerte_inicial: 0 });
  const r = ctx.cajaCerrar_({ fecha: '2026-07-15', sede: 'San Antonio', efectivo_contado: 90000, caja_fuerte_contada: 0, observacion: 'faltan 10.000', persona_recibe_cierre: 'Diana', persona_verifica_cierre: 'Carolina' }, encargada);
  assert.equal(r.ok, false, 'Encargado NO debe poder cerrar con diferencia en efectivo, ni con observación');
  assert.match(r.error, /Solo un Administrador puede cerrar/);
  assert.equal(turnos[0].estado, 'Abierto', 'la caja debe seguir abierta: el intento bloqueado no debe cerrarla');
}

// Diferencia en efectivo: Cocina tampoco puede cerrar.
{
  const { ctx, turnos } = construirEntorno_();
  abrirTurno_(ctx, turnos, { base_inicial: 100000, caja_fuerte_inicial: 0 });
  const r = ctx.cajaCerrar_({ fecha: '2026-07-15', sede: 'San Antonio', efectivo_contado: 90000, caja_fuerte_contada: 0, persona_recibe_cierre: 'Diana', persona_verifica_cierre: 'Carolina' }, cocina);
  assert.equal(r.ok, false, 'Cocina tampoco debe poder cerrar con diferencia');
}

// Diferencia solo en caja fuerte (efectivo cuadra): tampoco puede un Encargado.
{
  const { ctx, turnos } = construirEntorno_();
  abrirTurno_(ctx, turnos, { base_inicial: 100000, caja_fuerte_inicial: 500000 });
  const r = ctx.cajaCerrar_({ fecha: '2026-07-15', sede: 'San Antonio', efectivo_contado: 100000, caja_fuerte_contada: 400000, persona_recibe_cierre: 'Diana', persona_verifica_cierre: 'Carolina' }, encargada);
  assert.equal(r.ok, false, 'una diferencia SOLO en caja fuerte también debe bloquear a Encargado');
  assert.match(r.error, /Solo un Administrador puede cerrar/);
}

// Administrador SÍ puede cerrar con diferencia.
{
  const { ctx, turnos } = construirEntorno_();
  abrirTurno_(ctx, turnos, { base_inicial: 100000, caja_fuerte_inicial: 0 });
  const r = ctx.cajaCerrar_({ fecha: '2026-07-15', sede: 'San Antonio', efectivo_contado: 90000, caja_fuerte_contada: 0, observacion: 'faltan 10.000, reportado a gerencia', persona_recibe_cierre: 'Diana', persona_verifica_cierre: 'Carolina' }, administrador);
  assert.equal(r.ok, true, 'Administrador debe poder cerrar aunque haya diferencia');
  assert.equal(r.diferencia, -10000);
  assert.equal(turnos[0].estado, 'Cerrado');
}

// --- cajaAbrir_: misma regla al ABRIR — con diferencia, solo un Administrador puede aprobar --------

// Sin ninguna diferencia (nada previo cerrado => esperado 0 y 0): Encargado abre sin problema.
{
  const { ctx, turnos } = construirEntorno_();
  const r = ctx.cajaAbrir_({ fecha: '2026-07-15', sede: 'San Antonio', base_inicial: 0, caja_fuerte_inicial: 0 }, encargada);
  assert.equal(r.ok, true, 'Encargado debe poder abrir cuando lo contado coincide con lo esperado');
  assert.equal(turnos.length, 1);
}

// Diferencia en base (efectivo): Encargado NO puede abrir.
{
  const { ctx, turnos } = construirEntorno_();
  const r = ctx.cajaAbrir_({ fecha: '2026-07-15', sede: 'San Antonio', base_inicial: 50000, caja_fuerte_inicial: 0, observacion_apertura: 'sobra efectivo' }, encargada);
  assert.equal(r.ok, false, 'Encargado NO debe poder abrir con diferencia en la base, ni con observación');
  assert.match(r.error, /Solo un Administrador puede aprobar la apertura/);
  assert.equal(turnos.length, 0, 'no debe quedar ninguna fila creada cuando se bloquea la apertura');
}

// Diferencia solo en caja fuerte (base cuadra): tampoco puede un Encargado ni Cocina.
{
  const { ctx, turnos } = construirEntorno_();
  const r = ctx.cajaAbrir_({ fecha: '2026-07-15', sede: 'San Antonio', base_inicial: 0, caja_fuerte_inicial: 100000 }, cocina);
  assert.equal(r.ok, false, 'una diferencia SOLO en caja fuerte también debe bloquear a Cocina al abrir');
  assert.match(r.error, /Solo un Administrador puede aprobar la apertura/);
  assert.equal(turnos.length, 0);
}

// Administrador SÍ puede abrir con diferencia.
{
  const { ctx, turnos } = construirEntorno_();
  const r = ctx.cajaAbrir_({ fecha: '2026-07-15', sede: 'San Antonio', base_inicial: 50000, caja_fuerte_inicial: 100000, observacion_apertura: 'caja fuerte vacía, reportado' }, administrador);
  assert.equal(r.ok, true, 'Administrador debe poder abrir aunque haya diferencia');
  assert.equal(turnos.length, 1);
  assert.equal(turnos[0].diferencia_apertura, 50000);
  assert.equal(turnos[0].diferencia_caja_fuerte_apertura, 100000);
}

// --- Candado contra dos aperturas/cierres simultáneos para la misma fecha+sede --------------------

// Si no se puede tomar el candado (otra apertura ya en curso), se avisa en vez de crear una
// segunda fila.
{
  const { ctx, turnos } = construirEntorno_();
  ctx.LockService = { getScriptLock: () => ({ tryLock: () => false, releaseLock: () => {} }) };
  const r = ctx.cajaAbrir_({ fecha: '2026-07-15', sede: 'San Antonio', base_inicial: 0, caja_fuerte_inicial: 0 }, administrador);
  assert.equal(r.ok, false, 'no debe abrir si no se pudo tomar el candado');
  assert.match(r.error, /en curso/);
  assert.equal(turnos.length, 0);
}

// Carrera real: entre el primer chequeo y tomar el candado, otra apertura ya se guardó — al
// re-revisar DENTRO del candado debe detectarlo y no duplicar la fila.
{
  const { ctx, turnos } = construirEntorno_();
  ctx.LockService = {
    getScriptLock: () => ({
      tryLock: () => {
        // Simula que, justo al tomar el candado, ya existe una apertura de otro dispositivo.
        turnos.push({ id: 'ganador-de-la-carrera', fecha: '2026-07-15', sede: 'San Antonio', estado: 'Abierto', base_inicial: 0, caja_fuerte_inicial: 0 });
        return true;
      },
      releaseLock: () => {}
    })
  };
  const r = ctx.cajaAbrir_({ fecha: '2026-07-15', sede: 'San Antonio', base_inicial: 0, caja_fuerte_inicial: 0 }, administrador);
  assert.equal(r.ok, true);
  assert.equal(r.ya_abierta, true, 'debe reconocer la apertura que ganó la carrera, no crear una segunda');
  assert.equal(turnos.length, 1, 'no debe quedar una fila duplicada');
}

// Lo mismo al cerrar: si no se puede tomar el candado, se avisa en vez de arriesgar un cierre a medias.
{
  const { ctx, turnos } = construirEntorno_();
  abrirTurno_(ctx, turnos, { base_inicial: 100000, caja_fuerte_inicial: 0 });
  ctx.LockService = { getScriptLock: () => ({ tryLock: () => false, releaseLock: () => {} }) };
  const r = ctx.cajaCerrar_({ fecha: '2026-07-15', sede: 'San Antonio', efectivo_contado: 100000, caja_fuerte_contada: 0, persona_recibe_cierre: 'Diana', persona_verifica_cierre: 'Carolina' }, administrador);
  assert.equal(r.ok, false, 'no debe cerrar si no se pudo tomar el candado');
  assert.match(r.error, /en curso/);
  assert.equal(turnos[0].estado, 'Abierto');
}

// --- Validaciones de los campos de conteo (vacíos/negativos) — antes se leían como "$0" en silencio,
// ahora se rechazan explícitamente. Ligado a que caja.html ya no precarga estos campos con lo
// esperado: sin esta validación, enviar el formulario vacío abría/cerraba igual, siempre "sin
// diferencia", sin que nadie hubiera contado nada de verdad. ------------------------------------------

// Abrir sin escribir el efectivo contado (campo vacío) debe rechazarse, no leerse como $0.
{
  const { ctx, turnos } = construirEntorno_();
  const r = ctx.cajaAbrir_({ fecha: '2026-07-15', sede: 'San Antonio', base_inicial: '', caja_fuerte_inicial: 0 }, administrador);
  assert.equal(r.ok, false, 'no debe poder abrir con el efectivo contado vacío');
  assert.match(r.error, /Falta contar el dinero/);
  assert.equal(turnos.length, 0);
}

// Abrir con un valor negativo debe rechazarse.
{
  const { ctx, turnos } = construirEntorno_();
  const r = ctx.cajaAbrir_({ fecha: '2026-07-15', sede: 'San Antonio', base_inicial: -1000, caja_fuerte_inicial: 0 }, administrador);
  assert.equal(r.ok, false, 'no debe poder abrir con efectivo contado negativo');
  assert.match(r.error, /no puede ser negativo/);
  assert.equal(turnos.length, 0);
}

// Cerrar sin escribir el efectivo contado (campo vacío) debe rechazarse.
{
  const { ctx, turnos } = construirEntorno_();
  abrirTurno_(ctx, turnos, { base_inicial: 100000, caja_fuerte_inicial: 0 });
  const r = ctx.cajaCerrar_({ fecha: '2026-07-15', sede: 'San Antonio', efectivo_contado: '', caja_fuerte_contada: 0, persona_recibe_cierre: 'Diana', persona_verifica_cierre: 'Carolina' }, administrador);
  assert.equal(r.ok, false, 'no debe poder cerrar con el efectivo contado vacío');
  assert.match(r.error, /Falta contar el dinero/);
  assert.equal(turnos[0].estado, 'Abierto');
}

// Cerrar sin decir quién recibe el dinero debe rechazarse.
{
  const { ctx, turnos } = construirEntorno_();
  abrirTurno_(ctx, turnos, { base_inicial: 100000, caja_fuerte_inicial: 0 });
  const r = ctx.cajaCerrar_({ fecha: '2026-07-15', sede: 'San Antonio', efectivo_contado: 100000, caja_fuerte_contada: 0 }, administrador);
  assert.equal(r.ok, false, 'no debe poder cerrar sin decir quién recibe el cierre');
  assert.match(r.error, /persona que recibe/);
  assert.equal(turnos[0].estado, 'Abierto');
}

// Cerrar sin decir quién verifica el cierre debe rechazarse (Diana, ago 2026: son dos personas
// distintas — quien recibe el dinero no es necesariamente quien verifica el arqueo).
{
  const { ctx, turnos } = construirEntorno_();
  abrirTurno_(ctx, turnos, { base_inicial: 100000, caja_fuerte_inicial: 0 });
  const r = ctx.cajaCerrar_({ fecha: '2026-07-15', sede: 'San Antonio', efectivo_contado: 100000, caja_fuerte_contada: 0, persona_recibe_cierre: 'Diana' }, administrador);
  assert.equal(r.ok, false, 'no debe poder cerrar sin decir quién verifica el cierre');
  assert.match(r.error, /persona que verifica/);
  assert.equal(turnos[0].estado, 'Abierto');
}

// La base para el siguiente turno no puede ser mayor que lo contado.
{
  const { ctx, turnos } = construirEntorno_();
  abrirTurno_(ctx, turnos, { base_inicial: 100000, caja_fuerte_inicial: 0 });
  const r = ctx.cajaCerrar_({ fecha: '2026-07-15', sede: 'San Antonio', efectivo_contado: 100000, caja_fuerte_contada: 0, base_siguiente: 150000, persona_recibe_cierre: 'Diana', persona_verifica_cierre: 'Carolina' }, administrador);
  assert.equal(r.ok, false, 'la base siguiente no puede superar lo contado');
  assert.match(r.error, /no puede ser mayor/);
  assert.equal(turnos[0].estado, 'Abierto');
}

// --- Sin credenciales de FUDO configuradas, cuadre_confiable no debe bloquear nada -----------------
{
  const { ctx, turnos } = construirEntorno_();
  const estado = ctx.cajaEstado_('2026-07-15', 'San Antonio', encargada);
  assert.equal(estado.cuadre_confiable, true, 'sin credenciales de FUDO, el cuadre debe considerarse confiable (la validación no aplica)');
}

// --- Efectivo "Sin identificar" es puramente informativo: Diana (ago 2026) pidió explícitamente
// que nunca bloquee ni abrir ni cerrar caja, solo que se sepa que existe (el Administrador lo
// concilia aparte, desde "Ventas pendientes de sede"). -----------------------------------------
{
  const { ctx, turnos } = construirEntorno_();
  ctx.pagosFudoTotalesSedeFecha_ = (fecha, sede) => (
    sede === 'Sin identificar' ? { pagos_efectivo_esperado: 75000 } : { pagos_efectivo_esperado: 0 }
  );

  const estadoSinAbrir = ctx.cajaEstado_('2026-07-15', 'San Antonio', encargada);
  assert.equal(estadoSinAbrir.ok, true);
  assert.equal(estadoSinAbrir.efectivo_sin_identificar, 75000, 'debe informar el monto aunque la caja ni siquiera esté abierta');

  abrirTurno_(ctx, turnos, { base_inicial: 100000, caja_fuerte_inicial: 0 });
  const estadoAbierto = ctx.cajaEstado_('2026-07-15', 'San Antonio', encargada);
  assert.equal(estadoAbierto.efectivo_sin_identificar, 75000);

  const cierre = ctx.cajaCerrar_({ fecha: '2026-07-15', sede: 'San Antonio', efectivo_contado: 100000, caja_fuerte_contada: 0, persona_recibe_cierre: 'Diana', persona_verifica_cierre: 'Carolina' }, encargada);
  assert.equal(cierre.ok, true, 'el efectivo Sin identificar nunca debe bloquear el cierre, ni siquiera para un Encargado');
  assert.equal(cierre.efectivo_sin_identificar, 75000, 'debe informarse en la respuesta del cierre para que la pantalla lo muestre');
}

// --- La migración histórica corre una sola vez (bandera en Propiedades del Script), no en cada
// acción de Caja — se prueba con un entorno SIN los IDs pre-cargados, para distinguir "no la repite
// porque ya reconoce los IDs" de "no la repite porque ya está marcada como hecha". -----------------
{
  const { ctx, movimientos } = construirEntorno_();
  movimientos.length = 0; // quitar los 3 IDs pre-cargados por construirEntorno_ para esta prueba puntual
  ctx.cajaEstado_('2026-07-15', 'San Antonio', administrador); // dispara cajaAsegurarEstructura_ -> cajaMigrarHistorico_
  assert.equal(movimientos.length, 3, 'la primera vez debe insertar las 3 migraciones históricas');
  movimientos.length = 0; // se "borran" a mano, como si alguien las quitara de la hoja
  ctx.cajaEstado_('2026-07-15', 'San Antonio', administrador); // segunda llamada: ya debe estar marcada como hecha
  assert.equal(movimientos.length, 0, 'una vez marcada como hecha, no debe volver a insertarlas aunque ya no estén');
}

// --- cajaNivelConfianza_: FUDO no confiable gana siempre; Sin identificar/diferencia son solo
// "pendiente" (nunca bloquean, ago 2026); sin ninguna señal mala, es "confiable". --------------
{
  const { ctx } = construirEntorno_();
  assert.equal(ctx.cajaNivelConfianza_(false, 0, false), 'no_confiable');
  assert.equal(ctx.cajaNivelConfianza_(false, 50000, true), 'no_confiable', 'FUDO no confiable manda aunque también haya otras señales');
  assert.equal(ctx.cajaNivelConfianza_(true, 50000, false), 'pendiente');
  assert.equal(ctx.cajaNivelConfianza_(true, 0, true), 'pendiente');
  assert.equal(ctx.cajaNivelConfianza_(true, 0, false), 'confiable');
}

// --- cajaEstado_/cajaCerrar_ exponen nivel_confianza usando esa misma función ---------------------
{
  const { ctx, turnos } = construirEntorno_();
  const sinAbrir = ctx.cajaEstado_('2026-07-15', 'San Antonio', encargada);
  assert.equal(sinAbrir.nivel_confianza, 'confiable', 'sin FUDO configurado y sin Sin identificar, debe verse confiable aunque la caja no esté abierta');

  abrirTurno_(ctx, turnos, { base_inicial: 100000, caja_fuerte_inicial: 0 });
  const cierreConDiferencia = ctx.cajaCerrar_({ fecha: '2026-07-15', sede: 'San Antonio', efectivo_contado: 90000, caja_fuerte_contada: 0, observacion: 'faltan 10.000', persona_recibe_cierre: 'Diana', persona_verifica_cierre: 'Carolina' }, administrador);
  assert.equal(cierreConDiferencia.ok, true);
  assert.equal(cierreConDiferencia.nivel_confianza, 'pendiente', 'una diferencia ya cerrada (aunque autorizada con observación) debe verse como pendiente, no confiable a ciegas');

  const estadoTrasCierre = ctx.cajaEstado_('2026-07-15', 'San Antonio', administrador);
  assert.equal(estadoTrasCierre.nivel_confianza, 'pendiente', 'consultar el estado después también debe reflejar la diferencia del cierre ya hecho');
}

// --- cajaResumenAdministrador_: las dos sedes en una sola llamada, reutilizando cajaEstado_ --------
{
  const { ctx, turnos } = construirEntorno_();
  abrirTurno_(ctx, turnos, { base_inicial: 100000, caja_fuerte_inicial: 0, sede: 'San Antonio' });
  const resumen = ctx.cajaResumenAdministrador_('2026-07-15', ['San Antonio', 'Capri'], administrador);
  assert.equal(resumen.ok, true);
  assert.equal(resumen.sedes.length, 2);
  const sanAntonio = resumen.sedes.find((s) => s.sede === 'San Antonio');
  const capri = resumen.sedes.find((s) => s.sede === 'Capri');
  assert.equal(sanAntonio.abierta, true, 'San Antonio sí tiene una apertura en esta prueba');
  assert.equal(capri.abierta, false, 'Capri no tiene ninguna apertura, no debe inventarse una');
  assert.ok('nivel_confianza' in sanAntonio && 'nivel_confianza' in capri, 'cada sede debe traer su propio semáforo');

  // Sin especificar sedes, debe asumir las dos reales por defecto.
  const resumenPorDefecto = ctx.cajaResumenAdministrador_('2026-07-15', null, administrador);
  assert.deepEqual(resumenPorDefecto.sedes.map((s) => s.sede).sort(), ['Capri', 'San Antonio']);

  assert.equal(ctx.cajaResumenAdministrador_('', ['Capri'], administrador).ok, false, 'debe exigir la fecha');
}

console.log('caja-v2: OK');
