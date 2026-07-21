export const MATERIAL_ROWS={
  efm:[['coverGroup','Cover Group',9],['backPlane','BP',10],['tvSet','TV Set (Complete)',11]],
  pfa:[['tvSet','TV Set (Complete)',18],['smallParts','Small Parts',19],['serialNumber','Serial Number',20],['inputScan','Input Scan',21],['coverGroup','Cover Group',22],['mainBoard','Main Board',23]]
};
function materialCells(){
  const cells={internalModel:'B3',customerModel:'D3',rolling:'F3',line:'B4',date:'D4'};
  for(const[key,,row]of MATERIAL_ROWS.efm)Object.assign(cells,{[`efm_${key}_deliverySelected`]:`B${row}`,[`efm_${key}_deliveryQty`]:`C${row}`,[`efm_${key}_deliveryDate`]:`D${row}`,[`efm_${key}_receivedSelected`]:`E${row}`,[`efm_${key}_receivedQty`]:`F${row}`,[`efm_${key}_receivedDate`]:`G${row}`});
  for(const[key,,row]of MATERIAL_ROWS.pfa)Object.assign(cells,{[`pfa_${key}_selected`]:`B${row}`,[`pfa_${key}_part`]:`C${row}`,[`pfa_${key}_qtyDelivery`]:`D${row}`,[`pfa_${key}_deliveryDate`]:`E${row}`});
  Object.assign(cells,{efmDeliveryNpiSignature:'A14',efmDeliveryEfmSignature:'C14',efmReceivedNpiSignature:'E14',efmReceivedEfmSignature:'G14',pfaGeneralNpiSignature:'A26',pfaGeneralSignature:'D26',qmDeliveryPart:'B31',qmDeliveryQty:'D31',qmDeliveryDate:'E31',qmDeliverySignature:'F31',peDeliverySignature:'G31',qmReturnPart:'B32',qmReturnQty:'D32',qmReturnDate:'E32',qmReturnSignature:'F32',peReturnSignature:'G32'});
  return cells;
}
const FORM_CONFIG={
  material:{template:'templates/New_Model_Material_Delivery_Record_Corporate.xlsx',name:'New Model Material Delivery Record Rev 3.0',sheetFallback:'Sheet1',cells:materialCells()},
  change:{template:'templates/Model Change Format_Rev.06 Loss Time Record.xlsx',name:'Model Change Format Rev.06 Loss Time Record',sheetFallback:'Sheet1',cells:{rolling:'B4',order:'D4',material:'B6',internalModel:'D6',customerModel:'F6',date:'B8',shift:'D8',employee:'F8',lossTime:'B10',reason:'D10',notes:'B12'}}
};

export function getFormConfig(type){return FORM_CONFIG[type]}

export async function generateExcel(type,values,sourceBuffer){
  let buffer=sourceBuffer;
  if(!buffer){const response=await fetch(FORM_CONFIG[type].template);if(!response.ok)throw new Error('No se encontró la plantilla Excel.');buffer=await response.arrayBuffer()}
  if(window.ExcelJS){
    const workbook=new ExcelJS.Workbook();await workbook.xlsx.load(buffer);const sheet=workbook.worksheets[0];
    for(const[field,target]of Object.entries(FORM_CONFIG[type].cells)){if(values[field]===undefined||values[field]==='')continue;const addresses=Array.isArray(target)?target:[target];let signature=null,pending=false;try{const parsed=JSON.parse(values[field]);if(parsed?.kind==='signature')signature=parsed;if(parsed?.kind==='signature-request')pending=true}catch{}if(pending)continue;
      for(const address of addresses){const cell=sheet.getCell(address);if(signature){cell.value=`${signature.employeeNumber} · ${signature.fullName}`;cell.note=`Firma digital | ${signature.department} | ${signature.signedAt} | ${signature.method}`;if(signature.dataUrl){const imageId=workbook.addImage({base64:signature.dataUrl,extension:'png'}),match=address.match(/^([A-Z]+)(\d+)$/);let column=0;for(const char of match[1])column=column*26+char.charCodeAt(0)-64;workbook.getWorksheet(sheet.id).addImage(imageId,{tl:{col:column-1,row:Number(match[2])-1},ext:{width:field.startsWith('wh')?260:105,height:30},editAs:'oneCell'})}}else cell.value=field.endsWith('Selected')?'X':String(values[field])}
    }
    const bytes=await workbook.xlsx.writeBuffer(),prefix=(values.prefix||'MFG').replace(/[^a-z0-9_-]/gi,''),suffix=(values.order||values.rolling||Date.now()).toString().replace(/[^a-z0-9_-]/gi,'-'),fileName=`${prefix}_${type==='material'?'Material_Delivery':'Model_Change'}_${suffix}.xlsx`;return new File([bytes],fileName,{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'})
  }
  if(!window.XLSX)throw new Error('El generador de Excel no está disponible.');
  const workbook=XLSX.read(buffer,{type:'array',cellStyles:true,cellDates:true});
  const sheet=workbook.Sheets[workbook.SheetNames[0]];
  Object.entries(FORM_CONFIG[type].cells).forEach(([field,target])=>{if(values[field]===undefined||values[field]==='')return;const addresses=Array.isArray(target)?target:[target],value=field.endsWith('Selected')?'X':String(values[field]);addresses.forEach(address=>{sheet[address]={...(sheet[address]||{}),t:'s',v:value}})});
  const prefix=(values.prefix||'MFG').replace(/[^a-z0-9_-]/gi,'');
  const suffix=(values.order||values.rolling||Date.now()).toString().replace(/[^a-z0-9_-]/gi,'-');
  const fileName=`${prefix}_${type==='material'?'Material_Delivery':'Model_Change'}_${suffix}.xlsx`;
  const bytes=XLSX.write(workbook,{type:'array',cellStyles:true,bookType:'xlsx'});
  return new File([bytes],fileName,{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
}

export function downloadFile(file){const url=URL.createObjectURL(file),link=document.createElement('a');link.href=url;link.download=file.name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}
