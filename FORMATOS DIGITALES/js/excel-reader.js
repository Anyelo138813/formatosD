const COLUMN_ALIASES={
  line:['line','production line','linea','linea actual'],
  orderNo:['order no','order number','order','rolling'],
  rolling:['rolling','order no','order number'],
  materialCode:['material code','material no','material number','material'],
  sku:['sku'],
  internalModel:['internal model','model','modelo interno','modelo'],
  customerModel:['customer model','client model','modelo cliente'],
  materialType:['material type','packaging method','packing method','tipo material'],
  destination:['destination','country','destino','pais'],
  brand:['brand','marca'],
  peDoc:['pe doc','pe document','pe documentation'],
  orderQty:['order qty','order quantity','order q ty','qty order'],
  planQuantity:['plan quantity','planned quantity','plan qty','production quantity'],
  productionDate:['production date','plan date','date'],
  workOrderNo:['work order no','work order number','wo no','work order'],
  plannedStartTime:['planned start time','plan start time','start time'],
  plannedEndTime:['planned end time','plan end time','end time']
  ,screenRequirements:['screen requirements']
  ,packagingMethod:['packaging method','packing method']
  ,uph:['uph']
  ,eta:['eta']
  ,planType:['plan type']
  ,otd:['otd']
  ,orderRemarks:['order remarks']
  ,priority:['priority']
  ,materialDescription:['material description']
  ,keyMaterialNumber:['key material number']
  ,fgModel:['fg model']
  ,customer:['customer']
  ,keyMaterialPlannedQuantity:['key material planned quantity']
  ,prePlanning:['pre planning','pre-planning']
  ,productionStatus:['production status']
  ,planningStatus:['planning status']
  ,scheduleStatus:['schedule status']
  ,remark:['remark']
  ,basePlanNumber:['base plan number']
  ,timeConsuming:['time consuming']
  ,trialProductionTime:['trial production time']
  ,earliestProductionStartTime:['earliest production start time']
  ,latestProductionEndTime:['latest production end time']
  ,dockingFinishedGoodsId:['docking finished goods id pre process','docking finished goods id (pre-process)']
  ,assembly:['assembly']
  ,partNumber800:['800 part number']
};

const EMPLOYEE_ALIASES={
  employeeNumber:['employee id','employee number','employee no','no employee','no. employee','no empleado','no. de empleado','numero de empleado','numero empleado','numero','number','id'],
  fullName:['name','full name','employee name','nombre','nombre completo'],
  shift:['shift','turn','turno'],
  line:['line','production line','linea','linea actual'],
  area:['area','department','dept','line area','linea area','area linea','departamento'],
  department:['department','dept','departamento'],
  position:['position','job','role','puesto'],
  operation:['operation','process','skill','operacion','proceso'],
  packingCategory:['packing category','categoria packing','categoria empaque'],
  lineArea:['line area','linea area','area de linea']
};

export const normalizeColumnName=value=>String(value??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[\r\n]+/g,' ').replace(/[._-]+/g,' ').replace(/\s+/g,' ').trim().toLowerCase();
const compact=value=>normalizeColumnName(value).replace(/[^a-z0-9]/g,'');
const cleanText=value=>String(value??'').replace(/\s+/g,' ').trim();
const aliasIndex=new Map(Object.entries(COLUMN_ALIASES).flatMap(([field,aliases])=>aliases.map(alias=>[compact(alias),field])));
const canonicalField=header=>aliasIndex.get(compact(header))||null;
function employeeField(header){const key=compact(header),entries=Object.entries(EMPLOYEE_ALIASES).flatMap(([field,aliases])=>aliases.map(alias=>({field,alias:compact(alias)})));const exact=entries.find(item=>key===item.alias);if(exact)return exact.field;const prefix=entries.filter(item=>key.startsWith(item.alias)).sort((a,b)=>b.alias.length-a.alias.length)[0];return prefix?.field||null}
const completeScore=employee=>['employeeNumber','fullName','shift','line','area','department','position','operation','packingCategory','lineArea'].reduce((score,field)=>score+(cleanText(employee[field])?1:0),0);
const skillQualified=value=>{const normalized=normalizeColumnName(value);return Boolean(normalized)&&!['0','no','n','false','na','n a','sin calificar'].includes(normalized)};
function uniqueHeaders(headers){const seen=new Map();return headers.map((header,index)=>{const base=header||`Column ${index+1}`,count=(seen.get(base)||0)+1;seen.set(base,count);return count===1?base:`${base}__${count}`})}
function sheetMatrix(sheet){return XLSX.utils.sheet_to_json(sheet,{header:1,defval:'',raw:false,blankrows:false})}
function sheetHasContent(sheet){return sheetMatrix(sheet).some(row=>row.some(value=>cleanText(value)))}

function parseScheduleHeader(header){
  const clean=String(header??'').replace(/[\r\n]+/g,' ').replace(/_/g,'-').replace(/\s+/g,' ').trim();
  const match=clean.match(/(?:^|\s)(?:(\d{4})[-/]\s*(\d{1,2})[-/]\s*(\d{1,2})|(\d{1,2})[-/]\s*(\d{1,2}))(?:\s*\([^)]*\))?\s+(day|night|dia|noche|1st|2nd|3rd)(?:\s|$)/i);
  if(!match)return null;
  const date=match[1]?`${match[1]}-${match[2].padStart(2,'0')}-${match[3].padStart(2,'0')}`:`${match[4].padStart(2,'0')}-${match[5].padStart(2,'0')}`;
  const shift=/night|noche/i.test(match[6])?'Night':/day|dia/i.test(match[6])?'Day':match[6];
  return{date,shift,sourceColumn:cleanText(header)};
}

function buildHeaders(rows,index,depth){
  const width=Math.max(rows[index]?.length||0,rows[index+1]?.length||0);
  let carriedTop='';
  return Array.from({length:width},(_,column)=>{
    const top=cleanText(rows[index]?.[column]),bottom=depth===2?cleanText(rows[index+1]?.[column]):'';
    if(top)carriedTop=top;
    if(!bottom)return top;
    if(canonicalField(bottom)||parseScheduleHeader(bottom))return bottom;
    if(!top&&/^(day|night|dia|noche|1st|2nd|3rd)$/i.test(bottom)&&carriedTop)return`${carriedTop} ${bottom}`;
    if(!top)return bottom;
    return normalizeColumnName(top)===normalizeColumnName(bottom)?top:`${top} ${bottom}`;
  });
}

function scoreHeaders(headers){const fields=new Set();let schedules=0;for(const header of headers){const field=canonicalField(header);if(field)fields.add(field);if(parseScheduleHeader(header))schedules++}return fields.size*10+schedules*3+(fields.has('rolling')||fields.has('orderNo')?8:0)}
function detectHeaders(rows){let best=null;for(let index=0;index<Math.min(rows.length,35);index++){for(const depth of[1,2]){if(depth===2&&!rows[index+1])continue;const headers=buildHeaders(rows,index,depth),score=scoreHeaders(headers);if(!best||score>best.score)best={index,depth,headers,score}}}if(!best||best.score<20)throw new Error('No se reconocio la fila de encabezados del plan. Verifica que incluya Order No., Rolling, Material Code o Model.');return best}
const valueAt=(row,map,field)=>{const index=map.get(field);return index===undefined?'':row[index]??''};
const numberValue=value=>{if(typeof value==='number')return value;const parsed=Number(String(value??'').replace(/,/g,'').trim());return Number.isFinite(parsed)?parsed:null};
const nullText=value=>{const text=String(value??'').trim();return text||null};
function canonicalDate(value){if(value instanceof Date&&!Number.isNaN(value.valueOf()))return value.toISOString().slice(0,10);const text=String(value??'').trim();if(!text)return null;const iso=text.match(/^(\d{4})[-/]?(\d{1,2})[-/]?(\d{1,2})/);if(iso)return`${iso[1]}-${iso[2].padStart(2,'0')}-${iso[3].padStart(2,'0')}`;const parsed=new Date(text);return Number.isNaN(parsed.valueOf())?text:`${parsed.getFullYear()}-${String(parsed.getMonth()+1).padStart(2,'0')}-${String(parsed.getDate()).padStart(2,'0')}`}
function scheduleDate(value,productionDate){if(/^\d{4}-\d{2}-\d{2}$/.test(value))return value;const match=String(value).match(/^(\d{2})-(\d{2})$/),production=canonicalDate(productionDate);if(!match||!/^\d{4}-/.test(production||''))return null;let year=Number(production.slice(0,4)),month=Number(match[1]),productionMonth=Number(production.slice(5,7));if(month+6<productionMonth)year++;else if(productionMonth+6<month)year--;return`${year}-${match[1]}-${match[2]}`}

export function parseProductionSheet(sheet,fileName='production-plan.xlsx'){
  const matrix=sheetMatrix(sheet);
  if(!matrix.length||!matrix.some(row=>row.some(value=>cleanText(value))))throw new Error('El archivo del plan de produccion esta vacio.');
  const detected=detectHeaders(matrix),fieldColumns=new Map(),scheduleColumns=[];
  detected.headers.forEach((header,index)=>{const field=canonicalField(header),schedule=parseScheduleHeader(header);if(field&&!fieldColumns.has(field))fieldColumns.set(field,index);if(schedule)scheduleColumns.push({index,...schedule})});
  const recognized=[...fieldColumns.keys()],unrecognized=detected.headers.filter(header=>header&&!canonicalField(header)&&!parseScheduleHeader(header));
  console.groupCollapsed(`[Production Plan] ${fileName}`);console.info('Header row:',detected.index+1,'Header depth:',detected.depth);console.table([...fieldColumns].map(([field,index])=>({field,sourceColumn:detected.headers[index]})));console.info('Schedule columns:',scheduleColumns.map(x=>x.sourceColumn));console.info('Unrecognized columns:',unrecognized);console.groupEnd();
  const sourceHeaders=uniqueHeaders(detected.headers),dataStart=detected.index+detected.depth,stagingRows=matrix.slice(dataStart).map((row,rowOffset)=>{
    const order=valueAt(row,fieldColumns,'orderNo'),rolling=valueAt(row,fieldColumns,'rolling');
    const productionDate=canonicalDate(valueAt(row,fieldColumns,'productionDate'));
    const schedules=scheduleColumns.map(column=>({date:scheduleDate(column.date,productionDate),shift:String(column.shift).toLowerCase(),quantity:numberValue(row[column.index]),sourceColumn:column.sourceColumn})).filter(item=>item.date&&item.quantity!==null&&item.quantity>0);
    const raw=Object.fromEntries(sourceHeaders.map((header,index)=>[header,row[index]??'']));
    const sourceRowNumber=dataStart+rowOffset+1,materialCode=nullText(valueAt(row,fieldColumns,'materialCode')),basePlanNumber=nullText(valueAt(row,fieldColumns,'basePlanNumber')),orderNo=nullText(order||rolling);
    const auxiliaryLookup={'allocation quantity':'allocation_quantity','transfer hours':'transfer_hours','total working hours':'total_working_hours'},auxiliaryType=auxiliaryLookup[normalizeColumnName(materialCode)];
    const canonical={line:nullText(valueAt(row,fieldColumns,'line')),orderNo,basePlanNumber,materialCode,sku:nullText(valueAt(row,fieldColumns,'sku')),internalModel:nullText(valueAt(row,fieldColumns,'internalModel')),customerModel:nullText(valueAt(row,fieldColumns,'customerModel')),screenRequirements:nullText(valueAt(row,fieldColumns,'screenRequirements')),materialType:nullText(valueAt(row,fieldColumns,'materialType')),packagingMethod:nullText(valueAt(row,fieldColumns,'packagingMethod')),uph:numberValue(valueAt(row,fieldColumns,'uph')),destination:nullText(valueAt(row,fieldColumns,'destination')),brand:nullText(valueAt(row,fieldColumns,'brand')),peDoc:nullText(valueAt(row,fieldColumns,'peDoc')),orderQty:numberValue(valueAt(row,fieldColumns,'orderQty')),productionDate,eta:canonicalDate(valueAt(row,fieldColumns,'eta')),planQuantity:numberValue(valueAt(row,fieldColumns,'planQuantity')),planType:nullText(valueAt(row,fieldColumns,'planType')),otd:canonicalDate(valueAt(row,fieldColumns,'otd')),orderRemarks:nullText(valueAt(row,fieldColumns,'orderRemarks')),priority:nullText(valueAt(row,fieldColumns,'priority')),materialDescription:nullText(valueAt(row,fieldColumns,'materialDescription')),keyMaterialNumber:nullText(valueAt(row,fieldColumns,'keyMaterialNumber')),fgModel:nullText(valueAt(row,fieldColumns,'fgModel')),customer:nullText(valueAt(row,fieldColumns,'customer')),keyMaterialPlannedQuantity:numberValue(valueAt(row,fieldColumns,'keyMaterialPlannedQuantity')),prePlanning:nullText(valueAt(row,fieldColumns,'prePlanning')),productionStatus:nullText(valueAt(row,fieldColumns,'productionStatus')),planningStatus:nullText(valueAt(row,fieldColumns,'planningStatus')),scheduleStatus:nullText(valueAt(row,fieldColumns,'scheduleStatus')),remark:nullText(valueAt(row,fieldColumns,'remark')),workOrderNo:nullText(valueAt(row,fieldColumns,'workOrderNo')),plannedStartTime:nullText(valueAt(row,fieldColumns,'plannedStartTime')),plannedEndTime:nullText(valueAt(row,fieldColumns,'plannedEndTime')),timeConsuming:numberValue(valueAt(row,fieldColumns,'timeConsuming')),trialProductionTime:nullText(valueAt(row,fieldColumns,'trialProductionTime')),earliestProductionStartTime:nullText(valueAt(row,fieldColumns,'earliestProductionStartTime')),latestProductionEndTime:nullText(valueAt(row,fieldColumns,'latestProductionEndTime')),dockingFinishedGoodsId:nullText(valueAt(row,fieldColumns,'dockingFinishedGoodsId')),assembly:nullText(valueAt(row,fieldColumns,'assembly')),partNumber800:nullText(valueAt(row,fieldColumns,'partNumber800')),schedules};
    const hasContent=Object.values(raw).some(value=>String(value??'').trim());
    const rowKind=!hasContent?'blank':auxiliaryType?'auxiliary':orderNo&&basePlanNumber?'data':'rejected';
    return{id:`${compact(basePlanNumber||orderNo||fileName)}-${sourceRowNumber}`,sourceRowNumber,rowKind,auxiliaryType,line:canonical.line||'',rolling:orderNo||'',orderNo:orderNo||'',basePlanNumber:basePlanNumber||'',materialCode:materialCode||'',sku:canonical.sku||'',internalModel:canonical.internalModel||'',customerModel:canonical.customerModel||'',materialType:canonical.materialType||canonical.packagingMethod||'',destination:canonical.destination||'',brand:canonical.brand||'',peDoc:canonical.peDoc||'',orderQty:canonical.orderQty,planQuantity:canonical.planQuantity,productionDate:canonical.productionDate||'',workOrderNo:canonical.workOrderNo||'',plannedStartTime:canonical.plannedStartTime||'',plannedEndTime:canonical.plannedEndTime||'',schedules,canonical,raw};
  }).filter(record=>record.rowKind!=='blank');
  const records=stagingRows.filter(record=>record.rowKind==='data');
  if(!records.length)throw new Error('Se detectaron encabezados, pero el plan no contiene registros validos.');
  return{rows:records,stagingRows,auxiliaryRows:stagingRows.filter(record=>record.rowKind==='auxiliary'),rejectedRows:stagingRows.filter(record=>record.rowKind==='rejected'),totalRows:stagingRows.length,headers:detected.headers,headerRow:detected.index+1,headerDepth:detected.depth,recognizedColumns:recognized,unrecognizedColumns:unrecognized};
}

export function parseEmployeeSheet(sheet,fileName='employees.xlsx',sheetName=''){
  const started=performance.now();
  const matrix=sheetMatrix(sheet);
  if(!matrix.length||!matrix.some(row=>row.some(value=>cleanText(value))))throw new Error('El archivo de empleados esta vacio.');
  let detected=null;
  for(let index=0;index<Math.min(matrix.length,35);index++){const headers=matrix[index].map(cleanText),fields=headers.map(employeeField).filter(Boolean),score=new Set(fields).size*10+(fields.includes('employeeNumber')?16:0)+(fields.includes('fullName')?16:0);if(!detected||score>detected.score)detected={index,headers,score}}
  if(!detected||detected.score<24)throw new Error('No se reconoce la fila de encabezados de empleados.');
  const fieldColumns=new Map();detected.headers.forEach((header,index)=>{const field=employeeField(header);if(field&&!fieldColumns.has(field))fieldColumns.set(field,index)});
  const nameIndex=fieldColumns.get('fullName'),numberCandidates=detected.headers.map((header,index)=>({field:employeeField(header),index})).filter(item=>item.field==='employeeNumber').map(item=>item.index);
  if(nameIndex!==undefined&&numberCandidates.length>1){const beforeName=numberCandidates.filter(index=>index<nameIndex);fieldColumns.set('employeeNumber',beforeName.length?Math.max(...beforeName):numberCandidates[0])}
  if(!fieldColumns.has('fullName'))throw new Error('No se encontro ninguna columna de nombre de empleado.');
  if(!fieldColumns.has('employeeNumber'))throw new Error('No se encontro ninguna columna de numero de empleado.');
  const sourceHeaders=uniqueHeaders(detected.headers),unrecognized=detected.headers.filter(header=>header&&!employeeField(header));
  const sourceRows=matrix.slice(detected.index+1).filter(row=>row.some(value=>cleanText(value)));
  const skillColumns=detected.headers.map((header,index)=>({header,key:compact(header)||`column${index+1}`,index})).filter(column=>column.header&&!employeeField(column.header)&&column.index>(nameIndex??-1));
  const byKey=new Map();let duplicates=0,rejected=0;
  sourceRows.forEach((row,rowOffset)=>{
    const get=field=>{const index=fieldColumns.get(field);return cleanText(index===undefined?'':row[index]??'')};
    const employeeNumber=get('employeeNumber'),fullName=get('fullName'),line=get('line'),area=get('area');
    if(!employeeNumber||!fullName){rejected++;return}
    const raw=Object.fromEntries(sourceHeaders.map((header,index)=>[header,row[index]??'']));
    const skills=skillColumns.map(column=>({key:column.key,name:column.header,value:cleanText(row[column.index]??''),isQualified:skillQualified(row[column.index]),raw:{sourceColumn:column.header,sourceValue:row[column.index]??''}})).filter(skill=>skill.value);
    const employee={id:employeeNumber,employeeNumber,fullName,shift:get('shift'),line,area,department:get('department'),position:get('position'),operation:get('operation'),packingCategory:get('packingCategory'),lineArea:get('lineArea'),raw,skills};
    const key=employeeNumber?`number:${compact(employeeNumber)}`:`fallback:${compact(fullName)}|${compact(line)}|${compact(area)}`;
    if(byKey.has(key)){duplicates++;const current=byKey.get(key),preferred=completeScore(employee)>completeScore(current)?employee:current,secondary=preferred===employee?current:employee;for(const field of['fullName','shift','line','area','department','position','operation','packingCategory','lineArea'])if(!cleanText(preferred[field]))preferred[field]=secondary[field];preferred.raw={...secondary.raw,...preferred.raw,_sourceRows:[...(secondary.raw?._sourceRows||[secondary.raw]),...(preferred.raw?._sourceRows||[preferred.raw])]};const mergedSkills=new Map([...secondary.skills,...preferred.skills].map(skill=>[skill.key,skill]));preferred.skills=[...mergedSkills.values()];byKey.set(key,preferred);return}
    byKey.set(key,employee);
  });
  const employees=[...byKey.values()];
  if(!employees.length)throw new Error('Se detectaron encabezados, pero no existen empleados validos.');
  const elapsed=Math.round(performance.now()-started);
  console.groupCollapsed(`[Employees] ${fileName}`);console.info('Sheet used:',sheetName||'(first content sheet)');console.info('Header row:',detected.index+1);console.table([...fieldColumns].map(([field,index])=>({field,sourceColumn:detected.headers[index]})));console.info('Unrecognized columns:',unrecognized);console.info('Total rows read:',sourceRows.length);console.info('Valid employees:',employees.length);console.info('Duplicates removed:',duplicates);console.info('Processing time:',`${elapsed} ms`);console.groupEnd();
  return{rows:employees,headers:detected.headers,headerRow:detected.index+1,totalRows:sourceRows.length,duplicates,rejected,recognizedColumns:[...fieldColumns.keys()],unrecognizedColumns:unrecognized,processingTime:elapsed};
}

function readWorkbook(file,production=false){return new Promise((resolve,reject)=>{if(!window.XLSX)return reject(new Error('SheetJS no esta disponible. Revisa tu conexion.'));const reader=new FileReader();reader.onerror=()=>reject(new Error('No fue posible leer el archivo.'));reader.onload=()=>{try{const workbook=XLSX.read(reader.result,{type:'array',cellDates:true,cellStyles:true});if(!workbook.SheetNames.length)throw new Error('El libro no contiene hojas.');const sheetName=workbook.SheetNames[0],sheet=workbook.Sheets[sheetName];const parsed=production?parseProductionSheet(sheet,file.name):{rows:XLSX.utils.sheet_to_json(sheet,{defval:'',raw:false})};resolve({workbook,sheetName,...parsed,fileName:file.name,buffer:reader.result,loadedAt:new Date().toISOString()})}catch(e){reject(new Error(`No fue posible procesar el Excel: ${e.message}`))}};reader.readAsArrayBuffer(file)})}
export const readExcel=file=>readWorkbook(file,false);
export const readProductionPlan=file=>readWorkbook(file,true);
export function readEmployeeDatabase(file){return new Promise((resolve,reject)=>{if(!window.XLSX)return reject(new Error('SheetJS no esta disponible. Revisa tu conexion.'));const reader=new FileReader();reader.onerror=()=>reject(new Error('No fue posible leer el archivo de empleados.'));reader.onload=()=>{try{const workbook=XLSX.read(reader.result,{type:'array',cellDates:true});if(!workbook.SheetNames.length)throw new Error('El libro no contiene hojas.');const sheetName=workbook.SheetNames.find(name=>sheetHasContent(workbook.Sheets[name]));if(!sheetName)throw new Error('El archivo de empleados esta vacio.');const parsed=parseEmployeeSheet(workbook.Sheets[sheetName],file.name,sheetName);resolve({workbook,sheetName,...parsed,fileName:file.name,buffer:reader.result,loadedAt:new Date().toISOString()})}catch(e){reject(new Error(`No fue posible procesar empleados: ${e.message}`))}};reader.readAsArrayBuffer(file)})}
export function filterRows(rows,term){const q=normalizeColumnName(term);if(!q)return rows;return rows.filter(row=>Object.values(row).some(value=>!Array.isArray(value)&&typeof value!=='object'&&normalizeColumnName(value).includes(q)))}
export function findField(record,aliases){const key=Object.keys(record||{}).find(k=>aliases.some(alias=>compact(k).includes(compact(alias))));return key?record[key]:''}
