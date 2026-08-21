const fs=require('fs');const vm=require('vm');const assert=require('assert');
const backend=fs.readFileSync('apps-script/ZZZ_CajaConciliacionBancaria.gs','utf8');
const frontend=fs.readFileSync('assets/caja-conciliacion-bancaria.js','utf8');
const config=fs.readFileSync('assets/config.js','utf8');
const parcial=fs.readFileSync('caja-conciliacion-bancaria.html','utf8');

const ctx={console,Date,JSON,Object,String,Number,Math,Array,RegExp,isFinite,handleRequest_:()=>({fallback:true}),validarToken_:()=>({ok:true,usuario:{rol:'Administrador'}}),jsonOut_:x=>x};
vm.createContext(ctx);vm.runInContext(backend,ctx);

// Clasificación del extracto: solo ingresos de clientes elegibles participan.
let c=ctx.cajaConcBancoClasificarMovimiento_({descripcion:'J96H – ABONO CON BRE-B',credito:'1.218.550,00'});assert.strictEqual(c.clasificacion,'BRE_B');assert.strictEqual(c.elegible,true);assert.strictEqual(c.credito,1218550);
c=ctx.cajaConcBancoClasificarMovimiento_({descripcion:'GMF 4X1000',debito:2160});assert.strictEqual(c.clasificacion,'IMPUESTO_COMISION');assert.strictEqual(c.elegible,false);
c=ctx.cajaConcBancoClasificarMovimiento_({descripcion:'REVERSO COBRO',credito:540000});assert.strictEqual(c.clasificacion,'REVERSO');assert.strictEqual(c.elegible,false);
c=ctx.cajaConcBancoClasificarMovimiento_({descripcion:'ABONO',credito:100000});assert.strictEqual(c.clasificacion,'OTRO_INGRESO');assert.strictEqual(c.elegible,false,'un abono genérico no puede asumirse como venta');

// Métodos FUDO V1: Bre-B / QR / transferencias sí; tarjetas/datáfono no.
for(const metodo of ['BRE-B','Pago QR','Transferencia bancaria','Nequi'])assert.strictEqual(ctx.cajaConcBancoMetodoFudo_({metodo_pago:metodo}).elegible,true,metodo);
for(const metodo of ['Visa Débito','Mastercard','Datáfono'])assert.strictEqual(ctx.cajaConcBancoMetodoFudo_({metodo_pago:metodo}).elegible,false,metodo);

// La fecha valor del día siguiente participa (caso real de Bre-B que liquida al día siguiente).
assert.strictEqual(ctx.cajaConcBancoMovimientoEnVentana_({fecha_movimiento:'2026-08-20',fecha_valor:'2026-08-21'},'2026-08-20'),true);
assert.strictEqual(ctx.cajaConcBancoMovimientoEnVentana_({fecha_movimiento:'2026-08-22',fecha_valor:'2026-08-22'},'2026-08-20'),false);

// Cruce por grupos de monto: montos repetidos se consumen uno a uno, sin duplicar dinero.
const pagos=[
 {id_pago:'f1',fecha:'2026-08-20',creacion:'2026-08-20T18:00:00',sede:'Capri',medio:'BRE_B',metodo_pago:'BRE-B',valor:100000},
 {id_pago:'f2',fecha:'2026-08-20',creacion:'2026-08-20T18:10:00',sede:'Capri',medio:'BRE_B',metodo_pago:'BRE-B',valor:100000},
 {id_pago:'f3',fecha:'2026-08-20',creacion:'2026-08-20T18:20:00',sede:'Capri',medio:'QR',metodo_pago:'QR',valor:200000}
];
const banco=[
 {fecha_movimiento:'2026-08-20',fecha_valor:'2026-08-21',descripcion:'ABONO CON BRE-B',credito:100000,referencia:'b1'},
 {fecha_movimiento:'2026-08-20',fecha_valor:'2026-08-21',descripcion:'ABONO CON BRE-B',credito:100000,referencia:'b2'},
 {fecha_movimiento:'2026-08-20',fecha_valor:'2026-08-20',descripcion:'PAGO QR',credito:200000,referencia:'b3'},
 {fecha_movimiento:'2026-08-20',fecha_valor:'2026-08-20',descripcion:'TRANSFERENCIA',credito:300000,referencia:'b4'},
 {fecha_movimiento:'2026-08-20',descripcion:'GMF 4X1000',debito:1600,referencia:'tax'}
];
const x=ctx.cajaConcBancoCruzar_(pagos,banco,'2026-08-20');assert.strictEqual(x.total_conciliado,400000);assert.strictEqual(x.cruces.filter(r=>r.resultado==='CONCILIADO_POR_MONTO').length,3);assert.strictEqual(x.pendientes.length,1);assert.strictEqual(x.pendientes[0].tipo,'BANCO_SIN_FUDO');assert.strictEqual(x.pendientes[0].valor,300000);assert.strictEqual(x.movimientos_banco.find(r=>r.referencia==='tax').elegible,false);

// El override ZZZ solo intercepta conciliación; el resto conserva el router original.
assert.deepStrictEqual(ctx.doPost({postData:{contents:JSON.stringify({action:'caja_estado'})}}),{fallback:true});
const unknown=ctx.doPost({postData:{contents:JSON.stringify({action:'caja_conciliacion_bancaria_desconocida',token:'x'})}});assert.strictEqual(unknown.ok,false);assert.match(unknown.error,/desconocida/);

// Integración estática de la cuarta pestaña y parser Excel/CSV.
assert(config.includes("boton.textContent='Conciliación bancaria'"));assert(config.includes("host.id='tab-banco'"));assert(config.includes("u.rol!=='Administrador'"));
assert(parcial.includes('conciliacion-banco-archivo'));assert(parcial.includes('.xls,.xlsx,.csv'));assert(parcial.includes('Este módulo no modifica el efectivo esperado'));
assert(frontend.includes('xlsx.full.min.js'));assert(frontend.includes("caja_conciliacion_bancaria_procesar"));assert(frontend.includes("caja_conciliacion_bancaria_resolver"));assert(frontend.includes("file.size>8*1024*1024"));new Function(frontend);
console.log('✓ Conciliación bancaria: clasificación, ventana T+1, cruce, aislamiento de Caja e integración UI OK');
