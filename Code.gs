function doGet() {
  return HtmlService.createTemplateFromFile('index').evaluate().setTitle(AMELIA.NAME)
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag('viewport','width=device-width, initial-scale=1');
}

function include(filename){return HtmlService.createHtmlOutputFromFile(filename).getContent();}

function api(request) {
  request=request||{};const action=request.action;const token=request.token||'';const p=request.payload||{};
  try {
    let data;
    switch(action){
      case 'autoLogin':data=autoLogin_();break;
      case 'login':data=login_(p.email,p.pin);break;
      case 'logout':data=logout_(token);break;
      case 'bootstrap':data=bootstrap_(token);break;
      case 'dashboard':data=dashboard_(token,p.locationId);break;
      case 'analysis':data=dailyAnalysis_(token,p.date,p.locationId);break;
      case 'saveCount':data=saveCount_(token,p);break;
      case 'saveMovement':data=saveMovement_(token,p);break;
      case 'saveTransfer':data=saveTransfer_(token,p);break;
      case 'saveProduction':data=saveProduction_(token,p);break;
      case 'saveItem':data=saveItem_(token,p);break;
      case 'saveRecipe':data=saveRecipeDefinition_(token,p);break;
      case 'saveAlias':data=saveAlias_(token,p);break;
      case 'uploadReport':data=uploadReport_(token,p);break;
      case 'listUsers':data=listUsers_(token);break;
      case 'saveUser':data=saveUser_(token,p);break;
      default:throw new Error('Acción desconocida: '+action);
    }
    return {ok:true,data:data};
  }catch(err){return {ok:false,error:err.message||String(err),stack:err.stack||''};}
}
