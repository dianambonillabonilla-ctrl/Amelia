# Diagnóstico del módulo de Caja

Revisión completa de Caja: qué hay, qué funciona, qué está roto y qué se puede hacer con la API de
FUDO. Fecha del diagnóstico: **7 de agosto de 2026**, sobre `main` en el commit `e62889e`
(PR #145 consolidó `CajaTurno.gs` y eliminó `CajaV2.gs`; PR #146 añadió "Abrir esta caja de todas
formas" para el Administrador).

Este documento **no propone cambios de regla de negocio**. Donde hay una decisión pendiente lo dice
y la deja marcada en la sección 7.

---

## 1. Cómo se hizo la revisión

Además de leer los archivos, se montó `tests/diagnostico-caja-fudo.js` (se corre con
`npm run diagnostico:caja`). Carga **todo el backend real** y simula la API de FUDO **a nivel de
`UrlFetchApp`** — es decir, ejercita `FudoApi.gs` de verdad: autenticación, token, paginación,
`include` y formato JSON:API, y comprueba que el efectivo que FUDO reporta acaba en el cálculo de la
caja correcta.

Esto importa porque `tests/caja-v2.test.js`, la única prueba de Caja en la suite, corre **sin
credenciales de FUDO configuradas**, así que `cajaSincronizarFudo_` nunca aplica y esa cadena
completa jamás se ejercita.

Estado al cierre del diagnóstico: **43 comprobaciones pasan, 2 fallan**. Las dos fallas son los bugs
de la sección 4. Cualquier falla adicional a esas dos es una regresión nueva.

## 2. Archivos que componen el módulo

| Archivo | Papel |
|---|---|
| `apps-script/CajaTurno.gs` | única fuente operativa: apertura, movimientos, cierre, validación FUDO |
| `apps-script/Code.gs` | rutas `caja_*`, permisos por rol, esquema de hojas |
| `apps-script/PagosFudo.gs` | pagos de FUDO, clasificación de efectivo, totales por sede/fecha |
| `apps-script/FudoApi.gs` | integración real con la API (ventas, pagos, sedes) |
| `apps-script/Turnos.gs` | `turnoResumenCierre_`, de donde Caja toma el efectivo FUDO del día |
| `apps-script/FudoMapeoSedes.gs` | inferencia de sede: sala / caja / identificador / usuario |
| `caja.html` | interfaz |
| `assets/caja-apertura-segura.js` | reglas adicionales de frontend (lo carga `assets/config.js`) |
| `assets/config.js` | `API_URL` y `llamar(action, params)` |

No hay funciones `.gs` duplicadas: la consolidación del PR #145 quedó limpia.

## 3. Lo que funciona bien

Vale decirlo antes de la lista de problemas, porque la base conceptual es sólida: Caja separa **caja
operativa** de **caja fuerte**, distingue las entregas al Administrador según de dónde sale el
dinero, guarda `efectivo_fudo_al_abrir` como línea base del turno, encadena la base de un día con el
cierre anterior, y tiene permisos por rol **y** por sector del día.

Verificado con la API simulada:

- La cadena completa está sana: la venta llega de la API, se le resuelve la sede por mesa → sala, el
  pago se asocia a esa venta y hereda la sede, se clasifica por el `kind` real del método, y ese
  efectivo entra al esperado de la caja correcta.
- **`efectivo_fudo_al_abrir` hace bien su trabajo.** Con $50.000 de efectivo sincronizado antes de
  abrir, el esperado del turno queda en $0 — no reclama ese dinero. Cuando entra una venta de
  $30.000 ya abierta la caja, el esperado sube exactamente a $30.000.
- Cada sede solo ve su propio efectivo, sin contaminarse con la otra.
- Enviar a caja fuerte mueve el dinero sin cambiar el total bajo custodia; entregar desde caja fuerte
  sí lo reduce; gastos y retiros calculan bien.
- Con la API caída se puede abrir la caja, pero no cerrarla sin observación.
- El caché evita llamadas repetidas: 5 consultas de estado seguidas = 0 llamadas HTTP.
- Dos aperturas del mismo día no crean dos turnos, y un segundo cierre no pisa el conteo del primero.
- Los permisos por rol y por sector se respetan.
- Apertura y cierre dejan rastro en auditoría.

## 4. Bugs abiertos

Los dos existen en `main` hoy. Se verificó que las funciones responsables son idénticas byte a byte
a las de `main`, y uno de ellos se reprodujo corriendo el diagnóstico contra el código de `main`
extraído con `git archive`.

### Bug 1 — Si la caja se cierra después de medianoche, se pierde la base del día siguiente

El más grave, porque es de operación diaria.

```js
// apps-script/CajaTurno.gs
function cajaUltimoCierreAntes_(fecha, sede) {
  const limite = new Date(fecha + 'T00:00:00').getTime();
  return leerTabla_(SHEET_NAMES.CAJA_TURNO)
    .filter(r => r.sede === sede && r.estado === 'Cerrado' && cajaFechaMs_(r.timestamp_cierre || r.hora_cierre || r.fecha) < limite)
    .sort(/* ... por timestamp_cierre ... */)[0] || null;
}
```

Para decidir cuál es "el cierre anterior" usa `timestamp_cierre` — **el momento en que se pulsó el
botón** — en vez de la fecha a la que pertenece el turno. Si el turno del 6 se cierra a las 00:20 del
7 (el arqueo terminó pasada la medianoche, normal si cierran a las 11), ese `timestamp_cierre` no es
anterior a la medianoche del 7, el cierre **no se encuentra**, y la base esperada del 7 sale en $0.

| Cuándo se cierra el turno del 6 de agosto | Base esperada del 7 |
|---|---|
| 23:30 del día 6 | $40.000 — correcto |
| **00:20 del día 7** | **$0 — mal** |
| 14:00 del día 7, consultando el día 8 | $40.000 — correcto |

Qué pasa en la sede al día siguiente con el código de `main`: la pantalla dice "Efectivo esperado del
cierre anterior: $0", el campo viene precargado con ese $0, y si nadie se fija se abre la caja con
base $0. Los $40.000 que sí están en el cajón desaparecen del cálculo, el esperado del turno queda
$40.000 corto, y al cerrar aparece un sobrante de $40.000 que nadie puede explicar. Y así todos los
días.

La caja fuerte se salva de casualidad, y eso hace el bug más difícil de ver: `cajaSaldoFuerteAntes_`
tiene un plan B que reconstruye el saldo desde los movimientos históricos cuando no encuentra cierre
anterior, y los movimientos sí están fechados por día. La base operativa no tiene ese plan B.

Arreglo conceptual: ordenar por la **fecha del turno** y usar `timestamp_cierre` solo para desempatar.

### Bug 2 — Un método que no es efectivo, pero se llama "efectivo", cuenta como dinero en el cajón

```js
// apps-script/PagosFudo.gs
function pagosFudoEsEfectivo_(pago) {
  if (normalizar_(pago.metodo_tipo) === 'cash') return true;
  const nombre = normalizar_(pago.metodo_pago);
  return nombre.indexOf('efectivo') !== -1 || nombre === 'cash' || nombre.indexOf('cash') !== -1;
}
```

Reproducido con tres pagos del mismo día:

| Método | `kind` | Monto | ¿Está en el cajón? | ¿Caja lo cuenta? |
|---|---|---|---|---|
| Efectivo | `CASH` | $100.000 | sí | sí |
| Fiado efectivo | `HOUSE-ACCOUNT` | $70.000 | **no** | **sí** |
| Efectivo Rappi | `OTHER` | $50.000 | **no** | **sí** |

Caja concluye que en el cajón hay **$220.000**. Hay $100.000.

El problema es el orden: si el `kind` dice que **no** es efectivo, eso debería ser definitivo, porque
es dato de FUDO — el enum es cerrado (`CASH`, `DEBIT-CARD`, `CREDIT-CARD`, `HOUSE-ACCOUNT`, `PIX`,
`VOUCHER`, `CHECK`, `BANK-SLIP`, `BANK-TRANSFER`, `OTHER`). La función lo ignora y adivina por el
nombre. La regla correcta sería: cuando hay `kind`, manda el `kind`; el nombre solo se usa cuando no
hay `kind`, que es el caso de los CSV históricos importados antes de la API. Ese matiz importa —
quitar el respaldo por nombre a secas rompería los datos viejos.

**No se sabe todavía si esto afecta hoy a la cuenta real.** Lo resuelve una sola consulta:
`GET /payment-methods` devuelve `name` y `kind` de todos los métodos. Si todos los que tienen
"efectivo" en el nombre son `CASH`, el arreglo es preventivo; si hay alguno que no, el efectivo
esperado está inflado ahora mismo.

Es cambio de regla de negocio (cambia qué cuenta como efectivo y cambia números históricos), así que
está pendiente de aprobación.

### Interacción entre los dos bugs y las validaciones nuevas

Con la base esperada en $0 por el Bug 1, quien cuenta los $40.000 reales genera una diferencia de
apertura, y la validación de "solo un Administrador aprueba una diferencia" la bloquea. Es decir: la
sede no podría abrir la caja sin llamar a la Administradora, todas las mañanas. **El Bug 1 debe
arreglarse antes o junto con el endurecimiento de la apertura**, o un error silencioso se convierte
en un bloqueo diario.

## 5. Hallazgos de la auditoría previa

Los diez hallazgos reportados se confirmaron todos. Cuatro ya tienen corrección propuesta en la rama
`cursor/auditoria-caja-conteo-real-dba5` (pendiente de aprobación):

| # | Hallazgo | Estado |
|---|---|---|
| 1 | Campos de conteo físico precargados con lo esperado | corregido en rama |
| 2 | `cajaEstado_` forzaba sincronización completa con FUDO | corregido en rama |
| 3 | `llamar()` sin timeout | corregido en rama |
| 4 | No se detecta efectivo con sede "Sin identificar" | corregido en rama (como aviso) |
| 5 | Faltan validaciones backend fuertes | corregido en rama |
| 6 | Falta `LockService` en apertura/cierre | corregido en rama |
| 7 | `cajaRappiMarcar_` sin `sesion.usuario` | corregido en rama |
| 8 | "Persona que verifica" se guarda como `persona_recibe_cierre` | pendiente |
| 9 | Migración histórica se revisa en cada operación | pendiente |
| 10 | Las pruebas no cubren la API de FUDO | cubierto por este diagnóstico |

El #1 era doble, no solo de frontend: además de la precarga, el backend leía los conteos con
`Number(item.base_inicial) || 0`, que convierte "no conté nada" en un 0 válido. Vaciar los campos sin
tocar el backend no habría arreglado nada.

Hallazgos adicionales que no estaban en la lista original:

- **`tests/caja-turno.test.js` es una prueba huérfana y está roja.** Es la única que ejercita el flujo
  completo por `doPost`, no está en el script `test` de `package.json` (no corre ni local ni en CI), y
  falla: espera `entrega_cierre === -20000`, pero `cajaCerrar_` ni devuelve ese campo ni lo deja
  negativo. Lo mismo pasa con `tests/fudo-pendientes-sede-id.test.js`, que sí pasa pero tampoco corre.
- **`cajaSincronizarAhora_` era código muerto**: existía desde el PR #145 pero nunca tuvo ruta en
  `Code.gs`. Era justo la pieza que faltaba para el hallazgo #2.
- **Dos implementaciones peleando por el mismo elemento**: `caja.html` y `caja-apertura-segura.js`
  escribían las dos sobre `#diferencia-apertura` con reglas distintas, y cuál ganaba dependía del
  orden de los listeners. El `.js` además se sincronizaba con `setTimeout(..., 400)`.
- **Líneas duplicadas literales** en `caja.html` (`d-fuerte`, `d-total`, `cierre-fuerte` asignados dos
  veces).
- **Dos listas de columnas de `Caja_Turno` desincronizadas**: `configurarHojas()` en `Code.gs` declara
  18 columnas, `CAJA_COLUMNAS_TURNO_` tiene 32. Funciona porque `asegurarColumnas_` completa las que
  faltan, pero son dos fuentes de verdad para la misma tabla.

## 6. Qué permite la API de FUDO para Caja

Verificado leyendo `apps-script/fudo-openapi.yml` (8.412 líneas, 19 recursos, 37 rutas), distinguiendo
si cada dato está en un *requestBody* (escribir) o en un *schema de respuesta* / parámetro `include`
(leer).

### No existe apertura de caja en FUDO

`opening` → 0 coincidencias. `openedAt` → 0. `drawer` → 0. `closure` → 0. `initialAmount` → 0.
`openAmount` → 0. No hay recurso `/cash-registers` ni `/shifts`.

**La doble apertura (FUDO + Dilana) se queda.** No hay dato de FUDO que la reemplace. Lo que sí se
puede hacer es que Dilana avise "FUDO ya registró ventas hoy en esta sede y la caja de Dilana sigue
sin abrir" — información útil sin inferir que FUDO abrió caja.

`filter[shiftId]` existe en `GET /sales` pero es un callejón sin salida: no hay endpoint `/shifts`, y
`shiftId` no aparece en los atributos de la respuesta, ni en `relationships`, ni en `include`, ni en
`fields[sale]`. Se puede filtrar por un turno cuyo id no hay forma de averiguar ni de leer.

### Capacidades documentadas que Caja no usa

Dilana solo consume cuatro recursos: `sales`, `payments`, `products`, `ingredients`.

| Capacidad documentada | Estado |
|---|---|
| `GET /payment-methods` con `kind`, `active`, `forSales`, `forExpenses` | **nunca se consulta** |
| `filter[paymentMethod][kind]=in.(CASH)` en `/payments` | no se usa |
| `filter[paidAt]` en `/payments` | no se usa (se filtra por `createdAt`) |
| `filter[expenseId]=is.null` en `/payments` | no se usa |
| `filter[receivedBy]` en `/payments` | no se usa |
| `GET /expenses` con `useInCashCount`, `date`, `status` | **nunca se consulta** |
| `GET /sales?include=cashRegister` + `fields[cashRegister]=name` | no se pide |
| `GET /sales?include=closedBy` | no se pide |

Tres riesgos que salen de comparar la especificación con la implementación:

1. **Se filtra por `createdAt` pero se fecha por `paidAt`.** Un pago creado el día 5 y pagado el 7
   nunca lo trae la sincronización de HOY+AYER, pero es efectivo que sí está en el cajón hoy.
2. **Los pagos de gastos pueden estar entrando como efectivo de ventas.** `GET /payments` tiene
   relación `expense` además de `sale`. Dilana filtra por `sales.saleState=in.(CLOSED)`, lo que
   *probablemente* los excluye, pero depende de cómo FUDO implemente ese join y no está verificado.
   `expenseId: 'is.null'` lo haría explícito.
3. **Los gastos de FUDO son invisibles para Dilana.** `GET /expenses` es legible y trae
   `useInCashCount`, la marca de FUDO de "este gasto sale del arqueo". Si alguien registra un gasto en
   FUDO y también en Caja, se cuenta dos veces; si solo en FUDO, Dilana no lo ve.

### El `cashRegister` ya está cableado, solo falta pedirlo

`fudoApiReferenciasSedeDesdeSale_` **ya lee la caja registradora**, y tiene incluso un plan B que la
busca en los pagos de la venta. `fudoResolverSedeVenta_` la prioriza en segundo lugar, justo después
de la sala. `Fudo_Mapeo_Sedes` acepta el tipo `Caja` y las semillas ya lo contemplan.

**Lo único que falta es la palabra `cashRegister` dentro de `FUDO_API_SALES_INCLUDE_`.**

El comentario del código y `docs/modelo-inventario.md` afirman que la especificación confirma que
`/sales` no tiene relación `cashRegister`. Eso es **inexacto**, y la especificación se contradice a sí
misma:

- El `relationships` de la respuesta de `GET /sales` no lista `cashRegister`. Hasta ahí es correcto.
- Pero el patrón del parámetro `include` de `GET /sales` **sí lo acepta** (línea 6055), igual que
  `closedBy`, que tampoco figura en `relationships`.
- Y `fields[cashRegister]` está documentado con el atributo `name` (línea 6066).
- Y `GET /expenses` — una operación de lectura — documenta `include=cashRegister` y
  `include=payments.cashRegister`, más `filter[cashRegisterId]`. **La caja registradora sí es un objeto
  legible en esta API**; lo que está incompleto son los bloques `relationships` de los schemas.

Si funciona contra la cuenta real, las ventas de domicilio y para llevar —que hoy quedan "Sin
identificar" porque no tienen mesa— sí tienen caja registradora. Eso convierte el hallazgo #4 de
"avisar que hay efectivo sin sede" a **"que no haya efectivo sin sede"**.

Es **hipótesis a verificar**, no dato. Requiere una consulta real antes de implementar nada.

## 7. Decisiones pendientes

1. `base_siguiente` obligatorio al cerrar (antes se asumía igual al efectivo contado).
2. Observación obligatoria al abrir con diferencia, también para el Administrador.
3. "Sin identificar": ¿solo avisa (estado actual de la rama), exige observación, o bloquea el cierre?
4. Hallazgo #8: ¿"dinero entregado" calculado (contado − base siguiente) o escrito a mano? ¿"Quién
   recibe" obligatorio solo cuando la entrega es mayor que cero?
5. Hallazgo #9: migración de una sola ejecución con Script Property — implica que si se borran esos
   tres movimientos de la hoja, no se recrean solos.
6. `tests/caja-turno.test.js`: ¿repararla y meterla a `npm test`, o borrarla?
7. "Abrir esta caja de todas formas" (PR #146): dejarlo igual, quitarlo, o dejarlo registrando en
   auditoría que fue una apertura por excepción del Administrador.
8. Bug 2: ¿el `kind` de FUDO manda sobre el nombre del método?

## 8. Orden recomendado

1. **Bug 1** (encadenamiento por medianoche). Es corrección técnica, no cambio de regla, y desbloquea
   que el endurecimiento de la apertura no estorbe a diario.
2. **Tres consultas de solo lectura contra la cuenta real**, que no escriben nada:
   - `GET /payment-methods` → ¿el Bug 2 afecta hoy o es preventivo?
   - `GET /sales?include=cashRegister&fields[cashRegister]=name` sobre un día con domicilios →
     ¿llega algo con `type: CashRegister`?
   - `GET /expenses` sobre una semana reciente → ¿hay gastos registrados en FUDO?
3. **Cerrar la auditoría**: hallazgos #8, #9 y #10, según las decisiones de la sección 7.
4. **Cimientos con datos FUDO reales**: sincronizar `/payment-methods` para que "es efectivo" sea el
   `kind` autoritativo; cambiar el filtro a `paidAt`; excluir pagos de gastos; y si la verificación
   sale bien, resolver la sede por caja registradora.
5. **Sobre esos cimientos** se puede construir el panel del Administrador con las dos sedes lado a
   lado, el desglose del esperado indicando qué peso es dato FUDO y qué peso es conteo físico, las
   propinas en efectivo separadas del efectivo de ventas, y la bandeja de conciliación de pagos sin
   sede.

## 9. Cómo repetir este diagnóstico

```bash
npm test                    # suite del repositorio (debe quedar en verde)
npm run diagnostico:caja    # este diagnóstico (hoy: 43 pasan, 2 fallan = los bugs de la sección 4)
```
