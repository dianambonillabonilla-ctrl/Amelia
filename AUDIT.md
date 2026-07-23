# Auditoría técnica — Dilana OS

Fecha: 2026-07-15

## Alcance

Se revisaron los flujos principales del repositorio:

- Entrada HTTP del Web App de Google Apps Script.
- Autenticación, sesiones, roles y usuarios.
- Renderizado dinámico del frontend con `innerHTML`.
- Configuración del frontend y despliegue con Apps Script/clasp.
- Pruebas automatizadas disponibles.

## Hallazgos y acciones

### 1. Acciones sensibles disponibles por GET

**Severidad:** media

El backend aceptaba parámetros de `e.parameter` tanto en `doGet` como en `doPost`. Aunque el frontend usa `POST`, un usuario podía invocar acciones como `login` por URL si conocía el endpoint. Eso expone credenciales o tokens en historial del navegador, logs, proxies o herramientas de diagnóstico.

**Acción aplicada:** `doGet` ahora queda limitado a una comprobación de salud (`health` o sin acción). Cualquier otra acción por GET responde `METODO_NO_PERMITIDO` y exige usar POST para acciones autenticadas o con credenciales.

### 2. Configuración de ambiente poco documentada

**Severidad:** baja

La URL de Apps Script vive en `assets/config.js`, lo cual es normal para un frontend estático, pero necesitaba documentación para evitar confundir ambientes o pegar secretos en archivos públicos.

**Acción aplicada:** se agregó documentación de configuración en `README.md`, una plantilla `assets/config.example.js` y una advertencia explícita en `assets/config.js`.

### 3. Uso extendido de `innerHTML`

**Severidad:** baja/media, según el campo renderizado

El frontend usa `innerHTML` en varias pantallas. La revisión encontró que los campos libres provenientes del backend se escapan mediante `escapeHtml()` en los puntos revisados. El riesgo principal es mantener esa disciplina en cambios futuros.

**Acción recomendada:** conservar la regla de que todo dato editable o importado pase por `escapeHtml()` antes de entrar a `innerHTML`. Para cambios grandes, considerar migrar tablas críticas a creación de nodos DOM (`textContent`) o agregar tests/linting específicos para renderizado seguro.

### 4. Contraseñas y roles

**Severidad:** informativa

El backend ya incluye sal por usuario, migración desde hashes antiguos, mínimo de contraseña, bloqueo temporal por intentos fallidos y validaciones de rol para acciones administrativas.

**Acción recomendada:** si Apps Script lo permite dentro de tiempos aceptables, aumentar progresivamente `HASH_ITERACIONES` o migrar a un backend que soporte Argon2/bcrypt/scrypt nativo si la aplicación crece en criticidad.

## Comandos ejecutados

```bash
npm test
rg -n "innerHTML|outerHTML|insertAdjacentHTML|eval\(|new Function|localStorage|password|token|doGet|doPost|ContentService|TextOutput|setMimeType|JSON.parse" -g '!node_modules/**'
rg -n "function requiereAdmin|trasladoResolver|usuarioGuardar|usuariosListar|function .*_\(" apps-script/Usuarios.gs apps-script/Traslados.gs apps-script/*.gs
```

## Resultado

La corrección principal de esta auditoría fue cerrar el uso de GET para acciones sensibles. Las pruebas automatizadas existentes pasan después del cambio.
