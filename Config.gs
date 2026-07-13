var APP_CONFIG = {
  APP_NAME: 'Dilana OS - Amelia',
  DB_NAME: 'Dilana OS - Base de Datos Amelia',
  DRIVE_ROOT: 'Dilana OS - Amelia',
  SESSION_HOURS: 8,
  ALERT_THRESHOLDS: {
    WARN_DIFF_PCT: 5,
    CRITICAL_DIFF_PCT: 12,
    PRICE_JUMP_PCT: 15
  },
  SHEETS: [
    { name: 'Usuarios', headers: ['id_usuario', 'codigo_usuario', 'nombre_completo', 'usuario', 'hash_password', 'salt', 'rol', 'sede_asignada', 'estado', 'debe_cambiar_password', 'correo', 'telefono', 'fecha_creacion', 'ultimo_ingreso'] },
    { name: 'Sesiones', headers: ['token', 'id_usuario', 'usuario', 'fecha_inicio', 'ultima_actividad', 'expiracion', 'estado'] },
    { name: 'Roles', headers: ['rol', 'descripcion'] },
    { name: 'Permisos', headers: ['rol', 'modulo', 'puede_ver', 'puede_crear', 'puede_editar', 'puede_aprobar'] },
    { name: 'Sedes', headers: ['id_sede', 'nombre_sede', 'tipo', 'estado'] },
    { name: 'Productos', headers: ['id_producto', 'nombre_producto', 'categoria', 'subcategoria', 'tipo_producto', 'unidad_base', 'factor_conversion', 'stock_minimo', 'stock_ideal', 'sede_habitual', 'activo', 'requiere_lote', 'requiere_foto_inventario', 'requiere_foto_produccion', 'requiere_foto_transferencia', 'observaciones'] },
    { name: 'Proveedores', headers: ['id_proveedor', 'nombre_proveedor', 'nit', 'contacto', 'telefono', 'whatsapp', 'direccion', 'categorias', 'estado', 'observaciones'] },
    { name: 'Compras', headers: ['id_compra', 'fecha', 'hora', 'id_usuario', 'proveedor', 'numero_factura', 'foto_factura_url', 'sede_entrada', 'subtotal', 'iva', 'descuento', 'total', 'estado', 'observaciones'] },
    { name: 'Detalle_Compras', headers: ['id_detalle', 'id_compra', 'id_producto', 'cantidad_comprada', 'unidad_comprada', 'cantidad_base', 'valor_total_linea', 'valor_unitario_base'] },
    { name: 'Historial_Precios', headers: ['id_historial', 'fecha', 'id_producto', 'id_proveedor', 'valor_unitario_base', 'id_compra'] },
    { name: 'Recetas_Venta', headers: ['id_receta_venta', 'producto_fudo', 'id_producto_insumo', 'cantidad_por_unidad', 'unidad', 'tipo', 'activa', 'ultima_actualizacion'] },
    { name: 'Recetas_Produccion', headers: ['id_receta_prod', 'id_producto_producido', 'id_insumo', 'cantidad_estandar', 'unidad', 'rendimiento_esperado_pct', 'merma_esperada_pct', 'activa', 'ultima_actualizacion'] },
    { name: 'Produccion_Lotes', headers: ['id_lote', 'fecha', 'hora_inicio', 'hora_fin', 'id_usuario', 'id_producto_producido', 'cantidad_esperada', 'cantidad_real', 'unidad', 'foto_url', 'merma_calculada', 'estado', 'observaciones'] },
    { name: 'Produccion_Detalle', headers: ['id_detalle', 'id_lote', 'id_insumo', 'cantidad_teorica', 'cantidad_real', 'unidad'] },
    { name: 'Transferencias', headers: ['id_transferencia', 'fecha', 'hora', 'sede_origen', 'sede_destino', 'usuario_entrega', 'usuario_recibe', 'estado', 'foto_envio_url', 'foto_recepcion_url', 'observaciones'] },
    { name: 'Transferencias_Detalle', headers: ['id_detalle', 'id_transferencia', 'id_producto', 'cantidad_enviada', 'cantidad_recibida', 'unidad', 'diferencia'] },
    { name: 'Inventario_Fisico', headers: ['id_inventario', 'fecha', 'sede', 'id_producto', 'cantidad_fisica', 'unidad', 'foto_url', 'observacion', 'responsable'] },
    { name: 'Inventario_Movimientos', headers: ['id_movimiento', 'fecha_hora', 'tipo_movimiento', 'sede', 'id_producto', 'cantidad', 'unidad', 'referencia', 'id_usuario', 'observacion'] },
    { name: 'Pesajes', headers: ['id_pesaje', 'fecha_hora', 'sede', 'id_producto', 'cantidad', 'unidad', 'foto_url', 'id_usuario', 'tipo_pesaje', 'observaciones'] },
    { name: 'Mermas', headers: ['id_merma', 'fecha_hora', 'sede', 'id_producto', 'cantidad', 'unidad', 'motivo', 'foto_url', 'id_usuario', 'valor_estimado', 'aprobado_por', 'observaciones'] },
    { name: 'Archivos_Importados', headers: ['id_archivo', 'fecha_hora', 'nombre_archivo', 'hash_archivo', 'sede', 'id_usuario', 'tipo', 'estado'] },
    { name: 'Productos_Fudo', headers: ['id_producto_fudo', 'fecha', 'categoria', 'subcategoria', 'producto', 'cantidad_vendida', 'monto_total', 'cmv', 'cmv_pct', 'markup', 'id_archivo'] },
    { name: 'Equivalencias_Fudo', headers: ['nombre_fudo', 'id_producto_interno', 'nombre_interno', 'activo', 'observacion'] },
    { name: 'Consumo_Teorico', headers: ['id_consumo', 'fecha', 'sede', 'producto_fudo', 'id_producto_insumo', 'cantidad_teorica', 'unidad', 'valor_estimado', 'id_archivo'] },
    { name: 'Auditoria_Inventario', headers: ['id_auditoria', 'fecha', 'sede', 'id_producto', 'inventario_esperado', 'inventario_real', 'diferencia', 'diferencia_pct', 'diferencia_valor', 'estado_alerta'] },
    { name: 'Alertas', headers: ['id_alerta', 'fecha_hora', 'tipo_alerta', 'nivel', 'mensaje', 'sede', 'estado', 'responsable'] },
    { name: 'Log_Auditoria', headers: ['id_log', 'fecha_hora', 'id_usuario', 'codigo_usuario', 'rol', 'sede', 'modulo', 'accion', 'entidad', 'id_entidad', 'detalle'] },
    { name: 'Configuracion', headers: ['clave', 'valor'] }
  ],
  ROLES_BASE: [
    ['GERENCIA', 'Acceso total'],
    ['ADMIN_GENERAL', 'Operacion completa y aprobaciones'],
    ['ENCARGADO_PRODUCCION', 'Centro de produccion'],
    ['ADMIN_SAN_ANTONIO', 'Operacion sede San Antonio'],
    ['ADMIN_CAPRI', 'Operacion sede Capri'],
    ['COCINA', 'Produccion y pesajes'],
    ['COMPRAS', 'Compras y proveedores'],
    ['AUDITORIA', 'Solo lectura']
  ],
  SEDES_BASE: [
    ['SEDE-CP', 'Centro Produccion', 'CENTRO', 'ACTIVO'],
    ['SEDE-SA', 'San Antonio', 'SEDE', 'ACTIVO'],
    ['SEDE-CA', 'Capri', 'SEDE', 'ACTIVO']
  ]
};
