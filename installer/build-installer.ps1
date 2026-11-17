# Gera o instalador e a versão portátil do TelaDosGames em dist\ e copia os dois para site\downloads\
# Uso (na pasta raiz do projeto):  powershell -ExecutionPolicy Bypass -File installer\build-installer.ps1
#
# Estrutura do projeto usada aqui:
#   app\        server.js, db.js, package.json, public\, node_modules\
#   launcher\   TelaDosGames.cs (central do Windows)
#   vendor\     cloudflared.exe
#
# O pacote gerado é "plano" (tudo numa pasta só), que é o formato que o TelaDosGames.exe espera:
#   TelaDosGames.exe, server.js, db.js, package*.json, public\, node_modules\, node\node.exe, cloudflared.exe

$ErrorActionPreference = 'Stop'
$installerDir = $PSScriptRoot
$rootDir = Split-Path $installerDir -Parent
$appDir = Join-Path $rootDir 'app'
$launcherSrc = Join-Path $rootDir 'launcher\TelaDosGames.cs'
$cloudflared = Join-Path $rootDir 'vendor\cloudflared.exe'
$distDir = Join-Path $rootDir 'dist'
$siteDownloads = Join-Path $rootDir 'site\downloads'
$staging = Join-Path $installerDir 'staging'

# 1. Ferramentas e arquivos necessários
$csc = 'C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe'
$iscc = @(
  "$env:LOCALAPPDATA\Programs\Inno Setup 6\ISCC.exe",
  "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe",
  "$env:ProgramFiles\Inno Setup 6\ISCC.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1
$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) { $node = "$env:ProgramFiles\nodejs\node.exe" }

if (-not (Test-Path $csc)) { throw 'Compilador C# (.NET Framework 4) não encontrado.' }
if (-not $iscc) { throw 'Inno Setup 6 não encontrado. Instale com: winget install JRSoftware.InnoSetup' }
if (-not (Test-Path $node)) { throw 'Node.js não encontrado.' }
if (-not (Test-Path (Join-Path $appDir 'node_modules'))) { throw 'Rode "npm install" dentro da pasta app\ antes.' }
if (-not (Test-Path $cloudflared)) { throw 'cloudflared.exe não encontrado em vendor\.' }
if (-not (Test-Path $launcherSrc)) { throw 'launcher\TelaDosGames.cs não encontrado.' }

# 2. Monta a pasta staging (só o que o app precisa: contas e certificados de teste ficam de fora)
if (Test-Path $staging) { Remove-Item $staging -Recurse -Force }
New-Item -ItemType Directory $staging | Out-Null
New-Item -ItemType Directory $distDir -Force | Out-Null

Write-Host 'Compilando TelaDosGames.exe...'
& $csc /nologo /target:winexe /codepage:65001 /r:System.Windows.Forms.dll /r:System.Drawing.dll `
  "/out:$staging\TelaDosGames.exe" $launcherSrc
if ($LASTEXITCODE -ne 0) { throw 'Falha ao compilar launcher\TelaDosGames.cs' }

Write-Host 'Copiando arquivos do app...'
foreach ($f in 'server.js', 'db.js', 'package.json', 'package-lock.json') {
  Copy-Item (Join-Path $appDir $f) $staging
}
Copy-Item (Join-Path $appDir 'public') $staging -Recurse
Copy-Item (Join-Path $appDir 'node_modules') $staging -Recurse
Copy-Item $cloudflared $staging

Write-Host "Incluindo o Node.js ($node)..."
New-Item -ItemType Directory (Join-Path $staging 'node') | Out-Null
Copy-Item $node (Join-Path $staging 'node\node.exe')

# 3. Compila o instalador (o TelaDosGames.iss lê a pasta staging e grava em ..\dist)
Write-Host 'Gerando o instalador...'
& $iscc /Q (Join-Path $installerDir 'TelaDosGames.iss')
if ($LASTEXITCODE -ne 0) { throw 'Falha ao gerar o instalador' }

# 4. Versão portátil (.zip): é só extrair e abrir o TelaDosGames.exe
Write-Host 'Gerando a versão portátil (.zip)...'
$zip = Join-Path $distDir 'TelaDosGames-Portatil.zip'
if (Test-Path $zip) { Remove-Item $zip -Force }
$portableRoot = Join-Path $installerDir 'portable'
if (Test-Path $portableRoot) { Remove-Item $portableRoot -Recurse -Force }
New-Item -ItemType Directory $portableRoot | Out-Null
Move-Item $staging (Join-Path $portableRoot 'TelaDosGames')
Add-Type -AssemblyName System.IO.Compression.FileSystem
[IO.Compression.ZipFile]::CreateFromDirectory($portableRoot, $zip, [IO.Compression.CompressionLevel]::Optimal, $false)
Remove-Item $portableRoot -Recurse -Force

$setup = Get-ChildItem $distDir -Filter 'TelaDosGames-Setup-*.exe' | Sort-Object LastWriteTime -Descending | Select-Object -First 1

# 5. Atualiza os downloads do site
New-Item -ItemType Directory $siteDownloads -Force | Out-Null
Copy-Item $setup.FullName, $zip $siteDownloads -Force

Write-Host ''
Write-Host "Instalador pronto: $($setup.FullName) ($([math]::Round($setup.Length / 1MB, 1)) MB)"
Write-Host "Versão portátil:   $zip ($([math]::Round((Get-Item $zip).Length / 1MB, 1)) MB)"
Write-Host "Copiados para:     $siteDownloads"
