<#
.SYNOPSIS
  Roteiro de verificação do dock na tela real. Mexe no mouse, abre o Bloco de Notas e
  cobre a tela por alguns segundos: não use o PC enquanto roda.

.DESCRIPTION
  Porta o verificar.ps1 do teste de viabilidade (prototipos/dock). Cada roteiro imprime
  PASSOU/FALHOU por verificação e sai com código 1 se algo falhar.

  Roteiros:
    appbar     reserva, janela maximizada respeita, troca de lado sem reiniciar,
               queda seguida de nova execução não empilha, saída devolve a faixa
    modos      fixo, esconder e inteligente; colada e flutuante, alternando sem reiniciar
    telacheia  inteligente some em tela cheia e volta; fixo perde o topo; evento chega à interface
    janelas    painel abre ao lado do dock em menos de 100 ms (5 aberturas) sem tirar o foco
    atalhos    Ctrl+Alt+N, D e Espaço; atalho de outro programa é recusado com motivo e o anterior vale

.EXAMPLE
  pnpm tauri build --debug --no-bundle
  pwsh -File scripts\verificar.ps1 -Roteiro appbar
#>
param(
  [ValidateSet('appbar', 'modos', 'telacheia', 'janelas', 'atalhos')]
  [string[]]$Roteiro = @('appbar', 'modos', 'telacheia', 'janelas', 'atalhos'),
  [string]$Exe = (Join-Path $PSScriptRoot '..\src-tauri\target\debug\moductus.exe')
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms, System.Drawing
Add-Type @"
using System; using System.Runtime.InteropServices; using System.Text;
public static class W {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  [DllImport("user32.dll")] public static extern bool SystemParametersInfo(int a, int b, ref RECT r, int c);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr h, int i);
  [DllImport("user32.dll")] public static extern bool RegisterHotKey(IntPtr h, int id, uint mods, uint vk);
  [DllImport("user32.dll")] public static extern bool UnregisterHotKey(IntPtr h, int id);
  [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, int flags, IntPtr extra);
  public static void Teclar(byte vk) {
    keybd_event(0x11, 0, 0, IntPtr.Zero); keybd_event(0x12, 0, 0, IntPtr.Zero);
    keybd_event(vk, 0, 0, IntPtr.Zero); keybd_event(vk, 0, 2, IntPtr.Zero);
    keybd_event(0x12, 0, 2, IntPtr.Zero); keybd_event(0x11, 0, 2, IntPtr.Zero);
  }
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern IntPtr FindWindow(string c, string t);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern uint RegisterWindowMessage(string s);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint m, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(int f, int x, int y, int d, int e);
  [DllImport("shell32.dll")] public static extern int SHQueryUserNotificationState(out int s);
  public static RECT Trabalho() { var r = new RECT(); SystemParametersInfo(0x30, 0, ref r, 0); return r; }
  public static string Titulo(IntPtr h) { var s = new StringBuilder(256); GetWindowText(h, s, 256); return s.ToString(); }
}
"@

$script:falhas = 0
function Conferir([string]$nome, [bool]$ok, [string]$detalhe) {
  $marca = if ($ok) { 'PASSOU' } else { $script:falhas++; 'FALHOU' }
  Write-Host ("{0,-7} {1} — {2}" -f $marca, $nome, $detalhe)
}
function Texto($r) { "$($r.L),$($r.T),$($r.R),$($r.B)" }
function Retangulo([IntPtr]$h) { $r = New-Object W+RECT; [W]::GetWindowRect($h, [ref]$r) | Out-Null; $r }

function Bombear([double]$segundos) {
  $fim = (Get-Date).AddSeconds($segundos)
  while ((Get-Date) -lt $fim) { [Windows.Forms.Application]::DoEvents(); Start-Sleep -Milliseconds 50 }
}
# O Windows só deixa trazer para a frente quem recebeu entrada: clicar resolve.
function Clicar-Em([IntPtr]$h) {
  $r = Retangulo $h
  [W]::SetCursorPos([int](($r.L + $r.R) / 2), [int](($r.T + $r.B) / 2)) | Out-Null
  [W]::mouse_event(2, 0, 0, 0, 0); [W]::mouse_event(4, 0, 0, 0, 0)
}
function Nova-Janela {
  $f = New-Object Windows.Forms.Form -Property @{ Text = 'janela de teste do Moductus'; Width = 600; Height = 400; StartPosition = 'Manual'; Left = 400; Top = 300; TopMost = $true }
  $f.Show(); Bombear 1; Clicar-Em $f.Handle; Bombear 1
  $f
}
# Espera o dock se registrar: a área de trabalho muda quando a reserva entra.
function Iniciar-Dock {
  $area = Texto ([W]::Trabalho())
  $p = Start-Process $Exe -PassThru
  $h = [IntPtr]::Zero
  for ($i = 0; $i -lt 100 -and ($h -eq [IntPtr]::Zero -or (Texto ([W]::Trabalho())) -eq $area); $i++) {
    Start-Sleep -Milliseconds 200; $h = [W]::FindWindow([NullString]::Value, 'Moductus dock')
  }
  Start-Sleep 1
  [pscustomobject]@{ Processo = $p; Hwnd = $h }
}
function Fechar-Dock($d) {
  [W]::PostMessage($d.Hwnd, 0x10, [IntPtr]::Zero, [IntPtr]::Zero) | Out-Null
  $d.Processo.WaitForExit(5000) | Out-Null
  Start-Sleep 1
}

function Roteiro-Appbar {
  Write-Host "`n== appbar =="
  Get-Process moductus -ErrorAction SilentlyContinue | Stop-Process -Force
  Start-Sleep 1
  $antes = [W]::Trabalho()

  $janela = Nova-Janela
  $hNp = $janela.Handle

  $d = Iniciar-Dock
  $rd = Retangulo $d.Hwnd
  $largura = $rd.R - $rd.L
  $depois = [W]::Trabalho()
  Conferir 'reserva' ($depois.L -eq $antes.L + $largura -and $depois.R -eq $antes.R) "área $(Texto $antes) -> $(Texto $depois), dock $(Texto $rd)"

  [W]::ShowWindow($hNp, 3) | Out-Null; Bombear 1
  $rn = Retangulo $hNp
  Conferir 'maximizada respeita' ($rn.L -ge $rd.R - 8) "janela de teste maximizada $(Texto $rn)"

  Clicar-Em $hNp; Bombear 1
  $antesClique = [W]::GetForegroundWindow()
  Conferir 'janela de teste em primeiro plano' ($antesClique -eq $hNp) "em primeiro plano: '$([W]::Titulo($antesClique))'"
  $cx = [int](($rd.L + $rd.R) / 2); $cy = $rd.T + 200
  [W]::SetCursorPos($cx, $cy) | Out-Null; [W]::mouse_event(2, 0, 0, 0, 0); [W]::mouse_event(4, 0, 0, 0, 0); Bombear 1
  $foco = [W]::GetForegroundWindow()
  Conferir 'clique não rouba foco' ($foco -eq $hNp) "em primeiro plano: '$([W]::Titulo($foco))'"

  $msg = [W]::RegisterWindowMessage('MODUCTUS_TESTE_LADO')
  [W]::PostMessage($d.Hwnd, $msg, [IntPtr]1, [IntPtr]::Zero) | Out-Null; Start-Sleep 1
  $direita = [W]::Trabalho(); $rdd = Retangulo $d.Hwnd
  Conferir 'troca de lado sem reiniciar' ($direita.L -eq $antes.L -and $direita.R -eq $antes.R - $largura -and $rdd.R -eq $antes.R) "área $(Texto $direita), dock $(Texto $rdd)"

  Stop-Process -Id $d.Processo.Id -Force; Start-Sleep 2
  $presa = [W]::Trabalho()
  Write-Host "        após a queda, área $(Texto $presa) (no Windows 10 a faixa fica presa; no 11 pode voltar sozinha)"
  $d = Iniciar-Dock
  $nova = [W]::Trabalho()
  Conferir 'queda + nova execução não empilha' ($nova.L -eq $antes.L + $largura -and $nova.R -eq $antes.R) "área $(Texto $nova)"

  Fechar-Dock $d
  $fim = [W]::Trabalho()
  Conferir 'saída devolve a faixa' ((Texto $fim) -eq (Texto $antes)) "área $(Texto $fim), processo encerrado: $($d.Processo.HasExited)"

  $janela.Close()
}

function Modo($d, [int]$modo, [int]$forma) {
  $msg = [W]::RegisterWindowMessage('MODUCTUS_TESTE_MODO')
  [W]::PostMessage($d.Hwnd, $msg, [IntPtr]$modo, [IntPtr]$forma) | Out-Null
  Start-Sleep -Milliseconds 800
}

function Roteiro-Modos {
  Write-Host "`n== modos =="
  Get-Process moductus -ErrorAction SilentlyContinue | Stop-Process -Force
  Start-Sleep 1
  $antes = [W]::Trabalho()
  $d = Iniciar-Dock
  $escala = ((Retangulo $d.Hwnd).R - (Retangulo $d.Hwnd).L) / 64

  Modo $d 0 1
  $r = Retangulo $d.Hwnd; $a = [W]::Trabalho()
  Conferir 'fixo flutuante' (($r.R - $r.L) -eq [int](80 * $escala) -and $a.L -eq $antes.L + ($r.R - $r.L)) "dock $(Texto $r), área $(Texto $a)"

  Modo $d 1 0
  $r = Retangulo $d.Hwnd; $a = [W]::Trabalho()
  Conferir 'esconder recolhe e solta a reserva' (($r.R - $r.L) -le [int](2 * $escala) -and (Texto $a) -eq (Texto $antes)) "dock $(Texto $r), área $(Texto $a)"
  [W]::SetCursorPos(0, [int](($r.T + $r.B) / 2)) | Out-Null; Start-Sleep -Milliseconds 400
  $r = Retangulo $d.Hwnd
  Conferir 'esconder revela ao encostar' (($r.R - $r.L) -eq [int](64 * $escala)) "dock $(Texto $r)"
  [W]::SetCursorPos(800, [int](($r.T + $r.B) / 2)) | Out-Null; Start-Sleep -Milliseconds 400
  $r = Retangulo $d.Hwnd
  Conferir 'esconder recolhe ao sair' (($r.R - $r.L) -le [int](2 * $escala)) "dock $(Texto $r)"

  Modo $d 2 0
  $r = Retangulo $d.Hwnd; $a = [W]::Trabalho()
  Conferir 'inteligente reserva' (($r.R - $r.L) -eq [int](64 * $escala) -and $a.L -eq $antes.L + ($r.R - $r.L)) "dock $(Texto $r), área $(Texto $a)"

  Modo $d 0 0
  $r = Retangulo $d.Hwnd; $a = [W]::Trabalho()
  Conferir 'volta ao fixo colado' ($a.L -eq $antes.L + ($r.R - $r.L)) "dock $(Texto $r), área $(Texto $a)"

  Fechar-Dock $d
  Conferir 'saída devolve a faixa' ((Texto ([W]::Trabalho())) -eq (Texto $antes)) "área $(Texto ([W]::Trabalho()))"
}

function Tela-Cheia {
  $f = New-Object Windows.Forms.Form -Property @{ FormBorderStyle = 'None'; StartPosition = 'Manual'; Left = 0; Top = 0; TopMost = $true; BackColor = 'Black'; Text = 'tela cheia de teste' }
  $f.Bounds = [Windows.Forms.Screen]::PrimaryScreen.Bounds
  $f.Show(); Bombear 0.5; Clicar-Em $f.Handle; Bombear 2
  $f
}

function Roteiro-Telacheia {
  Write-Host "`n== telacheia =="
  Get-Process moductus -ErrorAction SilentlyContinue | Stop-Process -Force
  Start-Sleep 1
  $log = Join-Path $env:APPDATA 'Moductus\moductus.log'
  $d = Iniciar-Dock
  $inicioLog = (Get-Content $log -ErrorAction SilentlyContinue).Count

  Modo $d 2 0
  $f = Tela-Cheia
  $s = 0; [W]::SHQueryUserNotificationState([ref]$s) | Out-Null
  Conferir 'inteligente some em tela cheia' (-not [W]::IsWindowVisible($d.Hwnd)) "estado de notificação $s, dock visível: $([W]::IsWindowVisible($d.Hwnd))"
  $f.Close(); Bombear 2
  Conferir 'inteligente volta ao sair' ([W]::IsWindowVisible($d.Hwnd)) "dock visível: $([W]::IsWindowVisible($d.Hwnd))"

  Modo $d 0 0
  $f = Tela-Cheia
  $topo = ([W]::GetWindowLong($d.Hwnd, -20) -band 0x8) -ne 0
  Conferir 'fixo fica atrás da tela cheia' ([W]::IsWindowVisible($d.Hwnd) -and -not $topo) "visível: $([W]::IsWindowVisible($d.Hwnd)), sempre no topo: $topo"
  $f.Close(); Bombear 2
  $topo = ([W]::GetWindowLong($d.Hwnd, -20) -band 0x8) -ne 0
  Conferir 'fixo volta ao topo ao sair' $topo "sempre no topo: $topo"

  $linhas = @(Get-Content $log | Select-Object -Skip $inicioLog | Where-Object { $_ -match 'interface: tela-cheia' })
  Conferir 'evento chega à interface' ($linhas.Count -ge 4) "$($linhas.Count) eventos: $(($linhas | ForEach-Object { ($_ -split ' ', 2)[1] }) -join ' | ')"
  Fechar-Dock $d
}

function Roteiro-Janelas {
  Write-Host "`n== janelas =="
  Get-Process moductus -ErrorAction SilentlyContinue | Stop-Process -Force
  Start-Sleep 1
  $log = Join-Path $env:APPDATA 'Moductus\moductus.log'
  $janela = Nova-Janela
  $d = Iniciar-Dock
  $rd = Retangulo $d.Hwnd
  $hPainel = [W]::FindWindow([NullString]::Value, 'Moductus painel')
  $inicioLog = (Get-Content $log).Count
  $foco = $true
  for ($i = 0; $i -lt 5; $i++) {
    Clicar-Em $janela.Handle; Bombear 0.5
    [W]::SetCursorPos([int](($rd.L + $rd.R) / 2), $rd.T + 12) | Out-Null
    [W]::mouse_event(2, 0, 0, 0, 0); [W]::mouse_event(4, 0, 0, 0, 0); Bombear 0.8
    if ($i -eq 0) {
      $rp = Retangulo $hPainel
      Conferir 'painel ao lado do dock' ([W]::IsWindowVisible($hPainel) -and $rp.L -eq $rd.R) "dock $(Texto $rd), painel $(Texto $rp)"
    }
    $foco = $foco -and ([W]::GetForegroundWindow() -eq $janela.Handle)
    [W]::mouse_event(2, 0, 0, 0, 0); [W]::mouse_event(4, 0, 0, 0, 0); Bombear 0.5
  }
  Conferir 'abrir o painel não tira o foco' $foco "primeiro plano: '$([W]::Titulo([W]::GetForegroundWindow()))'"
  $tempos = @(Get-Content $log | Select-Object -Skip $inicioLog | Where-Object { $_ -match 'painel hoje aberto em' } | ForEach-Object { [double](($_ -replace '.*aberto em ([0-9.]+) ms.*', '$1')) })
  $ordenados = $tempos | Sort-Object
  $mediana = if ($ordenados.Count) { $ordenados[[int][math]::Floor($ordenados.Count / 2)] } else { -1 }
  Conferir 'painel abre em menos de 100 ms' ($tempos.Count -ge 5 -and ($tempos | Measure-Object -Maximum).Maximum -lt 100) "aberturas (ms): $($tempos -join ', '); mediana $mediana"
  Fechar-Dock $d
  $janela.Close()
}

function Roteiro-Atalhos {
  Write-Host "`n== atalhos =="
  Get-Process moductus -ErrorAction SilentlyContinue | Stop-Process -Force
  Start-Sleep 1
  $log = Join-Path $env:APPDATA 'Moductus\moductus.log'
  $antes = [W]::Trabalho()
  $d = Iniciar-Dock
  $hSis = [W]::FindWindow([NullString]::Value, 'Moductus')
  $hCap = [W]::FindWindow([NullString]::Value, 'Moductus captura')

  [W]::Teclar(0x4E); Start-Sleep 1
  Conferir 'Ctrl+Alt+N abre o Sistema' ([W]::IsWindowVisible($hSis)) "Sistema visível: $([W]::IsWindowVisible($hSis))"
  [W]::Teclar(0x4E); Start-Sleep 1
  Conferir 'Ctrl+Alt+N de novo esconde' (-not [W]::IsWindowVisible($hSis)) "Sistema visível: $([W]::IsWindowVisible($hSis))"

  [W]::Teclar(0x44); Start-Sleep 1
  $a = [W]::Trabalho()
  Conferir 'Ctrl+Alt+D esconde o dock e devolve a faixa' (-not [W]::IsWindowVisible($d.Hwnd) -and (Texto $a) -eq (Texto $antes)) "dock visível: $([W]::IsWindowVisible($d.Hwnd)), área $(Texto $a)"
  [W]::Teclar(0x44); Start-Sleep 1
  $a = [W]::Trabalho()
  Conferir 'Ctrl+Alt+D de novo mostra e reserva' ([W]::IsWindowVisible($d.Hwnd) -and (Texto $a) -ne (Texto $antes)) "área $(Texto $a)"

  $ocupado = @(Get-Content $log | Where-Object { $_ -match 'Ctrl\+Alt\+Space .* não registrado' }).Count -gt 0
  if ($ocupado) {
    Write-Host '        Ctrl+Alt+Espaço está em uso por outro programa nesta máquina: a casca registrou a falha'
  } else {
    [W]::Teclar(0x20); Start-Sleep 1
    Conferir 'Ctrl+Alt+Espaço abre a captura' ([W]::IsWindowVisible($hCap)) "captura visível: $([W]::IsWindowVisible($hCap))"
    [W]::Teclar(0x20); Start-Sleep 1
  }

  $inicioLog = (Get-Content $log).Count
  $ok = [W]::RegisterHotKey([IntPtr]::Zero, 77, 0x3, 0x4B)
  $msg = [W]::RegisterWindowMessage('MODUCTUS_TESTE_ATALHO')
  [W]::PostMessage($d.Hwnd, $msg, [IntPtr][int][char]'K', [IntPtr]::Zero) | Out-Null; Start-Sleep 1.5
  $recusa = @(Get-Content $log | Select-Object -Skip $inicioLog | Where-Object { $_ -match 'atalho recusado' })
  Conferir 'atalho de outro programa é recusado com motivo' ($ok -and $recusa.Count -eq 1) "registrado pelo roteiro: $ok; $(($recusa | ForEach-Object { ($_ -split ' ', 2)[1] }) -join ' | ')"
  [W]::UnregisterHotKey([IntPtr]::Zero, 77) | Out-Null
  [W]::Teclar(0x4E); Start-Sleep 1
  Conferir 'o anterior continua valendo' ([W]::IsWindowVisible($hSis)) "Sistema visível com Ctrl+Alt+N: $([W]::IsWindowVisible($hSis))"
  [W]::Teclar(0x4E); Start-Sleep 0.5
  Fechar-Dock $d
}

foreach ($r in $Roteiro) { & "Roteiro-$($r.Substring(0,1).ToUpper())$($r.Substring(1))" }
Write-Host "`nFalhas: $script:falhas"
exit [int]($script:falhas -gt 0)
