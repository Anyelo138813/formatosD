export const MODEL_CHANGE_MAPPING={
  templateFile:'/templates/Model Change Format_Rev.06 Loss Time Record.xlsx',
  templateName:'Model Change Format_Rev.06 Loss Time Record.xlsx',
  sheetName:'Sheet1',
  printArea:'A1:M106',
  fields:{
    date:{label:'Date DD/MM/YY:',labelCell:'A3:B3',cell:'C3:D3',source:'selectedSchedule.date || currentProductionRecord.productionDate',type:'date',autofill:true},
    line:{label:'Line',labelCell:'A4:B4',cell:'A5:B5',source:'currentProductionRecord.line',type:'text',autofill:true},
    outputModel:{label:'Exit model',labelCell:'C4:E4',cell:'C5:E5',source:null,type:'text',manual:true},
    inputModel:{label:'Input model',labelCell:'F4:H4',cell:'F5:H5',source:'currentProductionRecord.internalModel',type:'text',autofill:true},
    shift:{label:'Shift',labelCell:'I4:J4',cell:'I5:J5',source:'selectedSchedule.shift',type:'select',options:['Day','Night'],autofill:true},
    inputTime:{label:'Input time',labelCell:'K4:L4',cell:'K5:L5',source:'currentProductionRecord.plannedStartTime',type:'time',autofill:true},
    lastSerialNumber:{label:'Last serial number',labelCell:'C5:E5',cell:null,source:null,type:'text',manual:true,needsReview:true},
    firstSerialNumber:{label:'First serial number',labelCell:'F5:H5',cell:null,source:null,type:'text',manual:true,needsReview:true},
    materialTypeMckd3a:{label:'MCKD-3A',labelCell:'C6:D6',cell:'C6:D6',source:'currentProductionRecord.materialType',type:'checkbox',autofill:true},
    materialTypeMckd1:{label:'MCKD-1',labelCell:'E6:F6',cell:'E6:F6',source:'currentProductionRecord.materialType',type:'checkbox',autofill:true},
    materialTypeCkd:{label:'CKD',labelCell:'G6:H6',cell:'G6:H6',source:'currentProductionRecord.materialType',type:'checkbox',autofill:true},
    materialTypeSkd:{label:'SKD',labelCell:'I6:J6',cell:'I6:J6',source:'currentProductionRecord.materialType',type:'checkbox',autofill:true},
    finishChangeTime:{label:'Finish change time',labelCell:'G45:H45',cell:'G46:H48',source:null,type:'time',manual:true},
    totalTime:{label:'Total time',labelCell:'I45:J45',cell:'I46:J48',source:'calculated',type:'number',manual:true},
    comments:{label:'Comments',labelCell:'A45:F45',cell:'A46:F52',source:null,type:'textarea',manual:true},
    pe:{label:'PE',labelCell:'K45:L45',cell:'K46:L48',source:null,type:'employee',manual:true},
    efmModule:{label:'EFM (Module)',labelCell:'G49:H49',cell:'G50:H52',source:null,type:'employee',manual:true},
    efmFinal:{label:'EFM (Final)',labelCell:'I49:J49',cell:'I50:J52',source:null,type:'employee',manual:true},
    pfaSv:{label:'PFA SV',labelCell:'K49:L49',cell:'K50:L52',source:null,type:'employee',manual:true}
  },
  lossTimeSections:[
    {id:'unpacking',name:'Unpacking',titleCell:'A9:B9',inputTimeCell:'A10:B10',rows:[{row:8,areaCell:'A8:B8',issuesCell:'C8:E8',timeCell:'F8',mainIssueCell:'G8:H8',responsibleCell:'I8',responsibleTimeCell:'J8',finishTimeCell:'K8:L8'},{row:9,areaCell:'A9:B9',issuesCell:'C9:E9',timeCell:'F9',mainIssueCell:'G9:H9',responsibleCell:'I9',responsibleTimeCell:'J9',finishTimeCell:'K9:L9'}]},
    {id:'inputBackPlane',name:'Input Back Plane',titleCell:'A13:B13',inputTimeCell:'A14:B14',rows:[{row:12,areaCell:'A12:B12',issuesCell:'C12:E12',timeCell:'F12',mainIssueCell:'G12:H12',responsibleCell:'I12',responsibleTimeCell:'J12',finishTimeCell:'K12:L12'},{row:13,areaCell:'A13:B13',issuesCell:'C13:E13',timeCell:'F13',mainIssueCell:'G13:H13',responsibleCell:'I13',responsibleTimeCell:'J13',finishTimeCell:'K13:L13'}]},
    {id:'cleanRoom',name:'Clean Room',titleCell:'A17:B19',inputTimeCell:'A20:B20',rows:[{row:16,areaCell:'A16:B16',issuesCell:'C16:E16',timeCell:'F16',mainIssueCell:'G16:H16',responsibleCell:'I16',responsibleTimeCell:'J16',finishTimeCell:'K16:L16'},{row:17,areaCell:'A17:B19',issuesCell:'C17:E17',timeCell:'F17',mainIssueCell:'G17:H17',responsibleCell:'I17',responsibleTimeCell:'J17',finishTimeCell:'K17:L17'},{row:18,areaCell:'A18:B18',issuesCell:'C18:E18',timeCell:'F18',mainIssueCell:'G18:H18',responsibleCell:'I18',responsibleTimeCell:'J18',finishTimeCell:'K18:L18'},{row:19,areaCell:'A19:B19',issuesCell:'C19:E19',timeCell:'F19',mainIssueCell:'G19:H19',responsibleCell:'I19',responsibleTimeCell:'J19',finishTimeCell:'K19:L19'}]},
    {id:'moduleAssy',name:'Module Assy',titleCell:'A23:B25',inputTimeCell:'A26:B26',rows:[{row:22,areaCell:'A22:B22',issuesCell:'C22:E22',timeCell:'F22',mainIssueCell:'G22:H22',responsibleCell:'I22',responsibleTimeCell:'J22',finishTimeCell:'K22:L22'},{row:23,areaCell:'A23:B25',issuesCell:'C23:E23',timeCell:'F23',mainIssueCell:'G23:H23',responsibleCell:'I23',responsibleTimeCell:'J23',finishTimeCell:'K23:L23'},{row:24,areaCell:'A24:B24',issuesCell:'C24:E24',timeCell:'F24',mainIssueCell:'G24:H24',responsibleCell:'I24',responsibleTimeCell:'J24',finishTimeCell:'K24:L24'},{row:25,areaCell:'A25:B25',issuesCell:'C25:E25',timeCell:'F25',mainIssueCell:'G25:H25',responsibleCell:'I25',responsibleTimeCell:'J25',finishTimeCell:'K25:L25'}]},
    {id:'finalAssembly',name:'Final Assembly',titleCell:'A29:B31',inputTimeCell:'A32:B32',rows:[{row:28,areaCell:'A28:B28',issuesCell:'C28:E28',timeCell:'F28',mainIssueCell:'G28:H28',responsibleCell:'I28',responsibleTimeCell:'J28',finishTimeCell:'K28:L28'},{row:29,areaCell:'A29:B31',issuesCell:'C29:E29',timeCell:'F29',mainIssueCell:'G29:H29',responsibleCell:'I29',responsibleTimeCell:'J29',finishTimeCell:'K29:L29'},{row:30,areaCell:'A30:B30',issuesCell:'C30:E30',timeCell:'F30',mainIssueCell:'G30:H30',responsibleCell:'I30',responsibleTimeCell:'J30',finishTimeCell:'K30:L30'},{row:31,areaCell:'A31:B31',issuesCell:'C31:E31',timeCell:'F31',mainIssueCell:'G31:H31',responsibleCell:'I31',responsibleTimeCell:'J31',finishTimeCell:'K31:L31'}]},
    {id:'adjusment',name:'Adjusment',titleCell:'A35:B37',inputTimeCell:'A38:B38',rows:[{row:34,areaCell:'A34:B34',issuesCell:'C34:E34',timeCell:'F34',mainIssueCell:'G34:H34',responsibleCell:'I34',responsibleTimeCell:'J34',finishTimeCell:'K34:L34'},{row:35,areaCell:'A35:B37',issuesCell:'C35:E35',timeCell:'F35',mainIssueCell:'G35:H35',responsibleCell:'I35',responsibleTimeCell:'J35',finishTimeCell:'K35:L35'},{row:36,areaCell:'A36:B36',issuesCell:'C36:E36',timeCell:'F36',mainIssueCell:'G36:H36',responsibleCell:'I36',responsibleTimeCell:'J36',finishTimeCell:'K36:L36'},{row:37,areaCell:'A37:B37',issuesCell:'C37:E37',timeCell:'F37',mainIssueCell:'G37:H37',responsibleCell:'I37',responsibleTimeCell:'J37',finishTimeCell:'K37:L37'}]},
    {id:'packing',name:'Packing',titleCell:'A41:B42',inputTimeCell:'A43:B43',rows:[{row:40,areaCell:'A40:B40',issuesCell:'C40:E40',timeCell:'F40',mainIssueCell:'G40:H40',responsibleCell:'I40',responsibleTimeCell:'J40',finishTimeCell:'K40:L40'},{row:41,areaCell:'A41:B42',issuesCell:'C41:E41',timeCell:'F41',mainIssueCell:'G41:H41',responsibleCell:'I41',responsibleTimeCell:'J41',finishTimeCell:'K41:L41'},{row:42,areaCell:'A42:B42',issuesCell:'C42:E42',timeCell:'F42',mainIssueCell:'G42:H42',responsibleCell:'I42',responsibleTimeCell:'J42',finishTimeCell:'K42:L42'}]}
  ],
  pendingReview:[
    'La plantilla contiene Last serial number y First serial number como etiquetas en C5:E5 y F5:H5; no hay una celda vacia unica claramente separada para su captura.',
    'La segunda pagina repite encabezados desde A53:M106, pero no contiene nombres de area visibles en shared strings; se conserva como pendiente hasta validacion visual.'
  ]
};
