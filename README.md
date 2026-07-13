# Amelia Inventarios

Aplicación web de inventarios para Google Apps Script, respaldada por Google Sheets y versionada con GitHub.

## Qué resuelve

- Inventario independiente para Capri, San Antonio y Centro de Producción.
- Compras, producción, traslados, mermas, ajustes y conteos físicos como movimientos separados.
- Importación de reportes detallados de ventas FUDO (`.xls`/`.xlsx`).
- Exclusión automática de ventas canceladas y pendientes.
- Consumo esperado a partir de recetas propias, no de los pesos de comida de FUDO.
- Recetas con subproductos: Costilla Lista y Papas Listas.
- Disponibilidad estimada de platos y su insumo limitante.
- Conciliación diaria con explicación y fuente de cada cifra.
- Usuarios con roles, sedes permitidas y PIN almacenado como hash.
- Evidencia de archivos originales y prevención de importaciones duplicadas.

## Fuentes de verdad

| Dato | Fuente |
|---|---|
| Cantidades vendidas, cancelaciones y modificadores | FUDO Ventas |
| Gramajes de comida | Estandarización Productos |
| Recetas de Wafflería | Recetario validado |
| Stock por sede | Conteo físico y libro de movimientos Amelia |
| Compras | Movimiento estructurado con comprobante |
| Stock FUDO | Referencia, nunca cierre físico por sede |

## Instalación inicial

1. Crea un proyecto independiente de Google Apps Script.
2. Copia `.clasp.json.example` como `.clasp.json` y agrega el `scriptId`.
3. Instala y autentica `clasp`:

   ```bash
   npm install -g @google/clasp
   clasp login
   clasp push
   ```

4. En el editor de Apps Script, ejecuta una vez `setupApplication()`.
5. Autoriza Google Sheets y Google Drive.
6. Guarda el PIN inicial que devuelve la ejecución.
7. Implementa como **Aplicación web**, ejecutando como el propietario.

La configuración crea automáticamente la base de datos, las sedes, los insumos, las recetas iniciales, la carpeta de archivos y el usuario administrador.

## Flujo operativo recomendado

1. Registrar compras en la sede que las recibe.
2. Registrar traslados entre sedes.
3. Registrar producción de Costilla Lista y Papas Listas.
4. Cargar `ventas.xls` de FUDO al terminar el turno.
5. Registrar mermas o consumos internos con motivo.
6. Hacer el conteo físico final sin convertir celdas vacías en cero.
7. Abrir Análisis diario para ver entradas requeridas, consumo adicional y faltantes de conteo.

## Importación FUDO

La importación automática procesa la estructura detallada que contiene las hojas:

- `Ventas`
- `Adiciones`
- `Adiciones de Modificadores`

Otros reportes se almacenan como evidencia y generan una tarea de revisión. Esto evita duplicar compras o aceptar como inventario físico el stock global de FUDO.

## Desarrollo

```bash
npm test
npm run validate
```

No se debe subir `.clasp.json`, porque contiene el identificador real del proyecto Apps Script.

