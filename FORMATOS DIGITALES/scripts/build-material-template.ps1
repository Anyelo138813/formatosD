$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$templateDirectory = [IO.Path]::GetFullPath((Join-Path $projectRoot "templates"))
$targetPath = [IO.Path]::GetFullPath((Join-Path $templateDirectory "New_Model_Material_Delivery_Record_Corporate.xlsx"))
$tempPath = [IO.Path]::GetFullPath((Join-Path $templateDirectory "New_Model_Material_Delivery_Record_Corporate.next.xlsx"))
if (-not $targetPath.StartsWith($templateDirectory, [StringComparison]::OrdinalIgnoreCase)) { throw "Ruta de plantilla no valida." }

function Xml-Escape([string]$value) { return [Security.SecurityElement]::Escape($value) }
function Cell([string]$address, [string]$value, [int]$style = 1) {
  $safe = Xml-Escape $value
  return "<c r=`"$address`" s=`"$style`" t=`"inlineStr`"><is><t>$safe</t></is></c>"
}

$rows = [ordered]@{}
function Add-Cell([int]$row, [string]$column, [string]$value, [int]$style = 1) {
  $key = [string]$row
  if (-not $rows.Contains($key)) { $rows[$key] = [Collections.Generic.List[string]]::new() }
  $rows[$key].Add((Cell "$column$row" $value $style))
}

Add-Cell 1 "A" "NEW MODEL MATERIAL DELIVERY RECORD" 2
Add-Cell 3 "A" "Internal Model" 4; Add-Cell 3 "B" "" 5; Add-Cell 3 "C" "Client Model" 4; Add-Cell 3 "D" "" 5; Add-Cell 3 "E" "Rolling" 4; Add-Cell 3 "F" "" 5; Add-Cell 3 "G" "" 5
Add-Cell 4 "A" "Trial Run Line" 4; Add-Cell 4 "B" "" 5; Add-Cell 4 "C" "Date Trial" 4; Add-Cell 4 "D" "" 5; Add-Cell 4 "E" "" 5; Add-Cell 4 "F" "" 5; Add-Cell 4 "G" "" 5
Add-Cell 7 "A" "EFM - ENTREGA Y RECIBIDO" 2
$headers = @("Material","Seleccionar entrega","QTY entrega","Fecha entrega","Seleccionar recibido","QTY recibido","Fecha recibido")
for ($i=0; $i -lt 7; $i++) { Add-Cell 8 ([char](65+$i)) $headers[$i] 3 }
$materials = @("Cover Group","BP","TV Set (Complete)")
for ($r=9; $r -le 11; $r++) { Add-Cell $r "A" $materials[$r-9]; foreach($c in "B","C","D","E","F","G"){Add-Cell $r $c ""} }
Add-Cell 13 "A" "Firma entrega NPI" 3; Add-Cell 13 "C" "Firma entrega EFM" 3; Add-Cell 13 "E" "Firma recibido NPI" 3; Add-Cell 13 "G" "Firma recibido EFM" 3
foreach($c in "A","B","C","D","E","F","G"){Add-Cell 14 $c "" 6}
Add-Cell 16 "A" "PFA" 2
$headers = @("Material","Seleccionar","PN / Description","QTY","Fecha")
for ($i=0; $i -lt 5; $i++) { Add-Cell 17 ([char](65+$i)) $headers[$i] 3 }
$materials = @("TV Set (Complete)","Small Parts","Serial Number","Input Scan","Cover Group","Main Board")
for ($r=18; $r -le 23; $r++) { Add-Cell $r "A" $materials[$r-18]; foreach($c in "B","C","D","E"){Add-Cell $r $c ""} }
Add-Cell 25 "A" "Firma general NPI" 3; Add-Cell 25 "D" "Firma general PFA" 3
foreach($c in "A","B","C","D","E","F","G"){Add-Cell 26 $c "" 6}
Add-Cell 29 "A" "QM" 2
Add-Cell 30 "A" "Movimiento" 3; Add-Cell 30 "B" "PN / Description" 3; Add-Cell 30 "D" "QTY" 3; Add-Cell 30 "E" "Fecha" 3; Add-Cell 30 "F" "Firma QM" 3; Add-Cell 30 "G" "Firma PE" 3
foreach($r in 31,32){Add-Cell $r "A" $(if($r -eq 31){"Entrega"}else{"Retorno"}); Add-Cell $r "B" ""; foreach($c in "D","E","F","G"){Add-Cell $r $c ""}}

$rowHeights = @{"1"=30;"7"=24;"13"=22;"14"=48;"16"=24;"25"=22;"26"=48;"29"=24;"30"=30;"31"=42;"32"=42}
$rowXml = foreach ($entry in $rows.GetEnumerator()) {
  $height = if ($rowHeights.ContainsKey([string]$entry.Key)) { " ht=`"$($rowHeights[[string]$entry.Key])`" customHeight=`"1`"" } else { " ht=`"22`" customHeight=`"1`"" }
  "<row r=`"$($entry.Key)`"$height>$([string]::Join('', $entry.Value))</row>"
}
$merges = @("A1:G1","F3:G3","D4:E4","A7:G7","A13:B13","A14:B14","C13:D13","C14:D14","E13:F13","E14:F14","A16:G16","A25:C25","D25:G25","A26:C26","D26:G26","A29:G29","B30:C30","B31:C31","B32:C32")
$mergeXml = [string]::Join("", ($merges | ForEach-Object { "<mergeCell ref=`"$_`"/>" }))
$sheetXml = @"
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:G32"/><sheetViews><sheetView showGridLines="0" workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="22"/><cols><col min="1" max="1" width="24" customWidth="1"/><col min="2" max="2" width="22" customWidth="1"/><col min="3" max="3" width="24" customWidth="1"/><col min="4" max="7" width="19" customWidth="1"/></cols><sheetData>$([string]::Join('', $rowXml))</sheetData><mergeCells count="$($merges.Count)">$mergeXml</mergeCells><printOptions horizontalCentered="1"/><pageMargins left="0.25" right="0.25" top="0.35" bottom="0.35" header="0.1" footer="0.1"/><pageSetup orientation="landscape" paperSize="9" fitToWidth="1" fitToHeight="1"/></worksheet>
"@

$stylesXml = @"
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
 <fonts count="3"><font><sz val="10"/><name val="Arial"/><color rgb="FF1F2937"/></font><font><b/><sz val="10"/><name val="Arial"/><color rgb="FF173B33"/></font><font><b/><sz val="12"/><name val="Arial"/><color rgb="FFFFFFFF"/></font></fonts>
 <fills count="5"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF086B58"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFD9EEE8"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF3F7F6"/><bgColor indexed="64"/></patternFill></fill></fills>
 <borders count="3"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"><color rgb="FF52756C"/></left><right style="thin"><color rgb="FF52756C"/></right><top style="thin"><color rgb="FF52756C"/></top><bottom style="thin"><color rgb="FF52756C"/></bottom><diagonal/></border><border><left style="medium"><color rgb="FF086B58"/></left><right style="medium"><color rgb="FF086B58"/></right><top style="medium"><color rgb="FF086B58"/></top><bottom style="medium"><color rgb="FF086B58"/></bottom><diagonal/></border></borders>
 <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
 <cellXfs count="7">
  <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="center"/></xf>
  <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
  <xf numFmtId="0" fontId="2" fillId="2" borderId="2" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
  <xf numFmtId="0" fontId="1" fillId="3" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
  <xf numFmtId="0" fontId="1" fillId="4" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
  <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="left" vertical="center" wrapText="1"/></xf>
  <xf numFmtId="0" fontId="0" fillId="0" borderId="2" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
 </cellXfs>
 <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles><dxfs count="0"/><tableStyles count="0" defaultTableStyle="TableStyleMedium2" defaultPivotStyle="PivotStyleLight16"/>
</styleSheet>
"@

Copy-Item -LiteralPath $targetPath -Destination $tempPath -Force
$archive = [IO.Compression.ZipFile]::Open($tempPath, [IO.Compression.ZipArchiveMode]::Update)
try {
  $old = $archive.GetEntry("xl/worksheets/sheet1.xml")
  if ($old) { $old.Delete() }
  $entry = $archive.CreateEntry("xl/worksheets/sheet1.xml", [IO.Compression.CompressionLevel]::Optimal)
  $writer = [IO.StreamWriter]::new($entry.Open(), [Text.UTF8Encoding]::new($false))
  try { $writer.Write($sheetXml) } finally { $writer.Dispose() }
  $oldStyles = $archive.GetEntry("xl/styles.xml")
  if ($oldStyles) { $oldStyles.Delete() }
  $stylesEntry = $archive.CreateEntry("xl/styles.xml", [IO.Compression.CompressionLevel]::Optimal)
  $stylesWriter = [IO.StreamWriter]::new($stylesEntry.Open(), [Text.UTF8Encoding]::new($false))
  try { $stylesWriter.Write($stylesXml) } finally { $stylesWriter.Dispose() }
} finally { $archive.Dispose() }
Move-Item -LiteralPath $tempPath -Destination $targetPath -Force
Write-Output ("Plantilla actualizada: {0}" -f $targetPath)
