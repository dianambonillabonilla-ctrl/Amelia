function setupApplication() {
  const result = withLock_(function() {
    const props = PropertiesService.getScriptProperties();
    let db;
    let created = false;
    const existingId = props.getProperty(AMELIA.DB_PROPERTY);
    if (existingId) db = SpreadsheetApp.openById(existingId);
    else {
      db = SpreadsheetApp.create(AMELIA.NAME + ' - Base de datos');
      props.setProperty(AMELIA.DB_PROPERTY, db.getId());
      created = true;
    }
    Object.keys(TABLES).forEach(function(name) { ensureTable_(db, name, TABLES[name]); });
    const defaultSheet = db.getSheetByName('Hoja 1') || db.getSheetByName('Sheet1');
    if (defaultSheet && Object.keys(TABLES).indexOf(defaultSheet.getName()) < 0) db.deleteSheet(defaultSheet);
    seedLocations_();
    seedItems_();
    seedRecipes_();
    seedAliases_();
    upsertRow_('Settings', 'key', { key: 'version', value: AMELIA.VERSION, updatedAt: nowIso_() });
    upsertRow_('Settings', 'key', { key: 'timezone', value: AMELIA.TIMEZONE, updatedAt: nowIso_() });
    let adminPin = null;
    if (!getRows_('Users').length) {
      adminPin = String(Math.floor(100000 + Math.random() * 900000));
      const email = Session.getEffectiveUser().getEmail() || 'admin@amelia.local';
      appendRow_('Users', {
        userId: 'usr_admin', email: email, name: 'Administración', role: AMELIA.ROLES.ADMIN,
        locations: AMELIA.LOCATION_ALL, active: true, pinHash: hashSecret_(adminPin), createdAt: nowIso_(), updatedAt: nowIso_()
      });
    }
    let folderId = props.getProperty(AMELIA.UPLOAD_FOLDER_PROPERTY);
    if (!folderId) {
      const folder = DriveApp.createFolder(AMELIA.NAME + ' - Archivos cargados');
      folderId = folder.getId();
      props.setProperty(AMELIA.UPLOAD_FOLDER_PROPERTY, folderId);
    }
    return { created: created, databaseId: db.getId(), databaseUrl: db.getUrl(), uploadFolderId: folderId, adminPin: adminPin,
      message: adminPin ? 'Configuración terminada. Guarda el PIN inicial: ' + adminPin : 'La aplicación ya estaba configurada.' };
  });
  console.log(result.message);
  console.log('Base de datos: ' + result.databaseUrl);
  return result;
}

function seedLocations_() {
  [['capri','Capri'],['san_antonio','San Antonio'],['centro_produccion','Centro de Producción']].forEach(function(x) {
    upsertRow_('Locations', 'locationId', { locationId: x[0], name: x[1], active: true, createdAt: nowIso_() });
  });
}

function seedItems_() {
  const items = [
    ['costilla_preparada','Costilla Preparada','PRODUCCION','g'],['costilla_lista','Costilla Lista','PREPARADO','g'],
    ['panceta_preahumada','Panceta Pre-ahumada','PREPARADO','g'],['falafel','Falafel','PREPARADO','g'],
    ['papas_prefritas','Papas Pre-fritas','PREPARADO','g'],['papas_listas','Papas Listas','PREPARADO','g'],
    ['aioli','Aioli','PREPARADO','g'],['cebollita_amelia','Cebollita de Amelia','PREPARADO','g'],
    ['reduccion_balsamica','Reducción Balsámica','PREPARADO','g'],['ajo_preparado','Ajo Preparado','PREPARADO','g'],
    ['perejil_picado','Perejil Picado','PREPARADO','g'],['sal','Sal','DESPENSA','g'],
    ['limon_tahiti','Limón Tahití','MATERIA_PRIMA','g'],['papa_capira','Papa Capira','MATERIA_PRIMA','g'],
    ['cebolla_cruda','Cebolla Cruda','MATERIA_PRIMA','g'],['cebolla_pluma','Cebolla en Pluma','PREPARADO','g'],
    ['aguila_light','Águila Light 330 ml','BEBIDA','u'],['cc_dorada','CC Dorada 330 ml','BEBIDA','u'],
    ['poker','Poker','BEBIDA','u'],['stella','Stella Artois 330 ml','BEBIDA','u'],
    ['torre_anturio','Torre Anturio','BEBIDA','u'],['torre_camelia','Torre Camelia','BEBIDA','u'],
    ['torre_tangara','Torre Tangara','BEBIDA','u'],['torre_magnolia','Torre Magnolia','BEBIDA','u'],
    ['torre_silvana','Torre Silvana','BEBIDA','u'],['agua_mineral','Agua Mineral 500 ml','BEBIDA','u'],
    ['coca_original_350','Coca-Cola Original 350 ml','BEBIDA','u'],['coca_zero_350','Coca-Cola Zero 350 ml','BEBIDA','u'],
    ['coca_original_10','Coca-Cola Original 10 oz','BEBIDA','u'],['coca_zero_10','Coca-Cola Zero 10 oz','BEBIDA','u'],
    ['ginger_ale','Ginger Ale 240 ml','BEBIDA','u'],['soda','Soda 350 ml','BEBIDA','u'],['kefir','Kefir 240 ml','BEBIDA','u'],
    ['sirope_naranja','Sirope Naranja','PREPARADO','g'],['sirope_panela','Sirope Panela','PREPARADO','g'],
    ['torta_maracuya','Porción cheesecake maracuyá','POSTRE','u'],['torta_frutos_rojos','Porción cheesecake frutos rojos','POSTRE','u'],
    ['torta_chocolate','Porción torta de chocolate','POSTRE','u'],['torta_zanahoria','Porción torta de zanahoria','POSTRE','u'],
    ['torta_banano','Porción torta de banano','POSTRE','u'],['salsa_arequipe','Salsa de arequipe','WAFFLERIA','g'],
    ['salsa_chocolate','Salsa de chocolate','WAFFLERIA','g'],['helado_arequipe','Helado de arequipe','WAFFLERIA','g'],
    ['helado_chocolate','Helado de chocolate','WAFFLERIA','g'],['helado_vainilla','Helado de vainilla','WAFFLERIA','g'],
    ['helado_frutos_rojos','Helado de frutos rojos','WAFFLERIA','g'],['banano','Banano','WAFFLERIA','g'],
    ['durazno','Durazno','WAFFLERIA','g'],['fresa','Fresa','WAFFLERIA','g'],['milo','Milo','WAFFLERIA','g'],
    ['mezcla_pandebono','Mezcla pandebono','WAFFLERIA','u'],['waffle_clasico','Waffle clásico','WAFFLERIA','u']
  ];
  items.forEach(function(x) {
    upsertRow_('Items', 'itemId', { itemId: x[0], name: x[1], category: x[2], baseUnit: x[3], active: true,
      minimumStock: 0, notes: '', createdAt: nowIso_(), updatedAt: nowIso_() });
  });
}

function seedRecipe_(recipe, lines) {
  upsertRow_('Recipes', 'recipeId', Object.assign({ active: true, notes: '', createdAt: nowIso_(), updatedAt: nowIso_() }, recipe));
  const existing = getRows_('RecipeLines').filter(function(r) { return r.recipeId === recipe.recipeId; });
  if (!existing.length) lines.forEach(function(line) {
    appendRow_('RecipeLines', { lineId: makeId_('rln'), recipeId: recipe.recipeId, itemId: line[0], qty: line[1], unit: line[2] || 'g',
      optional: line[3] || false, source: 'Estandarización Productos', createdAt: nowIso_() });
  });
}

function seedRecipes_() {
  seedRecipe_({ recipeId:'prod_costilla_lista', name:'Producción Costilla Lista', type:'PRODUCTION', outputItemId:'costilla_lista', outputQty:1000, outputUnit:'g' },
    [['costilla_preparada',1282.051282,'g'],['reduccion_balsamica',530,'g']]);
  seedRecipe_({ recipeId:'prod_papas_listas', name:'Producción Papas Listas', type:'PRODUCTION', outputItemId:'papas_listas', outputQty:1000, outputUnit:'g' },
    [['papas_prefritas',1754.385965,'g'],['ajo_preparado',20,'g'],['sal',10,'g'],['perejil_picado',20,'g']]);
  const menu = [
    ['menu_chanchostilla','Chanchostilla',[['costilla_lista',90],['panceta_preahumada',123.2876712],['papas_listas',100]]],
    ['menu_supremo','Supremo',[['costilla_lista',70],['falafel',68],['panceta_preahumada',82.19178082],['papas_listas',100]]],
    ['menu_costilla','Costilla',[['costilla_lista',180],['papas_listas',100]]],
    ['menu_panceta','Panceta',[['panceta_preahumada',232.8767123],['papas_listas',100]]],
    ['menu_costilafel','Costilafel',[['costilla_lista',90],['falafel',85],['papas_listas',100]]],
    ['menu_falafel','Falafel',[['falafel',187],['papas_listas',100]]],
    ['menu_chanchalafel','Chanchalafel',[['falafel',102],['panceta_preahumada',123.2876712],['papas_listas',100]]],
    ['menu_papas','Porción Papas',[['papas_listas',100]]],
    ['add_panceta','Panceta (adición)',[['panceta_preahumada',136.9863014]]],
    ['add_falafel','Falafel (adición)',[['falafel',119]]],
    ['add_aioli','Aioli de Amelia',[['aioli',30]]],
    ['add_cebollita','Cebollita de Amelia',[['cebollita_amelia',30]]]
  ];
  menu.forEach(function(x) { seedRecipe_({ recipeId:x[0], name:x[1], type:x[0].indexOf('add_')===0?'ADDITION':'MENU', outputItemId:'', outputQty:1, outputUnit:'u' }, x[2]); });
  seedRecipe_({ recipeId:'waffle_grande', name:'Arma tu waffle grande', type:'MENU', outputItemId:'', outputQty:1, outputUnit:'u', notes:'Componentes variables se importan desde modificadores FUDO.' }, [['waffle_clasico',1,'u']]);
  seedRecipe_({ recipeId:'waffle_bonitos', name:'Wafflebonitos', type:'MENU', outputItemId:'', outputQty:1, outputUnit:'u' }, [['mezcla_pandebono',8,'u']]);
  seedRecipe_({ recipeId:'add_salsa_arequipe', name:'Salsa de arequipe waffle', type:'ADDITION', outputItemId:'', outputQty:1, outputUnit:'u' }, [['salsa_arequipe',55,'g']]);
  seedRecipe_({ recipeId:'add_salsa_chocolate', name:'Salsa de chocolate waffle', type:'ADDITION', outputItemId:'', outputQty:1, outputUnit:'u' }, [['salsa_chocolate',35,'g']]);
  seedRecipe_({ recipeId:'add_helado_arequipe', name:'Helado de arequipe waffle', type:'ADDITION', outputItemId:'', outputQty:1, outputUnit:'u' }, [['helado_arequipe',84,'g']]);
  seedRecipe_({ recipeId:'add_helado_chocolate', name:'Helado de chocolate waffle', type:'ADDITION', outputItemId:'', outputQty:1, outputUnit:'u' }, [['helado_chocolate',84,'g']]);
  seedRecipe_({ recipeId:'add_helado_vainilla', name:'Helado de vainilla waffle', type:'ADDITION', outputItemId:'', outputQty:1, outputUnit:'u' }, [['helado_vainilla',84,'g']]);
  seedRecipe_({ recipeId:'add_helado_frutos_rojos', name:'Helado de frutos rojos waffle', type:'ADDITION', outputItemId:'', outputQty:1, outputUnit:'u' }, [['helado_frutos_rojos',84,'g']]);
  seedRecipe_({ recipeId:'add_banano', name:'Banano waffle', type:'ADDITION', outputItemId:'', outputQty:1, outputUnit:'u' }, [['banano',30,'g']]);
  seedRecipe_({ recipeId:'add_durazno', name:'Durazno waffle', type:'ADDITION', outputItemId:'', outputQty:1, outputUnit:'u' }, [['durazno',75,'g']]);
  seedRecipe_({ recipeId:'add_fresa', name:'Fresa waffle', type:'ADDITION', outputItemId:'', outputQty:1, outputUnit:'u' }, [['fresa',32,'g']]);
}

function seedAliases_() {
  const aliases = [
    ['Chanchostilla','RECIPE','menu_chanchostilla'],['Supremo','RECIPE','menu_supremo'],['Costilla','RECIPE','menu_costilla'],
    ['Panceta','RECIPE','menu_panceta'],['Costilafel','RECIPE','menu_costilafel'],['Falafel','RECIPE','menu_falafel'],
    ['Chanchalafel','RECIPE','menu_chanchalafel'],['Porcion Papas','RECIPE','menu_papas'],['Porción Papas','RECIPE','menu_papas'],
    ['Panceta (adicion)','RECIPE','add_panceta'],['Panceta (adición)','RECIPE','add_panceta'],['Falafel (adición)','RECIPE','add_falafel'],
    ['Aioli de Amelia','RECIPE','add_aioli'],['Cebollita de Amelia','RECIPE','add_cebollita'],
    ['arma tu waffle grande','RECIPE','waffle_grande'],['waffle bonitos','RECIPE','waffle_bonitos'],
    ['Aguila Light','ITEM','aguila_light'],['CC Dorada','ITEM','cc_dorada'],['Poker','ITEM','poker'],['Stella Artois Lager','ITEM','stella'],
    ['Torre Anturio (Porter Ale)','ITEM','torre_anturio'],['Torre Camelia (Amber Ale)','ITEM','torre_camelia'],
    ['Torre Tangara','ITEM','torre_tangara'],['Torre Magnolia (Blonde Ale)','ITEM','torre_magnolia'],['Torre Silvana (IPA)','ITEM','torre_silvana'],
    ['Agua Mineral','ITEM','agua_mineral'],['Coca Cola Original 350 ml','ITEM','coca_original_350'],['Coca-Cola Original 10 oz','ITEM','coca_original_10'],
    ['Coca Cola Zero 350 ml','ITEM','coca_zero_350'],['Ginger Ale','ITEM','ginger_ale'],['Soda','ITEM','soda'],['Kefir','ITEM','kefir'],
    ['porcion torta de chocolate','ITEM','torta_chocolate'],['porcion torta de zanahoria','ITEM','torta_zanahoria'],
    ['porcion torta de banano','ITEM','torta_banano'],['porcion torta de frutos amarillos','ITEM','torta_maracuya'],
    ['Porción de torta de frutos rojos','ITEM','torta_frutos_rojos'],['Milo','ITEM','milo'],
    ['Salsa de arequipe','RECIPE','add_salsa_arequipe'],['Salsa de Chocolate','RECIPE','add_salsa_chocolate'],
    ['Helado de arequipe','RECIPE','add_helado_arequipe'],['Helado de Chocolate','RECIPE','add_helado_chocolate'],['Helado de Vainilla','RECIPE','add_helado_vainilla'],
    ['Helado de frutos rojos','RECIPE','add_helado_frutos_rojos'],['Banano','RECIPE','add_banano'],['Durazno','RECIPE','add_durazno'],['Fresa','RECIPE','add_fresa']
  ];
  aliases.forEach(function(x) {
    const id = 'als_' + Utilities.base64EncodeWebSafe(normalizeText_(x[0])).replace(/=/g,'').slice(0,30);
    upsertRow_('Aliases','aliasId',{ aliasId:id, source:'FUDO', externalName:x[0], normalizedName:normalizeText_(x[0]),
      entityType:x[1], entityId:x[2], active:true, createdAt:nowIso_() });
  });
}
