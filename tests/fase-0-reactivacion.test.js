const fs=require('fs');
const assert=require('assert');
const {crearEntorno}=require('./helpers/entorno-apps-script.js');

const code=fs.readFileSync('apps-script/Code.gs','utf8');
const extension=fs.readFileSync('apps-script/ZZ_ReactivacionCaja.gs','utf8');
const caja=fs.readFileSync('apps-script/Caja.gs','utf8');
const config=fs.readFileSync('assets/config.js','utf8');
const cajaHtml=fs.readFileSync('caja.html','utf8');

assert(code.includes('const MODO_REACTIVACION_BACKEND = true;'));
const cajaActiva=['caja_estado','caja_abrir','caja_movimiento_registrar','caja_movimientos_listar','caja_cerrar','caja_sincronizar_ahora','caja_resumen_admin','caja_historial_listar'];
for(const action of ['login','logout','whoami','cambiar_password','usuarios_listar','usuarios_guardar','usuario_resetear_password','fudo_panel_estado','fudo_api_probar_conexion','fudo_api_sincronizar_ventas','fudo_api_sincronizar_pagos',...cajaActiva]) {
  assert((code+'\n'+extension).includes(`'${action}'`),`Falta ${action}`);
}
assert(extension.includes('ACCIONES_CAJA_PERMITIDAS_REACTIVACION_'));
assert(extension.includes("usuario && usuario.rol === 'Caja' ? 'Encargado'"));
assert(caja.includes("const CAJA_V3_VERSION_ = 'CAJA_V3'"));
assert(caja.includes('El conteo físico del cierre pasa a ser la apertura esperada del siguiente turno'));
assert(cajaHtml.includes('Qué dice FUDO y qué dice DILANA'));
assert(cajaHtml.includes('Debes recibir del cierre anterior'));
assert(config.includes("const MODULOS_ACTIVOS = ['usuarios', 'sincronizacion', 'caja', 'reservas'];"));

const env=crearEntorno({reactivacionReal:true});
env.ctx.configurarHojas();
env.ctx.crearAdministradorInicial_('Diana','diana','contrasegura1','diana@example.com');
const login=env.post({action:'login',usuario:'diana',password:'contrasegura1'});
assert.strictEqual(login.ok,true);
assert.strictEqual(env.post({action:'usuarios_listar',token:login.token}).ok,true);

const estado=env.post({action:'caja_estado',token:login.token,fecha:'2026-08-22',sede:'San Antonio'});
assert.strictEqual(estado.ok,true);
assert.strictEqual(estado.version,'CAJA_V3');
assert.strictEqual(estado.referencia_apertura.es_inicio_cero,true);

const apertura=env.post({action:'caja_abrir',token:login.token,item:{fecha:'2026-08-22',sede:'San Antonio',base_inicial:100000,caja_fuerte_inicial:0,observacion_apertura:''}});
assert.strictEqual(apertura.ok,true);

const estado2=env.post({action:'caja_estado',token:login.token,fecha:'2026-08-22',sede:'San Antonio'});
assert.strictEqual(estado2.ok,true);
assert.strictEqual(estado2.apertura.estado,'Abierto');
assert.strictEqual(estado2.apertura.base_inicial,100000);

for(const action of ['conteo_listar','produccion_registrar','traslado_crear','catalogo_listar','conciliacion']){
  const r=env.post({action,token:login.token});
  assert.strictEqual(r.ok,false);
  assert.strictEqual(r.codigo,'MODULO_INACTIVO');
}
console.log('✓ Reactivación: Caja V3 activa; resto de módulos sigue bloqueado');
