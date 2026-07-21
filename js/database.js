const PREFERENCES_KEY='mfg_preferences_v2';
const DEFAULTS={plant:'',area:'',prefix:'MFG',apiUrl:'',serviceMode:'local'};
const bundled={productionPlan:'data/production-plan.xlsx',employees:'data/employees.xlsx',templates:{material:'templates/New_Model_Material_Delivery_Record_Corporate.xlsx',change:'templates/Model Change Format_Rev.06 Loss Time Record.xlsx'}};
const excelType='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const DB_NAME='npi_digital_forms_v1',DB_VERSION=1;
const TEMPLATE_CACHE_VERSION={material:'rev5-unified-styled',change:'rev6'};

function openDatabase(){return new Promise((resolve,reject)=>{const request=indexedDB.open(DB_NAME,DB_VERSION);request.onupgradeneeded=()=>{const db=request.result;for(const name of['records','queue'])if(!db.objectStoreNames.contains(name))db.createObjectStore(name,{keyPath:'id'})};request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error)})}
async function storeGet(store,id){const db=await openDatabase();return new Promise((resolve,reject)=>{const tx=db.transaction(store,'readonly'),request=tx.objectStore(store).get(id);request.onsuccess=()=>resolve(request.result?.value);request.onerror=()=>reject(request.error)})}
async function storePut(store,id,value){const db=await openDatabase();return new Promise((resolve,reject)=>{const tx=db.transaction(store,'readwrite');tx.objectStore(store).put({id,value});tx.oncomplete=()=>resolve(value);tx.onerror=()=>reject(tx.error)})}
async function storeDelete(store,id){const db=await openDatabase();return new Promise((resolve,reject)=>{const tx=db.transaction(store,'readwrite');tx.objectStore(store).delete(id);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error)})}
async function storeValues(store){const db=await openDatabase();return new Promise((resolve,reject)=>{const tx=db.transaction(store,'readonly'),request=tx.objectStore(store).getAll();request.onsuccess=()=>resolve(request.result.map(item=>item.value));request.onerror=()=>reject(request.error)})}
function notifySync(){storeValues('queue').then(items=>document.dispatchEvent(new CustomEvent('offline-sync-change',{detail:{pending:items.length,online:navigator.onLine}}))).catch(()=>{})}

async function fileFromUrl(url,name){const response=await fetch(url);if(!response.ok)throw new Error(`No se pudo cargar ${name}.`);return new File([await response.blob()],name,{type:excelType})}
function metadataFor(file,version=1,extra={}){return{fileId:extra.fileId||crypto.randomUUID(),fileName:file.name,fileType:file.type||excelType,uploadedAt:extra.uploadedAt||new Date().toISOString(),uploadedBy:extra.uploadedBy||'Usuario local',version,isActive:true,pendingSync:Boolean(extra.pendingSync)}}
function decodeBase64File(payload){if(!payload?.base64)return null;const bytes=Uint8Array.from(atob(payload.base64),character=>character.charCodeAt(0));return new File([bytes],payload.name||'file.xlsx',{type:payload.type||payload.mimeType||excelType})}
function normalizeActive(data){const active=data?.active??(data?.file?data:null);if(!active)return null;const file=decodeBase64File(active.file||active);if(!file)throw new Error('Apps Script no devolvió el contenido del archivo activo.');return{file,metadata:{fileId:active.metadata?.fileId||active.fileId||'',fileName:active.metadata?.fileName||file.name,fileType:active.metadata?.fileType||file.type,uploadedAt:active.metadata?.uploadedAt||active.updatedAt||'',uploadedBy:active.metadata?.uploadedBy||'',version:Number(active.metadata?.version||active.version||1),isActive:true,pendingSync:false}}}
function compactSignatureMetadata(metadata){const copy={...metadata,values:{...(metadata?.values||{})}};for(const[key,value]of Object.entries(copy.values)){try{const parsed=JSON.parse(value);if(parsed?.kind==='signature'){delete parsed.dataUrl;copy.values[key]=JSON.stringify(parsed)}}catch{}}return copy}

export class LocalDataService{
  async ensureBundled(kind){const key=`active:${kind}`,cached=await storeGet('records',key);if(cached)return cached;const isPlan=kind==='productionPlan',file=await fileFromUrl(isPlan?bundled.productionPlan:bundled.employees,isPlan?'production-plan.xlsx':'employees.xlsx'),active={file,metadata:metadataFor(file,1,{fileId:`development-${kind}-v1`,uploadedBy:'Datos incluidos'})};return storePut('records',key,active)}
  getActiveProductionPlan(){return this.ensureBundled('productionPlan')}
  getActiveEmployeeDatabase(){return this.ensureBundled('employees')}
  async replace(kind,file){const key=`active:${kind}`,previous=await this.ensureBundled(kind),active={file,metadata:metadataFor(file,(previous?.metadata?.version||0)+1)};await storePut('records',key,active);return active}
  replaceProductionPlan(file){return this.replace('productionPlan',file)}
  replaceEmployeeDatabase(file){return this.replace('employees',file)}
  uploadProductionPlan(file){return this.replaceProductionPlan(file)}
  uploadEmployeeDatabase(file){return this.replaceEmployeeDatabase(file)}
  async getTemplates(){return Promise.all(Object.entries(bundled.templates).map(async([type,url])=>{const key=`template:${type}:${TEMPLATE_CACHE_VERSION[type]}`,cached=await storeGet('records',key);if(cached)return{type,file:cached};const file=await fileFromUrl(url,url.split('/').pop());await storePut('records',key,file);return{type,file}}))}
  async uploadTemplate(file,type){await storePut('records',`template:${type}:${TEMPLATE_CACHE_VERSION[type]}`,file);return{ok:true,name:file.name,type}}
  async saveGeneratedFile(file,metadata){const records=await this.getGeneratedFiles(),record={id:crypto.randomUUID(),name:file.name,date:new Date().toISOString(),...compactSignatureMetadata(metadata),file,pendingSync:false};records.unshift(record);await storePut('records','generated',records);return record}
  async getGeneratedFiles(){return(await storeGet('records','generated'))||[]}
  async getConfiguration(){return preferences.get()}
  async saveConfiguration(value){preferences.save(value);return value}
  async testConnection(){return{ok:true,message:'Almacenamiento local listo'}}
  async getPendingCount(){return(await storeValues('queue')).length}
  async syncPending(){notifySync();return{synced:0,pending:await this.getPendingCount()}}
  async createSignatureRequest(){throw new Error('La firma por enlace requiere el modo Google Drive.')}
}

export class GoogleDriveService extends LocalDataService{
  constructor(apiUrl){super();this.apiUrl=String(apiUrl||'').trim().replace(/\/$/,'');this.syncPromise=null}
  assertConfigured(){if(!this.apiUrl)throw new Error('Configura la URL de Apps Script en Settings.')}
  async request(action,payload={}){this.assertConfigured();let response;try{response=await fetch(this.apiUrl,{method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify({action,...payload})})}catch{throw new Error('Sin conexión con Google Apps Script. Los cambios quedan pendientes.')}if(!response.ok)throw new Error(`Google Apps Script respondió ${response.status}.`);let data;try{data=await response.json()}catch{throw new Error('Google Apps Script devolvió una respuesta inválida.')}if(data.ok===false)throw new Error(data.error||data.message||'Error en Google Apps Script.');return data}
  async encodeFile(file){return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onerror=()=>reject(new Error('No fue posible preparar el archivo.'));reader.onload=()=>resolve({name:file.name,type:file.type||excelType,base64:String(reader.result).split(',')[1]});reader.readAsDataURL(file)})}
  async cachedActive(kind,action){const key=`active:${kind}`,mutation=kind==='productionPlan'?'replaceProductionPlan':'replaceEmployeeDatabase',pending=(await storeValues('queue')).some(item=>item.action===mutation);try{if(!navigator.onLine||pending)throw new Error('local copy preferred');const remote=normalizeActive(await this.request(action));if(remote)await storePut('records',key,remote);return remote}catch(error){const cached=await storeGet('records',key);if(cached)return cached;return super.ensureBundled(kind)}}
  getActiveProductionPlan(){return this.cachedActive('productionPlan','getActiveProductionPlan')}
  getActiveEmployeeDatabase(){return this.cachedActive('employees','getActiveEmployeeDatabase')}
  async queueMutation(action,file,metadata={},localResult=null){const item={id:crypto.randomUUID(),action,file,metadata,createdAt:new Date().toISOString()};await storePut('queue',item.id,item);notifySync();if(navigator.onLine)this.syncPending();return localResult||{ok:true,pendingSync:true}}
  async replaceRemote(kind,file,action){const key=`active:${kind}`,previous=await storeGet('records',key),active={file,metadata:metadataFor(file,(previous?.metadata?.version||0)+1,{pendingSync:true})};await storePut('records',key,active);return this.queueMutation(action,file,{},active)}
  replaceProductionPlan(file){return this.replaceRemote('productionPlan',file,'replaceProductionPlan')}
  replaceEmployeeDatabase(file){return this.replaceRemote('employees',file,'replaceEmployeeDatabase')}
  uploadProductionPlan(file){return this.replaceProductionPlan(file)}
  uploadEmployeeDatabase(file){return this.replaceEmployeeDatabase(file)}
  async uploadTemplate(file,type){await storePut('records',`template:${type}:${TEMPLATE_CACHE_VERSION[type]}`,file);return this.queueMutation('uploadTemplate',file,{type},{ok:true,name:file.name,type,pendingSync:true})}
  async saveGeneratedFile(file,metadata){metadata=compactSignatureMetadata(metadata);const records=await super.getGeneratedFiles(),record={id:crypto.randomUUID(),name:file.name,date:new Date().toISOString(),...metadata,file,pendingSync:true};records.unshift(record);await storePut('records','generated',records);await this.queueMutation('saveGeneratedFile',file,{...metadata,clientId:record.id});return record}
  async getGeneratedFiles(){const local=await super.getGeneratedFiles();if(!navigator.onLine)return local;try{const data=await this.request('getGeneratedFiles'),remote=data.files||[];const pending=local.filter(item=>item.pendingSync);const merged=[...pending,...remote.filter(item=>!pending.some(localItem=>localItem.id===(item.id||item.clientId)))];await storePut('records','generated',merged);return merged}catch{return local}}
  async getTemplates(){const local=await super.getTemplates();if(!navigator.onLine)return local;try{const data=await this.request('getTemplates'),remote=(data.templates||[]).map(item=>({type:item.type,file:decodeBase64File(item.file||item)})).filter(item=>item.file);for(const item of remote)await storePut('records',`template:${item.type}:${TEMPLATE_CACHE_VERSION[item.type]}`,item.file);return remote.length?remote:local}catch{return local}}
  async runQueueItem(item){const file=await this.encodeFile(item.file);const payload=item.action==='replaceProductionPlan'?{file,drivePath:'Digital Forms/Production Plan',configurationKey:'activeProductionPlanFileId',archivePrevious:true}:item.action==='replaceEmployeeDatabase'?{file,drivePath:'Digital Forms/Employees',configurationKey:'activeEmployeeDatabaseFileId',archivePrevious:true}:item.action==='uploadTemplate'?{file,metadata:item.metadata}: {file,metadata:item.metadata};await this.request(item.action,payload);if(item.action==='saveGeneratedFile'){const records=await super.getGeneratedFiles();const target=records.find(record=>record.id===item.metadata.clientId);if(target)target.pendingSync=false;await storePut('records','generated',records)}else if(item.action.startsWith('replace')){const kind=item.action==='replaceProductionPlan'?'productionPlan':'employees',active=await storeGet('records',`active:${kind}`);if(active?.file?.name===item.file.name){active.metadata.pendingSync=false;await storePut('records',`active:${kind}`,active)}}}
  async syncPending(){if(this.syncPromise)return this.syncPromise;this.syncPromise=(async()=>{if(!navigator.onLine||!this.apiUrl)return{synced:0,pending:await this.getPendingCount()};let synced=0;for(const item of(await storeValues('queue')).sort((a,b)=>a.createdAt.localeCompare(b.createdAt))){try{await this.runQueueItem(item);await storeDelete('queue',item.id);synced++}catch{break}}notifySync();return{synced,pending:await this.getPendingCount()}})().finally(()=>{this.syncPromise=null});return this.syncPromise}
  async testConnection(){const data=await this.request('ping');return{ok:true,message:data.message||'Conexión correcta'}}
  async createSignatureRequest(payload){const data=await this.request('createSignatureRequest',payload);return data.request||data.data}
  async getSignatureRequest(token){const data=await this.request('getSignatureRequest',{token});return data.request||data.data}
  async submitSignature(token,dataUrl){const data=await this.request('submitSignature',{token,dataUrl});return data.data||data}
}

const SUPABASE_ENV=globalThis.__APP_ENV__||{};
const EMPLOYEE_COLUMNS=['employee_number','full_name','shift','line','area','department','position','operation','packing_category','line_area','is_active','source_data'];
const employeeToApp=row=>({id:row.id,employeeNumber:row.employee_number,fullName:row.full_name,shift:row.shift||'',line:row.line||'',area:row.area||'',department:row.department||'',position:row.position||'',operation:row.operation||'',packingCategory:row.packing_category||'',lineArea:row.line_area||'',raw:row.source_data||{},skills:(row.employee_skills||[]).map(skill=>({id:skill.id,key:skill.skill_key,name:skill.skill_name,value:skill.skill_value||'',isQualified:skill.is_qualified,raw:skill.source_data||{}})),updatedAt:row.updated_at,pendingSync:Boolean(row.pendingSync)});
const employeeToDatabase=(employee,plantId,userId,sourceVersionId)=>({plant_id:plantId,employee_number:String(employee.employeeNumber||employee.employee_number||'').trim(),full_name:String(employee.fullName||employee.full_name||'').trim(),shift:employee.shift||null,line:employee.line||null,area:employee.area||null,department:employee.department||null,position:employee.position||null,operation:employee.operation||null,packing_category:employee.packingCategory||employee.packing_category||null,line_area:employee.lineArea||employee.line_area||null,is_active:employee.isActive??employee.is_active??true,source_file_version_id:sourceVersionId||employee.source_file_version_id||null,source_data:employee.raw||employee.sourceData||employee.source_data||{},updated_by:userId});
const sha256File=async file=>{const digest=await crypto.subtle.digest('SHA-256',await file.arrayBuffer());return[...new Uint8Array(digest)].map(value=>value.toString(16).padStart(2,'0')).join('')};
const productionToApp=(row,schedules=[])=>{const value=row.effective_data||row.imported_data||{},imported=row.imported_data||{};return{id:row.lot_id,lotVersionId:row.lot_version_id,sourceFileVersionId:row.source_file_version_id,basePlanNumber:row.base_plan_number||value.basePlanNumber||'',line:value.line||'',rolling:row.order_no||value.orderNo||'',orderNo:row.order_no||value.orderNo||'',materialCode:value.materialCode||'',sku:value.sku||'',internalModel:value.internalModel||'',customerModel:value.customerModel||'',materialType:value.materialType||value.packagingMethod||'',destination:value.destination||'',brand:value.brand||'',peDoc:value.peDoc||'',orderQty:value.orderQty,planQuantity:value.planQuantity,productionDate:value.productionDate||'',workOrderNo:value.workOrderNo||'',plannedStartTime:value.plannedStartTime||'',plannedEndTime:value.plannedEndTime||'',schedules:schedules.map(schedule=>({date:schedule.schedule_date,shift:schedule.shift==='night'?'Night':'Day',quantity:Number(schedule.quantity),sourceColumn:schedule.source_column||''})),raw:value,importedRaw:imported,manualAdjustments:row.manual_adjustments||{},isActive:row.is_active!==false}};

export class SupabaseDataService{
  constructor(fallback,url=SUPABASE_ENV.SUPABASE_URL,key=SUPABASE_ENV.SUPABASE_PUBLISHABLE_KEY){
    this.fallback=fallback;
    this.url=String(url||'').trim();
    this.key=String(key||'').trim();
    this.client=this.url&&this.key&&globalThis.supabase?.createClient?globalThis.supabase.createClient(this.url,this.key,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}}):null;
    return new Proxy(this,{get:(target,property,receiver)=>{if(property in target){const value=Reflect.get(target,property,receiver);return typeof value==='function'?value.bind(target):value}const value=target.fallback?.[property];return typeof value==='function'?value.bind(target.fallback):value}});
  }
  isConfigured(){return Boolean(this.client)}
  async session(){if(!this.client)return null;return(await this.client.auth.getSession()).data.session||null}
  async requireSession(){const session=await this.session();if(!session)throw new Error('Supabase está configurado, pero no hay una sesión iniciada.');return session}
  async signIn(email,password){if(!this.client)throw new Error('Configura SUPABASE_URL y SUPABASE_PUBLISHABLE_KEY.');const result=await this.client.auth.signInWithPassword({email:String(email||'').trim(),password:String(password||'')});if(result.error)throw result.error;return result.data}
  async signOut(){if(!this.client)return;const result=await this.client.auth.signOut();if(result.error)throw result.error}
  async getAuthState(){const session=await this.session();if(!session)return{configured:this.isConfigured(),authenticated:false,email:'',plantId:'',plantCode:'',role:''};const profile=await this.client.from('profiles').select('default_plant_id').eq('id',session.user.id).maybeSingle();if(profile.error)throw profile.error;let plantCode='',role='';if(profile.data?.default_plant_id){const[plant,membership]=await Promise.all([this.client.from('plants').select('code').eq('id',profile.data.default_plant_id).maybeSingle(),this.client.from('plant_members').select('role,is_active').eq('plant_id',profile.data.default_plant_id).eq('user_id',session.user.id).maybeSingle()]);if(plant.error)throw plant.error;if(membership.error)throw membership.error;plantCode=plant.data?.code||'';role=membership.data?.is_active?membership.data.role:''}return{configured:true,authenticated:true,email:session.user.email||'',plantId:profile.data?.default_plant_id||'',plantCode,role}}
  async saveMaterialDeliveryReport(file,metadata={}){
    if(metadata.reportId)return this.saveMaterialDeliveryReportVersion(metadata.reportId,file,metadata);
    const session=await this.requireSession(),plantId=await this.getPlantId(),values=metadata.values||{};
    const reportNumber=`MDR-${new Date().toISOString().replace(/\D/g,'').slice(0,14)}-${crypto.randomUUID().slice(0,6).toUpperCase()}`;
    const reportPayload={plant_id:plantId,report_number:reportNumber,status:'completed',rolling:values.rolling||null,internal_model:values.internalModel||null,customer_model:values.customerModel||null,line:values.line||null,trial_date:values.date||null,current_version:1,form_data:values,created_by:session.user.id,updated_by:session.user.id};
    const created=await this.client.from('material_delivery_reports').insert(reportPayload).select('*').single();
    if(created.error)throw created.error;
    const report=created.data,safeName=file.name.replace(/[^a-zA-Z0-9._-]/g,'_'),storagePath=`${plantId}/material-delivery/${report.id}/v1/${safeName}`;
    try{
      const version=await this.client.from('material_delivery_report_versions').insert({plant_id:plantId,report_id:report.id,version:1,form_data:values,change_summary:'CreaciÃ³n del reporte',created_by:session.user.id,updated_by:session.user.id});
      if(version.error)throw version.error;
      const upload=await this.client.storage.from('report-files').upload(storagePath,file,{contentType:file.type||excelType,upsert:false});
      if(upload.error)throw upload.error;
      const savedFile=await this.client.from('material_delivery_files').insert({plant_id:plantId,report_id:report.id,report_version:1,file_kind:'xlsx',storage_bucket:'report-files',storage_path:storagePath,original_name:file.name,mime_type:file.type||excelType,size_bytes:file.size,created_by:session.user.id,updated_by:session.user.id}).select('*').single();
      if(savedFile.error)throw savedFile.error;
      return{id:report.id,name:file.name,date:report.created_at,type:'material',order:report.rolling||'',reportNumber,status:report.status,version:1,storageBucket:'report-files',storagePath};
    }catch(error){await this.client.from('material_delivery_reports').update({status:'draft',updated_by:session.user.id}).eq('id',report.id);throw error}
  }
  async saveMaterialDeliveryReportVersion(reportId,file,metadata={}){
    const session=await this.requireSession(),plantId=await this.getPlantId(),values=metadata.values||{};
    const saved=await this.client.rpc('save_material_delivery_version',{target_report_id:reportId,target_form_data:values,target_status:'completed',target_change_summary:metadata.changeSummary||'ActualizaciÃ³n desde el formulario'});
    if(saved.error)throw saved.error;
    const report=Array.isArray(saved.data)?saved.data[0]:saved.data,version=Number(report.version),safeName=file.name.replace(/[^a-zA-Z0-9._-]/g,'_'),storagePath=`${plantId}/material-delivery/${reportId}/v${version}/${safeName}`;
    const upload=await this.client.storage.from('report-files').upload(storagePath,file,{contentType:file.type||excelType,upsert:false});
    if(upload.error)throw upload.error;
    const savedFile=await this.client.from('material_delivery_files').insert({plant_id:plantId,report_id:reportId,report_version:version,file_kind:'xlsx',storage_bucket:'report-files',storage_path:storagePath,original_name:file.name,mime_type:file.type||excelType,size_bytes:file.size,created_by:session.user.id,updated_by:session.user.id}).select('*').single();
    if(savedFile.error)throw savedFile.error;
    return{id:reportId,name:file.name,date:report.updated_at,type:'material',order:values.rolling||'',reportNumber:report.report_number,status:report.status,version,values,storageBucket:'report-files',storagePath};
  }
  async getMaterialDeliveryReports(){
    if(!this.client||!(await this.session()))return[];
    const plantId=await this.getPlantId(),[reports,files]=await Promise.all([
      this.client.from('material_delivery_reports').select('id,report_number,status,rolling,internal_model,customer_model,line,trial_date,current_version,form_data,created_at,updated_at').eq('plant_id',plantId).order('updated_at',{ascending:false}),
      this.client.from('material_delivery_files').select('report_id,file_kind,storage_bucket,storage_path,original_name,mime_type,size_bytes,report_version').eq('plant_id',plantId).eq('file_kind','xlsx')
    ]);
    if(reports.error)throw reports.error;if(files.error)throw files.error;
    const artifacts=new Map(files.data.map(file=>[`${file.report_id}:${file.report_version}`,file]));
    return reports.data.map(report=>{const artifact=artifacts.get(`${report.id}:${report.current_version}`);return{id:report.id,name:artifact?.original_name||`${report.report_number}.xlsx`,date:report.updated_at,type:'material',order:report.rolling||'',reportNumber:report.report_number,status:report.status,version:report.current_version,values:report.form_data||{},storageBucket:artifact?.storage_bucket,storagePath:artifact?.storage_path,internalModel:report.internal_model||'',customerModel:report.customer_model||'',line:report.line||'',trialDate:report.trial_date||''}})
  }
  async downloadGeneratedReport(item){
    if(!item?.storageBucket||!item?.storagePath)throw new Error('Este reporte todavÃ­a no tiene un archivo generado.');
    const result=await this.client.storage.from(item.storageBucket).download(item.storagePath);
    if(result.error)throw result.error;
    return new File([result.data],item.name,{type:result.data.type||excelType});
  }
  async saveGeneratedFile(file,metadata){if(metadata?.type==='material')return this.saveMaterialDeliveryReport(file,metadata);return this.fallback.saveGeneratedFile(file,metadata)}
  async getGeneratedFiles(){const [reports,local]=await Promise.all([this.getMaterialDeliveryReports(),this.fallback.getGeneratedFiles()]);return[...reports,...local.filter(item=>item.type!=='material')].sort((a,b)=>String(b.date).localeCompare(String(a.date)))}
  async getPlantId(){
    const session=await this.requireSession();
    const profile=await this.client.from('profiles').select('default_plant_id').eq('id',session.user.id).maybeSingle();
    if(profile.error)throw profile.error;
    if(profile.data?.default_plant_id)return profile.data.default_plant_id;
    const membership=await this.client.from('plant_members').select('plant_id').eq('user_id',session.user.id).eq('is_active',true).limit(1).maybeSingle();
    if(membership.error)throw membership.error;
    if(!membership.data?.plant_id)throw new Error('Tu usuario todavía no pertenece a una planta en Supabase.');
    return membership.data.plant_id;
  }
  async fetchEmployeePages(plantId){
    const pageSize=500,rows=[];
    for(let from=0;;from+=pageSize){
      const result=await this.client.from('employees').select('*,employee_skills(*)').eq('plant_id',plantId).eq('is_active',true).order('full_name').range(from,from+pageSize-1);
      if(result.error)throw result.error;
      rows.push(...result.data);
      if(result.data.length<pageSize)break;
    }
    return rows;
  }
  async getEmployees(filters={}){
    if(!this.client||!(await this.session()))return null;
    try{
      const plantId=filters.plantId||await this.getPlantId(),databaseRows=await this.fetchEmployeePages(plantId),rows=databaseRows.map(employeeToApp);
      const result={rows,source:'supabase',metadata:{fileName:'Employee Database · Supabase',uploadedAt:new Date().toISOString(),version:'DB',plantId},duplicates:0,rejected:0};
      await storePut('records','supabase:employees',result);
      return result;
    }catch(error){
      const cached=await storeGet('records','supabase:employees');
      if(cached)return{...cached,source:'supabase-cache',offline:true,error:error.message};
      return null;
    }
  }
  async getActiveEmployeeDatabase(){return(await this.getEmployees())||this.fallback.getActiveEmployeeDatabase()}
  async queueEmployeeMutation(mutation){const queued=(await storeGet('records','supabase:employee-mutations'))||[];queued.push({...mutation,queuedAt:new Date().toISOString()});await storePut('records','supabase:employee-mutations',queued);notifySync()}
  async cacheOptimistic(employee,action){
    const cached=(await storeGet('records','supabase:employees'))||{rows:[],source:'supabase-cache',metadata:{fileName:'Employee Database · offline'}};
    const optimistic={...employee,id:employee.id||crypto.randomUUID(),pendingSync:true};
    const index=cached.rows.findIndex(item=>item.id===optimistic.id||String(item.employeeNumber)===String(optimistic.employeeNumber));
    if(index>=0)cached.rows[index]={...cached.rows[index],...optimistic};else cached.rows.unshift(optimistic);
    cached.source='supabase-cache';cached.offline=true;
    await storePut('records','supabase:employees',cached);
    await this.queueEmployeeMutation({action,employee:optimistic});
    return optimistic;
  }
  async createEmployee(employee,{queueOnFailure=true}={}){
    if(!String(employee.employeeNumber||employee.employee_number||'').trim()||!String(employee.fullName||employee.full_name||'').trim())throw new Error('Número y nombre del empleado son obligatorios.');
    try{
      const session=await this.requireSession(),plantId=employee.plantId||await this.getPlantId(),payload=employeeToDatabase(employee,plantId,session.user.id);
      payload.created_by=session.user.id;
      const result=await this.client.from('employees').insert(payload).select('*,employee_skills(*)').single();
      if(result.error)throw result.error;
      return employeeToApp(result.data);
    }catch(error){if(!queueOnFailure)throw error;return this.cacheOptimistic(employee,'create')}
  }
  async updateEmployee(id,changes,{queueOnFailure=true}={}){
    if(!id)throw new Error('El identificador del empleado es obligatorio.');
    try{
      const session=await this.requireSession(),mapping={employeeNumber:'employee_number',fullName:'full_name',shift:'shift',line:'line',area:'area',department:'department',position:'position',operation:'operation',packingCategory:'packing_category',lineArea:'line_area',isActive:'is_active',raw:'source_data',sourceData:'source_data'},allowed={updated_by:session.user.id};
      for(const[source,target]of Object.entries(mapping))if(Object.hasOwn(changes,source))allowed[target]=changes[source]||((target==='is_active')?false:(target==='source_data'?{}:null));
      for(const target of EMPLOYEE_COLUMNS)if(Object.hasOwn(changes,target))allowed[target]=changes[target];
      if(Object.hasOwn(allowed,'employee_number'))allowed.employee_number=String(allowed.employee_number||'').trim();
      if(Object.hasOwn(allowed,'full_name'))allowed.full_name=String(allowed.full_name||'').trim();
      const result=await this.client.from('employees').update(allowed).eq('id',id).select('*,employee_skills(*)').single();
      if(result.error)throw result.error;
      return employeeToApp(result.data);
    }catch(error){if(!queueOnFailure)throw error;return this.cacheOptimistic({...changes,id},'update')}
  }
  async importEmployeeDatabase(file,parsed){
    if(!this.client||!(await this.session()))return{skipped:true,reason:'Supabase no configurado o sin sesión'};
    try{
      const session=await this.requireSession(),plantId=await this.getPlantId(),timestamp=new Date().toISOString().replace(/[:.]/g,'-'),safeName=file.name.replace(/[^a-zA-Z0-9._-]/g,'_'),storagePath=`${plantId}/employee-database/${timestamp}-${safeName}`;
      const upload=await this.client.storage.from('source-files').upload(storagePath,file,{contentType:file.type||excelType,upsert:false});
      if(upload.error)throw upload.error;
      const latest=await this.client.from('source_file_versions').select('version').eq('plant_id',plantId).eq('resource_type','employee_database').order('version',{ascending:false}).limit(1).maybeSingle();
      if(latest.error)throw latest.error;
      const version=(latest.data?.version||0)+1;
      const source=await this.client.from('source_file_versions').insert({plant_id:plantId,resource_type:'employee_database',version,is_active:false,storage_bucket:'source-files',storage_path:storagePath,original_name:file.name,mime_type:file.type||excelType,size_bytes:file.size,source_system:'supabase',imported_count:parsed.rows.length,duplicate_count:parsed.duplicates||0,rejected_count:parsed.rejected||0,source_data:{sheetName:parsed.sheetName,headerRow:parsed.headerRow,unrecognizedColumns:parsed.unrecognizedColumns||[]},created_by:session.user.id,updated_by:session.user.id}).select('id').single();
      if(source.error)throw source.error;
      const employeeIds=new Map();
      for(let offset=0;offset<parsed.rows.length;offset+=200){
        const batch=parsed.rows.slice(offset,offset+200).map(employee=>({...employeeToDatabase(employee,plantId,session.user.id,source.data.id),created_by:session.user.id}));
        const upsert=await this.client.from('employees').upsert(batch,{onConflict:'plant_id,employee_number'}).select('id,employee_number');
        if(upsert.error)throw upsert.error;
        upsert.data.forEach(row=>employeeIds.set(String(row.employee_number),row.id));
      }
      const skills=parsed.rows.flatMap(employee=>(employee.skills||[]).map(skill=>({plant_id:plantId,employee_id:employeeIds.get(String(employee.employeeNumber)),skill_key:skill.key,skill_name:skill.name,skill_value:skill.value||null,is_qualified:Boolean(skill.isQualified),source_data:skill.raw||{},created_by:session.user.id,updated_by:session.user.id}))).filter(skill=>skill.employee_id);
      for(let offset=0;offset<skills.length;offset+=200){const result=await this.client.from('employee_skills').upsert(skills.slice(offset,offset+200),{onConflict:'employee_id,skill_key'});if(result.error)throw result.error}
      const deactivate=await this.client.from('source_file_versions').update({is_active:false,updated_by:session.user.id}).eq('plant_id',plantId).eq('resource_type','employee_database').neq('id',source.data.id);if(deactivate.error)throw deactivate.error;
      const activate=await this.client.from('source_file_versions').update({is_active:true,updated_by:session.user.id}).eq('id',source.data.id);if(activate.error)throw activate.error;
      await storePut('records','supabase:employees',{rows:parsed.rows,source:'supabase',metadata:{fileName:file.name,uploadedAt:new Date().toISOString(),version,plantId}});
      return{ok:true,version,imported:parsed.rows.length,duplicates:parsed.duplicates||0,rejected:parsed.rejected||0,skills:skills.length};
    }catch(error){await storePut('records','supabase:pending-import',{file,parsed,queuedAt:new Date().toISOString(),error:error.message});return{pendingSync:true,error:error.message}}
  }
  async getProductionPlanRows(){
    if(!this.client||!(await this.session()))return null;
    try{
      const plantId=await this.getPlantId(),rows=[];
      for(let from=0;;from+=500){const result=await this.client.from('production_plan_effective').select('*').eq('plant_id',plantId).eq('is_active',true).order('order_no').range(from,from+499);if(result.error)throw result.error;rows.push(...result.data);if(result.data.length<500)break}
      if(!rows.length)return null;
      const schedules=[];for(let offset=0;offset<rows.length;offset+=100){const ids=rows.slice(offset,offset+100).map(row=>row.lot_version_id);const result=await this.client.from('production_plan_schedule_values').select('lot_version_id,schedule_date,shift,quantity,source_column').in('lot_version_id',ids).order('schedule_date');if(result.error)throw result.error;schedules.push(...result.data)}
      const scheduleMap=new Map();for(const schedule of schedules){if(!scheduleMap.has(schedule.lot_version_id))scheduleMap.set(schedule.lot_version_id,[]);scheduleMap.get(schedule.lot_version_id).push(schedule)}
      const active=await this.client.from('source_file_versions').select('id,version,original_name,created_at').eq('plant_id',plantId).eq('resource_type','production_plan').eq('is_active',true).maybeSingle();if(active.error)throw active.error;
      const result={rows:rows.map(row=>productionToApp(row,scheduleMap.get(row.lot_version_id)||[])),source:'supabase',metadata:{fileId:active.data?.id||'',fileName:active.data?.original_name||'Production Plan · Supabase',uploadedAt:active.data?.created_at||new Date().toISOString(),version:active.data?.version||'DB',plantId}};
      await storePut('records','supabase:production-plan',result);return result;
    }catch(error){const cached=await storeGet('records','supabase:production-plan');return cached?{...cached,source:'supabase-cache',offline:true,error:error.message}:null}
  }
  async stageProductionPlanImport(file,parsed){
    const session=await this.requireSession(),plantId=await this.getPlantId(),userId=session.user.id,hash=await sha256File(file),safeName=file.name.replace(/[^a-zA-Z0-9._-]/g,'_');let source=null,importRecord=null;
    try{
      const duplicate=await this.client.from('source_file_versions').select('id').eq('plant_id',plantId).eq('resource_type','production_plan').eq('sha256',hash).order('version',{ascending:false}).limit(1).maybeSingle();if(duplicate.error)throw duplicate.error;
      if(duplicate.data?.id){
        const existing=await this.client.from('production_plan_imports').select('id,status').eq('source_file_version_id',duplicate.data.id).order('created_at',{ascending:false}).limit(1).maybeSingle();
        if(existing.error)throw existing.error;
        if(existing.data?.status==='applied')throw new Error('Este mismo archivo ya fue aplicado; selecciona una revisión con contenido diferente.');
        const resumable=await this.client.from('production_plan_imports').select('id,status').eq('source_file_version_id',duplicate.data.id).in('status',['uploaded','staging','invalid','ready']).order('created_at',{ascending:false}).limit(1).maybeSingle();
        if(resumable.error)throw resumable.error;
        if(resumable.data?.id)return{...(await this.getProductionPlanImport(resumable.data.id)),resumed:true,fileName:file.name};
      }
      for(let attempt=0;attempt<2&&!source;attempt++){
        const latest=await this.client.from('source_file_versions').select('version').eq('plant_id',plantId).eq('resource_type','production_plan').order('version',{ascending:false}).limit(1).maybeSingle();if(latest.error)throw latest.error;
        const version=(latest.data?.version||0)+1,timestamp=new Date().toISOString().replace(/[:.]/g,'-'),storagePath=`${plantId}/production-plan/v${version}/${timestamp}-${safeName}`;
        const inserted=await this.client.from('source_file_versions').insert({plant_id:plantId,resource_type:'production_plan',version,is_active:false,storage_bucket:'source-files',storage_path:storagePath,original_name:file.name,mime_type:file.type||excelType,size_bytes:file.size,sha256:hash,source_system:'supabase',duplicate_of_version_id:duplicate.data?.id||null,source_data:{uploadState:'pending',sheetName:parsed.sheetName,headerRow:parsed.headerRow,headerDepth:parsed.headerDepth,unrecognizedColumns:parsed.unrecognizedColumns||[]},created_by:userId,updated_by:userId}).select('*').single();
        if(!inserted.error)source=inserted.data;else if(inserted.error.code!=='23505'||attempt)throw inserted.error;
      }
      const previous=await this.client.from('source_file_versions').select('id').eq('plant_id',plantId).eq('resource_type','production_plan').eq('is_active',true).maybeSingle();if(previous.error)throw previous.error;
      const createdImport=await this.client.from('production_plan_imports').insert({plant_id:plantId,source_file_version_id:source.id,previous_active_version_id:previous.data?.id||null,status:'uploaded',cleanup_eligible_at:new Date(Date.now()+30*86400000).toISOString(),created_by:userId,updated_by:userId}).select('*').single();if(createdImport.error)throw createdImport.error;importRecord=createdImport.data;
      const upload=await this.client.storage.from('source-files').upload(source.storage_path,file,{contentType:file.type||excelType,upsert:false});if(upload.error)throw upload.error;
      const sourceUpdate=await this.client.from('source_file_versions').update({source_data:{...source.source_data,uploadState:'uploaded',uploadedAt:new Date().toISOString()},updated_by:userId}).eq('id',source.id);if(sourceUpdate.error)throw sourceUpdate.error;
      const statusUpdate=await this.client.from('production_plan_imports').update({status:'staging',updated_by:userId}).eq('id',importRecord.id);if(statusUpdate.error)throw statusUpdate.error;
      const rowIds=new Map(),stagingRows=parsed.stagingRows||parsed.rows||[];
      for(let offset=0;offset<stagingRows.length;offset+=100){const batch=stagingRows.slice(offset,offset+100).map(row=>({import_id:importRecord.id,plant_id:plantId,sheet_name:parsed.sheetName||'Sheet1',source_row_number:row.sourceRowNumber,row_kind:row.rowKind||'data',auxiliary_type:row.auxiliaryType||null,order_no:row.orderNo||null,base_plan_number:row.basePlanNumber||null,canonical_data:row.canonical||row.raw||{},raw_data:row.raw||{},validation_errors:[],validation_warnings:[],created_by:userId,updated_by:userId}));const inserted=await this.client.from('production_plan_staging_rows').insert(batch).select('id,source_row_number');if(inserted.error)throw inserted.error;inserted.data.forEach(row=>rowIds.set(row.source_row_number,row.id))}
      const scheduleRows=stagingRows.flatMap(row=>(row.schedules||[]).map(schedule=>({staging_row_id:rowIds.get(row.sourceRowNumber),schedule_date:schedule.date,shift:String(schedule.shift).toLowerCase(),quantity:schedule.quantity,source_column:schedule.sourceColumn||null}))).filter(row=>row.staging_row_id&&row.schedule_date);
      for(let offset=0;offset<scheduleRows.length;offset+=200){const inserted=await this.client.from('production_plan_staging_schedules').insert(scheduleRows.slice(offset,offset+200));if(inserted.error)throw inserted.error}
      const validated=await this.client.rpc('validate_production_plan_import',{target_import_id:importRecord.id});if(validated.error)throw validated.error;
      const preview=await this.getProductionPlanImport(importRecord.id);
      return{...validated.data,...preview,sourceVersion:source.version,sourceFileVersionId:source.id,fileName:file.name,storagePath:source.storage_path};
    }catch(error){if(importRecord?.id)await this.client.from('production_plan_imports').update({status:'failed',failure_message:error.message,cleanup_eligible_at:new Date().toISOString(),updated_by:userId}).eq('id',importRecord.id);throw error}
  }
  async getProductionPlanImport(importId){const [preview,conflicts]=await Promise.all([this.client.from('production_plan_imports').select('*,source_file_versions!production_plan_imports_source_file_version_id_fkey(original_name,version,size_bytes,sha256,storage_path)').eq('id',importId).single(),this.client.from('production_plan_import_conflicts').select('*').eq('import_id',importId).order('severity').order('created_at')]);if(preview.error)throw preview.error;if(conflicts.error)throw conflicts.error;return{...preview.data,conflicts:conflicts.data}}
  async getPendingProductionPlanImport(){
    if(!this.client||!(await this.session()))return null;
    const plantId=await this.getPlantId(),pending=await this.client.from('production_plan_imports').select('id').eq('plant_id',plantId).in('status',['uploaded','staging','invalid','ready','failed']).order('created_at',{ascending:false}).limit(1).maybeSingle();
    if(pending.error)throw pending.error;
    return pending.data?.id?this.getProductionPlanImport(pending.data.id):null;
  }
  async applyProductionPlanImport(importId){await this.requireSession();const result=await this.client.rpc('apply_production_plan_import',{target_import_id:importId});if(result.error)throw result.error;const plan=await this.getProductionPlanRows();return{...result.data,plan}}
  async cancelProductionPlanImport(importId){const session=await this.requireSession(),result=await this.client.from('production_plan_imports').update({status:'cancelled',cancelled_at:new Date().toISOString(),cleanup_eligible_at:new Date().toISOString(),updated_by:session.user.id}).eq('id',importId).in('status',['uploaded','staging','invalid','ready','failed']).select('*').single();if(result.error)throw result.error;return result.data}
  async saveProductionPlanAdjustment(lotId,fieldName,adjustedValue,reason){
    const allowed=new Set(['line','materialType','destination','brand','peDoc','orderQty','planQuantity','productionDate','workOrderNo','plannedStartTime','plannedEndTime','orderRemarks','priority','productionStatus','planningStatus','scheduleStatus','remark']);
    if(!lotId||!allowed.has(fieldName))throw new Error('Campo de ajuste no permitido.');
    if(!String(reason||'').trim())throw new Error('Escribe el motivo del ajuste.');
    const session=await this.requireSession(),plantId=await this.getPlantId();
    let value=adjustedValue;
    if(['orderQty','planQuantity'].includes(fieldName)){value=adjustedValue===''||adjustedValue==null?null:Number(adjustedValue);if(value!==null&&!Number.isFinite(value))throw new Error('El ajuste debe ser numérico.')}else value=adjustedValue===''?null:String(adjustedValue).trim();
    const [active,lot]=await Promise.all([
      this.client.from('production_plan_manual_adjustments').select('id').eq('lot_id',lotId).eq('field_name',fieldName).eq('is_active',true).maybeSingle(),
      this.client.from('production_plan_lots').select('current_lot_version_id').eq('id',lotId).single()
    ]);
    if(active.error)throw active.error;if(lot.error)throw lot.error;
    const payload={adjusted_value:value,reason:String(reason).trim(),updated_by:session.user.id};
    const result=active.data?.id
      ?await this.client.from('production_plan_manual_adjustments').update(payload).eq('id',active.data.id).select('*').single()
      :await this.client.from('production_plan_manual_adjustments').insert({...payload,plant_id:plantId,lot_id:lotId,field_name:fieldName,based_on_lot_version_id:lot.data.current_lot_version_id,created_by:session.user.id}).select('*').single();
    if(result.error)throw result.error;
    return result.data;
  }
  async retireProductionPlanAdjustment(lotId,fieldName){
    if(!lotId||!fieldName)throw new Error('Selecciona el ajuste que deseas retirar.');
    const session=await this.requireSession(),result=await this.client.from('production_plan_manual_adjustments').update({is_active:false,updated_by:session.user.id}).eq('lot_id',lotId).eq('field_name',fieldName).eq('is_active',true).select('*').maybeSingle();
    if(result.error)throw result.error;
    return result.data;
  }
  async syncEmployeeMutations(){
    if(!navigator.onLine||!this.client||!(await this.session()))return{synced:0,pending:((await storeGet('records','supabase:employee-mutations'))||[]).length};
    const queued=(await storeGet('records','supabase:employee-mutations'))||[],remaining=[];let synced=0;
    for(const mutation of queued){try{if(mutation.action==='create')await this.createEmployee(mutation.employee,{queueOnFailure:false});else await this.updateEmployee(mutation.employee.id,mutation.employee,{queueOnFailure:false});synced++}catch{remaining.push(mutation)}}
    await storePut('records','supabase:employee-mutations',remaining);notifySync();return{synced,pending:remaining.length};
  }
  async syncPending(){const [fallbackResult,employeeResult]=await Promise.all([this.fallback.syncPending?.()||{synced:0,pending:0},this.syncEmployeeMutations()]);return{synced:(fallbackResult.synced||0)+employeeResult.synced,pending:(fallbackResult.pending||0)+employeeResult.pending}}
  async getPendingCount(){return(await this.fallback.getPendingCount?.()||0)+((await storeGet('records','supabase:employee-mutations'))||[]).length}
  async testConnection(){if(!this.client)return this.fallback.testConnection();const result=await this.client.auth.getSession();if(result.error)throw result.error;return{ok:true,message:result.data.session?'Supabase conectado y autenticado':'Supabase configurado; inicia sesión para consultar datos'}}
}

export const preferences={get(){try{return{...DEFAULTS,...JSON.parse(localStorage.getItem(PREFERENCES_KEY)||'{}')}}catch{return{...DEFAULTS}}},save(value){const allowed={apiUrl:value.apiUrl,serviceMode:value.serviceMode,plant:value.plant,area:value.area,prefix:value.prefix};localStorage.setItem(PREFERENCES_KEY,JSON.stringify({...this.get(),...allowed}))}};
export function createDataService(settings=preferences.get()){const fallback=settings.serviceMode==='google'?new GoogleDriveService(settings.apiUrl):new LocalDataService();return SUPABASE_ENV.SUPABASE_URL&&SUPABASE_ENV.SUPABASE_PUBLISHABLE_KEY?new SupabaseDataService(fallback):fallback}
