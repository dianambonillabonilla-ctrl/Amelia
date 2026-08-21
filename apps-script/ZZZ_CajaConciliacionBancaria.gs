/**
 * DILANA OS — Caja / Conciliación bancaria V1
 *
 * Alcance: Bre-B, QR y transferencias contra pagos FUDO. No toca arqueo, aperturas,
 * cierres, caja operativa ni caja fuerte. Conserva el archivo original en Drive y
 * guarda un rastro auditable de cada conciliación.
 */

const CAJA_CONC_BANCO_RESUMEN_ = 'Caja_Conciliacion_Bancaria';
const CAJA_CONC_BANCO_DETALLE_ = 'Caja_Conciliacion_Detalle';
const CAJA_CONC_BANCO_FOLDER_ = 'DILANA OS - Conciliaciones bancarias';
const CAJA_CONC_BANCO_MAX_FILAS_ = 5000;
const CAJA_CONC_BANCO_MAX_BYTES_ = 8 * 1024 * 1024;

/**
 * Extensión autoritativa del POST. El proyecto ya usa archivos ZZ/ZZZ para sobreponer la
 * capa de reactivación sin reescribir el router central. Solo intercepta estas tres acciones;
 * todo lo demás sigue exactamente por handleRequest_.
 */
function doPost(e) {
  let params = {};
  try { params = JSON.parse((e && e.postData && e.postData.contents) || '{}'); }
  catch (err) { return handleRequest_(e, 'POST'); }
  const action = String(params.action || '');
  if (action.indexOf('caja_conciliacion_bancaria_') !== 0) return handleRequest_(e, 'POST');
  try {
    const sesion = validarToken_(params.token);
    if (!sesion.ok) return jsonOut_(sesion);
    if (!sesion.usuario || sesion.usuario.rol !== 'Administrador') {
      return jsonOut_({ ok:false, codigo:'SIN_PERMISO', error:'La conciliación bancaria solo está disponible para Administrador.' });
    }
    if (action === 'caja_conciliacion_bancaria_procesar') {
      return jsonOut_(cajaConcBancoProcesar_(params, sesion.usuario));
    }
    if (action === 'caja_conciliacion_bancaria_ultima') {
      return jsonOut_(cajaConcBancoUltima_(params, sesion.usuario));
    }
    if (action === 'caja_conciliacion_bancaria_resolver') {
      return jsonOut_(cajaConcBancoResolver_(params, sesion.usuario));
    }
    return jsonOut_({ ok:false, error:'Acción de conciliación bancaria desconocida: ' + action });
  } catch (err) {
    console.error('Conciliación bancaria:', err && err.stack ? err.stack : err);
    return jsonOut_({ ok:false, error:err && err.message ? err.message : String(err) });
  }
}

function cajaConcBancoNormalizar_(valor) {
  return String(valor === null || valor === undefined ? '' : valor).trim().toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ');
}

function cajaConcBancoNumero_(valor) {
  if (typeof valor === 'number') return isFinite(valor) ? valor : 0;
  let s = String(valor === null || valor === undefined ? '' : valor).trim();
  if (!s) return 0;
  s = s.replace(/\s/g, '').replace(/\$/g, '');
  if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
  else if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) s = s.replace(/,/g, '');
  else if (s.indexOf(',') !== -1 && s.indexOf('.') === -1) s = s.replace(',', '.');
  const n = Number(s.replace(/[^0-9.-]/g, ''));
  return isFinite(n) ? n : 0;
}

function cajaConcBancoFecha_(valor) {
  if (!valor) return '';
  if (Object.prototype.toString.call(valor) === '[object Date]' && !isNaN(valor.getTime())) {
    return Utilities.formatDate(valor, Session.getScriptTimeZone() || 'America/Bogota', 'yyyy-MM-dd');
  }
  const s = String(valor).trim();
  let m = s.match(/^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})/);
  if (m) return m[1] + '-' + String(m[2]).padStart(2,'0') + '-' + String(m[3]).padStart(2,'0');
  m = s.match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{4})/);
  if (m) return m[3] + '-' + String(m[2]).padStart(2,'0') + '-' + String(m[1]).padStart(2,'0');
  const d = new Date(s);
  if (!isNaN(d.getTime())) return Utilities.formatDate(d, Session.getScriptTimeZone() || 'America/Bogota', 'yyyy-MM-dd');
  return '';
}

function cajaConcBancoDiaSiguiente_(fecha) {
  const p = String(fecha).split('-').map(Number);
  const d = new Date(p[0], p[1]-1, p[2]); d.setDate(d.getDate()+1);
  return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
}

function cajaConcBancoClasificarMovimiento_(mov) {
  const desc = cajaConcBancoNormalizar_(mov && mov.descripcion);
  const debito = Math.abs(cajaConcBancoNumero_(mov && mov.debito));
  const credito = Math.abs(cajaConcBancoNumero_(mov && mov.credito));
  const valorFirmado = cajaConcBancoNumero_(mov && mov.valor);
  const creditoReal = credito > 0 ? credito : (valorFirmado > 0 ? valorFirmado : 0);
  const debitoReal = debito > 0 ? debito : (valorFirmado < 0 ? Math.abs(valorFirmado) : 0);
  let clasificacion = 'NO_IDENTIFICADO', elegible = false;
  if (/revers|devol|anula|reintegro|reversion/.test(desc)) clasificacion = 'REVERSO';
  else if (/comision|iva|gmf|4x1000|4 x 1000|impuesto|gravamen|retencion|retefuente/.test(desc)) clasificacion = 'IMPUESTO_COMISION';
  else if (debitoReal > 0) clasificacion = 'SALIDA';
  else if (creditoReal > 0 && /bre[- ]?b|breb/.test(desc)) { clasificacion = 'BRE_B'; elegible = true; }
  else if (creditoReal > 0 && /\bqr\b/.test(desc)) { clasificacion = 'QR'; elegible = true; }
  else if (creditoReal > 0 && /transfer|nequi|daviplata/.test(desc)) { clasificacion = 'TRANSFERENCIA'; elegible = true; }
  else if (creditoReal > 0) clasificacion = 'OTRO_INGRESO';
  return { clasificacion:clasificacion, elegible:elegible, credito:Number(creditoReal.toFixed(2)), debito:Number(debitoReal.toFixed(2)) };
}

function cajaConcBancoMetodoFudo_(pago) {
  const texto = cajaConcBancoNormalizar_((pago && pago.metodo_pago) + ' ' + (pago && pago.metodo_tipo));
  if (/tarjeta|card|visa|master|amex|datafono|datofono/.test(texto)) return { elegible:false, medio:'TARJETA' };
  if (/bre[- ]?b|breb/.test(texto)) return { elegible:true, medio:'BRE_B' };
  if (/\bqr\b/.test(texto)) return { elegible:true, medio:'QR' };
  if (/transfer|nequi|daviplata/.test(texto)) return { elegible:true, medio:'TRANSFERENCIA' };
  return { elegible:false, medio:'OTRO' };
}

function cajaConcBancoCancelado_(pago) {
  const v = pago && pago.cancelado;
  return v === true || /^(true|si|sí|1)$/.test(cajaConcBancoNormalizar_(v));
}

function cajaConcBancoPagoFecha_(pago) {
  return cajaConcBancoFecha_(pago && (pago.fecha || pago.creacion || pago.paid_at || pago.paidAt));
}

function cajaConcBancoPagosFudo_(fecha, sede) {
  let filas = [];
  try { filas = leerTabla_((SHEET_NAMES && SHEET_NAMES.FUDO_PAGOS) || 'Fudo_Pagos'); } catch (e) { filas = []; }
  if (!filas.length) { try { filas = leerTabla_((SHEET_NAMES && SHEET_NAMES.PAGOS_FUDO) || 'Pagos_FUDO'); } catch (e2) { filas = []; } }
  return filas.filter(function(p){
    if (cajaConcBancoCancelado_(p)) return false;
    if (cajaConcBancoPagoFecha_(p) !== fecha) return false;
    if (sede !== 'Todas' && String(p.sede || '') !== sede) return false;
    return cajaConcBancoMetodoFudo_(p).elegible;
  }).map(function(p){
    const m = cajaConcBancoMetodoFudo_(p);
    return {
      id_pago:String(p.id_pago || ''), id_venta:String(p.id_venta || ''), fecha:cajaConcBancoPagoFecha_(p),
      creacion:String(p.creacion || p.paid_at || p.paidAt || ''), sede:String(p.sede || ''),
      medio:m.medio, metodo_pago:String(p.metodo_pago || p.metodo_tipo || ''), valor:Number(cajaConcBancoNumero_(p.monto).toFixed(2))
    };
  }).filter(function(p){ return p.valor > 0; });
}

function cajaConcBancoMovimientoEnVentana_(mov, fecha) {
  const siguiente = cajaConcBancoDiaSiguiente_(fecha);
  const f1 = cajaConcBancoFecha_(mov.fecha_movimiento);
  const f2 = cajaConcBancoFecha_(mov.fecha_valor);
  return f1 === fecha || f2 === fecha || f1 === siguiente || f2 === siguiente;
}

function cajaConcBancoClaveMonto_(n) { return Number(n || 0).toFixed(2); }

/** Cruce monetario conservador por grupos de monto. Nunca altera FUDO ni Caja. */
function cajaConcBancoCruzar_(pagosFudo, movimientosBanco, fecha) {
  const bancoClasificado = (movimientosBanco || []).map(function(m, i){
    const c = cajaConcBancoClasificarMovimiento_(m);
    return Object.assign({}, m, c, { _orden:i, fecha_movimiento:cajaConcBancoFecha_(m.fecha_movimiento), fecha_valor:cajaConcBancoFecha_(m.fecha_valor) });
  });
  const bancoElegible = bancoClasificado.filter(function(m){ return m.elegible && m.credito > 0 && cajaConcBancoMovimientoEnVentana_(m, fecha); });
  const gruposF = {}, gruposB = {};
  (pagosFudo || []).forEach(function(p){ const k=cajaConcBancoClaveMonto_(p.valor); (gruposF[k]||(gruposF[k]=[])).push(p); });
  bancoElegible.forEach(function(b){ const k=cajaConcBancoClaveMonto_(b.credito); (gruposB[k]||(gruposB[k]=[])).push(b); });
  const claves = {};
  Object.keys(gruposF).forEach(function(k){claves[k]=true;}); Object.keys(gruposB).forEach(function(k){claves[k]=true;});
  const cruces=[], pendientes=[]; let conciliado=0;
  Object.keys(claves).sort(function(a,b){return Number(a)-Number(b);}).forEach(function(k){
    const fs=(gruposF[k]||[]).slice().sort(function(a,b){return String(a.creacion||a.fecha).localeCompare(String(b.creacion||b.fecha));});
    const bs=(gruposB[k]||[]).slice().sort(function(a,b){return String(a.fecha_valor||a.fecha_movimiento).localeCompare(String(b.fecha_valor||b.fecha_movimiento));});
    const n=Math.min(fs.length,bs.length);
    for(let i=0;i<n;i++){
      const f=fs[i], b=bs[i]; conciliado+=Number(k);
      cruces.push({fecha:f.creacion||f.fecha,sede:f.sede,medio_fudo:f.medio,metodo_fudo:f.metodo_pago,valor_fudo:f.valor,id_pago:f.id_pago,
        banco_descripcion:b.descripcion||'',banco_referencia:b.referencia||'',banco_fecha:b.fecha_valor||b.fecha_movimiento,valor_banco:b.credito,resultado:'CONCILIADO_POR_MONTO'});
    }
    for(let i=n;i<fs.length;i++){
      const f=fs[i];
      cruces.push({fecha:f.creacion||f.fecha,sede:f.sede,medio_fudo:f.medio,metodo_fudo:f.metodo_pago,valor_fudo:f.valor,id_pago:f.id_pago,valor_banco:0,resultado:'FUDO_SIN_BANCO'});
      pendientes.push({tipo:'FUDO_SIN_BANCO',fecha:f.fecha,referencia:f.id_pago||f.id_venta,valor:f.valor,detalle:(f.sede||'')+' · '+(f.metodo_pago||f.medio),sede:f.sede});
    }
    for(let i=n;i<bs.length;i++){
      const b=bs[i];
      cruces.push({fecha:b.fecha_valor||b.fecha_movimiento,sede:'',medio_fudo:'',valor_fudo:0,banco_descripcion:b.descripcion||'',banco_referencia:b.referencia||'',banco_fecha:b.fecha_valor||b.fecha_movimiento,valor_banco:b.credito,resultado:'BANCO_SIN_FUDO'});
      pendientes.push({tipo:'BANCO_SIN_FUDO',fecha:b.fecha_valor||b.fecha_movimiento,referencia:b.referencia||('Fila '+(b.fila_origen||'')),valor:b.credito,detalle:b.descripcion||'',sede:''});
    }
  });
  return { movimientos_banco:bancoClasificado, banco_elegible:bancoElegible, cruces:cruces, pendientes:pendientes, total_conciliado:Number(conciliado.toFixed(2)) };
}

function cajaConcBancoAsegurarHojas_() {
  const specs = {};
  specs[CAJA_CONC_BANCO_RESUMEN_] = ['id','fecha','sede','archivo_nombre','archivo_drive_id','archivo_hash','total_fudo','total_banco','total_conciliado','diferencia','cantidad_fudo','cantidad_banco','cantidad_pendientes','estado','usuario','timestamp'];
  specs[CAJA_CONC_BANCO_DETALLE_] = ['id_detalle','conciliacion_id','seccion','orden','resultado','valor','resuelto','nota','resuelto_por','resuelto_en','payload_json'];
  const ss=ss_();
  Object.keys(specs).forEach(function(nombre){
    let sh=ss.getSheetByName(nombre); if(!sh) sh=ss.insertSheet(nombre);
    if(sh.getLastRow()===0){sh.getRange(1,1,1,specs[nombre].length).setValues([specs[nombre]]);sh.setFrozenRows(1);sh.getRange(1,1,1,specs[nombre].length).setFontWeight('bold').setBackground('#0B1F3A').setFontColor('#FFFFFF');}
    else asegurarColumnas_(sh,specs[nombre]);
  });
}

function cajaConcBancoHeaderMap_(sh) {
  const h=sh.getRange(1,1,1,sh.getLastColumn()).getValues()[0], m={}; h.forEach(function(x,i){m[String(x)]=i;}); return {headers:h,map:m};
}

function cajaConcBancoAppend_(nombre, obj) {
  const sh=ss_().getSheetByName(nombre), hm=cajaConcBancoHeaderMap_(sh);
  sh.appendRow(hm.headers.map(function(h){return obj[h]===undefined?'':obj[h];}));
}

function cajaConcBancoGuardarArchivo_(archivo) {
  if (!archivo || !archivo.contenido_base64) return {id:'',hash:''};
  const contenido=String(archivo.contenido_base64), bytes=Utilities.base64Decode(contenido);
  if(bytes.length>CAJA_CONC_BANCO_MAX_BYTES_) throw new Error('El archivo bancario supera 8 MB.');
  const nombre=String(archivo.nombre||'extracto-bancario').replace(/[\\/:*?"<>|]/g,'_');
  if(!/\.(xls|xlsx|csv)$/i.test(nombre)) throw new Error('El archivo debe ser .xls, .xlsx o .csv.');
  const mime=String(archivo.mime_type||'application/octet-stream');
  let folder; const it=DriveApp.getFoldersByName(CAJA_CONC_BANCO_FOLDER_); folder=it.hasNext()?it.next():DriveApp.createFolder(CAJA_CONC_BANCO_FOLDER_);
  const file=folder.createFile(Utilities.newBlob(bytes,mime,nombre));
  const digest=Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,bytes);
  const hash=digest.map(function(b){return ('0'+((b<0?b+256:b).toString(16))).slice(-2);}).join('');
  return {id:file.getId(),hash:hash};
}

function cajaConcBancoProcesar_(params, usuario) {
  cajaConcBancoAsegurarHojas_();
  const fecha=cajaConcBancoFecha_(params.fecha), sede=String(params.sede||'Todas');
  if(!fecha) throw new Error('Selecciona una fecha válida para conciliar.');
  if(['San Antonio','Capri','Todas'].indexOf(sede)===-1) throw new Error('Sede inválida para conciliación bancaria.');
  const movimientos=Array.isArray(params.movimientos)?params.movimientos:[];
  if(!movimientos.length) throw new Error('El archivo no contiene movimientos bancarios reconocibles.');
  if(movimientos.length>CAJA_CONC_BANCO_MAX_FILAS_) throw new Error('El archivo tiene demasiadas filas; máximo '+CAJA_CONC_BANCO_MAX_FILAS_+'.');
  const pagos=cajaConcBancoPagosFudo_(fecha,sede);
  const cruce=cajaConcBancoCruzar_(pagos,movimientos,fecha);
  const totalFudo=Number(pagos.reduce(function(a,p){return a+Number(p.valor||0);},0).toFixed(2));
  const totalBanco=Number(cruce.banco_elegible.reduce(function(a,b){return a+Number(b.credito||0);},0).toFixed(2));
  const diferencia=Number((totalBanco-totalFudo).toFixed(2));
  const evidencia=cajaConcBancoGuardarArchivo_(params.archivo);
  const id=Utilities.getUuid(), ahora=new Date();
  const estado=(Math.abs(diferencia)<0.01&&cruce.pendientes.length===0)?'CUADRA':'PENDIENTE';
  cajaConcBancoAppend_(CAJA_CONC_BANCO_RESUMEN_,{id:id,fecha:fecha,sede:sede,archivo_nombre:String(params.archivo&&params.archivo.nombre||''),archivo_drive_id:evidencia.id,archivo_hash:evidencia.hash,total_fudo:totalFudo,total_banco:totalBanco,total_conciliado:cruce.total_conciliado,diferencia:diferencia,cantidad_fudo:pagos.length,cantidad_banco:cruce.banco_elegible.length,cantidad_pendientes:cruce.pendientes.length,estado:estado,usuario:usuario.nombre||usuario.usuario,timestamp:ahora});
  let orden=0;
  cruce.movimientos_banco.forEach(function(x){cajaConcBancoAppend_(CAJA_CONC_BANCO_DETALLE_,{id_detalle:Utilities.getUuid(),conciliacion_id:id,seccion:'BANCO',orden:orden++,resultado:x.elegible?'ELEGIBLE':'EXCLUIDO',valor:x.credito||x.debito||0,resuelto:'',payload_json:JSON.stringify(x)});});
  orden=0;cruce.cruces.forEach(function(x){cajaConcBancoAppend_(CAJA_CONC_BANCO_DETALLE_,{id_detalle:Utilities.getUuid(),conciliacion_id:id,seccion:'CRUCE',orden:orden++,resultado:x.resultado,valor:x.valor_fudo||x.valor_banco||0,resuelto:'',payload_json:JSON.stringify(x)});});
  orden=0;cruce.pendientes.forEach(function(x){const did=Utilities.getUuid();x.id_detalle=did;cajaConcBancoAppend_(CAJA_CONC_BANCO_DETALLE_,{id_detalle:did,conciliacion_id:id,seccion:'PENDIENTE',orden:orden++,resultado:x.tipo,valor:x.valor||0,resuelto:'false',payload_json:JSON.stringify(x)});});
  SpreadsheetApp.flush();
  return {ok:true,conciliacion_id:id,archivo_guardado:!!evidencia.id,resumen:{fecha:fecha,sede:sede,total_fudo:totalFudo,total_banco:totalBanco,total_conciliado:cruce.total_conciliado,diferencia:diferencia,cantidad_fudo:pagos.length,cantidad_banco:cruce.banco_elegible.length,cantidad_pendientes:cruce.pendientes.length,estado:estado},movimientos_banco:cruce.movimientos_banco,cruces:cruce.cruces,pendientes:cruce.pendientes};
}

function cajaConcBancoLeerResumenes_() {
  cajaConcBancoAsegurarHojas_();
  return leerTabla_(CAJA_CONC_BANCO_RESUMEN_);
}

function cajaConcBancoUltima_(params) {
  const fecha=cajaConcBancoFecha_(params.fecha), sede=String(params.sede||'Todas');
  if(!fecha) return {ok:true,encontrada:false};
  const resumenes=cajaConcBancoLeerResumenes_().filter(function(r){return cajaConcBancoFecha_(r.fecha)===fecha&&String(r.sede)===sede;});
  if(!resumenes.length) return {ok:true,encontrada:false};
  resumenes.sort(function(a,b){return new Date(b.timestamp).getTime()-new Date(a.timestamp).getTime();});
  const r=resumenes[0], detalles=leerTabla_(CAJA_CONC_BANCO_DETALLE_).filter(function(d){return String(d.conciliacion_id)===String(r.id);});
  function payload(d){try{return Object.assign({},JSON.parse(d.payload_json||'{}'),{id_detalle:d.id_detalle,resuelto:String(d.resuelto).toLowerCase()==='true',nota:d.nota||'',resuelto_por:d.resuelto_por||'',resuelto_en:d.resuelto_en||''});}catch(e){return {};}}
  const banco=detalles.filter(function(d){return d.seccion==='BANCO';}).sort(function(a,b){return Number(a.orden)-Number(b.orden);}).map(payload);
  const cruces=detalles.filter(function(d){return d.seccion==='CRUCE';}).sort(function(a,b){return Number(a.orden)-Number(b.orden);}).map(payload);
  const pendientes=detalles.filter(function(d){return d.seccion==='PENDIENTE'&&String(d.resuelto).toLowerCase()!=='true';}).sort(function(a,b){return Number(a.orden)-Number(b.orden);}).map(payload);
  return {ok:true,encontrada:true,conciliacion_id:r.id,archivo_nombre:r.archivo_nombre||'',archivo_guardado:!!r.archivo_drive_id,resumen:{fecha:fecha,sede:sede,total_fudo:Number(r.total_fudo)||0,total_banco:Number(r.total_banco)||0,total_conciliado:Number(r.total_conciliado)||0,diferencia:Number(r.diferencia)||0,cantidad_fudo:Number(r.cantidad_fudo)||0,cantidad_banco:Number(r.cantidad_banco)||0,cantidad_pendientes:pendientes.length,estado:(Math.abs(Number(r.diferencia)||0)<0.01&&pendientes.length===0)?'CUADRA':'PENDIENTE'},movimientos_banco:banco,cruces:cruces,pendientes:pendientes};
}

function cajaConcBancoResolver_(params, usuario) {
  cajaConcBancoAsegurarHojas_();
  const id=String(params.id_detalle||''); if(!id) throw new Error('Falta el pendiente a resolver.');
  const nota=String(params.nota||'').trim(); if(!nota) throw new Error('Escribe una nota de resolución para dejar trazabilidad.');
  const sh=ss_().getSheetByName(CAJA_CONC_BANCO_DETALLE_), hm=cajaConcBancoHeaderMap_(sh), vals=sh.getDataRange().getValues(); let fila=-1, concId='';
  for(let i=1;i<vals.length;i++){if(String(vals[i][hm.map.id_detalle])===id){fila=i+1;concId=String(vals[i][hm.map.conciliacion_id]);break;}}
  if(fila<0) throw new Error('No se encontró el pendiente de conciliación.');
  if(String(sh.getRange(fila,hm.map.seccion+1).getValue())!=='PENDIENTE') throw new Error('Solo se pueden resolver filas pendientes.');
  sh.getRange(fila,hm.map.resuelto+1).setValue('true');sh.getRange(fila,hm.map.nota+1).setValue(nota);sh.getRange(fila,hm.map.resuelto_por+1).setValue(usuario.nombre||usuario.usuario);sh.getRange(fila,hm.map.resuelto_en+1).setValue(new Date());
  const pendientes=leerTabla_(CAJA_CONC_BANCO_DETALLE_).filter(function(d){return String(d.conciliacion_id)===concId&&d.seccion==='PENDIENTE'&&String(d.id_detalle)!==id&&String(d.resuelto).toLowerCase()!=='true';}).length;
  const sr=ss_().getSheetByName(CAJA_CONC_BANCO_RESUMEN_), hr=cajaConcBancoHeaderMap_(sr), rv=sr.getDataRange().getValues();
  for(let j=1;j<rv.length;j++){if(String(rv[j][hr.map.id])===concId){sr.getRange(j+1,hr.map.cantidad_pendientes+1).setValue(pendientes);const dif=Number(rv[j][hr.map.diferencia])||0;sr.getRange(j+1,hr.map.estado+1).setValue(Math.abs(dif)<0.01&&pendientes===0?'CUADRA':'PENDIENTE');break;}}
  SpreadsheetApp.flush(); return {ok:true,id_detalle:id,pendientes:pendientes};
}
