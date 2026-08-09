# Dilana OS — contexto para retomar el proyecto

Este archivo reemplaza a los documentos de contexto sueltos que Diana traía de otras sesiones
(Word, notas). A diferencia de esos, este vive en el repo, se actualiza en cada sesión y no se
desactualiza en silencio: si algo de aquí ya no es cierto, corrígelo en el mismo commit donde lo
descubras.

Para arquitectura, instalación y despliegue ver `README.md`. Para instrucciones específicas del
entorno cloud ver `AGENTS.md`. Esto es lo que ninguno de los dos cubre: reglas de trabajo, qué se
decidió y por qué, y qué sigue genuinamente pendiente.

## Reglas de trabajo con Diana

- Responder en español, claro y sin rodeos.
- Antes de tocar una regla de negocio: revisar y explicar primero, no asumir. Si hay una lista de
  decisiones o alternativas, las responde Diana — no contestarlas en su nombre.
- Cambios importantes: rama/PR, explicar archivos e impacto, correr `npm test` antes de mergear.
- FUDO: no inferir un endpoint por lo que aparece en el POS o en nombres de permisos — confirmar en
  `apps-script/fudo-openapi.yml` y en `apps-script/FudoApi.gs`.
- Separar siempre HECHO CONFIRMADO / DATO HISTÓRICO / PROVISIONAL / DECISIÓN PENDIENTE al hablar de
  recetas o rendimientos — la receta "más reciente" no siempre es la vigente (ver estados abajo).
- No commitear archivos que huelan a credenciales o respaldos locales sin revisión explícita.

## Qué es DILANA OS

Sistema de control operativo para Amelia + La Wafflería: reconcilia lo que entra, se transforma, se
mueve y se vende contra lo que físicamente debería quedar en cada sede.

- **San Antonio** y **Capri**: sedes de venta (Caja + Cocina + Servicio). Capri también vende La
  Wafflería.
- **Centro de Producción (CP)**: compras/producción/traslados. No tiene Caja de venta ni personal de
  Caja/Servicio — solo producción y manejo de insumos.
- Flujo: Compras → Producción CP → Traslados → Recepción → Ventas FUDO → consumo por receta →
  mermas/ajustes → conteo físico → conciliación.
- **Disponible Hoy** (`apps-script/DisponibleHoy.gs`) es el cálculo central: último conteo físico +
  compras + traslados recibidos + producción − ventas/consumo por receta − producción usada como
  insumo − mermas − traslados enviados, todo desde el último conteo de cada sede. Se usa igual para
  las 3 sedes (desde agosto 2026 también para Centro de Producción — antes CP tenía un cálculo
  aparte basado solo en "producción del día", que se retiró por mostrar la pantalla vacía cualquier
  día sin producción registrada aunque sí hubiera inventario real).

## Recetas: jerarquía y dónde ver lo pendiente

La hoja `Recetas` es la fuente real (vía `recetas_listar`), no ningún Excel o documento externo.
Cada línea tiene un `estado` que decide si afecta el cálculo (`recetaEstadoVigente_` en
`apps-script/Recetas.gs`):

| Estado | Afecta Disponible Hoy/Conciliación | Significado |
|---|---|---|
| `activo` | Sí, sin aviso | Dato confirmado |
| `revisar` | Sí, con aviso en `recetas.html` | Se usa, pero el dato tiene una duda abierta |
| `pendiente` | No | Dato inválido o faltante (ej. rendimiento sin medir) |
| `referencia` | No | Confirmado pero no automatizable hoy (opciones "elige 1 de N": salsas, toppings, masa a elegir — FUDO no registra qué eligió el cliente) |
| `borrador` / `inactivo` / `archivado` | No | Sin confirmar, reemplazado, o histórico |

**`recetas.html` tiene un panel "Pendientes por confirmar"** (agosto 2026, pedido de Diana) que
agrupa por producto todo lo que esté en `pendiente`/`revisar`/`borrador`/`referencia` con la nota de
qué falta — es el lugar para ir a recopilar pesos/rendimientos reales, no hay que filtrar la matriz
a mano. Cuando midas un dato real, edita la línea ahí mismo y cámbiale el estado a `activo`.

No mezclar recetas "Archivo Amelia" (histórico) con la versión vigente sin validar contra esa hoja
— hay ejemplos reales de un documento externo mostrando una cifra ya reemplazada en el Sheet (ej. la
receta de Chanchostilla cambió costilla 80g→85g, panceta 90g→75g, y sumó Alioli 30g en julio 2026;
un documento de contexto seguía mostrando la versión vieja).

## Caja

Backend único: `apps-script/CajaTurno.gs` (consolidado — `CajaV2.gs` existió brevemente y se
eliminó por declarar las mismas funciones globales y competir con `CajaTurno.gs` según el orden de
carga; no recrearlo). Frontend: `caja.html`. Solo existe en San Antonio y Capri.

### Decisiones ya confirmadas (no volver a preguntar)

- Una diferencia de dinero (al abrir o cerrar) **nunca bloquea**: quien está en turno sigue igual,
  solo debe escribir una observación. No hace falta que un Administrador apruebe ni que abra/cierre
  él mismo — concilia la diferencia después, aparte, desde "Novedades de Administrador".
- FUDO sin sincronizar **nunca bloquea** abrir ni cerrar. Abrir ni siquiera espera una sincronización
  real (lee caché); cerrar sí sincroniza en vivo porque el efectivo esperado depende de los pagos,
  pero si falla, la caja se cierra igual y queda marcada `fudo_confiable_cierre:false` para que el
  Administrador la revise.
- Efectivo FUDO "Sin identificar" (sede no resuelta) es puramente informativo, nunca bloquea. Se
  concilia aparte en el Panel FUDO.
- Persona que recibe / persona que verifica el cierre: se probó exigirlas por separado (PR #153) y
  se revirtió — quien cierra el turno hace todo, un solo responsable. Los campos siguen existiendo
  por compatibilidad con cierres históricos.
- Movimientos de caja no se editan ni se borran desde la pantalla; tienen candado + clave de
  idempotencia para que un doble clic no duplique. No se puede sacar más de lo disponible en caja
  operativa/fuerte en ese momento.
- **Cocina no debe tener ningún acceso a Caja** (confirmado por Diana, ago 2026: "cocina no tiene que
  ver nada con caja") — así ya estaba en el código (`caja.html` y el router en `Code.gs` exigen
  Administrador/Encargado); la rama de `cajaPuedeCerrar_` que contemplaba Cocina según sector de
  turno queda como código muerto a propósito, documentado, no una decisión pendiente.
- Historial de Caja (`historial-caja.html`) ya es un rango de fechas, no una fecha suelta.
- Un día cerrado ya se puede corregir, pero **solo un Administrador** (Diana, ago 2026: "reapertura o
  corrección de caja ya hecha, solo por administrador") — ver `cajaCorregir_` más abajo.

### Corrección de un cierre ya hecho (solo Administrador)

- Es **corrección con auditoría**, no reapertura del estado de la caja (nunca vuelve a "Abierto"): se
  edita `efectivo_contado`/`caja_fuerte_contada`/`observacion_cierre`/`base_siguiente`/
  `caja_fuerte_siguiente` de un turno ya `Cerrado`, se recalculan las diferencias, y queda
  `corregido_por`/`corregido_en`/`motivo_correccion` en la fila para que se note en
  `historial-caja.html` que ese día no es el original. Auditoria.gs guarda el antes/después completo.
- Se eligió corrección en vez de reapertura real porque el `base_siguiente`/`caja_fuerte_siguiente`
  de este día ya pudo haber sido usado como `base_esperada`/`caja_fuerte_esperada` de un día
  posterior — reabrir de verdad (volver a "Abierto", dejar registrar más movimientos) podría dejar
  ese día posterior calculando contra un número que ya cambió. Por eso `cajaCorregir_` **rechaza
  corregir un día si ya existe un cierre posterior de esa misma sede** — hay que corregir en orden,
  del más reciente hacia atrás, nunca un día en medio de la cadena.
- No toca movimientos de Caja_Movimientos (siguen sin editarse/borrarse) ni el `efectivo_esperado`/
  `caja_fuerte_esperada` originales (quedan como referencia de qué se esperaba en el momento) — solo
  lo contado, la observación y las diferencias resultantes.

### Sigue genuinamente pendiente / vale la pena preguntarle a Diana

- Apertura excepcional de otra sede: hoy es exclusiva de Administrador (o un usuario con
  `sede: 'Ambas'`); un Encargado no puede abrir la caja de una sede que no es la suya.
- No existe evidencia obligatoria por tipo de movimiento (ej. "Gasto") — el campo existe en el
  backend pero la pantalla de "Registrar movimiento" no lo pide.
- Rappi: se enciende una vez por turno y no se puede apagar/desmarcar desde la pantalla — así sigue.

## FUDO — datos de referencia

- Auth: `https://auth.fu.do/api` · API: `https://api.fu.do/v1alpha1` · credenciales en Script
  Properties (`FUDO_API_KEY`, `FUDO_API_SECRET`). Sin ellas configuradas, toda la validación FUDO de
  Caja queda desactivada sin bloquear nada (comportamiento pre-integración).
- Resolución de sede en ventas: `cashRegister` id `"1"` = San Antonio, `"2"` = Capri. Fallback por
  sala (Salón SA/Terraza SA → San Antonio; Terraza Capri/La Wafflería-Capri → Capri) y luego "Sin
  identificar".
- Métodos de pago: id 1 = Efectivo (`cash`); el resto (Cta. Cte., Tarjeta, Bancolombia/Daviplata/
  Pse/Nequi por WhatsApp, QR BBVA) no son efectivo.
- Sincronización automática cada 15 min (`fudoSincronizacionAutomatica_` en `FudoApi.gs`) más
  sincronización forzada al cerrar Caja y bajo demanda (botón "Sincronizar FUDO").
- No asumir que un permiso visible en el POS implica un endpoint público — confirmar en
  `apps-script/fudo-openapi.yml` primero.

## Convenciones de nombres que importan

- `assets/config.js` expone `API_URL`, `llamar()` (POST al `/exec`, timeout ~45s) y utilidades
  compartidas (`Sesion`, `requerirRol_`, `restringirSelectorSede_`, `normalizarTexto`,
  `escapeHtml`...). Casi todo `.html` en la raíz depende de él.
- `sedeEscrituraPermitida_`/`sedeConsultaPermitida_` (`Code.gs`) son la regla de permisos por sede:
  Administrador o `sede:'Ambas'` puede cualquier sede; cualquiera puede escribir en Centro de
  Producción además de la suya (pedido explícito: cualquiera de San Antonio/Capri/Ambas debe poder
  registrar cosas de CP); Caja es la excepción — ahí CP ni siquiera es una opción.

## Cómo mantener este archivo

- Si una decisión de negocio cambia (Diana confirma algo distinto a lo escrito aquí), actualiza la
  sección correspondiente en el mismo commit — no dejes que quede un documento que contradiga al
  código.
- Si terminás un fix de la lista de Inventario/Caja, muévelo de "pendiente" a una nota breve aquí
  solo si es una decisión reutilizable (no repitas el changelog de PRs, eso ya vive en GitHub).
- Preferí que los datos vivos (recetas, rendimientos, estado de PRs) se consulten en la app o en
  GitHub en vez de copiarlos aquí — este archivo es para reglas y decisiones, no para una fotografía
  de datos que se desactualiza sola.
