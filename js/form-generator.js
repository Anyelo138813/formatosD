export const MATERIAL_ROWS={
  efm:[['coverGroup','Cover Group',10],['backPlane','Backplane',11],['tvSet','TV Set (Complete)',12]],
  pfa:[['tvSet','TV Set (Complete)',18],['smallParts','Small Parts',19],['adjustmentValidation','Adjustment validation',20],['inputScan','Input Scan',21],['packaging','Packaging',22]]
};

function materialCells(){
  const cells={internalModel:'B3',customerModel:'D3',rolling:'F3',line:'B4',date:'D4',materialType:'F4'};
  for(const[key,,row]of MATERIAL_ROWS.efm)Object.assign(cells,{[`efm_${key}_selected`]:`B${row}`,[`efm_${key}_qty`]:`C${row}`});
  for(const[key,,row]of MATERIAL_ROWS.pfa)Object.assign(cells,{[`pfa_${key}_selected`]:`B${row}`});
  Object.assign(cells,{
    efmDeliveryDate:'E8',efmReturnDate:'E9',
    efmNpiSignature:'A14',efmDeliveryEfmSignature:'C14',efmReturnEfmSignature:'E14',
    pfaDeliveryDate:'C18',pfaSerialNumber:'C21',pfaQty:'D21',
    pfaNpiSignature:'A24',pfaSignature:'D24',
    qmSelected:'B29',qmSerialNumber:'C29',qmQty:'E28',qmDeliveryDate:'B30',
    qmNpiSignature:'A32',qmSignature:'D32'
  });
  return cells;
}

const FORM_CONFIG={
  material:{
    template:'templates/New_Model_Material_Delivery_Record_Corporate.xlsx',
    name:'New Model Material Delivery Record',
    sheetFallback:'Sheet1',
    cells:materialCells(),
    images:{efmEvidence:'D11:F12',pfaEvidence:'E18:F22',qmEvidence:'E29:F30'},
    signatures:{efmNpiSignature:'A14:B14',efmDeliveryEfmSignature:'C14:D14',efmReturnEfmSignature:'E14:F14',pfaNpiSignature:'A24:C24',pfaSignature:'D24:F24',qmNpiSignature:'A32:C32',qmSignature:'D32:F32'}
  },
  change:{template:'templates/Model Change Format_Rev.06 Loss Time Record.xlsx',name:'Model Change Format Rev.06 Loss Time Record',sheetFallback:'Sheet1',cells:{rolling:'B4',order:'D4',material:'B6',internalModel:'D6',customerModel:'F6',date:'B8',shift:'D8',employee:'F8',lossTime:'B10',reason:'D10',notes:'B12'}}
};

export function getFormConfig(type){return FORM_CONFIG[type]}

function generatedFileName(type,values){
  if(type==='material'){
    const date=/^\d{4}-\d{2}-\d{2}$/.test(values.date||'')
      ?values.date
      :new Date().toLocaleDateString('en-CA');
    return`NMMDR_${date}.xlsx`;
  }
  const prefix=(values.prefix||'MFG').replace(/[^a-z0-9_-]/gi,'');
  const suffix=(values.order||values.rolling||Date.now()).toString().replace(/[^a-z0-9_-]/gi,'-');
  return`${prefix}_Model_Change_${suffix}.xlsx`;
}

function parsePayload(value){
  if(value&&typeof value==='object'&&value.kind)return value;
  try{return JSON.parse(value)}catch{return null}
}

function imageElement(source){
  return new Promise((resolve,reject)=>{const image=new Image();image.onload=()=>resolve(image);image.onerror=()=>reject(new Error('No fue posible procesar la evidencia.'));image.src=source});
}

function rangeSize(sheet,range,minWidth=120,minHeight=80){
  const[startAddress,endAddress]=range.split(':'),start=sheet.getCell(startAddress),end=sheet.getCell(endAddress);
  let width=0,height=0;
  for(let column=start.col;column<=end.col;column++)width+=(sheet.getColumn(column).width||8.43)*7;
  for(let row=start.row;row<=end.row;row++)height+=(sheet.getRow(row).height||15)*(96/72);
  return{width:Math.max(minWidth,width),height:Math.max(minHeight,height)};
}

async function evidenceForRange(sheet,range,payload){
  const image=await imageElement(payload.dataUrl),box=rangeSize(sheet,range),scale=Math.min(2,1000/box.width),canvas=document.createElement('canvas');
  canvas.width=Math.max(1,Math.round(box.width*scale));canvas.height=Math.max(1,Math.round(box.height*scale));
  const context=canvas.getContext('2d');context.fillStyle='#ffffff';context.fillRect(0,0,canvas.width,canvas.height);
  const margin=Math.max(5,Math.round(Math.min(canvas.width,canvas.height)*.035)),availableWidth=canvas.width-margin*2,availableHeight=canvas.height-margin*2,imageScale=Math.min(availableWidth/image.naturalWidth,availableHeight/image.naturalHeight),width=image.naturalWidth*imageScale,height=image.naturalHeight*imageScale;
  context.drawImage(image,(canvas.width-width)/2,(canvas.height-height)/2,width,height);
  return canvas.toDataURL('image/jpeg',.82);
}

export async function generateExcel(type,values,sourceBuffer){
  let buffer=sourceBuffer;
  if(!buffer){const response=await fetch(FORM_CONFIG[type].template);if(!response.ok)throw new Error('No se encontró la plantilla Excel.');buffer=await response.arrayBuffer()}
  if(window.ExcelJS){
    const workbook=new ExcelJS.Workbook();await workbook.xlsx.load(buffer);const sheet=workbook.worksheets[0],config=FORM_CONFIG[type];
    for(const target of Object.values(config.cells)){for(const address of(Array.isArray(target)?target:[target]))sheet.getCell(address).value=null}
    for(const[field,target]of Object.entries(config.cells)){
      if(values[field]===undefined||values[field]==='')continue;
      const addresses=Array.isArray(target)?target:[target],payload=parsePayload(values[field]);
      if(payload?.kind==='signature-request')continue;
      for(const address of addresses){
        const cell=sheet.getCell(address);
        if(payload?.kind==='signature'){
          cell.value=[payload.employeeNumber,payload.fullName].filter(Boolean).join(' · ');cell.note=`Firma digital | ${payload.department} | ${payload.signedAt} | ${payload.method}`;cell.alignment={...cell.alignment,horizontal:'center',vertical:'bottom',wrapText:true};
          if(payload.dataUrl){const imageId=workbook.addImage({base64:payload.dataUrl,extension:'png'}),match=address.match(/^([A-Z]+)(\d+)$/),box=rangeSize(sheet,config.signatures?.[field]||address,0,0),height=Math.min(70,box.height*.72),width=Math.min(box.width*.84,height*(700/220));let column=0;for(const char of match[1])column=column*26+char.charCodeAt(0)-64;const firstColumnWidth=(sheet.getColumn(column).width||8.43)*7,columnOffset=Math.max(.04,(box.width-width)/2/firstColumnWidth);sheet.addImage(imageId,{tl:{col:column-1+columnOffset,row:Number(match[2])-1+.02},ext:{width,height},editAs:'oneCell'})}
        }else cell.value=field.toLowerCase().endsWith('selected')?'X':String(values[field]);
      }
    }
    for(const[field,range]of Object.entries(config.images||{})){
      const payload=parsePayload(values[field]);if(payload?.kind!=='evidence'||!payload.dataUrl)continue;
      const imageId=workbook.addImage({base64:await evidenceForRange(sheet,range,payload),extension:'jpeg'});sheet.addImage(imageId,range);
    }
    const bytes=await workbook.xlsx.writeBuffer(),fileName=generatedFileName(type,values);return new File([bytes],fileName,{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'})
  }
  if(Object.keys(FORM_CONFIG[type].images||{}).some(field=>parsePayload(values[field])?.dataUrl))throw new Error('El generador de imágenes para Excel no está disponible.');
  if(!window.XLSX)throw new Error('El generador de Excel no está disponible.');
  const workbook=XLSX.read(buffer,{type:'array',cellStyles:true,cellDates:true}),sheet=workbook.Sheets[workbook.SheetNames[0]];
  for(const target of Object.values(FORM_CONFIG[type].cells)){for(const address of(Array.isArray(target)?target:[target]))if(sheet[address])sheet[address].v=''}
  Object.entries(FORM_CONFIG[type].cells).forEach(([field,target])=>{if(values[field]===undefined||values[field]==='')return;const addresses=Array.isArray(target)?target:[target],value=field.toLowerCase().endsWith('selected')?'X':String(values[field]);addresses.forEach(address=>{sheet[address]={...(sheet[address]||{}),t:'s',v:value}})});
  const fileName=generatedFileName(type,values),bytes=XLSX.write(workbook,{type:'array',cellStyles:true,bookType:'xlsx'});
  return new File([bytes],fileName,{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
}

export function downloadFile(file){const url=URL.createObjectURL(file),link=document.createElement('a');link.href=url;link.download=file.name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}
