<#
.SYNOPSIS
  Mede os três orçamentos da casca: dock visível depois de iniciar, memória em repouso e
  abertura do painel. Não mexe no mouse nem no teclado; abre e fecha o Moductus algumas vezes.

.DESCRIPTION
  dock     de Start-Process até a janela "Moductus dock" estar visível e a área de trabalho
           já reservada (média de -Execucoes), e o mesmo intervalo pelo log: do início até a
           primeira linha "dock fixado".
  memoria  depois de -Ocioso segundos parado, soma os bytes privados da casca e de todos os
           descendentes (node do serviço, processos do WebView2).
  painel   aciona o botão "Hoje" do dock por UI Automation (expandir/recolher, sem cursor) -Aberturas
           vezes e lê as linhas "painel hoje aberto em N ms" do log.

  No fim o app fica aberto, como estava antes de medir. Encerre outras instâncias antes:
  taskkill /IM moductus.exe /F

.EXAMPLE
  pnpm tauri build --no-bundle
  pwsh -NoProfile -File scripts\medir.ps1
#>
param(
  [string]$Exe = (Join-Path $PSScriptRoot '..\src-tauri\target\release\moductus.exe'),
  [int]$Execucoes = 5,
  [int]$Ocioso = 60,
  [int]$Aberturas = 5
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
Add-Type @"
using System; using System.Runtime.InteropServices;
public static class M {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  [DllImport("user32.dll")] public static extern bool SystemParametersInfo(int a, int b, ref RECT r, int c);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern IntPtr FindWindow(string c, string t);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint m, IntPtr w, IntPtr l);
  public static string Trabalho() { var r = new RECT(); SystemParametersInfo(0x30, 0, ref r, 0); return r.L + "," + r.T + "," + r.R + "," + r.B; }
}
"@

$log = Join-Path $env:APPDATA 'Moductus\moductus.log'
$Exe = (Resolve-Path $Exe).Path
if (Get-Process moductus -ErrorAction SilentlyContinue) {
  throw 'O Moductus já está rodando: encerre antes (taskkill /IM moductus.exe /F).'
}

function Linhas-Desde([int]$marca) { @(Get-Content $log -ErrorAction SilentlyContinue | Select-Object -Skip $marca) }
function Tempo-Da-Linha([string]$linha) { [int64](($linha -split ' ', 2)[0]) }
function Agora { [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() }

function Abrir {
  $area = [M]::Trabalho()
  $marca = (Get-Content $log -ErrorAction SilentlyContinue).Count
  $inicio = Agora
  $relogio = [Diagnostics.Stopwatch]::StartNew()
  $p = Start-Process $Exe -PassThru
  $h = [IntPtr]::Zero
  $visivel = -1
  while ($relogio.ElapsedMilliseconds -lt 20000) {
    if ($h -eq [IntPtr]::Zero) { $h = [M]::FindWindow([NullString]::Value, 'Moductus dock') }
    if ($visivel -lt 0 -and $h -ne [IntPtr]::Zero -and [M]::IsWindowVisible($h)) { $visivel = $relogio.Elapsed.TotalMilliseconds }
    if ($visivel -ge 0 -and [M]::Trabalho() -ne $area) { break }
    Start-Sleep -Milliseconds 5
  }
  $tela = $relogio.Elapsed.TotalMilliseconds
  Start-Sleep 2
  $fixado = Linhas-Desde $marca | Where-Object { $_ -match ' dock fixado: ' } | Select-Object -First 1
  $pelo_log = if ($fixado) { (Tempo-Da-Linha $fixado) - $inicio } else { -1 }
  [pscustomobject]@{ Processo = $p; Hwnd = $h; Visivel = $visivel; Tela = $tela; Log = $pelo_log }
}

function Fechar($d) {
  [M]::PostMessage($d.Hwnd, 0x10, [IntPtr]::Zero, [IntPtr]::Zero) | Out-Null
  $d.Processo.WaitForExit(5000) | Out-Null
  Start-Sleep 2
}

function Descendentes([int]$raiz) {
  $todos = @(Get-CimInstance Win32_Process)
  $ids = [Collections.Generic.List[int]]::new(); $ids.Add($raiz)
  for ($i = 0; $i -lt $ids.Count; $i++) {
    foreach ($p in $todos) { if ($p.ParentProcessId -eq $ids[$i] -and -not $ids.Contains([int]$p.ProcessId)) { $ids.Add([int]$p.ProcessId) } }
  }
  $ids
}

# ---------- dock ----------
Write-Host "== dock ($Execucoes execuções) =="
$tempos = @()
for ($i = 1; $i -le $Execucoes; $i++) {
  $d = Abrir
  Write-Host ("  {0}: janela visível em {1:N0} ms, com a reserva em {2:N0} ms; pelo log, dock fixado em {3} ms" -f $i, $d.Visivel, $d.Tela, $d.Log)
  $tempos += $d
  if ($i -lt $Execucoes) { Fechar $d }
}
$media = { param($campo) ($tempos | Measure-Object $campo -Average).Average }
Write-Host ("  média: visível em {0:N0} ms, com a reserva em {1:N0} ms, {2:N0} ms pelo log (orçamento: 1000 ms)" -f (& $media Visivel), (& $media Tela), (& $media Log))

# ---------- memória ----------
Write-Host "`n== memória (depois de $Ocioso s parado) =="
Start-Sleep $Ocioso
$total = 0
$grupos = @{}
foreach ($id in (Descendentes $d.Processo.Id)) {
  $p = Get-Process -Id $id -ErrorAction SilentlyContinue
  if (-not $p) { continue }
  $total += $p.PrivateMemorySize64
  $grupos[$p.ProcessName] = @($grupos[$p.ProcessName]) + [math]::Round($p.PrivateMemorySize64 / 1MB, 1)
}
foreach ($nome in $grupos.Keys | Sort-Object) {
  $v = @($grupos[$nome] | Where-Object { $_ -ne $null })
  Write-Host ("  {0}: {1} processo(s), {2:N1} MB ({3})" -f $nome, $v.Count, ($v | Measure-Object -Sum).Sum, ($v -join ' + '))
}
Write-Host ("  total: {0:N1} MB privados (orçamento: 200 MB)" -f ($total / 1MB))

# ---------- painel ----------
Write-Host "`n== painel ($Aberturas aberturas por UI Automation) =="
$raiz = [Windows.Automation.AutomationElement]::FromHandle($d.Hwnd)
$cond = New-Object Windows.Automation.PropertyCondition([Windows.Automation.AutomationElement]::NameProperty, 'Hoje')
# O WebView2 só monta a árvore de acessibilidade quando alguém pergunta: espera ela chegar.
$botao = $null
for ($i = 0; $i -lt 40 -and -not $botao; $i++) {
  $botao = $raiz.FindFirst([Windows.Automation.TreeScope]::Descendants, $cond)
  if (-not $botao) { Start-Sleep -Milliseconds 250 }
}
if (-not $botao){ throw 'Botão "Hoje" do dock não encontrado por UI Automation.' }
# O botão de área tem aria-expanded: o UI Automation o expõe como expandir/recolher.
$area = $botao.GetCurrentPattern([Windows.Automation.ExpandCollapsePattern]::Pattern)
$hPainel = [M]::FindWindow([NullString]::Value, 'Moductus painel')
$marca = (Get-Content $log).Count
for ($i = 0; $i -lt $Aberturas; $i++) {
  $area.Expand(); Start-Sleep -Milliseconds 800
  # A mesma área de novo fecha o painel: a próxima volta mede uma abertura nova.
  if ([M]::IsWindowVisible($hPainel)) { $area.Collapse(); Start-Sleep -Milliseconds 600 }
}
$medidas = @(Linhas-Desde $marca | Where-Object { $_ -match 'painel hoje aberto em' } | ForEach-Object { [double](($_ -replace '.*aberto em ([0-9.]+) ms.*', '$1')) })
$ordenados = @($medidas | Sort-Object)
$mediana = if ($ordenados.Count) { $ordenados[[int][math]::Floor($ordenados.Count / 2)] } else { -1 }
Write-Host ("  aberturas (ms): {0}; mediana {1}; máximo {2} (orçamento: 100 ms)" -f ($medidas -join ', '), $mediana, ($medidas | Measure-Object -Maximum).Maximum)

Write-Host "`nO Moductus continua aberto (pid $($d.Processo.Id))."
