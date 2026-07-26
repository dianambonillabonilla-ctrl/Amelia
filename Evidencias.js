/**
 * EVIDENCIAS — fotos de pesaje, facturas, etc. en Google Drive.
 * Carpeta "Dilana OS — Evidencias" creada automáticamente la primera vez.
 * Los archivos quedan PRIVADOS (solo el script y quienes tengan acceso directo en Drive).
 * La app web los sirve vía evidencia_obtener con sesión válida — no enlaces públicos.
 */

const EVIDENCIA_CARPETA_NOMBRE_ = 'Dilana OS — Evidencias';
const EVIDENCIA_CARPETA_PROP_ = 'EVIDENCIA_DRIVE_FOLDER_ID';
const EVIDENCIA_TAMANO_MAX_BYTES_ = 8 * 1024 * 1024;
const EVIDENCIA_MIMES_PERMITIDOS_ = {
  'image/jpeg': true,
  'image/png': true,
  'application/pdf': true
};

function evidenciaObtenerCarpeta_() {
  const props = PropertiesService.getScriptProperties();
  const idGuardado = props.getProperty(EVIDENCIA_CARPETA_PROP_);
  if (idGuardado) {
    try {
      return DriveApp.getFolderById(idGuardado);
    } catch (e) {
      props.deleteProperty(EVIDENCIA_CARPETA_PROP_);
    }
  }
  const existentes = DriveApp.getFoldersByName(EVIDENCIA_CARPETA_NOMBRE_);
  const carpeta = existentes.hasNext() ? existentes.next() : DriveApp.createFolder(EVIDENCIA_CARPETA_NOMBRE_);
  props.setProperty(EVIDENCIA_CARPETA_PROP_, carpeta.getId());
  return carpeta;
}

function evidenciaBytesEmpiezanCon_(bytes, firma) {
  if (bytes.length < firma.length) return false;
  for (let i = 0; i < firma.length; i++) {
    if ((bytes[i] & 0xFF) !== firma[i]) return false;
  }
  return true;
}

/** Detecta el tipo real por firma mágica — no confía en el MIME que envía el navegador. */
function evidenciaDetectarMime_(bytes) {
  if (evidenciaBytesEmpiezanCon_(bytes, [0xFF, 0xD8, 0xFF])) return 'image/jpeg';
  if (evidenciaBytesEmpiezanCon_(bytes, [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])) return 'image/png';
  if (evidenciaBytesEmpiezanCon_(bytes, [0x25, 0x50, 0x44, 0x46])) return 'application/pdf';
  return '';
}

function evidenciaEsArchivoDeCarpeta_(file, carpeta) {
  const parents = file.getParents();
  while (parents.hasNext()) {
    if (parents.next().getId() === carpeta.getId()) return true;
  }
  return false;
}

/**
 * Sube un archivo desde base64 (enviado por el frontend vía JSON).
 * archivo: { nombre, mime_type, contenido_base64 }
 */
function evidenciaSubir_(archivo) {
  if (!archivo || !archivo.contenido_base64) return { ok: false, error: 'Falta el contenido del archivo' };
  const nombre = String(archivo.nombre || 'evidencia.jpg').replace(/[/\\?%*:|"<>]/g, '-').slice(0, 120);
  let bytes;
  try {
    bytes = Utilities.base64Decode(archivo.contenido_base64);
  } catch (e) {
    return { ok: false, error: 'No se pudo leer el archivo — formato inválido' };
  }
  if (bytes.length > EVIDENCIA_TAMANO_MAX_BYTES_) {
    return { ok: false, error: 'El archivo es demasiado grande (máx. 8 MB)' };
  }
  const mimeDetectado = evidenciaDetectarMime_(bytes);
  if (!mimeDetectado || !EVIDENCIA_MIMES_PERMITIDOS_[mimeDetectado]) {
    return { ok: false, error: 'Tipo de archivo no permitido — solo JPEG, PNG o PDF' };
  }
  const blob = Utilities.newBlob(bytes, mimeDetectado, nombre);
  const file = evidenciaObtenerCarpeta_().createFile(blob);
  // Sin setSharing: el archivo queda privado; se abre con evidencia_obtener y sesión válida.
  const ref = 'evidencia:' + file.getId();
  return { ok: true, url: ref, id: file.getId() };
}

/** Devuelve el contenido de una evidencia ya subida (solo si está en la carpeta del sistema). */
function evidenciaObtener_(fileId) {
  if (!fileId) return { ok: false, error: 'Falta el identificador del archivo' };
  const carpeta = evidenciaObtenerCarpeta_();
  let file;
  try {
    file = DriveApp.getFileById(String(fileId));
  } catch (e) {
    return { ok: false, error: 'Archivo no encontrado' };
  }
  if (!evidenciaEsArchivoDeCarpeta_(file, carpeta)) {
    return { ok: false, error: 'No tienes permiso para ver este archivo' };
  }
  const bytes = file.getBlob().getBytes();
  if (bytes.length > EVIDENCIA_TAMANO_MAX_BYTES_) {
    return { ok: false, error: 'El archivo es demasiado grande' };
  }
  const mimeDetectado = evidenciaDetectarMime_(bytes);
  if (!mimeDetectado || !EVIDENCIA_MIMES_PERMITIDOS_[mimeDetectado]) {
    return { ok: false, error: 'Tipo de archivo no permitido' };
  }
  return {
    ok: true,
    mime_type: mimeDetectado,
    contenido_base64: Utilities.base64Encode(bytes),
    nombre: file.getName()
  };
}