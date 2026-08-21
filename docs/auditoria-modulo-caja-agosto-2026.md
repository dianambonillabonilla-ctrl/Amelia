# Auditoría del módulo Caja — agosto 2026

Auditoría de solo lectura (no se modificó ningún archivo de `apps-script/`, `caja.html`,
`base-caja.html` ni `historial-caja.html`). Objetivo: revisar la lógica de negocio, permisos y
cobertura de pruebas del módulo Caja tal como opera hoy en producción, y dejar evidencia
verificable de cada hallazgo.

## Alcance y método

- Backend: `apps-script/CajaTurno.gs` (motor original, hoy **dormido** para la mayoría de sus
  funciones), `apps-script/ZZ_ReactivacionCajaFinal.gs` (capa que redefine las funciones que sí
  corren en producción mientras `MODO_REACTIVACION_BACKEND=true`), `apps-script/BaseCaja.gs`
  (predecesor de Caja, hoy de solo redirección en el frontend), `apps-script/CajaInicioOperacion20260820.gs`,
  `apps-script/MigracionBaseCajaJulio2026.gs`, y el router de permisos en `apps-script/Code.gs`.
- Frontend: `caja.html`, `base-caja.html`, `historial-caja.html`.
- Pruebas existentes: los 14 archivos `tests/caja-*.test.js` y `tests/base-caja.test.js`, más
  `tests/flujo-escritura.test.js` y `tests/syntax.test.js` en lo que tocan permisos.
- Se corrió la suite completa (`npm test`, 44 archivos) y, además, varios scripts Node puntuales
  contra `tests/helpers/entorno-apps-script.js` (el mismo simulador de Apps Script que usan las
  pruebas) para confirmar en vivo el comportamiento real de los hallazgos 2 y 3 de abajo, no solo
  leer el código.

## Resultado de `npm test`

**44/44 archivos en verde, sin fallos**, incluyendo los 11 archivos específicos de Caja
(`base-caja`, `caja-v2` [nombre heredado; hoy prueba `CajaTurno.gs` aislado, ver hallazgo 0],
`caja-turno`, `caja-entregas-fuera-turno`, `caja-fudo-gastos-arqueo`, `caja-auditoria-final`,
`caja-corregir`, `caja-integridad-final`, `caja-inicio-20260820`, `caja-cierre-total-auditoria`,
`caja-cierre-medianoche`). No se encontró ninguna prueba rota ni aserción incorrecta.

## Hallazgo 0 — Contexto necesario para leer las pruebas de Caja (no es un bug)

`tests/caja-v2.test.js` carga **solo** `CajaTurno.gs` de forma aislada (no carga
`ZZ_ReactivacionCajaFinal.gs`). El propio archivo lo advierte en su cabecera (líneas 1-13): esas
funciones están "dormidas" mientras `MODO_REACTIVACION_BACKEND=true` — `ZZ_ReactivacionCajaFinal.gs`
redefine `cajaAbrir_`, `cajaCerrar_`, `cajaCorregir_`, `cajaMovimientoRegistrar_`,
`cajaEfectivoEsperado_`, `cajaBaseEsperada_`, `cajaSaldoFuerteAntes_`, `cajaPuedeCerrar_`,
`cajaLeerEstadoFudo_`, `cajaFudoCambioTrasCierre_`, `cajaSincronizarFudo_`/`cajaSincronizarAhora_`
por encima de las de `CajaTurno.gs`, y esas versiones son las que realmente reciben tráfico. Un
verde en `caja-v2.test.js` **no** certifica el comportamiento real; para eso sirven
`caja-auditoria-final`, `caja-integridad-final`, `caja-entregas-fuera-turno`, `caja-corregir`,
`caja-cierre-medianoche`, `caja-fudo-gastos-arqueo` y `caja-inicio-20260820`, que sí pasan por el
router completo (`env.post`, que ejecuta `doPost` de verdad).

`cajaEstado_`, `cajaSincronizarAhora_`\*, `cajaResumenAdministrador_`, `cajaRappiMarcar_`,
`cajaMovimientosListar_`, `cajaTurnoMotivosNovedad_`, `cajaNovedadesAdministrador_`,
`cajaNovedadConciliar_` y `cajaHistorialListar_` **no** están redefinidas en
`ZZ_ReactivacionCajaFinal.gs` — siguen siendo las de `CajaTurno.gs`. Esto funciona correctamente
porque, al cargarse todos los `.gs` en un mismo espacio global (igual en Apps Script real que en el
simulador de pruebas), las llamadas internas de esas funciones a `cajaBaseEsperada_`,
`cajaSaldoFuerteAntes_`, `cajaEfectivoEsperado_`, `cajaFudoCambioTrasCierre_`, etc. se resuelven en
tiempo de ejecución contra el último `function` cargado con ese nombre — es decir, contra las
versiones de `ZZ_ReactivacionCajaFinal.gs`. Se confirmó con `caja-fudo-gastos-arqueo.test.js`, que
llama a la acción `caja_estado` del router y sí recibe `movimientos_resumen.gastos_fudo_arqueo`, un
campo que solo existe en la versión de `cajaEfectivoEsperado_` de `ZZ_ReactivacionCajaFinal.gs`. No
requiere ninguna acción — es la arquitectura de "capa de reactivación" ya documentada en el propio
código, dejado aquí por si alguien lee las pruebas sin ese contexto.

\* `cajaSincronizarAhora_` sí tiene una segunda definición propia en `ZZ_ReactivacionCajaFinal.gs`
(línea 561) que reemplaza por completo a la de `CajaTurno.gs`.

## Hallazgo 1 — Sin prueba end-to-end de que Cocina no puede operar Caja (brecha de cobertura, no bug activo)

**Verificado hoy: el comportamiento actual es correcto.** Se probó en vivo, a través del router
completo (`env.post`, que ejecuta `doPost`/`handleRequest_`/`requiereRol_` de verdad, igual que
Apps Script real):

```
caja_abrir con rol Cocina (via router completo): {"ok":false,"error":"Error de servidor (código ...)"}
caja_estado con rol Cocina (via router completo): {"ok":false,"error":"Error de servidor (código ...)"}
caja_movimiento_registrar con rol Cocina (via router completo): {"ok":false,"error":"Error de servidor (código ...)"}
caja_cerrar con rol Cocina (via router completo): {"ok":false,"error":"Error de servidor (código ...)"}
```

(El mensaje se ve genérico porque `apiErrorConIncidente_` — `Code.gs:291-295` — oculta a propósito
el detalle interno de cualquier excepción, incluida la de `requiereRol_`; es el comportamiento de
seguridad correcto, no un error.) Esto coincide con `Code.gs:454-489`: `caja_abrir`, `caja_estado`,
`caja_movimiento_registrar` y `caja_cerrar` exigen `['Administrador','Encargado']` (o solo
`['Administrador']` para `caja_resumen_admin`, `caja_novedades_listar`, `caja_novedad_conciliar`,
`caja_corregir`) — 'Cocina' nunca aparece en ninguna de esas listas.

**El problema es que ese `requiereRol_` de `Code.gs` es el ÚNICO punto donde se aplica esa regla.**
Ninguna de las funciones de negocio (`cajaAbrir_`, `cajaMovimientoRegistrar_` en
`ZZ_ReactivacionCajaFinal.gs`) revisa el rol de quien llama — solo `sedeEscrituraPermitida_`. Se
confirmó llamándolas directamente, sin pasar por el router (mismo simulador, mismo motor real,
saltándose solo `Code.gs`):

```
cajaAbrir_ LLAMADA DIRECTA con usuario Cocina (bypass del router/requiereRol_):
  {"ok":true, "item":{... "usuario_apertura":"Juan Cocina" ...}}
cajaMovimientoRegistrar_ LLAMADA DIRECTA con usuario Cocina:
  {"ok":true, "item":{... "usuario":"Juan Cocina" ...}}
```

Es decir: si alguna vez se agrega otra acción del router que internamente llame a `cajaAbrir_` o
`cajaMovimientoRegistrar_` sin pasar por su propio `requiereRol_(...,['Administrador','Encargado'])`
— o si esa línea se toca por error al modificar `Code.gs` — nada dentro de `CajaTurno.gs` /
`ZZ_ReactivacionCajaFinal.gs` lo detendría, y **ninguna prueba de la suite lo notaría**: se revisaron
los 44 archivos de `tests/` y no hay ningún `caja_abrir`/`caja_cerrar`/`caja_movimiento_registrar`/
`caja_estado` con un usuario `rol:'Cocina'` pasado por `env.post` (el único camino que ejercita
`requiereRol_` de verdad). La única prueba que combina Cocina con una acción parecida es
`tests/flujo-escritura.test.js:264-265`, y es sobre `turno_cerrar` (el módulo viejo
`Cierres_Turno`/`Turnos.gs`), no sobre `caja_cerrar`. `tests/caja-turno.test.js:19` sí llama a
`cajaAbrir_`/`cajaCerrar_` con un usuario Cocina, pero **directamente sobre `CajaTurno.gs` aislado**
(ver Hallazgo 0) y solo para probar `sedeEscrituraPermitida_`, no el rol — de hecho esa prueba
espera `.ok === true` al abrir con Cocina, que es correcto para esa función aislada pero podría
leerse, fuera de contexto, como que Cocina sí puede operar Caja.

**Recomendación** (no aplicada — es una decisión de dónde invertir esfuerzo de pruebas, no de
negocio): agregar un caso a `tests/caja-integridad-final.test.js` o crear
`tests/caja-permisos-rol.test.js` que haga login con un usuario `rol:'Cocina'` y confirme, vía
`env.post`, que `caja_abrir`/`caja_estado`/`caja_movimiento_registrar`/`caja_cerrar` devuelven
`ok:false` — así una futura reorganización de `Code.gs` no puede romper esto en silencio.

## Hallazgo 2 — `base_caja_*` todavía permite el rol Cocina en `Code.gs` (inactivo hoy, trampa a futuro)

`Code.gs:445-453` — las tres acciones de `BaseCaja.gs` (`base_caja_guardar`, `base_caja_dia`,
`base_caja_listar`) siguen listando `'Cocina'` entre los roles permitidos:

```js
case 'base_caja_guardar':
  requiereRol_(sesion.usuario, ['Administrador', 'Encargado', 'Cocina']);
```

Esto contradice la decisión ya documentada en `CLAUDE.md` ("Cocina no debe tener ningún acceso a
Caja... confirmado por Diana, ago 2026"). `Base_Caja` es, por descripción propia del código
(`BaseCaja.gs:1-11`, "BASE DE CAJA — cuadre de caja física por sede"), el antecesor directo de lo
que hoy es el módulo Caja: `base-caja.html` ya no es una pantalla, es un redirect
(`base-caja.html:6-10`, "La base de caja anterior fue reemplazada por Caja").

**Verificado que hoy no es explotable**: `base_caja_guardar`/`base_caja_dia`/`base_caja_listar` no
están en `ACCIONES_PERMITIDAS_REACTIVACION_BACKEND` (`Code.gs:22-30`) ni en
`ACCIONES_CAJA_PERMITIDAS_REACTIVACION_`/`ACCIONES_FUDO_PERMITIDAS_REACTIVACION_`
(`ZZ_ReactivacionCajaFinal.gs:5-11`), y ese candado (`accionPermitidaEnReactivacion_`,
`Code.gs:315`) se evalúa antes que cualquier `requiereRol_`. Confirmado en vivo:

```
base_caja_guardar con rol Cocina (MODO_REACTIVACION_BACKEND=true, hoy):
  {"ok":false,"codigo":"MODULO_INACTIVO","error":"Este módulo está temporalmente inactivo..."}
```

Es decir: hoy nadie puede llegar a `base_caja_guardar` con ningún rol, Caja incluida — el candado de
Fase 0 lo bloquea antes de llegar al chequeo de rol. **El riesgo es a futuro**: el día que
`MODO_REACTIVACION_BACKEND` pase a `false` (reactivación completa) sin que alguien revise
específicamente estas tres líneas de `Code.gs`, Cocina recupera acceso de escritura y lectura a un
registro de cuadre de caja — justo lo que la decisión de agosto 2026 quiso cerrar. No se tocó este
archivo porque se pidió explícitamente no cambiar nada; queda documentado para que se corrija junto
con el resto de la reactivación, o se elimine `BaseCaja.gs`/sus tres acciones del todo si ya no
tiene uso (no se encontró ninguna pantalla viva que lo use).

## Hallazgo 3 — `saldo_validado`/`fuera_de_turno` no se muestran en ninguna pantalla

`cajaMovimientoRegistrar_` (`ZZ_ReactivacionCajaFinal.gs:348-391`) permite registrar una "Entrega
administrador" fuera de turno (caja cerrada, o incluso antes de la primera apertura histórica de una
sede) y calcula si pudo validarla contra algún saldo de referencia
(`cajaCierreReferenciaCustodia_`, línea 253-258). Cuando no existe ningún turno cerrado anterior con
qué comparar (`turnoReferencia` es `null` — por ejemplo, la primerísima vez que se usa Caja en una
sede, antes de cualquier cierre DILANA), la línea 379 hace `saldoValidado=false` y dei todos modos
registra el movimiento sin ningún tope de disponibilidad. Este `saldo_validado:false` (y
`fuera_de_turno:true`) queda guardado en la fila (`ZZ_ReactivacionCajaFinal.gs:385`) y viaja en la
respuesta de la API (línea 389), pero:

- La lista de movimientos del día en pantalla (`caja.html:501-508`) solo pinta `tipo`, `motivo` y
  `persona_recibe`/`usuario` — no hay ningún indicio visual de `fuera_de_turno` ni `saldo_validado`.
- El panel de "Novedades de Administrador" (`cajaTurnoMotivosNovedad_`, `CajaTurno.gs:687-713`,
  vigente — ver Hallazgo 0) tampoco lo revisa: sus motivos son diferencia al abrir/cerrar, caja
  quedó abierta sin cerrar, FUDO no sincronizado y FUDO cambió tras el cierre. Un movimiento
  `saldo_validado:false` no genera ninguna de esas señales.
- El historial (`cajaHistorialListar_`, `CajaTurno.gs:755-780`) tampoco expone estos campos por
  turno ni por movimiento.

En la práctica: una entrega/retiro que el propio backend marcó como "no pude confirmar que había
plata suficiente para esto" queda invisible para quien revisa la caja después — ni en el día, ni en
novedades, ni en el histórico. Se confirmó con `tests/caja-entregas-fuera-turno.test.js:53-55`, que
sí verifica `saldo_validado` en la respuesta JSON de la API, pero ninguna prueba (ni `caja.html`)
comprueba que ese dato llegue a mostrarse en pantalla — porque no llega.

## Observaciones sin acción necesaria (para no repetir la revisión)

- El caso "medianoche" (cerrar después de las 00:00 reales para el turno de "ayer") está bien
  resuelto y probado (`caja-cierre-medianoche.test.js`): la continuidad de base/caja fuerte entre
  días se decide por la fecha de negocio del turno, nunca por la hora real del clic.
- Los candados (`LockService`) contra doble apertura/cierre/movimiento y la idempotencia por
  `idempotency_key` están bien cubiertos, incluida la "carrera real" (dos dispositivos abriendo a la
  vez) — `caja-v2.test.js:222-253` y el candado propio de `cajaMovimientoRegistrar_`.
- `caja.html` usa `escapeHtml()` consistentemente en todo campo de texto libre que viene del backend
  antes de inyectarlo en `innerHTML` (motivo, observaciones, nombres de usuario, etc.) — no se
  encontró ningún punto de XSS reflejado.
- El frontend (`caja.html:767-770`) y el backend (`ZZ_ReactivacionCajaFinal.gs:404-406`) están de
  acuerdo en que `base_siguiente` siempre es exactamente el efectivo contado — ya no existe el
  formulario viejo que pedía una base distinta al cerrar (eso quedó solo en `CajaTurno.gs`
  dormido/`caja-v2.test.js`, sin efecto real).
- El rol `'Caja'` se trata como equivalente a `'Encargado'` tanto en `requiereRol_`
  (`ZZ_ReactivacionCajaFinal.gs:22`) como en `cajaPuedeCerrar_` — consistente entre frontend
  (`caja.html:316,321`) y backend.
- La corrección administrativa de un cierre (`cajaCorregir_`) exige corregir en orden del más
  reciente hacia atrás y valida que la corrección no deje saldo negativo contra movimientos de
  custodia ya registrados después del cierre original — bien cubierto por
  `caja-corregir.test.js` e `caja-integridad-final.test.js`.

## Resumen para decidir

| # | Hallazgo | ¿Explotable hoy? | Tipo |
|---|---|---|---|
| 1 | Sin prueba end-to-end de que Cocina no puede operar Caja | No (el rol sí se rechaza hoy) | Brecha de cobertura de pruebas |
| 2 | `base_caja_*` sigue permitiendo Cocina en `Code.gs` | No (bloqueado por Fase 0) | Deuda técnica / trampa a futuro |
| 3 | `saldo_validado`/`fuera_de_turno` no se muestran en pantalla | Sí — el dato existe pero es invisible | Brecha de UI, no de backend |

Ningún hallazgo requirió ni recibió un cambio de código — quedan documentados para que Diana decida
si y cuándo priorizarlos.
