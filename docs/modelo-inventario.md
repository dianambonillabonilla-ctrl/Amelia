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
- **Ubicaciones (sub-zonas por sede)** — `Ubicaciones.gs`: catálogo de los puntos de la sección 4
  (Cocina/Barra/Almacén/Caja, etc.) por sede, para que la app pueda ofrecer un desplegable en vez de
  texto libre en los campos `punto`/`punto_conteo`/`punto_origen`/`punto_destino` que ya existían en
  Ajustes_Inventario/Conteos_Manuales/Traslados. No valida ni migra retroactivamente lo ya guardado.
- **Libro de movimientos, como VISTA de solo lectura** — `MovimientosInventario.gs`:
  `movimientosInventarioListar_(filtros)` normaliza Ajustes_Inventario, Producciones y Traslados a
  un único formato con signo (`MOVIMIENTO_TIPOS_SIGNO_`), y `calcularInventarioTeorico_(producto,
  sede, fechaCorte)` implementa la fórmula de la sección 5 (último conteo + movimientos
  posteriores) como una sola función reusable. Es una vista calculada, no una tabla nueva: no migra
  las hojas de origen ni cambia cómo Producción/Traslados/Ajustes escriben hoy. Tampoco incluye
  todavía "Consumo por venta" (requiere explotar la receta vigente, ya resuelto en
  `DisponibleHoy.gs`/`Conciliacion.gs` — se conecta ahí cuando se decida consolidar, no se
  duplica). Y compara por FECHA, no por hora exacta como sí hace `DisponibleHoy.gs` para la
  pantalla operativa — esa lógica más fina sigue siendo la que se usa en producción por ahora.

Pendiente (no implementado todavía, requiere decisiones de producto y migración de datos reales
antes de tocar código en producción):

- Migrar Conciliacion.gs/DisponibleHoy.gs para que consulten `movimientosInventarioListar_`/
  `calcularInventarioTeorico_` en vez de combinar las hojas por su cuenta — deliberadamente no se
  hizo en esta pasada para no arriesgar su lógica ya probada (comparación por hora exacta,
  proyección de Stock_FUDO_Base hacia atrás, etc.) sin una razón concreta.
- Agregar "Consumo de producción"/"Merma de producción" reales: hoy `Producciones` solo registra el
  producto TERMINADO (cantidad+unidad), no el insumo crudo que entró ni la merma de proceso de la
  sección 6.B — para eso hace falta ampliar el formulario de producción, no solo el libro.
  "Consumo por venta"/"Cancelación de venta" tampoco están en el libro todavía (ver punto anterior).
- Refactor de `Ventas_FUDO` en `Fudo_Ventas`/`Fudo_Items`/`Fudo_Subitems`/`Fudo_Pagos`/
  `Fudo_Descuentos`/`Fudo_Propinas`.
- Ampliación de `Cierres_Turno` con los campos de sincronización/pagos/inventario del punto 6.F.
- Pantallas nuevas (bandeja "Ventas pendientes de sede", panel Fudo con última sincronización,
  vista del libro de movimientos/inventario por ubicación).
