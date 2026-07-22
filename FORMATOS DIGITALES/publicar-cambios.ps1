param(
    [string]$Mensaje = "Actualizar formatos digitales"
)

$ErrorActionPreference = "Stop"
Set-Location -LiteralPath $PSScriptRoot

$gitCommand = Get-Command git.exe -ErrorAction SilentlyContinue
$git = if ($gitCommand) { $gitCommand.Source } else { "C:\Program Files\Git\cmd\git.exe" }

if (-not (Test-Path -LiteralPath $git)) {
    throw "No se encontro Git. Cierra y vuelve a abrir PowerShell e intentalo otra vez."
}

function Invoke-Git {
    & $git @args
    if ($LASTEXITCODE -ne 0) {
        throw "Git termino con un error al ejecutar: git $($args -join ' ')"
    }
}

Invoke-Git fetch origin main

$remoteProjectTree = (& $git rev-parse "origin/main:FORMATOS DIGITALES").Trim()
if ($LASTEXITCODE -ne 0) {
    throw "No se encontro la carpeta FORMATOS DIGITALES en origin/main."
}

$lastRemoteProjectTree = (& $git config --get formatos.lastRemoteProjectTree).Trim()
if ($lastRemoteProjectTree -and $lastRemoteProjectTree -ne $remoteProjectTree) {
    throw "GitHub contiene cambios que este equipo aun no tiene. No se publico nada; sincroniza primero el proyecto remoto."
}

Invoke-Git add -A
& $git diff --cached --quiet
if ($LASTEXITCODE -eq 0) {
    Write-Host "No hay cambios nuevos para publicar."
    exit 0
}
if ($LASTEXITCODE -ne 1) {
    throw "No se pudo revisar la lista de cambios."
}

Invoke-Git commit -m $Mensaje

$temporaryIndex = [System.IO.Path]::GetTempFileName()
Remove-Item -LiteralPath $temporaryIndex -Force
$previousIndex = $env:GIT_INDEX_FILE

try {
    $env:GIT_INDEX_FILE = $temporaryIndex
    Invoke-Git read-tree origin/main
    Invoke-Git rm -r --cached --ignore-unmatch -- "FORMATOS DIGITALES"
    Invoke-Git read-tree --prefix="FORMATOS DIGITALES/" HEAD

    $newTree = (& $git write-tree).Trim()
    if ($LASTEXITCODE -ne 0) { throw "No se pudo preparar el arbol para GitHub." }

    $remoteCommit = (& $git rev-parse origin/main).Trim()
    $publishedCommit = ($Mensaje | & $git commit-tree $newTree -p $remoteCommit).Trim()
    if ($LASTEXITCODE -ne 0) { throw "No se pudo crear el commit para GitHub." }
}
finally {
    if ($null -eq $previousIndex) {
        Remove-Item Env:GIT_INDEX_FILE -ErrorAction SilentlyContinue
    }
    else {
        $env:GIT_INDEX_FILE = $previousIndex
    }
    Remove-Item -LiteralPath $temporaryIndex -Force -ErrorAction SilentlyContinue
}

Invoke-Git push origin "${publishedCommit}:refs/heads/main"
Invoke-Git fetch origin main

$publishedProjectTree = (& $git rev-parse "HEAD^{tree}").Trim()
Invoke-Git config formatos.lastRemoteProjectTree $publishedProjectTree

Write-Host "Cambios publicados correctamente en GitHub."
Write-Host "Vercel iniciara el despliegue automatico desde la rama main."
