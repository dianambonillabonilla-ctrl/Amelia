/**
 * CajaTurno.gs (consolidado — antes esta prueba cargaba CajaTurno.gs + CajaV2.gs por separado,
 * hasta que ambos archivos declaraban las mismas funciones globales y competían entre sí según el
 * orden de carga; CajaV2.gs se eliminó y todo quedó en un solo archivo): al abrir o cerrar con una
 * diferencia (efectivo o caja fuerte), quien está en turno (Encargado o Administrador) puede
 * hacerlo igual — nunca se bloquea el trabajo — pero debe dejar por escrito una observación
 * explicando qué pasó. Diana (ago 2026): la diferencia queda registrada para que el Administrador
 * la concilie después; ya no hace falta que él mismo abra/cierre ni que apruebe nada antes.
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
  'usuario_cierre', 'hora_cierre', 'observacion_cierre', 'timestamp_cierre',
  'fudo_confiable_cierre', 'estado_conciliacion', 'nota_conciliacion'
];
const MOVIMIENTOS_HEADERS = [
  'id', 'fecha', 'sede', 'tipo', 'valor', 'persona_entrega', 'persona_recibe',
  'hora', 'motivo', 'evidencia_url', 'usuario_id', 'usuario', 'timestamp', 'idempotency_key'
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
    // Igual que la real (Conteos.gs): las cadenas ya en formato yyyy-MM-dd pasan tal cual; un Date
    // (como el `new Date()` que usa cajaAbrir_ para comparar contra "hoy") se formatea de verdad —
    // String(new Date()).slice(0,10) daba basura tipo "Fri Aug 07" y rompía esa comparación.
    formatearFecha_: (v) => {
      if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v.trim())) return v.trim();
      const d = v instanceof Date ? v : new Date(v);
      return d.toISOString().slice(0, 10);
    },
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

// Diferencia en efectivo: Encargado SÍ puede cerrar, dejando la observación por escrito.
{
  const { ctx, turnos } = construirEntorno_();
  abrirTurno_(ctx, turnos, { base_inicial: 100000, caja_fuerte_inicial: 0 });
  const r = ctx.cajaCerrar_({ fecha: '2026-07-15', sede: 'San Antonio', efectivo_contado: 90000, caja_fuerte_contada: 0, observacion: 'faltan 10.000', persona_recibe_cierre: 'Diana', persona_verifica_cierre: 'Carolina' }, encargada);
  assert.equal(r.ok, true, 'Encargado debe poder cerrar con diferencia en efectivo si deja una observación — nunca se bloquea el trabajo');
  assert.equal(r.diferencia, -10000);
  assert.equal(turnos[0].estado, 'Cerrado');
}

// Diferencia en efectivo SIN observación: nadie puede cerrar (ni Encargado, ni Cocina, ni nadie) —
// la única exigencia es dejar por escrito qué pasó, no el rol de quien cierra.
{
  const { ctx, turnos } = construirEntorno_();
  abrirTurno_(ctx, turnos, { base_inicial: 100000, caja_fuerte_inicial: 0 });
  const r = ctx.cajaCerrar_({ fecha: '2026-07-15', sede: 'San Antonio', efectivo_contado: 90000, caja_fuerte_contada: 0, persona_recibe_cierre: 'Diana', persona_verifica_cierre: 'Carolina' }, cocina);
  assert.equal(r.ok, false, 'sin observación, no debe poder cerrar con diferencia');
  assert.match(r.error, /Debes escribir una observación/);
}

// Diferencia solo en caja fuerte (efectivo cuadra) SIN observación: tampoco se puede cerrar.
{
  const { ctx, turnos } = construirEntorno_();
  abrirTurno_(ctx, turnos, { base_inicial: 100000, caja_fuerte_inicial: 500000 });
  const r = ctx.cajaCerrar_({ fecha: '2026-07-15', sede: 'San Antonio', efectivo_contado: 100000, caja_fuerte_contada: 400000, persona_recibe_cierre: 'Diana', persona_verifica_cierre: 'Carolina' }, encargada);
  assert.equal(r.ok, false, 'una diferencia SOLO en caja fuerte también exige observación para poder cerrar');
  assert.match(r.error, /Debes escribir una observación/);
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

// --- cajaAbrir_: misma regla al ABRIR — una diferencia nunca bloquea, solo exige observación ------

// Sin ninguna diferencia (nada previo cerrado => esperado 0 y 0): Encargado abre sin problema.
{
  const { ctx, turnos } = construirEntorno_();
  const r = ctx.cajaAbrir_({ fecha: '2026-07-15', sede: 'San Antonio', base_inicial: 0, caja_fuerte_inicial: 0 }, encargada);
  assert.equal(r.ok, true, 'Encargado debe poder abrir cuando lo contado coincide con lo esperado');
  assert.equal(turnos.length, 1);
}

// Diferencia en base (efectivo): Encargado SÍ puede abrir, dejando la observación por escrito.
{
  const { ctx, turnos } = construirEntorno_();
  const r = ctx.cajaAbrir_({ fecha: '2026-07-15', sede: 'San Antonio', base_inicial: 50000, caja_fuerte_inicial: 0, observacion_apertura: 'sobra efectivo' }, encargada);
  assert.equal(r.ok, true, 'Encargado debe poder abrir con diferencia en la base si deja una observación — nunca se bloquea el trabajo');
  assert.equal(turnos.length, 1);
  assert.equal(turnos[0].diferencia_apertura, 50000);
}

// Diferencia solo en caja fuerte (base cuadra) SIN observación: no se puede abrir (falta la
// observación, no importa el rol de quien abre).
{
  const { ctx, turnos } = construirEntorno_();
  const r = ctx.cajaAbrir_({ fecha: '2026-07-15', sede: 'San Antonio', base_inicial: 0, caja_fuerte_inicial: 100000 }, cocina);
  assert.equal(r.ok, false, 'sin observación, no debe poder abrir con diferencia SOLO en caja fuerte');
  assert.match(r.error, /Escribe una observación/);
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


// Cerrar sin persona_recibe_cierre/persona_verifica_cierre debe funcionar igual (Diana, ago 2026:
// revirtió la regla de hace unas horas — nadie recibe el dinero ni verifica el cierre por separado,
// quien cierra el turno hace todo).
{
  const { ctx, turnos } = construirEntorno_();
  abrirTurno_(ctx, turnos, { base_inicial: 100000, caja_fuerte_inicial: 0 });
  const r = ctx.cajaCerrar_({ fecha: '2026-07-15', sede: 'San Antonio', efectivo_contado: 100000, caja_fuerte_contada: 0 }, administrador);
  assert.equal(r.ok, true, 'debe poder cerrar sin persona_recibe_cierre ni persona_verifica_cierre');
  assert.equal(turnos[0].estado, 'Cerrado');
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

// --- cajaEstado_ ya NO fuerza una sincronización real inline (ago 2026) — esto era la causa real de
// la pantalla pegada en "Consultando…" varios minutos, no solo el bloqueo de Sin identificar que ya
// se había corregido antes. Se prueba con credenciales "configuradas" — fudoApiSincronizarVentas_/
// fudoApiSincronizarPagos_ ni siquiera existen en este entorno mínimo, así que si cajaEstado_
// todavía intentara forzar el sync como antes, esto reventaría con un ReferenceError. -------------
{
  const { ctx } = construirEntorno_();
  ctx.PropertiesService.getScriptProperties().setProperty('FUDO_API_KEY', 'clave');
  ctx.PropertiesService.getScriptProperties().setProperty('FUDO_API_SECRET', 'secreto');
  const estado = ctx.cajaEstado_('2026-07-15', 'San Antonio', encargada);
  assert.equal(estado.ok, true, 'cajaEstado_ debe responder ya, sin intentar sincronizar FUDO en el momento');
  assert.equal(estado.fudo_sync.pendiente, true, 'debe reconocer que todavía no hay ningún intento guardado para esta fecha/sede');
  assert.equal(estado.cuadre_confiable, false, 'sin un intento real todavía, no se puede declarar confiable');
  assert.equal(estado.nivel_confianza, 'pendiente', 'una sincronización nunca intentada no es lo mismo que una que falló de verdad — no debe verse roja');

  // cajaSincronizarAhora_ (la acción aparte que dispara el frontend en segundo plano) sigue
  // intentando de verdad — y como aquí sí "hay credenciales" pero la integración de FUDO no está
  // cargada en este entorno mínimo, debe fallar con un error claro, no colgarse ni tronar silencioso.
  const sync = ctx.cajaSincronizarAhora_('2026-07-15', 'San Antonio', encargada);
  assert.equal(sync.ok, false);
  assert.match(sync.error, /integración API de FUDO no está disponible/);
}

// --- cajaAbrir_ tampoco debe forzar una sincronización real (ago 2026): el mismo problema que ya se
// había corregido en cajaEstado_ (PR #155) seguía presente aquí — abrir no necesita ese dato para
// calcular nada, así que forzarlo solo podía colgar el botón "Abrir caja" hasta el timeout del
// navegador si FUDO tardaba. Mismo truco de prueba: con credenciales "configuradas" pero sin la
// integración real cargada, si cajaAbrir_ todavía forzara el sync esto reventaría con un
// ReferenceError en vez de abrir normalmente. ------------------------------------------------------
{
  const { ctx, turnos } = construirEntorno_();
  ctx.PropertiesService.getScriptProperties().setProperty('FUDO_API_KEY', 'clave');
  ctx.PropertiesService.getScriptProperties().setProperty('FUDO_API_SECRET', 'secreto');
  const r = ctx.cajaAbrir_({ fecha: '2026-07-15', sede: 'San Antonio', base_inicial: 0, caja_fuerte_inicial: 0 }, encargada);
  assert.equal(r.ok, true, 'abrir no debe intentar sincronizar FUDO en el momento, ni colgarse ni tronar');
  assert.equal(r.fudo_sync.pendiente, true, 'sin ningún intento guardado todavía, debe reconocerlo como pendiente');
  assert.equal(turnos.length, 1);
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
  // Cuarto parámetro (ago 2026): una sincronización que nunca se ha intentado (caché vacío) es
  // "pendiente", no "no_confiable" — no es lo mismo que un intento real que falló.
  assert.equal(ctx.cajaNivelConfianza_(false, 0, false, true), 'pendiente', 'nunca intentada != falló de verdad');
  assert.equal(ctx.cajaNivelConfianza_(false, 0, false, false), 'no_confiable', 'sin el cuarto parámetro, sigue siendo no_confiable como antes');
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

// --- Novedades de Administrador: ninguna diferencia ni FUDO sin sincronizar bloquea nada, pero el
// Administrador debe poder verlas y marcarlas como conciliadas (ago 2026) --------------------------
{
  const { ctx, turnos } = construirEntorno_();
  abrirTurno_(ctx, turnos, { base_inicial: 50000, caja_fuerte_inicial: 0, diferencia_apertura: 50000, observacion_apertura: 'sobra' });
  const sinNovedad = ctx.cajaNovedadesAdministrador_({});
  assert.equal(sinNovedad.ok, true);
  assert.equal(sinNovedad.novedades.length, 1, 'una diferencia al abrir debe verse como novedad pendiente');
  // El turno de esta prueba queda 'Abierto' con fecha 2026-07-15 (fixture de abrirTurno_) y nunca se
  // cierra — hoy (fecha real de la prueba) es posterior, así que también cuenta como "quedó abierta
  // sin cerrar" (ago 2026, ver cajaTurnoMotivosNovedad_).
  assert.deepEqual(sinNovedad.novedades[0].motivos, ['Diferencia al abrir', 'Caja quedó abierta sin cerrar']);
  assert.equal(sinNovedad.novedades[0].estado_conciliacion, '');

  const conciliada = ctx.cajaNovedadConciliar_('2026-07-15', 'San Antonio', 'ya se revisó, fue un préstamo', administrador);
  assert.equal(conciliada.ok, true);
  assert.equal(turnos[0].estado_conciliacion, 'Resuelta');
  assert.equal(turnos[0].nota_conciliacion, 'ya se revisó, fue un préstamo');

  // Ya conciliada, no debe seguir apareciendo entre las pendientes...
  const trasConciliar = ctx.cajaNovedadesAdministrador_({});
  assert.equal(trasConciliar.novedades.length, 0, 'una novedad ya resuelta no debe seguir apareciendo por defecto');
  // ...pero sí si se piden explícitamente todas (no solo las pendientes).
  const todas = ctx.cajaNovedadesAdministrador_({ solo_pendientes: false });
  assert.equal(todas.novedades.length, 1);
  assert.equal(todas.novedades[0].estado_conciliacion, 'Resuelta');

  assert.equal(ctx.cajaNovedadConciliar_('', 'San Antonio', '', administrador).ok, false, 'debe exigir fecha y sede');
}

// Una caja que se quedó 'Abierto' de un día anterior y nadie la cerró debe verse como novedad —
// antes era invisible del todo (ago 2026, auditoría al retomar el uso real de Caja). El turno de
// HOY sigue sin avisar nada mientras esté en curso, es su estado normal durante el día.
{
  const { ctx, turnos } = construirEntorno_();
  const ayer = new Date(); ayer.setDate(ayer.getDate() - 1);
  const fechaAyer = ctx.formatearFecha_(ayer);
  const fechaHoy = ctx.formatearFecha_(new Date());
  abrirTurno_(ctx, turnos, { fecha: fechaAyer, base_inicial: 100000, caja_fuerte_inicial: 0 });
  abrirTurno_(ctx, turnos, { id: 't2', fecha: fechaHoy, sede: 'Capri', base_inicial: 50000, caja_fuerte_inicial: 0 });

  const novedades = ctx.cajaNovedadesAdministrador_({});
  assert.equal(novedades.novedades.length, 1, 'solo la de ayer debe avisar, la de hoy sigue en curso normalmente');
  assert.equal(novedades.novedades[0].fecha, fechaAyer);
  assert.deepEqual(novedades.novedades[0].motivos, ['Caja quedó abierta sin cerrar']);
}

// Diferencia al cerrar y FUDO no sincronizado al cerrar también cuentan como novedad — pero ninguna
// de las dos impidió el cierre (Diana, ago 2026).
{
  const { ctx, turnos } = construirEntorno_();
  abrirTurno_(ctx, turnos, { base_inicial: 100000, caja_fuerte_inicial: 0 });
  const cierre = ctx.cajaCerrar_({ fecha: '2026-07-15', sede: 'San Antonio', efectivo_contado: 90000, caja_fuerte_contada: 0, observacion: 'faltan 10.000' }, encargada);
  assert.equal(cierre.ok, true);
  assert.equal(turnos[0].fudo_confiable_cierre, true, 'sin credenciales de FUDO configuradas, se considera confiable (la validación no aplica)');

  const novedades = ctx.cajaNovedadesAdministrador_({});
  assert.equal(novedades.novedades.length, 1);
  assert.deepEqual(novedades.novedades[0].motivos, ['Diferencia al cerrar']);
}

// --- cajaHistorialListar_: pantalla aparte para ver días anteriores (Diana, ago 2026) ---------------
{
  const { ctx, turnos } = construirEntorno_();
  abrirTurno_(ctx, turnos, { fecha: '2026-07-10', sede: 'San Antonio', base_inicial: 100000, caja_fuerte_inicial: 0 });
  abrirTurno_(ctx, turnos, { id: 't2', fecha: '2026-07-12', sede: 'Capri', base_inicial: 50000, caja_fuerte_inicial: 0 });
  abrirTurno_(ctx, turnos, { id: 't3', fecha: '2026-06-01', sede: 'San Antonio', base_inicial: 0, caja_fuerte_inicial: 0 });

  assert.equal(ctx.cajaHistorialListar_('', '2026-07-31', 'Ambas').ok, false, 'debe exigir el rango de fechas');

  const rango = ctx.cajaHistorialListar_('2026-07-01', '2026-07-31', 'Ambas');
  assert.equal(rango.ok, true);
  assert.equal(rango.historial.length, 2, 'solo los dos turnos de julio, el de junio queda fuera del rango');
  assert.equal(rango.historial[0].fecha, '2026-07-12', 'más reciente primero');

  const soloSanAntonio = ctx.cajaHistorialListar_('2026-07-01', '2026-07-31', 'San Antonio');
  assert.equal(soloSanAntonio.historial.length, 1);
  assert.equal(soloSanAntonio.historial[0].sede, 'San Antonio');

  // Sin sede (frontend nunca lo hace, pero por si acaso) debe comportarse igual que 'Ambas'.
  const sinSede = ctx.cajaHistorialListar_('2026-07-01', '2026-07-31', '');
  assert.equal(sinSede.historial.length, 2);
}

// --- cajaAbrir_: sede y fecha inválidas (auditoría externa, ago 2026) -------------------------------
{
  const { ctx } = construirEntorno_();
  const sedeInvalida = ctx.cajaAbrir_({ fecha: '2026-07-15', sede: 'Centro de Producción', base_inicial: 0, caja_fuerte_inicial: 0 }, administrador);
  assert.equal(sedeInvalida.ok, false, 'Centro de Producción no debe poder tener caja');
  assert.match(sedeInvalida.error, /San Antonio y Capri/);

  const fechaFutura = ctx.cajaAbrir_({ fecha: '2027-06-15', sede: 'San Antonio', base_inicial: 0, caja_fuerte_inicial: 0 }, administrador);
  assert.equal(fechaFutura.ok, false, 'no se debe poder abrir una fecha futura');
  assert.match(fechaFutura.error, /fecha futura/);
}

// --- cajaMovimientoRegistrar_: idempotencia (auditoría externa, ago 2026) ---------------------------
// Antes: un doble clic o un reintento de red guardaba el MISMO movimiento dos veces, sin forma de
// arreglarlo después (no se puede editar ni borrar un movimiento).
{
  const { ctx, turnos } = construirEntorno_();
  ctx.cajaAbrir_({ fecha: '2026-07-15', sede: 'San Antonio', base_inicial: 0, caja_fuerte_inicial: 0 }, encargada);
  const item = { fecha: '2026-07-15', sede: 'San Antonio', tipo: 'Otro ingreso', valor: 50000, motivo: 'Vuelto de la panadería', idempotency_key: 'clave-1' };
  const primero = ctx.cajaMovimientoRegistrar_(item, encargada);
  assert.equal(primero.ok, true);
  const segundo = ctx.cajaMovimientoRegistrar_(item, encargada);
  assert.equal(segundo.ok, true, 'reintentar con la misma clave no debe fallar');
  assert.equal(segundo.item.id, primero.item.id, 'debe devolver el mismo movimiento, no crear uno nuevo');

  const movimientosGuardados = ctx.cajaMovimientosListar_('2026-07-15', 'San Antonio');
  assert.equal(movimientosGuardados.length, 1, 'solo debe quedar UN movimiento guardado, no dos');

  // Una clave distinta sí es un movimiento genuinamente nuevo.
  const otro = ctx.cajaMovimientoRegistrar_(Object.assign({}, item, { idempotency_key: 'clave-2' }), encargada);
  assert.equal(otro.ok, true);
  assert.notEqual(otro.item.id, primero.item.id);
  assert.equal(ctx.cajaMovimientosListar_('2026-07-15', 'San Antonio').length, 2);
}

// --- cajaMovimientoRegistrar_: tope de disponible (auditoría externa, ago 2026) ---------------------
// Antes: un retiro de caja fuerte vacía la dejaba en negativo e inflaba la caja operativa con
// dinero que nunca existió; un envío/entrega más grande que lo disponible dejaba un faltante
// permanente que nadie podía explicar.
{
  const { ctx } = construirEntorno_();
  ctx.cajaAbrir_({ fecha: '2026-07-15', sede: 'San Antonio', base_inicial: 100000, caja_fuerte_inicial: 0, observacion_apertura: 'base inicial de prueba' }, encargada);

  const envioDeMas = ctx.cajaMovimientoRegistrar_({ fecha: '2026-07-15', sede: 'San Antonio', tipo: 'Envío a caja fuerte', valor: 150000, motivo: 'prueba', idempotency_key: 'k1' }, encargada);
  assert.equal(envioDeMas.ok, false, 'no debe poder enviar a caja fuerte más de lo que hay en la caja operativa');
  assert.match(envioDeMas.error, /excede el efectivo disponible/);

  const retiroDeCajaFuerteVacia = ctx.cajaMovimientoRegistrar_({ fecha: '2026-07-15', sede: 'San Antonio', tipo: 'Retiro de caja fuerte', valor: 50000, motivo: 'prueba', idempotency_key: 'k2' }, encargada);
  assert.equal(retiroDeCajaFuerteVacia.ok, false, 'no debe poder retirar de una caja fuerte vacía');
  assert.match(retiroDeCajaFuerteVacia.error, /excede lo disponible en la caja fuerte/);

  // Un envío válido (dentro de lo disponible) sí debe funcionar, y ahora la caja fuerte tiene fondos
  // para que un retiro de ese mismo monto sí sea válido.
  const envioValido = ctx.cajaMovimientoRegistrar_({ fecha: '2026-07-15', sede: 'San Antonio', tipo: 'Envío a caja fuerte', valor: 50000, motivo: 'prueba', idempotency_key: 'k3' }, encargada);
  assert.equal(envioValido.ok, true);
  const retiroValido = ctx.cajaMovimientoRegistrar_({ fecha: '2026-07-15', sede: 'San Antonio', tipo: 'Retiro de caja fuerte', valor: 50000, motivo: 'prueba', idempotency_key: 'k4' }, encargada);
  assert.equal(retiroValido.ok, true, 'ahora sí hay 50.000 disponibles en caja fuerte');

  // 'Otro ingreso' nunca tiene tope — siempre es dinero que ENTRA, no que sale.
  const otroIngreso = ctx.cajaMovimientoRegistrar_({ fecha: '2026-07-15', sede: 'San Antonio', tipo: 'Otro ingreso', valor: 999999999, motivo: 'prueba', idempotency_key: 'k5' }, encargada);
  assert.equal(otroIngreso.ok, true, 'Otro ingreso no debe tener tope de disponibilidad');
}

// --- FUDO cambia después del cierre (Diana, ago 2026): "cerré con 300 mil y FUDO ahora dice que
// debería haber 350 mil, debe aparecer que no coincide". FUDO sigue sincronizando "ayer" cada 15
// minutos, así que un pago tardío puede cambiar el total de un día ya cerrado. Se usa una fecha de
// AYER de verdad (no la fija de las demás pruebas) porque el chequeo solo revisa cierres de los
// últimos 3 días — no tiene sentido recalcular cierres de hace meses. --------------------------------
{
  const ayer = (() => { const d = new Date(); d.setDate(d.getDate() - 1); return d.toISOString().slice(0, 10); })();
  const { ctx, turnos } = construirEntorno_();
  let totalFudo = 0;
  ctx.turnoResumenCierre_ = () => ({ pagos_efectivo_esperado: totalFudo });

  const abrir = ctx.cajaAbrir_({ fecha: ayer, sede: 'San Antonio', base_inicial: 0, caja_fuerte_inicial: 0 }, encargada);
  assert.equal(abrir.ok, true);
  totalFudo = 300000; // lo que FUDO acumuló en efectivo durante el turno, según lo que sabía al cerrar
  const cierre = ctx.cajaCerrar_({ fecha: ayer, sede: 'San Antonio', efectivo_contado: 300000, caja_fuerte_contada: 0 }, encargada);
  assert.equal(cierre.ok, true, 'con lo que FUDO tenía al momento de cerrar, cuadra exacto');
  assert.equal(cierre.efectivo_esperado, 300000);

  // FUDO recibe un pago tardío de esa misma fecha: ahora dice 350.000, no 300.000.
  totalFudo = 350000;

  const turno = turnos.find((t) => t.fecha === ayer);
  const cambio = ctx.cajaFudoCambioTrasCierre_(turno);
  assert.ok(cambio, 'debe detectar que FUDO ya no coincide con lo guardado en el cierre');
  assert.equal(cambio.esperado_guardado, 300000);
  assert.equal(cambio.esperado_actual, 350000);
  assert.equal(cambio.diferencia, 50000);

  // Debe aparecer tanto consultando el estado de ese día (lo ve quien esté mirando, Encargado o
  // Administrador) como en el panel de novedades del Administrador — "para ambos", como pidió Diana.
  const estado = ctx.cajaEstado_(ayer, 'San Antonio', encargada);
  assert.ok(estado.fudo_cambio_tras_cierre, 'cajaEstado_ debe exponerlo para que se vea sin ser Administrador');
  assert.equal(estado.fudo_cambio_tras_cierre.diferencia, 50000);

  const novedades = ctx.cajaNovedadesAdministrador_({});
  assert.equal(novedades.novedades.length, 1);
  assert.ok(novedades.novedades[0].motivos.includes('FUDO cambió después del cierre'));
  assert.equal(novedades.novedades[0].fudo_cambio_tras_cierre.diferencia, 50000);

  // Si FUDO ya no cambia (vuelve a coincidir), no debe seguir apareciendo como novedad.
  totalFudo = 300000;
  assert.equal(ctx.cajaFudoCambioTrasCierre_(turno), null);
}

// Un cierre viejo (de hace más de 3 días) no debe revisarse aunque FUDO haya cambiado — no vale la
// pena recalcular historia vieja cada vez que se abre el panel de novedades.
{
  const { ctx, turnos } = construirEntorno_();
  ctx.turnoResumenCierre_ = () => ({ pagos_efectivo_esperado: 999999 });
  abrirTurno_(ctx, turnos, { fecha: '2026-07-15', sede: 'San Antonio', base_inicial: 100000, caja_fuerte_inicial: 0, estado: 'Cerrado', efectivo_esperado: 100000 });
  const turno = turnos[0];
  assert.equal(ctx.cajaFudoCambioTrasCierre_(turno), null, 'un cierre de hace más de 3 días no debe revisarse');
}

console.log('caja-v2: OK');
