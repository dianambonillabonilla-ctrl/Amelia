/**
 * EVIDENCIAS — fotos de pesaje, facturas, etc. en Google Drive.
 * Carpeta "Dilana OS — Evidencias" creada automáticamente la primera vez.
 * Cada archivo queda con enlace de solo lectura para quien tenga la URL.
 */

const EVIDENCIA_CARPETA_NOMBRE_ = 'Dilana OS — Evidencias';
const EVIDENCIA_CARPETA_PROP_ = 'EVIDENCIA_DRIVE_FOLDER_ID';
const EVIDENCIA_TAMANO_MAX_BYTES_ = 8 * 1024 * 1024;

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

/**
 * Sube un archivo desde base64 (enviado por el frontend vía JSON).
 * archivo: { nombre, mime_type, contenido_base64 }
 */
function evidenciaSubir_(archivo) {
  if (!archivo || !archivo.contenido_base64) return { ok: false, error: 'Falta el contenido del archivo' };
  const nombre = String(archivo.nombre || 'evidencia.jpg').replace(/[/\\?%*:|"<>]/g, '-').slice(0, 120);
  const mime = archivo.mime_type || 'image/jpeg';
  let bytes;
  try {
    bytes = Utilities.base64Decode(archivo.contenido_base64);
  } catch (e) {
    return { ok: false, error: 'No se pudo leer el archivo — formato inválido' };
  }
  if (bytes.length > EVIDENCIA_TAMANO_MAX_BYTES_) {
    return { ok: false, error: 'El archivo es demasiado grande (máx. 8 MB)' };
  }
  const blob = Utilities.newBlob(bytes, mime, nombre);
  const file = evidenciaObtenerCarpeta_().createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return { ok: true, url: file.getUrl(), id: file.getId() };
}
