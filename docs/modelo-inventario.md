# Modelo definitivo de inventario y sincronización con Fudo

> Documento de arquitectura/roadmap recibido el 26 jul 2026. Define el destino a largo plazo del
> sistema. No implica que todo esté construido: el estado real de avance se documenta al final de
> este archivo y se debe mantener actualizado en cada fase que se complete.

## 1. Lo que debemos aceptar sobre Fudo

**Fudo no divide claramente el inventario por sede.** Con la configuración actual, el código
utiliza una sola `apiKey` y un solo `apiSecret`, lo que representa una sola cuenta API de Fudo. La
aplicación intenta identificar la sede de una venta mediante:

```
Venta → Mesa → Sala → Sede
```

Por ejemplo: Salón SA → San Antonio, Terraza SA → San Antonio, Terraza Capri → Capri,
La Wafflería Capri → Capri. Pero las ventas sin mesa (domicilios, para llevar) pueden quedar sin
identificar.

La documentación permite solicitar relaciones como caja registradora, mesero, usuario, mesa, sala,
pagos e identificador de venta. Sin embargo, una muestra real de la cuenta no trajo `cashRegister`.
Hay que volver a probar solicitando expresamente esas relaciones, pero no se puede diseñar el
sistema suponiendo que siempre estarán presentes.

**Conclusión sobre las sedes:** el inventario de `/products` y `/ingredients` no muestra relación
con Capri o San Antonio (entrega stock, costo, unidad, mínimo y control de inventario, pero no una
ubicación/sede). Por tanto el stock de Fudo debe tratarse como **stock consolidado de la cuenta**,
no como inventario confiable por sede. Solo sería distinto si existieran dos cuentas de Fudo
completamente separadas, cada una con sus propias credenciales, catálogo y stock.

**Las recetas de Fudo no serán la fuente oficial.** Aunque la API permite consultar proporciones y
componentes de productos, las recetas actuales en Fudo están mal configuradas y no representan el
flujo real de Amelia. No se importarán automáticamente como recetas oficiales — se podrán mostrar
como referencia. Las recetas reales viven en Amelia, tendrán versiones y fechas de vigencia, y el
consumo se calcula con la receta vigente al momento de la venta.

**Fudo no conoce todas las entradas reales.** Cuando llega comida o materia prima: no siempre se
registra en Fudo, no se registra cuánto llegó crudo, dónde quedó, cuánto se produjo, el rendimiento,
el traslado real entre sedes, ni todas las mermas. El stock de Fudo sirve como comparación externa,
no como verdad operativa.

## 2. Modelo definitivo de la aplicación

```
                 FUDO API
         Ventas, ítems, pagos,
       productos y stock global
                    │
                    ▼
          SINCRONIZACIÓN FUDO
       Sin digitación del personal
                    │
                    ▼
┌─────────────────────────────────────┐
│      MOTOR DE INVENTARIO AMELIA     │
│                                     │
│ Compras y recepciones manuales      │
│ Producción y rendimientos           │
│ Traslados y recepciones             │
│ Mermas y consumos internos          │
│ Ventas automáticas desde Fudo       │
│ Conteos físicos                     │
└─────────────────────────────────────┘
                    │
                    ▼
         INVENTARIO POR UBICACIÓN
     CP / San Antonio / Capri
                    │
                    ▼
     Conciliación, alertas, costos,
   disponible para vender y auditoría
```

## 3. Fuente oficial de cada información

| Información | Fuente oficial |
| --- | --- |
| Venta realizada | Fudo |
| Producto vendido | Fudo |
| Pago registrado | Fudo |
| Descuento y cancelación | Fudo |
| Precio de venta | Fudo |
| Receta real | Amelia |
| Compra recibida | Amelia |
| Cantidad recibida | Amelia |
| Producción realizada | Amelia |
| Rendimiento real | Amelia |
| Merma | Amelia |
| Traslado entre sedes | Amelia |
| Inventario por sede | Amelia |
| Conteo físico | Amelia |
| Stock global mostrado por Fudo | Referencia secundaria |
| Dinero físico contado | Amelia |
| Movimiento bancario real | Banco o confirmación manual |

## 4. Ubicaciones que tendrá Amelia

No basta con guardar solamente "Capri" o "San Antonio" — el inventario debe conocer la ubicación
física:

- **Centro de Producción:** materia prima cruda, productos en proceso, productos terminados,
  despachos pendientes, mermas de producción.
- **San Antonio:** cocina, barra o bebidas, almacén, terraza o servicio (cuando aplique), caja
  (productos de venta directa).
- **Capri:** cocina, café y barra, waflería, almacén, caja.

Cada movimiento tendrá: producto, cantidad, unidad, ubicación origen, ubicación destino, tipo de
movimiento, fecha y hora, usuario, documento relacionado, evidencia, estado.

## 5. El corazón del sistema: movimientos de inventario

Las tablas separadas de producción, traslados, ajustes, conteos y ventas se conservan como
formularios operativos, pero todas deben alimentar una tabla central `Movimientos_Inventario`.

Tipos de movimiento: compra recibida, entrada por producción, consumo de producción, merma de
producción, traslado enviado, traslado recibido, consumo por venta, cancelación de venta, merma en
sede, consumo interno, cortesía, devolución, ajuste autorizado, diferencia de conteo.

Cada movimiento tiene signo (entrada = positivo, salida = negativo), de modo que el inventario se
calcula siempre igual:

```
Inventario teórico =
  último conteo físico
  + compras recibidas
  + producción recibida
  + traslados recibidos
  - consumo por ventas
  - producción consumida
  - traslados enviados
  - mermas
  - consumos internos
  ± ajustes autorizados
```

## 6. Flujo diario definitivo

**A. Compra:** proveedor, número de factura, fecha, producto, cantidad recibida, unidad, costo,
lugar donde ingresó, foto de factura, foto/evidencia del pesaje. No depende de que también se
registre en Fudo.

**B. Producción (Centro de Producción cocina):** entrada al proceso (ej. 25 kg costilla cruda),
salida (ej. 18,2 kg costilla preparada), merma (ej. 6,8 kg). Debe quedar: responsable, hora de
inicio/fin, receta o proceso utilizado, peso crudo, peso preparado, rendimiento, foto del pesaje,
observación.

**C. Traslado a una sede:** al enviar, resta del origen y queda "En tránsito"; al recibir, se anota
la cantidad realmente recibida y la diferencia contra lo enviado. La diferencia debe investigarse o
aprobarse — nunca se marca "recibido" automáticamente solo porque fue enviado.

**D. Venta registrada en Fudo:** la sincronización automática trae venta, producto, cantidad y sede;
Amelia busca la receta vigente y genera los movimientos de consumo de cada componente en esa sede.
El empleado no registra esa salida manualmente.

**E. Merma:** producto, cantidad, motivo, ubicación, foto cuando sea necesaria (se quemó, se cayó,
se venció, mala preparación, error de pedido, devolución de cliente, consumo interno).

**F. Cierre:** el personal realiza los conteos asignados por sector/frecuencia. El bloqueo de cierre
si faltan conteos obligatorios, y que pueda cerrar Caja/un encargado/un administrador, se conserva.
El cierre final debe ampliarse para mostrar: inventario teórico, inventario físico, diferencia,
ventas Fudo sincronizadas, ventas sin sede identificada, traslados pendientes, producciones
pendientes, mermas sin evidencia, pagos esperados, dinero físico contado.

## 7. Qué información será manual realmente

Solo se registra a mano lo que Fudo no puede conocer: recepción de compras, producción, traslados y
su recepción, mermas, consumos internos, conteos físicos, efectivo contado y comprobantes
necesarios. Ventas, productos vendidos, pagos, cancelaciones y descuentos vienen automáticos de
Fudo.

## 8. Cómo se resuelve la sede de las ventas

Tabla `Fudo_Mapeo_Sedes`:

| Tipo de referencia | ID Fudo | Nombre | Sede |
| --- | --- | --- | --- |
| Sala | 10 | Terraza Capri | Capri |
| Sala | 12 | Salón SA | San Antonio |
| Caja | 4 | Caja Capri | Capri |
| Usuario | 22 | Caja SA | San Antonio |
| Identificador | 8 | Domicilios Capri | Capri |

Prioridad para identificar una venta: 1) mesa → sala, 2) caja registradora, 3) identificador de
venta, 4) usuario o mesero, 5) regla específica del canal, 6) pendiente de identificar. Nunca se
asigna una venta automáticamente a una sede sin evidencia suficiente — las no identificadas quedan
en una bandeja "Ventas pendientes de sede"; el administrador las asigna una vez y el sistema
aprende la regla cuando sea posible.

## 9. Recetas definitivas

Niveles: producto vendido (ej. Chanchostilla) → componentes preparados (costilla preparada, panceta
preparada, papas listas, aioli, cebollita) → recetas de producción de esos componentes (ej. aioli =
aceite + huevo + ajo + limón). La venta descuenta el producto preparado; la producción descuenta los
insumos crudos — así se evita descontar dos veces.

Cada receta tendrá: versión, fecha de inicio, fecha de finalización, sede, rendimiento, unidad,
estado (borrador/aprobada/inactiva), usuario que la aprobó, evidencia de prueba.

## 10. Cómo se usa el stock de Fudo

El stock que entrega Fudo se guarda periódicamente (snapshot). No es el inventario oficial por
sede. Se usa para: comparar el consolidado de Amelia contra Fudo, detectar productos sin control de
stock, identificar nombres/códigos nuevos, revisar diferencias en bebidas empacadas, detectar
modificaciones hechas directo en Fudo, generar alertas.

No se usa para: repartir automáticamente stock entre sedes, sobrescribir conteos físicos, calcular
producción, crear mermas imaginarias, ni reemplazar recepciones y traslados.

## 11. Qué se conserva y qué se cambia del repositorio

**Se conserva:** usuarios y sesiones, roles y permisos, catálogo maestro, alias, recetas
versionadas, conteos, producción, traslados, auditoría, gestión de turnos, conexión y autenticación
con Fudo, disponibilidad de platos.

**Se refactoriza:**
- `Ventas_FUDO` (hoy plana por producto vendido) → dividir en `Fudo_Ventas`, `Fudo_Items`,
  `Fudo_Subitems`, `Fudo_Pagos`, `Fudo_Descuentos`, `Fudo_Propinas`.
- `Movimientos_FUDO` → queda como importación histórica/contingencia/auditoría eventual, no como
  requisito diario.
- `Stock_FUDO_Base` → sustituirse por snapshots automáticos de `/products` y `/ingredients`.
- `Conciliacion.gs` → dejar de calcular con fuentes parciales y consultar el libro central de
  movimientos.
- `Cierres_Turno` → hoy solo guarda fecha, sede, usuario y hora; debe guardar también estado de
  sincronización Fudo, total de ventas, pagos esperados, efectivo contado, diferencia de caja,
  inventario contado, diferencia de inventario, traslados pendientes, observaciones, evidencias,
  aprobación.

## 12. Pantallas de la aplicación final

Inicio · Operación diaria · Conteo y cierre · Inventario (CP/San Antonio/Capri/Consolidado) ·
Recetas · Fudo (última sincronización, ventas/pagos recibidos, productos nuevos, ventas sin sede,
errores, reintentar) · Conciliación (físico vs. teórico, Amelia consolidado vs. Fudo, consumo por
ventas, mermas, rendimientos, historial de diferencias).

## 13. Orden correcto de implementación

- **Fase 1 — Base de inventario:** ubicaciones, libro de movimientos, migrar producción/traslados/
  compras/ajustes/conteos, fórmula única de inventario.
- **Fase 2 — Integración completa de Fudo:** ventas, ítems, pagos, descuentos, productos,
  ingredientes, métodos de pago, salas/mesas/usuarios, snapshots de stock, registro de errores y
  última sincronización.
- **Fase 3 — Recetas:** limpiar recetas actuales, crear subrecetas, establecer rendimientos,
  vincular cada producto vendido por su ID de Fudo, versionar recetas.
- **Fase 4 — Operación diaria:** compras y recepción, producción, traslados, mermas, consumo
  interno, evidencias.
- **Fase 5 — Conciliación y cierre:** inventario teórico, conteo físico, diferencias, cierre de
  caja, ventas sin identificar, aprobaciones.
- **Fase 6 — Disponibilidad y alertas:** para cuántos platos alcanza, qué preparar, qué comprar, qué
  trasladar, qué productos están en riesgo, qué sede tiene exceso o faltante.

## Decisión definitiva

Fudo registra lo que se vende. Amelia registra lo que entra, se transforma, se mueve, se pierde y
se cuenta físicamente. Fudo no será el inventario oficial por sede — su stock es una referencia
consolidada. Las recetas oficiales están en Amelia, no en Fudo. Las entradas, producción,
traslados, mermas y conteos siguen siendo manuales porque representan hechos físicos, pero se
registran una sola vez mediante formularios simples. Ventas y pagos son completamente automáticos.
El repositorio actual se conserva; el siguiente desarrollo debe comenzar por el libro central de
movimientos y el modelo de ubicaciones, antes de ampliar dashboards o agregar más parches a la
conciliación existente.

---

## Estado real de avance (mantener actualizado)

Antes de este documento, buena parte de "Fase 1" ya existía bajo otros nombres:

- El "libro de movimientos con signo" ya existe de facto en `Ajustes_Inventario` (columna `tipo` +
  `cantidad`, ver `AjustesInventario.gs`), `Traslados` (envío/recepción con diferencia, ver
  `Traslados.gs`) y `Producciones` (`Produccion.gs`). `Conciliacion.gs` y `DisponibleHoy.gs` ya
  calculan el inventario teórico como último conteo ± esas fuentes.
- `Recetas` ya tiene columnas `version`, `sede`, `vigente_desde`, `vigente_hasta`, `estado` (ver
  `configurarHojas()` en `Code.gs`) — el versionado de recetas del punto 9 ya está modelado, aunque
  falta UI/flujo de aprobación completo.

Lo que **no** existía y se agregó en jul 2026 como primera pieza (aditiva, sin tocar las hojas ni
los cálculos existentes):

- `Fudo_Mapeo_Sedes` + resolución de sede por prioridad (mesa→sala, caja, identificador de venta,
  usuario/mesero, pendiente) — ver `FudoMapeoSedes.gs`.
- Snapshot automático de `/products` y `/ingredients` vía API hacia `Stock_FUDO_Base` (reutilizando
  el upsert que ya existía para la carga manual por Excel) — ver `fudoApiTomarSnapshotStock_` en
  `FudoApi.gs`.
- ~~Ubicaciones (sub-zonas por sede) — `Ubicaciones.gs`~~ **revertido (jul 2026).** Se había agregado
  como catálogo nuevo sin buscar primero si ya existía algo — sí existía: `assets/config.js` ya
  tiene `PUNTOS_POR_SEDE` con los puntos REALES que usan `conteo.html`/`traslados.html`/
  `producir.html` (ej. "Cocina terraza", "Bodega segundo piso"), con nombres distintos a los que
  `Ubicaciones.gs` inventó. `Ubicaciones.gs` y la acción `ubicaciones_listar` eran código muerto —
  nada los llamaba desde ninguna pantalla. Se eliminaron en vez de dejarlos convivir con
  `PUNTOS_POR_SEDE` como una tercera fuente. Si en el futuro se necesita una hoja `Ubicaciones` con
  ids estables (como propone el modelo de arquitectura), debe construirse SOBRE `PUNTOS_POR_SEDE`
  (unificando primero), no en paralelo.
- **Libro de movimientos, como VISTA de solo lectura** — `MovimientosInventario.gs`:
  `movimientosInventarioListar_(filtros)` normaliza Ajustes_Inventario, Producciones y Traslados a
  un único formato con signo (`MOVIMIENTO_TIPOS_SIGNO_`), y `calcularInventarioTeorico_(producto,
  sede, fechaCorte)` implementa la fórmula de la sección 5 (último conteo + movimientos
  posteriores) como una sola función reusable. Es una vista calculada, no una tabla nueva: no migra
  las hojas de origen ni cambia cómo Producción/Traslados/Ajustes escriben hoy. Compara por FECHA,
  no por hora exacta como sí hace `DisponibleHoy.gs` para la pantalla operativa — esa lógica más
  fina sigue siendo la que se usa en producción por ahora.
- **"Consumo por venta"** — `movimientosDesdeVentas_(fecha, sede, indice)` integrado opcionalmente al libro vía
  `movimientosInventarioListar_({ incluir_consumo_ventas: true })` y a `calcularInventarioTeorico_` con la
  misma bandera. Reutiliza `construirRecetaMap_`/`explotarReceta_`/`claveRecetaVenta_` — mismo criterio
  EXACTO que `conciliarComidaPorSede_` (`Conciliacion.gs`). Ventas canceladas se excluyen.

- **Insumo consumido y merma de proceso en Producción** (sección 6.B) — `Produccion.gs`:
  `produccionRegistrar_` acepta ahora, de forma opcional, `insumo_producto`/`insumo_cantidad`/
  `insumo_unidad`/`merma_cantidad`/`merma_unidad` (además de `rendimiento_porcentaje`,
  `receta_referencia`, `hora_inicio`/`hora_fin`, `observacion`, `evidencia_url`, guardados tal cual
  sin lógica todavía). Cuando vienen, `movimientosDesdeProduccion_` genera los 3 movimientos de la
  sección 6.B (entrada del terminado, consumo del insumo crudo, merma) en vez de solo el primero.
  La merma se registra bajo un nombre de producto sintético (no calza con ningún producto real del
  catálogo) para que aparezca en el libro/reportes sin restarse dos veces — ya queda reflejada en
  la diferencia entre insumo consumido y lo efectivamente producido. Sin insumo/merma (como todas
  las producciones registradas antes de jul 2026), sigue funcionando exactamente igual que antes.

- **UI de producir.html para insumo/merma/rendimiento/observación** — cada ítem de producción tiene
  ahora un "+ Detalle de lote" opcional y colapsado por defecto (insumo crudo consumido + cantidad +
  unidad, merma de proceso, rendimiento %, observación) que manda esos campos a
  `produccion_con_obligatorios_registrar` solo si se llenaron. La tabla "Producción de hoy" muestra
  ese detalle cuando existe. `evidencia_url` y `hora_inicio`/`hora_fin` quedan en el backend pero
  todavía sin campo en esta pantalla (ver pendientes).

- **Cierres_Turno ampliado** (sección 6.F) — `Turnos.gs`: `turnoResumenCierre_(fecha, sede)` calcula
  ventas Fudo del día (total y cantidad, ya sin canceladas), traslados de/hacia esa sede sin
  Confirmar/Resolver, y producciones registradas. `turnoCerrar_` guarda ese resumen como snapshot en
  Cierres_Turno al momento de cerrar (no se recalcula después, así el histórico no cambia si se edita
  algo de ese día más tarde) y acepta `datosCierre.efectivo_contado`/`observaciones` opcionales. El
  dashboard muestra el resumen antes de cerrar (con los dos campos opcionales) y lo ya guardado
  cuando el turno ya está cerrado.

- **Bandeja "Ventas pendientes de sede"** (sección 8, completa el mecanismo de Fudo_Mapeo_Sedes) —
  `FudoMapeoSedes.gs`: `ventasPendientesSedeListar_()` agrupa las ventas con `sede === 'Sin
  identificar'` por `creada_por` (casi siempre muchas comparten la misma referencia sin mapear).
  `ventasPendientesSedeAsignar_(creadaPor, sede, usuario)` asigna esa sede a TODAS las ventas de ese
  grupo de una vez y, si `creadaPor` tiene un valor real, crea el mapeo tipo "Sala" correspondiente
  — "el sistema aprende la regla", así las próximas ventas con esa misma referencia se identifican
  solas. UI nueva en `importar.html` (se recarga tras sincronizar y tras cada asignación).

### Correcciones (jul 2026, tras una revisión externa del código real)

Una revisión de otra IA (verificada contra el repo real, a diferencia de una anterior que
describía una rama/commit inexistentes) encontró dos gaps reales en lo ya construido:

- **`fudoApiTomarSnapshotStock_` pedía `include=unit` pero nunca lo usaba** — `fudoApiObtenerTodo_`
  descarta el arreglo `included` de cada página, así que `unidad` siempre quedaba en `''`. Se
  cambió a `fudoApiObtenerTodoCompleto_` (que sí conserva `included`) y se resuelve
  `relationships.unit` contra ese arreglo.
- **`fudoResolverSedeVenta_` (mesa→sala, identificador, mesero) existía pero no estaba conectada al
  sync real** — `fudoApiFilasVentaDesdeSale_` solo extraía la sala. Ahora también extrae `waiter` y
  `saleIdentifier` (agregados al `include` de `fudoApiSincronizarVentas_`) y llama a
  `fudoResolverSedeVenta_` con las tres referencias, mandando una columna `Sede` adicional que
  `importarFudoConLock_` (Fudo.gs) prioriza sobre `sedeDesdeCreadaPor_` — pero solo si esa
  resolución encontró algo (si da "Sin identificar", se le sigue dando su oportunidad a
  `sedeDesdeCreadaPor_`, que tiene su propia lista histórica). NO se intenta extraer "caja
  registradora": la especificación OpenAPI oficial completa confirma que `/sales` no tiene ninguna
  relación `cashRegister` (solo la tienen los Usuarios) — la prioridad "Caja" de
  `FUDO_MAPEO_SEDES_PRIORIDAD_` queda sin una fuente real por ahora, no es un bug, es una limitación
  de la API misma.

La misma revisión señaló, correctamente, que `Ubicaciones.gs` (arriba) duplicaba
`PUNTOS_POR_SEDE` — ver la nota tachada más arriba. **Corrección jul 2026:** la PR #93 intentó
unificar ubicaciones vía `ubicaciones_listar`, pero esa acción ya no existía (eliminada en #92);
el frontend caía a un fallback con nombres ficticios. Se restauró `PUNTOS_POR_SEDE` en
`assets/config.js` como única fuente de puntos de conteo/traslado.

### Hecho en jul 2026 (Pasos 6–17, además de lo listado arriba)

- Sincronización de **pagos** Fudo (`Pagos_FUDO` + dual-write `Fudo_Pagos`).
- Tablas normalizadas **`Fudo_Ventas`/`Fudo_Items`/`Fudo_Subitems`/`Fudo_Descuentos`/`Fudo_Propinas`** con dual-write desde sync/API.
- **Panel Fudo** (`fudo.html`) con última sincronización, migraciones históricas y estado de tablas normalizadas.
- **Evidencias** en Drive (`Evidencias.gs`) conectadas a compras, conteo, producción y ajustes.
- **Cierre de turno enriquecido:** `turnoResumenCierre_` incluye pagos esperados, descuentos, propinas, diferencia de caja (efectivo contado vs esperado) y resumen de inventario teórico vs contado.
- **Conciliación:** inventario teórico de referencia, consumo por ventas (libro), subítems en consumo por receta (paso 17).
- **Lectores con fallback** (`FudoLectores.gs`): `Fudo_Items`/`Fudo_Pagos` primero, tablas planas si no hay datos.

### Hecho en jul 2026 (Paso 19 — cierre en un solo PR)

- **Lectores unificados** en Pagos, Recetas, Turnos, Diagnóstico y libro de inventario (contenido del paso 18).
- **Libro:** checkbox "incluir consumo por ventas", filtro por punto/ubicación, columna Ubicación.
- **Inventario teórico** con opción `incluir_consumo_ventas` (API + `calcularInventarioTeorico_`).
- **Mapeo de sedes:** al asignar ventas pendientes, recalcula cabeceras `Fudo_Ventas`.
- **Consumo interno** como tipo de ajuste (degustación, staff) en conteo y libro.
- **Aprobar recetas:** botón en `recetas.html` + `receta_aprobar` (borrador → activo).
- **Catálogo:** columna `id_fudo` en `Catalogo_Maestro` (vínculo estable al ID numérico de Fudo).

### Hecho en jul 2026 (Paso 20 — pendientes del roadmap)

- **Cancelación de venta** como movimiento (`movimientosDesdeCancelaciones_`) — reversa positiva del consumo por receta para ventas canceladas; opción `incluir_cancelaciones_ventas` en el libro.
- **Disponible Hoy (Fase 6):** descuenta consumo por ventas (ítems + subítems normalizados) desde el último conteo vía `netoVentasDesdeConteo_`.
- **Consumo interno** en conciliación de ajustes, Disponible Hoy y dual-write del libro físico.
- **Conciliación:** traslados netos delegan a `movimientosInventarioListar_` cuando hay datos.
- **Vista por ubicación:** pantalla `inventario-ubicacion.html` + API `inventario_ubicacion_resumen`.
- **Hora inicio/fin de lote** en `producir.html` — ya implementada (se quitó de pendientes).

Pendiente (requiere migración de datos reales en producción o decisiones de producto):

- Dejar de **escribir** en `Ventas_FUDO`/`Pagos_FUDO` planas (hoy lectura prioriza normalizadas; escritura sigue en dual-write desde sync).
- Migración completa de `Conciliacion.gs`/`DisponibleHoy.gs` al motor único con comparación por hora exacta (Disponible Hoy conserva lógica horaria propia).
- **Activar dual-write del libro central** en producción (`inventarioLibroActivo_`) — requiere migración histórica validada en la hoja real. Sigue apagado a propósito (jul 2026): no se activó junto con la sincronización automática de abajo para no mezclar dos cambios de riesgo distinto en el mismo despliegue.
- Regla de negocio avanzada: cancelación después de servido vs. antes del cierre (hoy todas las canceladas generan reversa en el libro).
- Seguir consolidando pantallas hacia el modelo de ~7 de la sección 12 (Inicio · Operación diaria ·
  Conteo y cierre · Inventario · Recetas · Fudo · Conciliación). Ya se hizo un primer recorte de bajo
  riesgo (ver "Consolidación de pantallas" más abajo: 5 históricos de solo lectura → 1). Falta lo más
  grande y de más riesgo: fusionar pantallas de REGISTRO (conteo/producción/traslados/compras) y
  reducir hojas del spreadsheet — esto último requiere activar el libro central primero (punto de
  arriba), no es solo UI.

### Hecho en jul 2026 (importar histórico manual desde Excel + consolidar pantallas de solo lectura)

Dos pedidos del negocio recién empezando: (1) traer al sistema lo que ya llevaban a mano en Excel
antes de usar Dilana OS, y (2) que la aplicación se sintiera con menos pantallas, no más.

- **`apps-script/ImportarHistorico.gs`** (nuevo) — `historicoImportarFilas_(tipoDestino, filas,
  usuario, opciones)` importa filas históricas de Compras, Mermas/ajustes, Producción, Traslados o
  Conteos hacia las MISMAS hojas y con las MISMAS reglas de validación que las pantallas manuales
  (reutiliza `ajusteInventarioRegistrar_`, `produccionRegistrar_`, `trasladoCrear_`/
  `trasladoConfirmar_`, `conteoRegistrar_` — no duplica esa lógica). Dedupe por contenido (no hay id
  externo como en Fudo) usando el mismo `contadorClaves_` de `Fudo.gs`, así subir el mismo Excel dos
  veces no duplica filas. Acciones nuevas: `historico_tipos_listar` / `historico_importar` (solo
  Administrador, ver `Code.gs`).
- **UI en `importar.html`** (sección "Datos históricos manuales (Excel)", NO una pestaña nueva) — sube
  un `.xls`/`.xlsx`/`.csv` con `XLSX.js` (ya vendorizado, mismo que usa la importación de Fudo),
  arma un mapeo de columnas con adivinado automático por nombre parecido, vista previa, y confirma en
  lotes de 100 filas con barra de progreso — mismo patrón que la importación de Fudo, para que las
  columnas reales del Excel del negocio (que casi nunca calzan con los nombres de campo del backend)
  no bloqueen nada.
- **Consolidación de pantallas** — `historial.html` (nuevo) reemplaza `historial-conteos.html`,
  `historial-mermas.html`, `historial-producciones.html`, `historial-conciliacion.html` y
  `historial-cierres-turno.html` (eliminados): un selector de tipo muestra/oculta cada sección, cada
  una carga sus datos solo la primera vez que se abre. Mismas llamadas al backend, mismos filtros y
  columnas que las 5 pantallas originales — no se tocó ninguna lógica de negocio, solo se unificó el
  contenedor. El menú de navegación pasó de 20 a 16 pantallas. También se renombró "Importar de
  FUDO" a solo "Importar" (ya no es solo Fudo).
- No tocado a propósito: pantallas de REGISTRO (conteo.html, producir.html, traslados.html,
  compras.html) siguen separadas — fusionarlas es un cambio de flujo diario para el personal, más
  arriesgado que unificar vistas de solo lectura, y no se hizo sin mockups/validación con el equipo
  real (ver "Pendiente" arriba).

### Hecho en jul 2026 (sincronización automática de Fudo — cierra el gap "por qué es manual")

Hasta ahora `fudoApiSincronizarVentas_`/`fudoApiSincronizarPagos_` (API real, ya probada contra la
cuenta, ver arriba) solo corrían cuando un Administrador entraba a `importar.html`, elegía un rango
de fechas y hacía clic — nada las llamaba solas. El único trigger programado (`tareaDiaria_`, 6am)
únicamente limpiaba sesiones y revisaba alertas. Es decir: el motor de sincronización funcionaba,
pero dependía de que alguien se acordara de sincronizar todos los días.

- **`fudoSincronizacionAutomatica_`** (`FudoApi.gs`) — nuevo handler de trigger que sincroniza
  ventas y pagos de FUDO solo, sin ningún clic. Rango: mientras no haya un registro de
  sincronización **exitosa** de ventas en el panel (negocio recién empezando, instalación nueva, o
  todos los intentos previos fallaron), sincroniza desde `FUDO_FECHA_INICIO_OPERACION_`
  (`'2026-07-01'`, Amelia empezó a operar/usar FUDO en jul 2026) hasta hoy — trae el histórico
  completo del mes solo, sin que un Administrador tenga que entrar a `importar.html` y sincronizarlo
  a mano. Una vez que hay al menos una corrida exitosa, vuelve al rango normal "ayer → hoy" (no
  tiene sentido re-consultar el mes completo cada 15 minutos una vez puesto al día). Es seguro
  repetir el mismo rango una y otra vez porque ventas y pagos se deduplican por su id real de FUDO
  (`claveVenta_` / upsert por `id_pago`), nunca por rango de fechas — así una venta cerrada tarde,
  cancelada después, o una corrida que falló hace unas horas quedan cubiertas solas en la siguiente.
  A diferencia de llamar las funciones de sync directo, esto **siempre** deja un registro en el
  panel (`fudoApiSyncRegistrar_`) aunque la API de FUDO lance una excepción (token vencido, fu.do
  caído) — antes esos fallos no dejaban ningún rastro visible, y como un registro fallido NO cuenta
  como "corrida exitosa", el histórico completo se reintenta solo en la siguiente corrida en vez de
  rendirse y pasar a "ayer" con el mes a medio sincronizar.
- **`fudoSincronizacionStockDiaria_`** (`FudoApi.gs`) — mismo patrón para el snapshot de stock
  consolidado (`fudoApiTomarSnapshotStock_`), llamado desde `tareaDiaria_` una vez al día.
- **`configurarTriggers()`** (`Code.gs`) ahora crea también un trigger cada 15 minutos para
  `fudoSincronizacionAutomatica_`, además del diario de siempre. Hay que volver a correr
  `configurarTriggers()` una vez desde el editor de Apps Script para que el trigger nuevo quede
  activo en una instalación que ya existía (no se activa solo con `clasp push`).
- Sin credenciales de la API configuradas (`fudoApiConfigurarCredenciales_` nunca corrido), los dos
  handlers no hacen nada — no es un error, es una instalación que aún no conectó FUDO. La
  sincronización manual de `importar.html` se conserva intacta como respaldo (ej. para rangos de
  fechas históricos puntuales).
- **Panel Fudo** (`fudo.html`) ahora marca una tarjeta como "Desactualizado" (no solo "Error") si la
  última sincronización exitosa de ventas/pagos/stock tiene más de 90 minutos (3 corridas seguidas
  sin novedad) — antes una corrida automática atascada podía pasar desapercibida porque la tarjeta
  seguía mostrando el último "OK" manual de hace días.
- Pendiente real (no resuelto en este cambio): el snapshot de stock sigue siendo diario, no cada 15
  min, a propósito — es una referencia secundaria (sección 10), no justifica el costo extra de
  consultar `/products`+`/ingredients` con esa frecuencia.
