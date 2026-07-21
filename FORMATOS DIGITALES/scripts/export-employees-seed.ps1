param(
  [string]$WorkbookPath = (Join-Path $PSScriptRoot '..\data\employees.xlsx'),
  [string]$SeedPath = (Join-Path $PSScriptRoot '..\supabase\seed.sql'),
  [string]$SummaryPath = (Join-Path $PSScriptRoot '..\data\employees-import-summary.json'),
  [string]$SeedPartsPath = (Join-Path $PSScriptRoot '..\supabase\.temp\employee-seed-parts')
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem

function Normalize-Text([object]$Value) {
  if ($null -eq $Value) { return '' }
  return ([string]$Value -replace '\s+', ' ').Trim()
}

function Normalize-Key([object]$Value) {
  $text = (Normalize-Text $Value).Normalize([Text.NormalizationForm]::FormD)
  $builder = [Text.StringBuilder]::new()
  foreach ($character in $text.ToCharArray()) {
    if ([Globalization.CharUnicodeInfo]::GetUnicodeCategory($character) -ne [Globalization.UnicodeCategory]::NonSpacingMark) {
      [void]$builder.Append($character)
    }
  }
  return (($builder.ToString().ToLowerInvariant()) -replace '[^a-z0-9]', '')
}

function Get-ColumnIndex([string]$Reference) {
  $letters = ([regex]::Match($Reference, '^[A-Z]+')).Value
  $index = 0
  foreach ($letter in $letters.ToCharArray()) { $index = ($index * 26) + ([int]$letter - [int][char]'A' + 1) }
  return $index - 1
}

function Get-CellValue($Cell, [string[]]$SharedStrings, $NamespaceManager) {
  $type = [string]$Cell.t
  if ($type -eq 'inlineStr') { return Normalize-Text (($Cell.SelectNodes('.//x:t', $NamespaceManager) | ForEach-Object InnerText) -join '') }
  $valueNode = $Cell.SelectSingleNode('./x:v', $NamespaceManager)
  if ($null -eq $valueNode) { return '' }
  $value = $valueNode.InnerText
  if ($type -eq 's') { return Normalize-Text $SharedStrings[[int]$value] }
  if ($type -eq 'b') { return $(if ($value -eq '1') { 'TRUE' } else { 'FALSE' }) }
  return Normalize-Text $value
}

function ConvertTo-SqlJson([object]$Value) {
  $json = $Value | ConvertTo-Json -Depth 100 -Compress
  return $json -replace '\$employee_import\$', ''
}

if (-not (Test-Path -LiteralPath $WorkbookPath)) { throw "No existe $WorkbookPath" }
$resolvedWorkbook = (Resolve-Path -LiteralPath $WorkbookPath).Path
$archive = [IO.Compression.ZipFile]::OpenRead($resolvedWorkbook)
try {
  $entries = @{}
  foreach ($entry in $archive.Entries) { $entries[$entry.FullName] = $entry }
  function Read-ZipXml([string]$Name) {
    if (-not $entries.ContainsKey($Name)) { return $null }
    $reader = [IO.StreamReader]::new($entries[$Name].Open())
    try { return [xml]$reader.ReadToEnd() } finally { $reader.Dispose() }
  }

  $sharedStrings = @()
  $sharedXml = Read-ZipXml 'xl/sharedStrings.xml'
  if ($null -ne $sharedXml) {
    $sharedNs = [Xml.XmlNamespaceManager]::new($sharedXml.NameTable)
    $sharedNs.AddNamespace('x', 'http://schemas.openxmlformats.org/spreadsheetml/2006/main')
    $sharedStrings = @($sharedXml.SelectNodes('//x:si', $sharedNs) | ForEach-Object { Normalize-Text (($_.SelectNodes('.//x:t', $sharedNs) | ForEach-Object InnerText) -join '') })
  }

  $workbookXml = Read-ZipXml 'xl/workbook.xml'
  $relationsXml = Read-ZipXml 'xl/_rels/workbook.xml.rels'
  $workbookNs = [Xml.XmlNamespaceManager]::new($workbookXml.NameTable)
  $workbookNs.AddNamespace('x', 'http://schemas.openxmlformats.org/spreadsheetml/2006/main')
  $workbookNs.AddNamespace('r', 'http://schemas.openxmlformats.org/officeDocument/2006/relationships')
  $relationMap = @{}
  foreach ($relationship in $relationsXml.Relationships.Relationship) { $relationMap[[string]$relationship.Id] = [string]$relationship.Target }
  $sheetNode = $workbookXml.SelectSingleNode('//x:sheets/x:sheet[1]', $workbookNs)
  $sheetName = [string]$sheetNode.name
  $relationId = [string]$sheetNode.GetAttribute('id', 'http://schemas.openxmlformats.org/officeDocument/2006/relationships')
  $sheetTarget = $relationMap[$relationId] -replace '^/', ''
  if ($sheetTarget -notmatch '^xl/') { $sheetTarget = 'xl/' + (($sheetTarget.TrimStart('.')).TrimStart('/')) }
  $sheetXml = Read-ZipXml $sheetTarget
  $sheetNs = [Xml.XmlNamespaceManager]::new($sheetXml.NameTable)
  $sheetNs.AddNamespace('x', 'http://schemas.openxmlformats.org/spreadsheetml/2006/main')

  $rows = @()
  foreach ($rowNode in $sheetXml.SelectNodes('//x:sheetData/x:row', $sheetNs)) {
    $values = @{}
    foreach ($cell in $rowNode.SelectNodes('./x:c', $sheetNs)) { $values[(Get-ColumnIndex ([string]$cell.r))] = Get-CellValue $cell $sharedStrings $sheetNs }
    $rows += [pscustomobject]@{ Number = [int]$rowNode.r; Values = $values }
  }
  if (-not $rows.Count) { throw 'El libro no contiene filas.' }

  $headerRow = $rows | Where-Object { ($_.Values.Values | Where-Object { (Normalize-Key $_) -eq 'nombre' }).Count -gt 0 } | Select-Object -First 1
  if ($null -eq $headerRow) { throw 'No se encontró la fila de encabezados con Nombre.' }
  $maxColumn = ($headerRow.Values.Keys | Measure-Object -Maximum).Maximum
  $headers = for ($index = 0; $index -le $maxColumn; $index++) { Normalize-Text $headerRow.Values[$index] }
  $uniqueHeaders = @(); $headerCounts = @{}
  for ($index = 0; $index -lt $headers.Count; $index++) {
    $base = $(if ($headers[$index]) { $headers[$index] } else { "Column $($index + 1)" })
    $headerCounts[$base] = 1 + [int]$headerCounts[$base]
    $uniqueHeaders += $(if ($headerCounts[$base] -eq 1) { $base } else { "${base}__$($headerCounts[$base])" })
  }

  $nameIndex = [Array]::IndexOf(($headers | ForEach-Object { Normalize-Key $_ }), 'nombre')
  $numberIndexes = @(for ($index = 0; $index -lt $headers.Count; $index++) { if ((Normalize-Key $headers[$index]) -eq 'numero') { $index } })
  $employeeNumberIndex = @($numberIndexes | Where-Object { $_ -lt $nameIndex } | Sort-Object -Descending)[0]
  if ($null -eq $employeeNumberIndex) { throw 'No se encontró la columna Numero antes de Nombre.' }
  $shiftIndex = [Array]::IndexOf(($headers | ForEach-Object { Normalize-Key $_ }), 'turno')
  $lineIndex = [Array]::IndexOf(($headers | ForEach-Object { Normalize-Key $_ }), 'lineaactual')
  $packingIndex = [Array]::IndexOf(($headers | ForEach-Object { Normalize-Key $_ }), 'packingcategory')
  $lineAreaCandidates = @(for ($index=0;$index -lt $headers.Count;$index++){if((Normalize-Key $headers[$index]).StartsWith('lineaarea')){$index}})
  $lineAreaIndex = @($lineAreaCandidates | Select-Object -First 1)
  $skillIndexes = @(($nameIndex + 1)..$maxColumn | Where-Object { $headers[$_] })

  $employees = [ordered]@{}
  $duplicates = 0; $rejected = 0; $sourceRows = 0
  foreach ($row in ($rows | Where-Object { $_.Number -gt $headerRow.Number })) {
    if (($row.Values.Values | Where-Object { Normalize-Text $_ }).Count -eq 0) { continue }
    $sourceRows++
    $employeeNumber = Normalize-Text $row.Values[$employeeNumberIndex]
    $fullName = Normalize-Text $row.Values[$nameIndex]
    if (-not $employeeNumber -or -not $fullName) { $rejected++; continue }
    $raw = [ordered]@{}
    for ($index=0;$index -le $maxColumn;$index++) { $raw[$uniqueHeaders[$index]] = Normalize-Text $row.Values[$index] }
    $skills = @()
    foreach ($index in $skillIndexes) {
      $value = Normalize-Text $row.Values[$index]
      if (-not $value) { continue }
      $normalizedValue = Normalize-Key $value
      $skills += [ordered]@{ key = (Normalize-Key $uniqueHeaders[$index]); name = $headers[$index]; value = $value; is_qualified = ($normalizedValue -notin @('0','no','n','false','na','sincalificar')); source_data = [ordered]@{ source_column = $headers[$index]; source_value = $value } }
    }
    $employee = [ordered]@{
      employee_number = $employeeNumber; full_name = $fullName
      shift = $(if ($shiftIndex -ge 0) { Normalize-Text $row.Values[$shiftIndex] } else { '' })
      line = $(if ($lineIndex -ge 0) { Normalize-Text $row.Values[$lineIndex] } else { '' })
      area = ''; department = ''; position = ''; operation = ''
      packing_category = $(if ($packingIndex -ge 0) { Normalize-Text $row.Values[$packingIndex] } else { '' })
      line_area = $(if ($lineAreaIndex -ge 0) { Normalize-Text $row.Values[$lineAreaIndex] } else { '' })
      source_data = $raw; skills = $skills
    }
    $key = Normalize-Key $employeeNumber
    if ($employees.Contains($key)) {
      $duplicates++
      $existing = $employees[$key]
      foreach ($field in 'full_name','shift','line','area','department','position','operation','packing_category','line_area') { if (-not $existing[$field] -and $employee[$field]) { $existing[$field] = $employee[$field] } }
      $priorRows = @(); if ($existing.source_data.Contains('_source_rows')) { $priorRows += $existing.source_data._source_rows } else { $priorRows += $existing.source_data }
      $priorRows += $raw; $existing.source_data['_source_rows'] = $priorRows
      $skillsByKey = [ordered]@{}; foreach ($skill in @($existing.skills) + @($skills)) { $skillsByKey[$skill.key] = $skill }; $existing.skills = @($skillsByKey.Values)
    } else { $employees[$key] = $employee }
  }

  $employeeArray = @($employees.Values)
  $skillCount = [int](($employeeArray | ForEach-Object { @($_.skills).Count } | Measure-Object -Sum).Sum)
  $hash = (Get-FileHash -LiteralPath $resolvedWorkbook -Algorithm SHA256).Hash.ToLowerInvariant()
  $fileInfo = Get-Item -LiteralPath $resolvedWorkbook
  $summary = [ordered]@{
    workbook = $fileInfo.Name; sheet = $sheetName; header_row = $headerRow.Number
    source_rows = $sourceRows; imported = $employeeArray.Count; duplicates = $duplicates; rejected = $rejected
    skills = $skillCount; sha256 = $hash; generated_at = (Get-Date).ToUniversalTime().ToString('o')
  }
  $payload = [ordered]@{ summary = $summary; employees = $employeeArray }
  $json = ConvertTo-SqlJson $payload
  $originalNameSql = $fileInfo.Name.Replace("'", "''")
  $sql = @"
-- Generated by scripts/export-employees-seed.ps1. Re-run it after replacing data/employees.xlsx.
begin;

create temporary table employee_import_payload (data jsonb not null) on commit drop;
insert into employee_import_payload (data) values (`$employee_import`$$json`$employee_import`$::jsonb);

update public.source_file_versions
set is_active = false, updated_at = now()
where plant_id = (select id from public.plants where code = 'MAIN')
  and resource_type = 'employee_database'
  and is_active;

insert into public.source_file_versions (
  plant_id, resource_type, version, is_active, original_name, mime_type, size_bytes,
  sha256, source_system, imported_count, duplicate_count, rejected_count, source_data
)
select
  p.id, 'employee_database',
  coalesce((select sf.version from public.source_file_versions sf where sf.plant_id = p.id and sf.resource_type = 'employee_database' and sf.sha256 = '$hash'),
           (select coalesce(max(sf.version), 0) + 1 from public.source_file_versions sf where sf.plant_id = p.id and sf.resource_type = 'employee_database')),
  true, '$originalNameSql', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', $($fileInfo.Length),
  '$hash', 'bundled_excel', $($employeeArray.Count), $duplicates, $rejected,
  jsonb_build_object('sheet', '$($sheetName.Replace("'", "''"))', 'header_row', $($headerRow.Number), 'source_rows', $sourceRows, 'skills', $skillCount)
from public.plants p where p.code = 'MAIN'
on conflict (plant_id, resource_type, sha256) do update set
  is_active = true, original_name = excluded.original_name, mime_type = excluded.mime_type,
  size_bytes = excluded.size_bytes, imported_count = excluded.imported_count,
  duplicate_count = excluded.duplicate_count, rejected_count = excluded.rejected_count,
  source_data = excluded.source_data, updated_at = now();

insert into public.employees (
  plant_id, employee_number, full_name, shift, line, area, department, position,
  operation, packing_category, line_area, source_file_version_id, source_data
)
select
  p.id, e->>'employee_number', e->>'full_name', nullif(e->>'shift',''), nullif(e->>'line',''),
  nullif(e->>'area',''), nullif(e->>'department',''), nullif(e->>'position',''), nullif(e->>'operation',''),
  nullif(e->>'packing_category',''), nullif(e->>'line_area',''), sf.id, e->'source_data'
from employee_import_payload payload
cross join lateral jsonb_array_elements(payload.data->'employees') e
cross join public.plants p
join public.source_file_versions sf on sf.plant_id = p.id and sf.resource_type = 'employee_database' and sf.sha256 = '$hash'
where p.code = 'MAIN'
on conflict (plant_id, employee_number) do update set
  full_name = excluded.full_name, shift = coalesce(excluded.shift, public.employees.shift),
  line = coalesce(excluded.line, public.employees.line), area = coalesce(excluded.area, public.employees.area),
  department = coalesce(excluded.department, public.employees.department), position = coalesce(excluded.position, public.employees.position),
  operation = coalesce(excluded.operation, public.employees.operation), packing_category = coalesce(excluded.packing_category, public.employees.packing_category),
  line_area = coalesce(excluded.line_area, public.employees.line_area), source_file_version_id = excluded.source_file_version_id,
  source_data = public.employees.source_data || excluded.source_data, is_active = true, updated_at = now();

insert into public.employee_skills (
  plant_id, employee_id, skill_key, skill_name, skill_value, is_qualified, source_data
)
select
  employee.plant_id, employee.id, skill->>'key', skill->>'name', nullif(skill->>'value',''),
  coalesce((skill->>'is_qualified')::boolean, false), coalesce(skill->'source_data', '{}'::jsonb)
from employee_import_payload payload
cross join lateral jsonb_array_elements(payload.data->'employees') e
cross join lateral jsonb_array_elements(e->'skills') skill
join public.plants plant on plant.code = 'MAIN'
join public.employees employee on employee.plant_id = plant.id and employee.employee_number = e->>'employee_number'
on conflict (employee_id, skill_key) do update set
  skill_name = excluded.skill_name, skill_value = excluded.skill_value,
  is_qualified = excluded.is_qualified, source_data = excluded.source_data, updated_at = now();

commit;
"@

  [IO.File]::WriteAllText((Join-Path (Resolve-Path (Split-Path $SeedPath -Parent)).Path (Split-Path $SeedPath -Leaf)), $sql, [Text.UTF8Encoding]::new($false))
  [IO.File]::WriteAllText((Join-Path (Resolve-Path (Split-Path $SummaryPath -Parent)).Path (Split-Path $SummaryPath -Leaf)), ($summary | ConvertTo-Json -Depth 10), [Text.UTF8Encoding]::new($false))

  [void](New-Item -ItemType Directory -Force -Path $SeedPartsPath)
  Get-ChildItem -LiteralPath $SeedPartsPath -Filter '*.sql' -File | Remove-Item -Force
  $sourcePart = @"
update public.source_file_versions set is_active=false, updated_at=now()
where plant_id=(select id from public.plants where code='MAIN') and resource_type='employee_database' and is_active;
insert into public.source_file_versions (plant_id,resource_type,version,is_active,original_name,mime_type,size_bytes,sha256,source_system,imported_count,duplicate_count,rejected_count,source_data)
select p.id,'employee_database',coalesce((select version from public.source_file_versions where plant_id=p.id and resource_type='employee_database' and sha256='$hash'),(select coalesce(max(version),0)+1 from public.source_file_versions where plant_id=p.id and resource_type='employee_database')),true,'$originalNameSql','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',$($fileInfo.Length),'$hash','bundled_excel',$($employeeArray.Count),$duplicates,$rejected,jsonb_build_object('sheet','$($sheetName.Replace("'", "''"))','header_row',$($headerRow.Number),'source_rows',$sourceRows,'skills',$skillCount)
from public.plants p where p.code='MAIN'
on conflict (plant_id,resource_type,sha256) do update set is_active=true,original_name=excluded.original_name,mime_type=excluded.mime_type,size_bytes=excluded.size_bytes,imported_count=excluded.imported_count,duplicate_count=excluded.duplicate_count,rejected_count=excluded.rejected_count,source_data=excluded.source_data,updated_at=now();
"@
  [IO.File]::WriteAllText((Join-Path $SeedPartsPath '000_source.sql'), $sourcePart, [Text.UTF8Encoding]::new($false))
  $partNumber = 0
  for ($offset=0; $offset -lt $employeeArray.Count; $offset+=6) {
    $partNumber++
    $last = [Math]::Min($offset + 5, $employeeArray.Count - 1)
    $partJson = ConvertTo-SqlJson @($employeeArray[$offset..$last])
    $partSql = @"
begin;
create temporary table employee_import_part (data jsonb not null) on commit drop;
insert into employee_import_part(data) values (`$employee_part`$$partJson`$employee_part`$::jsonb);
insert into public.employees (plant_id,employee_number,full_name,shift,line,area,department,position,operation,packing_category,line_area,source_file_version_id,source_data)
select p.id,e->>'employee_number',e->>'full_name',nullif(e->>'shift',''),nullif(e->>'line',''),nullif(e->>'area',''),nullif(e->>'department',''),nullif(e->>'position',''),nullif(e->>'operation',''),nullif(e->>'packing_category',''),nullif(e->>'line_area',''),sf.id,e->'source_data'
from employee_import_part payload cross join lateral jsonb_array_elements(payload.data) e cross join public.plants p
join public.source_file_versions sf on sf.plant_id=p.id and sf.resource_type='employee_database' and sf.sha256='$hash' where p.code='MAIN'
on conflict (plant_id,employee_number) do update set full_name=excluded.full_name,shift=coalesce(excluded.shift,public.employees.shift),line=coalesce(excluded.line,public.employees.line),area=coalesce(excluded.area,public.employees.area),department=coalesce(excluded.department,public.employees.department),position=coalesce(excluded.position,public.employees.position),operation=coalesce(excluded.operation,public.employees.operation),packing_category=coalesce(excluded.packing_category,public.employees.packing_category),line_area=coalesce(excluded.line_area,public.employees.line_area),source_file_version_id=excluded.source_file_version_id,source_data=public.employees.source_data||excluded.source_data,is_active=true,updated_at=now();
insert into public.employee_skills (plant_id,employee_id,skill_key,skill_name,skill_value,is_qualified,source_data)
select employee.plant_id,employee.id,skill->>'key',skill->>'name',nullif(skill->>'value',''),coalesce((skill->>'is_qualified')::boolean,false),coalesce(skill->'source_data','{}'::jsonb)
from employee_import_part payload cross join lateral jsonb_array_elements(payload.data) e cross join lateral jsonb_array_elements(e->'skills') skill
join public.plants plant on plant.code='MAIN' join public.employees employee on employee.plant_id=plant.id and employee.employee_number=e->>'employee_number'
on conflict (employee_id,skill_key) do update set skill_name=excluded.skill_name,skill_value=excluded.skill_value,is_qualified=excluded.is_qualified,source_data=excluded.source_data,updated_at=now();
commit;
"@
    [IO.File]::WriteAllText((Join-Path $SeedPartsPath ('{0:D3}_employees.sql' -f $partNumber)), $partSql, [Text.UTF8Encoding]::new($false))
  }
  $summary | ConvertTo-Json -Depth 10
} finally {
  $archive.Dispose()
}
