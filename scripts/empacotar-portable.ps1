<#
.SYNOPSIS
  Monta o zip portable a partir do que o `pnpm tauri build` deixou em target/release.

.DESCRIPTION
  O layout repete o que o código procura em tempo de execução:
    moductus.exe            a casca
    node.exe                sidecar, ao lado do exe (servico.rs)
    servico/servico.mjs     recurso; no Windows o resource_dir do Tauri é a pasta do exe
    portable.txt            liga o modo portable: dados ao lado do exe (dados.rs)
  Usado pelo release.yml e localmente, para o zip do CI ser o mesmo que se confere aqui.

.EXAMPLE
  pwsh -File scripts/empacotar-portable.ps1 -Versao v0.5.0-alpha -Destino artefatos
#>
param(
  [Parameter(Mandatory)] [string]$Versao,
  [string]$Origem = (Join-Path $PSScriptRoot '..\src-tauri\target\release'),
  [string]$Destino = (Join-Path $PSScriptRoot '..rtefatos')
)

$ErrorActionPreference = 'Stop'

$arquivos = @(
  @{ De = 'moductus.exe'; Para = 'moductus.exe' },
  @{ De = 'node.exe'; Para = 'node.exe' },
  @{ De = 'servico\servico.mjs'; Para = 'servico\servico.mjs' }
)

# Falta de qualquer peça vira erro aqui, não um app que abre sem serviço na mão de alguém.
foreach ($a in $arquivos) {
  $caminho = Join-Path $Origem $a.De
  if (-not (Test-Path -LiteralPath $caminho -PathType Leaf)) {
    throw "Falta $caminho. Rode 'pnpm tauri build' antes."
  }
}

New-Item -ItemType Directory -Force -Path $Destino | Out-Null
$Destino = (Resolve-Path -LiteralPath $Destino).Path
$montagem = Join-Path ([System.IO.Path]::GetTempPath()) "moductus-portable-$([guid]::NewGuid().ToString('N'))"

try {
  foreach ($a in $arquivos) {
    $alvo = Join-Path $montagem $a.Para
    New-Item -ItemType Directory -Force -Path (Split-Path $alvo) | Out-Null
    Copy-Item -LiteralPath (Join-Path $Origem $a.De) -Destination $alvo
  }
  Set-Content -LiteralPath (Join-Path $montagem 'portable.txt') -Encoding utf8 -Value @(
    'Este arquivo liga o modo portable: o Moductus guarda dados e configurações nesta pasta.',
    'Apague-o para usar %APPDATA%\Moductus.'
  )

  $zip = Join-Path $Destino "moductus-$Versao-win-x64-portable.zip"
  if (Test-Path -LiteralPath $zip) { Remove-Item -LiteralPath $zip }
  Compress-Archive -Path (Join-Path $montagem '*') -DestinationPath $zip -CompressionLevel Optimal
}
finally {
  if (Test-Path -LiteralPath $montagem) { Remove-Item -LiteralPath $montagem -Recurse -Force }
}

Write-Output $zip
