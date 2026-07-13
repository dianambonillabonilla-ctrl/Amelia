const AMELIA = Object.freeze({
  NAME: 'Amelia Inventarios',
  VERSION: '1.0.0',
  TIMEZONE: 'America/Bogota',
  DB_PROPERTY: 'AMELIA_DB_ID',
  UPLOAD_FOLDER_PROPERTY: 'AMELIA_UPLOAD_FOLDER_ID',
  AUTH_SALT_PROPERTY: 'AMELIA_AUTH_SALT',
  SESSION_HOURS: 24,
  MAX_UPLOAD_BYTES: 10 * 1024 * 1024,
  ROLES: Object.freeze({ ADMIN: 'ADMIN', MANAGER: 'MANAGER', COUNTER: 'COUNTER', VIEWER: 'VIEWER' }),
  LOCATION_ALL: '*'
});

const TABLES = Object.freeze({
  Users: ['userId','email','name','role','locations','active','pinHash','createdAt','updatedAt'],
  Sessions: ['sessionId','tokenHash','userId','expiresAt','createdAt'],
  Locations: ['locationId','name','active','createdAt'],
  Items: ['itemId','name','category','baseUnit','active','minimumStock','notes','createdAt','updatedAt'],
  Recipes: ['recipeId','name','type','outputItemId','outputQty','outputUnit','active','notes','createdAt','updatedAt'],
  RecipeLines: ['lineId','recipeId','itemId','qty','unit','optional','source','createdAt'],
  Aliases: ['aliasId','source','externalName','normalizedName','entityType','entityId','active','createdAt'],
  Movements: ['movementId','date','timestamp','locationId','itemId','type','qty','unit','provider','documentNo','unitCost','totalCost','referenceType','referenceId','reason','source','userId','createdAt'],
  Counts: ['countId','countDate','timestamp','locationId','itemId','qty','unit','difference','source','userId','createdAt'],
  Imports: ['importId','reportDate','sourceType','fileName','fileHash','originalFileId','convertedFileId','status','rowsRead','rowsImported','pendingRows','unmappedRows','notes','userId','createdAt'],
  Sales: ['saleLineId','importId','saleId','documentNo','saleDate','createdAtSource','locationId','saleStatus','productName','category','qty','cancelled','mappingType','mappingId','source','createdAt'],
  SaleModifiers: ['modifierLineId','importId','saleId','saleDate','locationId','parentProduct','groupName','modifierName','qty','cancelled','mappingType','mappingId','source','createdAt'],
  Alerts: ['alertId','date','locationId','severity','type','title','detail','status','referenceType','referenceId','source','createdAt','resolvedAt','resolvedBy'],
  AuditLog: ['auditId','timestamp','userId','action','entityType','entityId','detail','createdAt'],
  Settings: ['key','value','updatedAt']
});

const MOVEMENT_TYPES = Object.freeze({
  PURCHASE: 'PURCHASE',
  PRODUCTION_INPUT: 'PRODUCTION_INPUT',
  PRODUCTION_OUTPUT: 'PRODUCTION_OUTPUT',
  TRANSFER_OUT: 'TRANSFER_OUT',
  TRANSFER_IN: 'TRANSFER_IN',
  WASTE: 'WASTE',
  ADJUSTMENT: 'ADJUSTMENT',
  COUNT_ADJUSTMENT: 'COUNT_ADJUSTMENT',
  SALE: 'SALE'
});

function movementSign_(type) {
  return [MOVEMENT_TYPES.PRODUCTION_INPUT, MOVEMENT_TYPES.TRANSFER_OUT,
    MOVEMENT_TYPES.WASTE, MOVEMENT_TYPES.SALE].indexOf(type) >= 0 ? -1 : 1;
}
