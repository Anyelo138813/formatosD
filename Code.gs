/**
 * Digital Forms - Google Apps Script backend
 *
 * Deploy this project as a Web App and run it as the script owner.
 * The Vercel frontend must call this endpoint with POST JSON:
 * { "action": "getActiveProductionPlan" }
 *
 * Google Apps Script note about CORS:
 * ContentService does not expose custom Access-Control-Allow-Origin headers.
 * This backend is compatible with browser calls by accepting text/plain JSON,
 * which avoids a preflight request from the frontend.
 */

var APP_NAME = 'Digital Forms';
var ROOT_FOLDER_NAME = 'Digital Forms';
var CONFIG_SHEET_NAME = 'Config';
var REGISTRY_SHEET_NAME = 'FileRegistry';
var DEFAULT_MAX_FILE_SIZE_MB = 25;

var CONFIG_KEYS = {
  productionPlan: 'activeProductionPlanFileId',
  employees: 'activeEmployeeDatabaseFileId',
  materialTemplate: 'activeMaterialDeliveryTemplateFileId',
  modelChangeTemplate: 'activeModelChangeTemplateFileId'
};

var PROP_KEYS = {
  rootFolderId: 'ROOT_FOLDER_ID',
  configSpreadsheetId: 'CONFIG_SPREADSHEET_ID',
  productionActiveFolderId: 'PRODUCTION_ACTIVE_FOLDER_ID',
  productionArchiveFolderId: 'PRODUCTION_ARCHIVE_FOLDER_ID',
  employeesActiveFolderId: 'EMPLOYEES_ACTIVE_FOLDER_ID',
  employeesArchiveFolderId: 'EMPLOYEES_ARCHIVE_FOLDER_ID',
  templatesActiveFolderId: 'TEMPLATES_ACTIVE_FOLDER_ID',
  templatesArchiveFolderId: 'TEMPLATES_ARCHIVE_FOLDER_ID',
  generatedFilesFolderId: 'GENERATED_FILES_FOLDER_ID',
  signaturesFolderId: 'SIGNATURES_FOLDER_ID',
  maxFileSizeMb: 'MAX_FILE_SIZE_MB'
};

var FILE_TYPES = {
  productionPlan: {
    label: 'Production Plan',
    configKey: CONFIG_KEYS.productionPlan,
    activeFolderProp: PROP_KEYS.productionActiveFolderId,
    archiveFolderProp: PROP_KEYS.productionArchiveFolderId
  },
  employees: {
    label: 'Employee Database',
    configKey: CONFIG_KEYS.employees,
    activeFolderProp: PROP_KEYS.employeesActiveFolderId,
    archiveFolderProp: PROP_KEYS.employeesArchiveFolderId
  }
};

function doGet(e) {
  try {
    var action = e && e.parameter && e.parameter.action ? e.parameter.action : 'ping';
    return routeRequest(action, e.parameter || {});
  } catch (err) {
    return jsonResponse(false, 'Request failed', sanitizeError_(err));
  }
}

function doPost(e) {
  try {
    var body = parseRequestBody_(e);
    return routeRequest(body.action, body);
  } catch (err) {
    return jsonResponse(false, 'Request failed', sanitizeError_(err));
  }
}

function routeRequest(action, payload) {
  Logger.log('Digital Forms action: ' + action);

  switch (action) {
    case 'ping':
      return jsonResponse(true, 'Connection ready', '', { status: 'ok', app: APP_NAME });
    case 'getActiveProductionPlan':
      return getActiveFile(FILE_TYPES.productionPlan);
    case 'replaceProductionPlan':
      return replaceActiveFile(FILE_TYPES.productionPlan, payload);
    case 'getActiveEmployeeDatabase':
      return getActiveFile(FILE_TYPES.employees);
    case 'replaceEmployeeDatabase':
      return replaceActiveFile(FILE_TYPES.employees, payload);
    case 'uploadTemplate':
      return uploadTemplate_(payload);
    case 'getTemplates':
      return getTemplates_();
    case 'saveGeneratedFile':
      return saveGeneratedFile_(payload);
    case 'getGeneratedFiles':
      return getGeneratedFiles_();
    case 'getConfiguration':
      return jsonResponse(true, 'Configuration loaded', '', getPublicConfiguration_(), { configuration: getPublicConfiguration_() });
    case 'saveConfiguration':
      return savePublicConfiguration_(payload.configuration || {});
    case 'createSignatureRequest':
      return createSignatureRequest_(payload);
    case 'getSignatureRequest':
      return getSignatureRequest_(payload.token);
    case 'submitSignature':
      return submitSignature_(payload);
    default:
      return jsonResponse(false, 'Unsupported action', 'Unknown action');
  }
}

function templateConfig_(type) {
  return type === 'material'
    ? { type: 'material', key: CONFIG_KEYS.materialTemplate }
    : { type: 'change', key: CONFIG_KEYS.modelChangeTemplate };
}

function uploadTemplate_(payload) {
  ensureReady_();
  validateUploadPayload_(payload);
  var config = templateConfig_((payload.metadata || {}).type);
  var active = DriveApp.getFolderById(getRequiredProperty_(PROP_KEYS.templatesActiveFolderId));
  var archive = DriveApp.getFolderById(getRequiredProperty_(PROP_KEYS.templatesArchiveFolderId));
  var previousId = getConfigValue(config.key);
  if (previousId) archivePreviousFile_(previousId, active, archive);
  var filePayload = payload.file;
  var blob = base64ToBlob(filePayload.base64, filePayload.type || filePayload.mimeType, sanitizeFileName(filePayload.name));
  var file = active.createFile(blob).setName(blob.getName());
  setConfigValue(config.key, file.getId());
  return jsonResponse(true, 'Template saved', '', { fileId: file.getId(), type: config.type });
}

function getTemplates_() {
  ensureReady_();
  var templates = [];
  ['material', 'change'].forEach(function(type) {
    var config = templateConfig_(type);
    var id = getConfigValue(config.key);
    if (!id) return;
    try {
      var file = DriveApp.getFileById(id);
      var blob = file.getBlob();
      templates.push({ type: type, file: { name: file.getName(), type: blob.getContentType(), base64: blobToBase64(blob) } });
    } catch (err) {
      setConfigValue(config.key, '');
    }
  });
  return jsonResponse(true, 'Templates loaded', '', { templates: templates }, { templates: templates });
}

function saveGeneratedFile_(payload) {
  ensureReady_();
  validateUploadPayload_(payload);
  var metadata = payload.metadata || {};
  var folder = DriveApp.getFolderById(getRequiredProperty_(PROP_KEYS.generatedFilesFolderId));
  var clientId = sanitizeText_(metadata.clientId || '');
  if (clientId) {
    var existing = folder.getFiles();
    while (existing.hasNext()) {
      var existingFile = existing.next();
      try { if (JSON.parse(existingFile.getDescription() || '{}').clientId === clientId) return jsonResponse(true, 'File already synchronized', '', { fileId: existingFile.getId(), clientId: clientId }); } catch (ignore) {}
    }
  }
  var filePayload = payload.file;
  var blob = base64ToBlob(filePayload.base64, filePayload.type || filePayload.mimeType, sanitizeFileName(filePayload.name));
  var file = folder.createFile(blob).setName(blob.getName());
  var description = { clientId: clientId, type: sanitizeText_(metadata.type), order: sanitizeText_(metadata.order), date: new Date().toISOString() };
  file.setDescription(JSON.stringify(description));
  return jsonResponse(true, 'Generated file saved', '', { fileId: file.getId(), clientId: clientId, downloadUrl: file.getUrl() });
}

function getGeneratedFiles_() {
  ensureReady_();
  var folder = DriveApp.getFolderById(getRequiredProperty_(PROP_KEYS.generatedFilesFolderId));
  var iterator = folder.getFiles(), files = [];
  while (iterator.hasNext()) {
    var file = iterator.next(), metadata = {};
    try { metadata = JSON.parse(file.getDescription() || '{}'); } catch (ignore) {}
    files.push({ id: metadata.clientId || file.getId(), clientId: metadata.clientId || '', name: file.getName(), date: metadata.date || file.getDateCreated().toISOString(), type: metadata.type || '', order: metadata.order || '', downloadUrl: file.getUrl() });
  }
  files.sort(function(a, b) { return String(b.date).localeCompare(String(a.date)); });
  return jsonResponse(true, 'Generated files loaded', '', { files: files }, { files: files });
}

function getPublicConfiguration_() {
  return { plant: getConfigValue('plant'), area: getConfigValue('area'), prefix: getConfigValue('prefix') };
}

function savePublicConfiguration_(configuration) {
  ['plant', 'area', 'prefix'].forEach(function(key) { if (typeof configuration[key] !== 'undefined') setConfigValue(key, sanitizeText_(configuration[key])); });
  var result = getPublicConfiguration_();
  return jsonResponse(true, 'Configuration saved', '', result, { configuration: result });
}

function ensureSignatureSheet_() {
  var spreadsheet = SpreadsheetApp.openById(getRequiredProperty_(PROP_KEYS.configSpreadsheetId));
  var sheet = spreadsheet.getSheetByName('SignatureRequests') || spreadsheet.insertSheet('SignatureRequests');
  ensureHeader_(sheet, ['Token','Status','Field','Department','EmployeeNumber','FullName','Area','Position','CreatedAt','ExpiresAt','SignatureFileId','SignedAt']);
  return sheet;
}
function getSignatureFolder_() { var props=PropertiesService.getScriptProperties(),id=props.getProperty(PROP_KEYS.signaturesFolderId);if(id){try{return DriveApp.getFolderById(id)}catch(ignore){}}var folder=getOrCreateFolder('Signatures',DriveApp.getFolderById(getRequiredProperty_(PROP_KEYS.rootFolderId)));props.setProperty(PROP_KEYS.signaturesFolderId,folder.getId());return folder; }

function signatureRecord_(token) {
  var sheet = ensureSignatureSheet_(), values = sheet.getDataRange().getValues();
  for (var i = 1; i < values.length; i++) if (String(values[i][0]) === String(token || '')) return { sheet: sheet, row: i + 1, values: values[i] };
  return null;
}

function createSignatureRequest_(payload) {
  ensureReady_();
  var employee = payload.employee || {}, token = Utilities.getUuid(), now = new Date(), expires = new Date(now.getTime() + 72 * 60 * 60 * 1000);
  ensureSignatureSheet_().appendRow([token,'pending',sanitizeText_(payload.field),sanitizeText_(payload.department),sanitizeText_(employee.employeeNumber),sanitizeText_(employee.fullName),sanitizeText_(employee.area || employee.department),sanitizeText_(employee.position),now.toISOString(),expires.toISOString(),'','']);
  var request = { token: token, status: 'pending', field: sanitizeText_(payload.field), department: sanitizeText_(payload.department), employeeNumber: sanitizeText_(employee.employeeNumber), fullName: sanitizeText_(employee.fullName), expiresAt: expires.toISOString() };
  return jsonResponse(true, 'Signature request created', '', request, { request: request });
}

function getSignatureRequest_(token) {
  ensureReady_();
  var record = signatureRecord_(token);
  if (!record) return jsonResponse(false, 'Signature request not found', 'Invalid token');
  var value = record.values, expired = new Date(value[9]).getTime() < Date.now(), status = expired && value[1] === 'pending' ? 'expired' : value[1];
  var request = { token: value[0], status: status, field: value[2], department: value[3], employeeNumber: value[4], fullName: value[5], area: value[6], position: value[7], createdAt: value[8], expiresAt: value[9], signedAt: value[11] };
  if (status === 'signed' && value[10]) { var blob = DriveApp.getFileById(value[10]).getBlob(); request.dataUrl = 'data:image/png;base64,' + blobToBase64(blob); }
  return jsonResponse(true, 'Signature request loaded', '', request, { request: request });
}

function submitSignature_(payload) {
  ensureReady_();
  var record = signatureRecord_(payload.token);
  if (!record) return jsonResponse(false, 'Signature request not found', 'Invalid token');
  if (record.values[1] !== 'pending') return jsonResponse(false, 'Signature request is not pending', 'Already signed or expired');
  if (new Date(record.values[9]).getTime() < Date.now()) return jsonResponse(false, 'Signature request expired', 'Expired token');
  var base64 = String(payload.dataUrl || '').split(',')[1];
  if (!base64) return jsonResponse(false, 'Missing signature', 'No PNG data');
  var folder = getSignatureFolder_();
  var file = folder.createFile(Utilities.newBlob(Utilities.base64Decode(base64), 'image/png', 'signature-' + payload.token + '.png'));
  var signedAt = new Date().toISOString();
  record.sheet.getRange(record.row, 2).setValue('signed');record.sheet.getRange(record.row, 11, 1, 2).setValues([[file.getId(), signedAt]]);
  return jsonResponse(true, 'Signature saved', '', { status: 'signed', signedAt: signedAt });
}

function setupDigitalFormsStorage() {
  var props = PropertiesService.getScriptProperties();
  var root = getOrCreateFolder(ROOT_FOLDER_NAME);

  var production = getOrCreateFolder('Production Plan', root);
  var productionActive = getOrCreateFolder('Active', production);
  var productionArchive = getOrCreateFolder('Archive', production);

  var employees = getOrCreateFolder('Employees', root);
  var employeesActive = getOrCreateFolder('Active', employees);
  var employeesArchive = getOrCreateFolder('Archive', employees);

  var templates = getOrCreateFolder('Templates', root);
  var templatesActive = getOrCreateFolder('Active', templates);
  var templatesArchive = getOrCreateFolder('Archive', templates);

  var generatedFiles = getOrCreateFolder('Generated Files', root);
  var signatures = getOrCreateFolder('Signatures', root);
  var spreadsheet = getOrCreateConfigSpreadsheet_(root);

  props.setProperties({
    ROOT_FOLDER_ID: root.getId(),
    CONFIG_SPREADSHEET_ID: spreadsheet.getId(),
    PRODUCTION_ACTIVE_FOLDER_ID: productionActive.getId(),
    PRODUCTION_ARCHIVE_FOLDER_ID: productionArchive.getId(),
    EMPLOYEES_ACTIVE_FOLDER_ID: employeesActive.getId(),
    EMPLOYEES_ARCHIVE_FOLDER_ID: employeesArchive.getId(),
    TEMPLATES_ACTIVE_FOLDER_ID: templatesActive.getId(),
    TEMPLATES_ARCHIVE_FOLDER_ID: templatesArchive.getId(),
    GENERATED_FILES_FOLDER_ID: generatedFiles.getId(),
    SIGNATURES_FOLDER_ID: signatures.getId(),
    MAX_FILE_SIZE_MB: String(DEFAULT_MAX_FILE_SIZE_MB)
  }, false);

  ensureConfigSheet_();
  ensureRegistrySheet_();
  ensureConfigKey_(CONFIG_KEYS.productionPlan, '');
  ensureConfigKey_(CONFIG_KEYS.employees, '');
  ensureConfigKey_(CONFIG_KEYS.materialTemplate, '');
  ensureConfigKey_(CONFIG_KEYS.modelChangeTemplate, '');

  Logger.log('Digital Forms storage ready. Root folder: ' + root.getId());
  return {
    rootFolderId: root.getId(),
    configSpreadsheetId: spreadsheet.getId()
  };
}

function jsonResponse(success, message, error, data, extra) {
  var output = {
    success: Boolean(success),
    message: message || '',
    data: success ? (typeof data === 'undefined' ? {} : data) : undefined,
    error: success ? undefined : (error || '')
  };

  if (!success) {
    output.ok = false;
  }

  if (extra) {
    Object.keys(extra).forEach(function(key) {
      output[key] = extra[key];
    });
  }

  return ContentService
    .createTextOutput(JSON.stringify(output))
    .setMimeType(ContentService.MimeType.JSON);
}

function getOrCreateFolder(name, parentFolder) {
  var folders = parentFolder ? parentFolder.getFoldersByName(name) : DriveApp.getFoldersByName(name);
  if (folders.hasNext()) {
    return folders.next();
  }
  return parentFolder ? parentFolder.createFolder(name) : DriveApp.createFolder(name);
}

function getConfigValue(key) {
  var sheet = ensureConfigSheet_();
  var values = sheet.getDataRange().getValues();
  for (var i = 1; i < values.length; i++) {
    if (String(values[i][0]) === key) {
      return String(values[i][1] || '');
    }
  }
  return '';
}

function setConfigValue(key, value) {
  var sheet = ensureConfigSheet_();
  var values = sheet.getDataRange().getValues();
  var now = new Date().toISOString();

  for (var i = 1; i < values.length; i++) {
    if (String(values[i][0]) === key) {
      sheet.getRange(i + 1, 2, 1, 2).setValues([[value || '', now]]);
      return;
    }
  }

  sheet.appendRow([key, value || '', now]);
}

function getActiveFile(fileType) {
  ensureReady_();

  var fileId = getConfigValue(fileType.configKey);
  if (!fileId) {
    return jsonResponse(true, 'No active ' + fileType.label.toLowerCase() + ' found', '', null);
  }

  try {
    var file = DriveApp.getFileById(fileId);
    var registry = getRegistryRecord_(fileId);
    var blob = file.getBlob();
    var metadata = {
      fileId: file.getId(),
      fileName: file.getName(),
      fileType: blob.getContentType(),
      uploadedAt: registry.uploadedAt || file.getLastUpdated().toISOString(),
      uploadedBy: registry.uploadedBy || '',
      version: Number(registry.version || 1),
      isActive: true
    };
    var filePayload = {
      name: file.getName(),
      type: blob.getContentType(),
      mimeType: blob.getContentType(),
      base64: blobToBase64(blob)
    };
    var data = {
      fileId: metadata.fileId,
      fileName: metadata.fileName,
      mimeType: metadata.fileType,
      uploadedAt: metadata.uploadedAt,
      uploadedBy: metadata.uploadedBy,
      version: metadata.version,
      isActive: true,
      base64: filePayload.base64
    };

    return jsonResponse(true, 'Active file loaded', '', data, {
      file: filePayload,
      metadata: metadata
    });
  } catch (err) {
    Logger.log('Active file missing or unreadable: ' + fileId);
    setConfigValue(fileType.configKey, '');
    return jsonResponse(true, 'No active ' + fileType.label.toLowerCase() + ' found', '', null);
  }
}

function replaceActiveFile(fileType, payload) {
  ensureReady_();
  validateUploadPayload_(payload);

  var filePayload = payload.file;
  var uploadedBy = sanitizeText_(payload.uploadedBy || 'Vercel frontend');
  var activeFolder = DriveApp.getFolderById(getRequiredProperty_(fileType.activeFolderProp));
  var archiveFolder = DriveApp.getFolderById(getRequiredProperty_(fileType.archiveFolderProp));
  var previousId = getConfigValue(fileType.configKey);

  if (previousId) {
    archivePreviousFile_(previousId, activeFolder, archiveFolder);
    deactivatePreviousFile(previousId);
  }

  archiveExtraActiveFiles_(activeFolder, archiveFolder, previousId);

  var cleanName = sanitizeFileName(filePayload.name);
  var blob = base64ToBlob(filePayload.base64, filePayload.mimeType || filePayload.type, cleanName);
  var newFile = activeFolder.createFile(blob).setName(cleanName);
  var version = getNextVersion(fileType.label);
  var uploadedAt = new Date().toISOString();

  setConfigValue(fileType.configKey, newFile.getId());
  registerFile({
    fileId: newFile.getId(),
    fileType: fileType.label,
    fileName: cleanName,
    version: version,
    uploadedAt: uploadedAt,
    uploadedBy: uploadedBy,
    isActive: true,
    driveFolder: activeFolder.getName()
  });

  var metadata = {
    fileId: newFile.getId(),
    fileName: cleanName,
    fileType: blob.getContentType(),
    uploadedAt: uploadedAt,
    uploadedBy: uploadedBy,
    version: version,
    isActive: true
  };
  var responseFile = {
    name: cleanName,
    type: blob.getContentType(),
    mimeType: blob.getContentType(),
    base64: filePayload.base64
  };
  var data = {
    fileId: metadata.fileId,
    fileName: metadata.fileName,
    mimeType: metadata.fileType,
    uploadedAt: metadata.uploadedAt,
    uploadedBy: metadata.uploadedBy,
    version: metadata.version,
    isActive: true,
    base64: filePayload.base64
  };

  Logger.log('Replaced active ' + fileType.label + ': ' + newFile.getId());
  return jsonResponse(true, fileType.label + ' replaced successfully', '', data, {
    file: responseFile,
    metadata: metadata
  });
}

function base64ToBlob(base64, mimeType, fileName) {
  var bytes = Utilities.base64Decode(base64);
  return Utilities.newBlob(bytes, mimeType || MimeType.MICROSOFT_EXCEL, fileName);
}

function blobToBase64(blob) {
  return Utilities.base64Encode(blob.getBytes());
}

function getNextVersion(fileType) {
  var sheet = ensureRegistrySheet_();
  var values = sheet.getDataRange().getValues();
  var maxVersion = 0;

  for (var i = 1; i < values.length; i++) {
    if (String(values[i][1]) === fileType) {
      maxVersion = Math.max(maxVersion, Number(values[i][3]) || 0);
    }
  }

  return maxVersion + 1;
}

function registerFile(record) {
  var sheet = ensureRegistrySheet_();
  sheet.appendRow([
    record.fileId,
    record.fileType,
    record.fileName,
    record.version,
    record.uploadedAt,
    record.uploadedBy,
    record.isActive,
    record.driveFolder
  ]);
}

function deactivatePreviousFile(fileId) {
  if (!fileId) return;

  var sheet = ensureRegistrySheet_();
  var values = sheet.getDataRange().getValues();
  for (var i = 1; i < values.length; i++) {
    if (String(values[i][0]) === fileId) {
      sheet.getRange(i + 1, 7).setValue(false);
    }
  }
}

function sanitizeFileName(name) {
  var fallback = 'upload.xlsx';
  var clean = String(name || fallback)
    .replace(/[\\\/:*?"<>|#%{}~&]/g, '_')
    .replace(/\s+/g, ' ')
    .trim();

  if (!clean) clean = fallback;
  if (!/\.(xlsx|xls)$/i.test(clean)) clean += '.xlsx';
  return clean.slice(0, 180);
}

function parseRequestBody_(e) {
  if (!e || !e.postData || !e.postData.contents) {
    return {};
  }
  return JSON.parse(e.postData.contents);
}

function ensureReady_() {
  var props = PropertiesService.getScriptProperties();
  if (!props.getProperty(PROP_KEYS.configSpreadsheetId)) {
    setupDigitalFormsStorage();
  }
}

function getOrCreateConfigSpreadsheet_(rootFolder) {
  var props = PropertiesService.getScriptProperties();
  var existingId = props.getProperty(PROP_KEYS.configSpreadsheetId);

  if (existingId) {
    try {
      return SpreadsheetApp.openById(existingId);
    } catch (err) {
      Logger.log('Configured spreadsheet not found. Creating a new one.');
    }
  }

  var files = rootFolder.getFilesByName(APP_NAME + ' Configuration');
  if (files.hasNext()) {
    return SpreadsheetApp.openById(files.next().getId());
  }

  var spreadsheet = SpreadsheetApp.create(APP_NAME + ' Configuration');
  var file = DriveApp.getFileById(spreadsheet.getId());
  file.moveTo(rootFolder);
  return spreadsheet;
}

function ensureConfigSheet_() {
  var spreadsheet = SpreadsheetApp.openById(getRequiredProperty_(PROP_KEYS.configSpreadsheetId));
  var sheet = spreadsheet.getSheetByName(CONFIG_SHEET_NAME) || spreadsheet.insertSheet(CONFIG_SHEET_NAME);
  ensureHeader_(sheet, ['Key', 'Value', 'UpdatedAt']);
  return sheet;
}

function ensureRegistrySheet_() {
  var spreadsheet = SpreadsheetApp.openById(getRequiredProperty_(PROP_KEYS.configSpreadsheetId));
  var sheet = spreadsheet.getSheetByName(REGISTRY_SHEET_NAME) || spreadsheet.insertSheet(REGISTRY_SHEET_NAME);
  ensureHeader_(sheet, ['FileId', 'FileType', 'FileName', 'Version', 'UploadedAt', 'UploadedBy', 'IsActive', 'DriveFolder']);
  return sheet;
}

function ensureHeader_(sheet, headers) {
  var range = sheet.getRange(1, 1, 1, headers.length);
  var current = range.getValues()[0];
  var needsHeader = current.join('') === '';

  for (var i = 0; i < headers.length; i++) {
    if (current[i] !== headers[i]) {
      needsHeader = true;
      break;
    }
  }

  if (needsHeader) {
    range.setValues([headers]);
    sheet.setFrozenRows(1);
  }
}

function ensureConfigKey_(key, value) {
  if (getConfigValue(key) === '') {
    setConfigValue(key, value || '');
  }
}

function getRequiredProperty_(key) {
  var value = PropertiesService.getScriptProperties().getProperty(key);
  if (!value) {
    throw new Error('Storage is not configured');
  }
  return value;
}

function validateUploadPayload_(payload) {
  if (!payload || !payload.file) {
    throw new Error('Missing file payload');
  }

  var file = payload.file;
  var cleanName = sanitizeFileName(file.name);
  if (!/\.(xlsx|xls)$/i.test(cleanName)) {
    throw new Error('Only .xlsx and .xls files are accepted');
  }

  if (!file.base64 || !String(file.base64).trim()) {
    throw new Error('File content is empty');
  }

  var maxMb = Number(PropertiesService.getScriptProperties().getProperty(PROP_KEYS.maxFileSizeMb)) || DEFAULT_MAX_FILE_SIZE_MB;
  var estimatedBytes = Math.floor(String(file.base64).length * 0.75);
  if (estimatedBytes > maxMb * 1024 * 1024) {
    throw new Error('File exceeds the configured size limit');
  }
}

function archivePreviousFile_(fileId, activeFolder, archiveFolder) {
  try {
    var file = DriveApp.getFileById(fileId);
    file.moveTo(archiveFolder);
  } catch (err) {
    Logger.log('Previous active file could not be archived: ' + fileId);
  }
}

function archiveExtraActiveFiles_(activeFolder, archiveFolder, expectedPreviousId) {
  var files = activeFolder.getFiles();
  while (files.hasNext()) {
    var file = files.next();
    if (file.getId() !== expectedPreviousId) {
      file.moveTo(archiveFolder);
      deactivatePreviousFile(file.getId());
    }
  }
}

function getRegistryRecord_(fileId) {
  var sheet = ensureRegistrySheet_();
  var values = sheet.getDataRange().getValues();

  for (var i = values.length - 1; i >= 1; i--) {
    if (String(values[i][0]) === fileId) {
      return {
        fileId: values[i][0],
        fileType: values[i][1],
        fileName: values[i][2],
        version: values[i][3],
        uploadedAt: values[i][4],
        uploadedBy: values[i][5],
        isActive: values[i][6],
        driveFolder: values[i][7]
      };
    }
  }

  return {};
}

function sanitizeText_(value) {
  return String(value || '').replace(/[<>]/g, '').slice(0, 120);
}

function sanitizeError_(err) {
  Logger.log(err && err.stack ? err.stack : err);
  return err && err.message ? err.message : 'Unexpected error';
}

/**
 * Request and response examples
 *
 * 1. getActiveProductionPlan
 * Request:
 * { "action": "getActiveProductionPlan" }
 *
 * Response with active file:
 * {
 *   "success": true,
 *   "message": "Active file loaded",
 *   "data": {
 *     "fileId": "...",
 *     "fileName": "production-plan.xlsx",
 *     "mimeType": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
 *     "uploadedAt": "2026-07-09T00:00:00.000Z",
 *     "version": 1,
 *     "isActive": true,
 *     "base64": "..."
 *   },
 *   "file": { "name": "production-plan.xlsx", "type": "...", "base64": "..." },
 *   "metadata": { "fileId": "...", "fileName": "production-plan.xlsx", "version": 1, "isActive": true }
 * }
 *
 * Response without active file:
 * { "success": true, "message": "No active production plan found", "data": null }
 *
 * 2. replaceProductionPlan
 * Request:
 * {
 *   "action": "replaceProductionPlan",
 *   "file": { "name": "production-plan.xlsx", "mimeType": "...", "base64": "..." },
 *   "uploadedBy": "user@company.com"
 * }
 *
 * 3. getActiveEmployeeDatabase
 * Request:
 * { "action": "getActiveEmployeeDatabase" }
 *
 * 4. replaceEmployeeDatabase
 * Request:
 * {
 *   "action": "replaceEmployeeDatabase",
 *   "file": { "name": "employees.xlsx", "mimeType": "...", "base64": "..." },
 *   "uploadedBy": "user@company.com"
 * }
 *
 * Deployment instructions
 *
 * 1. Go to https://script.google.com and create a new Apps Script project.
 * 2. Paste this complete file as Code.gs.
 * 3. Save the project as "Digital Forms API".
 * 4. In the function selector, choose setupDigitalFormsStorage.
 * 5. Click Run and authorize Drive, Sheets, and Script Properties permissions.
 * 6. Confirm that Drive now contains:
 *    Digital Forms / Production Plan / Active
 *    Digital Forms / Production Plan / Archive
 *    Digital Forms / Employees / Active
 *    Digital Forms / Employees / Archive
 *    Digital Forms / Templates / Active
 *    Digital Forms / Templates / Archive
 *    Digital Forms / Generated Files
 * 7. Click Deploy > New deployment > Web app.
 * 8. Set "Execute as" to "Me".
 * 9. Set "Who has access" according to your Vercel access needs.
 *    For an internal app, use your Google Workspace access option when available.
 *    For a public Vercel frontend without Google sign-in, use "Anyone".
 * 10. Deploy, authorize if prompted, and copy the Web App URL.
 * 11. In the frontend Settings, select Google Drive mode and paste the Apps Script API URL.
 * 12. Use Test connection, then upload the production plan and employee database once.
 */
