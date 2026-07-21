param(
  [string]$Url = 'http://127.0.0.1:8000/',
  [switch]$DriveFallback,
  [switch]$SupabaseUnavailable
)

$ErrorActionPreference = 'Stop'
$chrome = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
if (-not (Test-Path -LiteralPath $chrome)) { throw 'Google Chrome no está instalado.' }

$port = Get-Random -Minimum 9300 -Maximum 9800
$profile = Join-Path $env:TEMP ("npi-stage1-browser-{0}" -f [guid]::NewGuid())
$process = Start-Process -FilePath $chrome -WindowStyle Hidden -PassThru -ArgumentList @(
  '--headless=new', '--disable-gpu', '--no-first-run', "--remote-debugging-port=$port",
  "--user-data-dir=$profile", 'about:blank'
)

function Receive-Cdp($Socket, [int]$ExpectedId) {
  while ($true) {
    $stream = [IO.MemoryStream]::new()
    do {
      $buffer = New-Object byte[] 65536
      $segment = [ArraySegment[byte]]::new($buffer)
      $received = $Socket.ReceiveAsync($segment, [Threading.CancellationToken]::None).GetAwaiter().GetResult()
      $stream.Write($buffer, 0, $received.Count)
    } while (-not $received.EndOfMessage)
    $message = [Text.Encoding]::UTF8.GetString($stream.ToArray()) | ConvertFrom-Json
    if ($message.id -eq $ExpectedId) { return $message }
  }
}

function Send-Cdp($Socket, [int]$Id, [string]$Method, [hashtable]$Params = @{}) {
  $json = @{ id=$Id; method=$Method; params=$Params } | ConvertTo-Json -Depth 20 -Compress
  $bytes = [Text.Encoding]::UTF8.GetBytes($json)
  [void]($Socket.SendAsync([ArraySegment[byte]]::new($bytes), [Net.WebSockets.WebSocketMessageType]::Text, $true, [Threading.CancellationToken]::None).GetAwaiter().GetResult())
  return Receive-Cdp $Socket $Id
}

try {
  $targets = $null
  for ($attempt=0; $attempt -lt 30 -and $null -eq $targets; $attempt++) {
    try { $targets = Invoke-RestMethod "http://127.0.0.1:$port/json/list" -TimeoutSec 1 } catch { Start-Sleep -Milliseconds 200 }
  }
  if ($null -eq $targets) { throw 'Chrome DevTools no inició.' }
  $target = $targets | Where-Object type -eq 'page' | Select-Object -First 1
  $socket = [Net.WebSockets.ClientWebSocket]::new()
  [void]($socket.ConnectAsync([uri]$target.webSocketDebuggerUrl, [Threading.CancellationToken]::None).GetAwaiter().GetResult())
  [void](Send-Cdp $socket 1 'Page.enable')
  [void](Send-Cdp $socket 2 'Runtime.enable')
  $bootstrap = "globalThis.__browserErrors=[];addEventListener('error',e=>__browserErrors.push(String(e.error?.stack||e.message)));addEventListener('unhandledrejection',e=>__browserErrors.push(String(e.reason?.stack||e.reason)));"
  if ($DriveFallback) { $bootstrap += "localStorage.setItem('mfg_preferences_v2',JSON.stringify({serviceMode:'google',apiUrl:'http://127.0.0.1:9/unreachable'}));" }
  [void](Send-Cdp $socket 3 'Page.addScriptToEvaluateOnNewDocument' @{ source=$bootstrap })
  [void](Send-Cdp $socket 4 'Page.navigate' @{ url=$Url })
  Start-Sleep -Seconds 12
  $fallbackProbe = if ($SupabaseUnavailable) { @"
const databaseModule=await import('./js/database.js?fallback-test=1');
const unavailableService=new databaseModule.SupabaseDataService(new databaseModule.LocalDataService(),'http://127.0.0.1:9','sb_publishable_test');
unavailableService.session=async()=>({user:{id:'b1130fcd-fe1d-4586-8e18-e252d5c3fabb'}});
unavailableService.getPlantId=async()=>'e7120367-05f9-4201-ad74-c28682b64949';
const unavailableRows=await unavailableService.getEmployees();
const unavailableActive=await unavailableService.getActiveEmployeeDatabase();
const unavailablePlanRows=await unavailableService.getProductionPlanRows();
const unavailablePlanActive=await unavailableService.getActiveProductionPlan();
const unavailable={supabaseRows:unavailableRows?.rows?.length??0,fallbackFile:unavailableActive?.file?.name||'',fallbackWorked:!unavailableRows&&unavailableActive?.file?.name==='employees.xlsx',productionSupabaseRows:unavailablePlanRows?.rows?.length??0,productionFallbackFile:unavailablePlanActive?.file?.name||'',productionFallbackWorked:!unavailablePlanRows&&unavailablePlanActive?.file?.name==='production-plan.xlsx'};
"@ } else { 'const unavailable=null;' }
  $expression = @"
(async()=>{
$fallbackProbe
const excelModule=await import('./js/excel-reader.js?production-plan-smoke=1');
const planResponse=await fetch('./data/production-plan.xlsx',{cache:'no-store'});
const planFile=new File([await planResponse.blob()],'production-plan.xlsx',{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
const parsedPlan=await excelModule.readProductionPlan(planFile);
const productionPlan={records:parsedPlan.rows.length,auxiliary:parsedPlan.auxiliaryRows.length,rejected:parsedPlan.rejectedRows.length,total:parsedPlan.totalRows,uniqueBasePlans:new Set(parsedPlan.rows.map(row=>row.basePlanNumber.trim().toUpperCase())).size};
return JSON.stringify({
  title: document.title,
  driveFallbackRequested: $($DriveFallback.IsPresent.ToString().ToLowerInvariant()),
  hasContent: document.body.innerText.trim().length > 500,
  employeeCount: document.querySelector('#employeeCount')?.textContent,
  employeeStatus: document.querySelector('#employeeDriveStatus')?.textContent,
  employeeFile: document.querySelector('#employeeFileName')?.textContent,
  errors: globalThis.__browserErrors || [],
  fallbackLoaded: Number((document.querySelector('#employeeCount')?.textContent || '0').replace(/[^0-9]/g,'')) > 0,
  moduleCheck: await import('./js/database.js?smoke=1').then(()=> 'OK').catch(error=>String(error?.stack||error)),
  productionPlan,
  supabaseUnavailable: unavailable
})})()
"@
  $response = Send-Cdp $socket 5 'Runtime.evaluate' @{ expression=$expression; returnByValue=$true; awaitPromise=$true }
  $result = $response.result.result.value | ConvertFrom-Json
  $result | ConvertTo-Json -Depth 10
  if (-not $result.hasContent -or $result.errors.Count -or -not $result.fallbackLoaded -or $result.productionPlan.records -ne 372 -or $result.productionPlan.auxiliary -ne 51 -or $result.productionPlan.rejected -ne 0 -or $result.productionPlan.uniqueBasePlans -ne 372 -or ($SupabaseUnavailable -and (-not $result.supabaseUnavailable.fallbackWorked -or -not $result.supabaseUnavailable.productionFallbackWorked))) { exit 1 }
} finally {
  if ($socket) { $socket.Dispose() }
  if ($process -and -not $process.HasExited) { Stop-Process -Id $process.Id -Force }
}
