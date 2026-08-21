/* DILANA OS — Caja / Conciliación bancaria V1 */
(function(){
  'use strict';
  const $=id=>document.getElementById(id);
  if(!$('conciliacion-banco-procesar'))return;

  const estado=$('conciliacion-banco-estado');
  const fecha=$('conciliacion-banco-fecha');
  const sede=$('conciliacion-banco-sede');
  const archivo=$('conciliacion-banco-archivo');
  const btnProcesar=$('conciliacion-banco-procesar');
  const btnLimpiar=$('conciliacion-banco-limpiar');
  const moneda=n=>Number(n||0).toLocaleString('es-CO',{style:'currency',currency:'COP',maximumFractionDigits:0});
  const norm=s=>String(s??'').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/\s+/g,' ');

  function estado_(texto,tipo){
    estado.textContent=texto;
    estado.className='estado'+(tipo?' '+tipo:'');
  }

  async function bancoApi_(action,params={}){
    const body=Object.assign({action,token:Sesion.token()},params);
    const controlador=new AbortController();
    const limite=setTimeout(()=>controlador.abort(),65000);
    try{
      const res=await fetch(API_URL,{method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify(body),signal:controlador.signal});
      const txt=await res.text();
      try{return JSON.parse(txt);}catch(e){return{ok:false,error:'El servidor respondió algo que no se pudo leer.'};}
    }catch(e){
      return{ok:false,error:e.name==='AbortError'?'La conciliación tardó demasiado. Inténtalo de nuevo.':'No se pudo conectar con el servidor.'};
    }finally{clearTimeout(limite);}
  }

  function cargarSheetJs_(){
    if(window.XLSX)return Promise.resolve();
    return new Promise((resolve,reject)=>{
      const previo=document.querySelector('script[data-dilana-xlsx]');
      if(previo){previo.addEventListener('load',resolve,{once:true});previo.addEventListener('error',()=>reject(new Error('No se pudo cargar el lector de Excel.')),{once:true});return;}
      const s=document.createElement('script');s.src='https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';s.async=true;s.dataset.dilanaXlsx='1';s.onload=resolve;s.onerror=()=>reject(new Error('No se pudo cargar el lector de Excel. Revisa la conexión.'));document.head.appendChild(s);
    });
  }

  function numero_(v){
    if(typeof v==='number')return Number.isFinite(v)?v:0;
    let s=String(v??'').trim().replace(/\s/g,'').replace(/\$/g,'');if(!s)return 0;
    if(/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(s))s=s.replace(/\./g,'').replace(',','.');
    else if(/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(s))s=s.replace(/,/g,'');
    else if(s.includes(',')&&!s.includes('.'))s=s.replace(',','.');
    const n=Number(s.replace(/[^0-9.-]/g,''));return Number.isFinite(n)?n:0;
  }

  function fecha_(v){
    if(!v)return '';
    if(v instanceof Date&&!isNaN(v))return `${v.getFullYear()}-${String(v.getMonth()+1).padStart(2,'0')}-${String(v.getDate()).padStart(2,'0')}`;
    const s=String(v).trim();let m=s.match(/^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})/);if(m)return `${m[1]}-${String(m[2]).padStart(2,'0')}-${String(m[3]).padStart(2,'0')}`;
    m=s.match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{4})/);if(m)return `${m[3]}-${String(m[2]).padStart(2,'0')}-${String(m[1]).padStart(2,'0')}`;
    const d=new Date(s);return isNaN(d)?'':`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  }

  function buscarCol_(headers,pruebas,excluir=[]){
    for(let i=0;i<headers.length;i++){
      const h=norm(headers[i]);if(excluir.some(x=>h.includes(x)))continue;
      if(pruebas.some(x=>x instanceof RegExp?x.test(h):h.includes(x)))return i;
    }
    return -1;
  }

  function detectarCabecera_(filas){
    let mejor=null;
    for(let r=0;r<Math.min(filas.length,25);r++){
      const h=(filas[r]||[]).map(norm);
      const cols={
        fechaValor:buscarCol_(h,['fecha valor','fecha de valor']),
        fecha:buscarCol_(h,['fecha'],['valor']),
        descripcion:buscarCol_(h,['descripcion','descripción','concepto','detalle','movimiento','transaccion','transacción']),
        debito:buscarCol_(h,['debito','débito','cargo','retiro','egreso']),
        credito:buscarCol_(h,['credito','crédito','abono','ingreso']),
        monto:buscarCol_(h,['importe','monto','valor'],['fecha']),
        referencia:buscarCol_(h,['referencia','documento','numero','número','comprobante'])
      };
      const score=[cols.fecha,cols.fechaValor].some(x=>x>=0)?1:0;
      const total=score+(cols.descripcion>=0?2:0)+(cols.debito>=0||cols.credito>=0||cols.monto>=0?2:0);
      if(!mejor||total>mejor.score)mejor={fila:r,cols,score:total};
    }
    if(!mejor||mejor.score<4)throw new Error('No pude reconocer las columnas del extracto. Debe tener fecha, descripción/concepto y débito/crédito o valor.');
    return mejor;
  }

  function normalizarFilas_(filas){
    const cab=detectarCabecera_(filas), c=cab.cols, out=[];
    for(let i=cab.fila+1;i<filas.length;i++){
      const row=filas[i]||[];
      if(!row.some(v=>String(v??'').trim()))continue;
      const monto=c.monto>=0?numero_(row[c.monto]):0;
      const debito=c.debito>=0?Math.abs(numero_(row[c.debito])):(monto<0?Math.abs(monto):0);
      const credito=c.credito>=0?Math.abs(numero_(row[c.credito])):(monto>0?monto:0);
      const descripcion=c.descripcion>=0?String(row[c.descripcion]??'').trim():'';
      const fm=c.fecha>=0?fecha_(row[c.fecha]):'';
      const fv=c.fechaValor>=0?fecha_(row[c.fechaValor]):'';
      if(!descripcion&&!debito&&!credito&&!fm&&!fv)continue;
      out.push({fecha_movimiento:fm,fecha_valor:fv,descripcion,debito:Number(debito.toFixed(2)),credito:Number(credito.toFixed(2)),valor:Number((credito-debito).toFixed(2)),referencia:c.referencia>=0?String(row[c.referencia]??'').trim():'',fila_origen:i+1});
    }
    if(!out.length)throw new Error('El archivo no contiene movimientos después de la cabecera.');
    if(out.length>5000)throw new Error('El archivo tiene más de 5.000 movimientos. Acota el periodo antes de cargarlo.');
    return out;
  }

  async function archivoBase64_(file){
    if(file.size>8*1024*1024)throw new Error('El archivo bancario no puede superar 8 MB.');
    return new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>{const b=String(r.result||'').split(',')[1];if(!b)reject(new Error('No se pudo leer el archivo.'));else resolve(b);};r.onerror=()=>reject(new Error('No se pudo leer el archivo.'));r.readAsDataURL(file);});
  }

  async function leerExtracto_(file){
    if(!/\.(xls|xlsx|csv)$/i.test(file.name))throw new Error('Selecciona un archivo .xls, .xlsx o .csv.');
    await cargarSheetJs_();
    const ab=await file.arrayBuffer();
    const wb=XLSX.read(ab,{type:'array',cellDates:true});
    if(!wb.SheetNames.length)throw new Error('El archivo no contiene hojas.');
    const filas=XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]],{header:1,defval:'',raw:false,dateNF:'yyyy-mm-dd'});
    return normalizarFilas_(filas);
  }

  function limpiarVista_(){
    ['conciliacion-fudo-total','conciliacion-banco-total','conciliacion-coincide-total','conciliacion-diferencia-total'].forEach(id=>$(id).textContent='$0');
    $('conciliacion-banco-movimientos').innerHTML='<tr><td colspan="6" class="vacio">Carga un archivo para ver los movimientos bancarios.</td></tr>';
    $('conciliacion-banco-cruce').innerHTML='<tr><td colspan="7" class="vacio">Todavía no hay una conciliación procesada.</td></tr>';
    $('conciliacion-banco-pendientes').innerHTML='<tr><td colspan="6" class="vacio">Sin pendientes cargados.</td></tr>';
    estado_('Sin archivo cargado');
  }

  const claseBanco_={BRE_B:'Bre-B',QR:'QR',TRANSFERENCIA:'Transferencia',REVERSO:'Reverso',IMPUESTO_COMISION:'Impuesto / comisión',SALIDA:'Salida',OTRO_INGRESO:'Otro ingreso',NO_IDENTIFICADO:'No identificado'};
  function pintar_(data){
    const r=data.resumen||{};
    $('conciliacion-fudo-total').textContent=moneda(r.total_fudo);
    $('conciliacion-banco-total').textContent=moneda(r.total_banco);
    $('conciliacion-coincide-total').textContent=moneda(r.total_conciliado);
    $('conciliacion-diferencia-total').textContent=(Number(r.diferencia)>0?'+':'')+moneda(r.diferencia);
    estado_(r.estado==='CUADRA'?'✓ Conciliación cuadrada':`⚠ ${Number(r.cantidad_pendientes)||0} pendiente(s)`,r.estado==='CUADRA'?'ok':'');
    const banco=data.movimientos_banco||[];
    $('conciliacion-banco-movimientos').innerHTML=banco.length?banco.map(m=>`<tr>
      <td>${escapeHtml(m.fecha_movimiento||m.fecha_valor||'—')}</td><td>${escapeHtml(m.descripcion||'—')}</td>
      <td>${m.debito?moneda(m.debito):'—'}</td><td>${m.credito?moneda(m.credito):'—'}</td>
      <td>${escapeHtml(claseBanco_[m.clasificacion]||m.clasificacion||'—')}</td><td>${m.elegible?'<span class="badge ok">Participa</span>':'<span class="badge">Excluido</span>'}</td>
    </tr>`).join(''):'<tr><td colspan="6" class="vacio">Sin movimientos.</td></tr>';
    const cruces=data.cruces||[];
    $('conciliacion-banco-cruce').innerHTML=cruces.length?cruces.map(c=>`<tr>
      <td>${escapeHtml(c.fecha||c.banco_fecha||'—')}</td><td>${escapeHtml(c.sede||'—')}</td><td>${escapeHtml(c.metodo_fudo||c.medio_fudo||'—')}</td>
      <td>${c.valor_fudo?moneda(c.valor_fudo):'—'}</td><td>${escapeHtml(c.banco_descripcion||c.banco_referencia||'—')}</td><td>${c.valor_banco?moneda(c.valor_banco):'—'}</td>
      <td>${c.resultado==='CONCILIADO_POR_MONTO'?'<span class="badge ok">Conciliado</span>':`<span class="badge advertencia">${escapeHtml(c.resultado||'Pendiente')}</span>`}</td>
    </tr>`).join(''):'<tr><td colspan="7" class="vacio">Sin cruces para mostrar.</td></tr>';
    const pendientes=data.pendientes||[];
    $('conciliacion-banco-pendientes').innerHTML=pendientes.length?pendientes.map(p=>`<tr>
      <td>${escapeHtml(p.tipo||'')}</td><td>${escapeHtml(p.fecha||'—')}</td><td>${escapeHtml(p.referencia||'—')}</td><td>${moneda(p.valor)}</td><td>${escapeHtml(p.detalle||'')}</td>
      <td><button class="btn fantasma conc-banco-resolver" data-id="${escapeHtml(p.id_detalle||'')}">Marcar revisado</button></td>
    </tr>`).join(''):'<tr><td colspan="6" class="vacio">✓ No hay pendientes sin revisar.</td></tr>';
    document.querySelectorAll('.conc-banco-resolver').forEach(b=>b.addEventListener('click',async()=>{
      const nota=prompt('Escribe cómo se resolvió o verificó este pendiente:');if(!nota||!nota.trim())return;
      b.disabled=true;const resp=await bancoApi_('caja_conciliacion_bancaria_resolver',{id_detalle:b.dataset.id,nota:nota.trim()});b.disabled=false;
      if(!resp.ok){alert(resp.error||'No se pudo marcar el pendiente.');return;}avisarGuardado('Pendiente de conciliación revisado.');await cargarUltima_();
    }));
  }

  async function cargarUltima_(){
    if(!fecha.value)return;
    estado_('Consultando…');
    const r=await bancoApi_('caja_conciliacion_bancaria_ultima',{fecha:fecha.value,sede:sede.value});
    if(!r.ok){estado_('No se pudo consultar','error');return;}
    if(!r.encontrada){limpiarVista_();estado_('Sin conciliación para esta fecha');return;}
    pintar_(r);
  }

  btnProcesar.addEventListener('click',conBotonProtegido(btnProcesar,async()=>{
    const file=archivo.files[0];if(!file){alert('Selecciona el archivo descargado del banco.');return;}
    if(!fecha.value){alert('Selecciona la fecha que quieres conciliar.');return;}
    estado_('Leyendo extracto…');
    try{
      const [movimientos,base64]=await Promise.all([leerExtracto_(file),archivoBase64_(file)]);
      estado_('Cruzando con FUDO…');
      const r=await bancoApi_('caja_conciliacion_bancaria_procesar',{fecha:fecha.value,sede:sede.value,movimientos,archivo:{nombre:file.name,mime_type:file.type||'application/octet-stream',contenido_base64:base64}});
      if(!r.ok){estado_('Error al conciliar','error');alert(r.error||'No se pudo procesar el extracto.');return;}
      pintar_(r);avisarGuardado(r.archivo_guardado?'Conciliación guardada y archivo bancario adjuntado.':'Conciliación guardada.');
    }catch(e){estado_('No se pudo procesar','error');alert(e.message||String(e));}
  }));

  btnLimpiar.addEventListener('click',()=>{archivo.value='';limpiarVista_();});
  fecha.addEventListener('change',cargarUltima_);sede.addEventListener('change',cargarUltima_);
  fecha.value=(typeof fechaEl!=='undefined'&&fechaEl&&fechaEl.value)||fechaLocalHoy_();
  const sedeCaja=(typeof sedeEl!=='undefined'&&sedeEl&&sedeEl.value)||'Todas';
  if(Array.from(sede.options).some(o=>o.value===sedeCaja))sede.value=sedeCaja;
  cargarUltima_();
})();
