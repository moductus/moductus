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
    inicio     segunda execução foca a primeira; autostart liga e desliga
    midia      o dock acompanha uma sessão de mídia de teste (tocar, pausar por fora, fim) por evento
               (pede: cargo build --example sessao_midia)
    controles  mudo do microfone feito fora chega ao dock; Awake liga pelo dock e é liberado ao sair
    servico    matar o serviço faz a casca subir outro, e o dock mostra o estado; sair encerra o serviço
    teclado    rótulos de todos os botões do dock (UI Automation); Ctrl+Alt+D cicla mostrar, focar
               e esconder; setas, Home, End e Esc dentro do dock

.EXAMPLE
  pnpm tauri build --debug --no-bundle
  pwsh -File scripts\verificar.ps1 -Roteiro appbar
#>
param(
  [ValidateSet('appbar', 'modos', 'telacheia', 'janelas', 'atalhos', 'inicio', 'midia', 'controles', 'servico', 'teclado')]
  [string[]]$Roteiro = @('appbar', 'modos', 'telacheia', 'janelas', 'atalhos', 'inicio', 'midia', 'controles', 'servico', 'teclado'),
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
  # A área Hoje é o segundo botão, depois da marca: 14 de respiro + marca de 44 + 6 de margem
  # + 6 de espaço, e o meio do botão de 44. Em pixels físicos, pela escala do dock (64 lógicos).
  $escala = ($rd.R - $rd.L) / 64
  $yHoje = $rd.T + [int]((14 + 44 + 6 + 6 + 44 / 2) * $escala)
  $foco = $true
  for ($i = 0; $i -lt 5; $i++) {
    Clicar-Em $janela.Handle; Bombear 0.5
    [W]::SetCursorPos([int](($rd.L + $rd.R) / 2), $yHoje) | Out-Null
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
  # A mesma área de novo fecha; depois reabre e fecha pelo X do cabeçalho (40 px lógicos da
  # borda direita, 45 do topo). O painel é mostrado por ShowWindow: fechar tem que esconder.
  [W]::SetCursorPos([int](($rd.L + $rd.R) / 2), $yHoje) | Out-Null
  [W]::mouse_event(2, 0, 0, 0, 0); [W]::mouse_event(4, 0, 0, 0, 0); Bombear 0.8
  $aberto = [W]::IsWindowVisible($hPainel)
  [W]::mouse_event(2, 0, 0, 0, 0); [W]::mouse_event(4, 0, 0, 0, 0); Bombear 0.8
  Conferir 'a mesma área de novo fecha o painel' ($aberto -and -not [W]::IsWindowVisible($hPainel)) "aberto: $aberto, depois: $([W]::IsWindowVisible($hPainel))"
  [W]::mouse_event(2, 0, 0, 0, 0); [W]::mouse_event(4, 0, 0, 0, 0); Bombear 0.8
  $rp = Retangulo $hPainel
  [W]::SetCursorPos([int]($rp.R - 40 * $escala), [int]($rp.T + 45 * $escala)) | Out-Null
  [W]::mouse_event(2, 0, 0, 0, 0); [W]::mouse_event(4, 0, 0, 0, 0); Bombear 0.8
  Conferir 'o X fecha o painel' (-not [W]::IsWindowVisible($hPainel)) "painel visível: $([W]::IsWindowVisible($hPainel))"
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

  # Ctrl+Alt+D cicla: com o dock na tela, o primeiro dá o foco a ele; o segundo esconde.
  [W]::Teclar(0x44); Start-Sleep 1
  Conferir 'Ctrl+Alt+D dá o foco ao dock' ([W]::GetForegroundWindow() -eq $d.Hwnd) "primeiro plano: '$([W]::Titulo([W]::GetForegroundWindow()))'"
  [W]::Teclar(0x44); Start-Sleep 1
  $a = [W]::Trabalho()
  Conferir 'Ctrl+Alt+D de novo esconde o dock e devolve a faixa' (-not [W]::IsWindowVisible($d.Hwnd) -and (Texto $a) -eq (Texto $antes)) "dock visível: $([W]::IsWindowVisible($d.Hwnd)), área $(Texto $a)"
  [W]::Teclar(0x44); Start-Sleep 1
  $a = [W]::Trabalho()
  Conferir 'Ctrl+Alt+D pela terceira vez mostra e reserva' ([W]::IsWindowVisible($d.Hwnd) -and (Texto $a) -ne (Texto $antes)) "área $(Texto $a)"

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

function Roteiro-Inicio {
  Write-Host "`n== inicio =="
  Get-Process moductus -ErrorAction SilentlyContinue | Stop-Process -Force
  Start-Sleep 1
  $d = Iniciar-Dock
  $hSis = [W]::FindWindow([NullString]::Value, 'Moductus')

  $segunda = Start-Process $Exe -PassThru
  $segunda.WaitForExit(10000) | Out-Null; Start-Sleep 1
  $processos = @(Get-Process moductus -ErrorAction SilentlyContinue).Count
  $frente = [W]::GetForegroundWindow()
  Conferir 'segunda execução foca a primeira' ($segunda.HasExited -and $processos -eq 1 -and [W]::IsWindowVisible($hSis) -and $frente -eq $hSis) "segunda saiu: $($segunda.HasExited), processos: $processos, primeiro plano: '$([W]::Titulo($frente))'"
  [W]::PostMessage($hSis, 0x10, [IntPtr]::Zero, [IntPtr]::Zero) | Out-Null; Start-Sleep 0.5

  $chave = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
  Start-Process $Exe -ArgumentList '--autostart', 'ligar' -Wait; Start-Sleep 1
  $valor = (Get-ItemProperty $chave -ErrorAction SilentlyContinue).Moductus
  Conferir 'autostart liga' ([bool]$valor) "Run\Moductus = $valor"
  Start-Process $Exe -ArgumentList '--autostart', 'desligar' -Wait; Start-Sleep 1
  $valor = (Get-ItemProperty $chave -ErrorAction SilentlyContinue).Moductus
  Conferir 'autostart desliga' (-not $valor) "Run\Moductus = '$valor'"
  Fechar-Dock $d
}

function Linhas-Novas($log, [int]$desde, [string]$padrao) {
  @(Get-Content $log | Select-Object -Skip $desde | Where-Object { $_ -match $padrao })
}

function Roteiro-Midia {
  Write-Host "`n== midia =="
  Get-Process moductus -ErrorAction SilentlyContinue | Stop-Process -Force
  Start-Sleep 1
  $log = Join-Path $env:APPDATA 'Moductus\moductus.log'
  $sessao = Join-Path (Split-Path $Exe) 'examples\sessao_midia.exe'
  $d = Iniciar-Dock
  $inicio = (Get-Content $log).Count

  $p = Start-Process $sessao -ArgumentList 10 -PassThru -WindowStyle Hidden
  Start-Sleep 3
  $casca = Linhas-Novas $log $inicio 'mídia: .*Teste do Moductus \(tocando\)'
  $ui = Linhas-Novas $log $inicio 'interface: midia Teste do Moductus tocando'
  Conferir 'sessão nova chega ao dock' ($casca.Count -ge 1 -and $ui.Count -ge 1) "casca: $($casca.Count), interface: $($ui.Count)"

  $marca = (Get-Content $log).Count
  [W]::keybd_event(0xB3, 0, 0, [IntPtr]::Zero); [W]::keybd_event(0xB3, 0, 2, [IntPtr]::Zero); Start-Sleep 1.5
  $ui = Linhas-Novas $log $marca 'interface: midia Teste do Moductus pausada'
  Conferir 'pausa feita fora do Moductus chega ao dock' ($ui.Count -ge 1) "eventos: $($ui.Count)"

  $p.WaitForExit(15000) | Out-Null; Start-Sleep 2
  $fim = Linhas-Novas $log $marca 'interface: midia (sem sessão|(?!Teste do Moductus))'
  Conferir 'fim da sessão chega ao dock' ($fim.Count -ge 1) "último: $(($fim | Select-Object -Last 1) -replace '^\d+ ', '')"

  $verificacoes = Linhas-Novas $log $inicio '^\d+ mídia:'
  Write-Host "        $($verificacoes.Count) avisos da casca em ~15 s (só nas mudanças, sem consulta periódica)"
  Fechar-Dock $d
}

function Carregar-Controles {
  if ('Audio' -as [type]) { return }
  Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
  Add-Type @"
using System; using System.Runtime.InteropServices;
[Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDeviceEnumerator { int NotImpl1(); int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice ep); }
[Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDevice { int Activate(ref Guid iid, int ctx, IntPtr p, [MarshalAs(UnmanagedType.IUnknown)] out object o); }
[Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioEndpointVolume {
  int f1(); int f2(); int f3(); int f4(); int f5(); int f6(); int f7(); int f8(); int f9(); int f10(); int f11();
  int SetMute([MarshalAs(UnmanagedType.Bool)] bool mute, ref Guid ctx);
  int GetMute([MarshalAs(UnmanagedType.Bool)] out bool mute);
}
[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class MMDeviceEnumeratorCom { }
public static class Audio {
  static IAudioEndpointVolume Vol() {
    var e = (IMMDeviceEnumerator)new MMDeviceEnumeratorCom(); IMMDevice d;
    if (e.GetDefaultAudioEndpoint(1, 2, out d) != 0) return null;
    var iid = typeof(IAudioEndpointVolume).GUID; object o; d.Activate(ref iid, 23, IntPtr.Zero, out o);
    return (IAudioEndpointVolume)o;
  }
  public static bool Existe() { return Vol() != null; }
  public static bool Mudo() { bool m; Vol().GetMute(out m); return m; }
  public static void Definir(bool m) { var g = Guid.Empty; Vol().SetMute(m, ref g); }
  [DllImport("powrprof.dll")] static extern uint CallNtPowerInformation(int level, IntPtr i, int il, out uint o, int ol);
  public static uint Execucao() { uint e; CallNtPowerInformation(16, IntPtr.Zero, 0, out e, 4); return e; }
}
"@
}

function Botao-Do-Dock([IntPtr]$hDock, [string]$nome) {
  $raiz = [Windows.Automation.AutomationElement]::FromHandle($hDock)
  $cond = New-Object Windows.Automation.PropertyCondition([Windows.Automation.AutomationElement]::NameProperty, $nome)
  for ($i = 0; $i -lt 20; $i++) {
    $b = $raiz.FindFirst([Windows.Automation.TreeScope]::Descendants, $cond)
    if ($b) { return $b }
    Start-Sleep -Milliseconds 250
  }
}

# Botão comum expõe Invoke; botão de alternância (aria-pressed) expõe Toggle.
function Acionar($elemento) {
  $p = $null
  if ($elemento.TryGetCurrentPattern([Windows.Automation.InvokePattern]::Pattern, [ref]$p)) { $p.Invoke() }
  elseif ($elemento.TryGetCurrentPattern([Windows.Automation.TogglePattern]::Pattern, [ref]$p)) { $p.Toggle() }
}

function Roteiro-Controles {
  Write-Host "`n== controles =="
  Carregar-Controles
  Get-Process moductus -ErrorAction SilentlyContinue | Stop-Process -Force
  Start-Sleep 1
  $log = Join-Path $env:APPDATA 'Moductus\moductus.log'
  $d = Iniciar-Dock
  Start-Sleep 1

  if ([Audio]::Existe()) {
    $original = [Audio]::Mudo()
    $marca = (Get-Content $log).Count
    [Audio]::Definir(-not $original); Start-Sleep 1
    [Audio]::Definir($original); Start-Sleep 1
    $esperado = if ($original) { @('aberto', 'mudo') } else { @('mudo', 'aberto') }
    $ui = @(Linhas-Novas $log $marca 'interface: mic ' | ForEach-Object { ($_ -split 'interface: mic ')[1] })
    Conferir 'mudo feito fora chega ao dock' (($ui -join ',') -eq ($esperado -join ',')) "interface recebeu: $($ui -join ', '); microfone voltou a mudo=$([Audio]::Mudo())"
  } else {
    Write-Host '        sem microfone de comunicação nesta máquina: o controle fica desativado'
  }

  $antes = [Audio]::Execucao()
  $botao = Botao-Do-Dock $d.Hwnd 'Manter acordado'
  Acionar $botao; Start-Sleep 1
  $ligado = [Audio]::Execucao()
  Conferir 'Awake liga pelo dock' (($ligado -band 0x3) -eq 0x3) ("SystemExecutionState 0x{0:X} -> 0x{1:X}" -f $antes, $ligado)
  Fechar-Dock $d
  $depois = [Audio]::Execucao()
  Conferir 'Awake é liberado ao sair' (($depois -band 0x3) -eq ($antes -band 0x3)) ("SystemExecutionState depois de sair 0x{0:X}" -f $depois)
}

function Tecla([byte]$vk) {
  [W]::keybd_event($vk, 0, 0, [IntPtr]::Zero); [W]::keybd_event($vk, 0, 2, [IntPtr]::Zero)
}
function Nome-Focado {
  try { [Windows.Automation.AutomationElement]::FocusedElement.Current.Name } catch { '' }
}

function Roteiro-Teclado {
  Write-Host "`n== teclado =="
  Carregar-Controles
  Get-Process moductus -ErrorAction SilentlyContinue | Stop-Process -Force
  Start-Sleep 1
  $janela = Nova-Janela
  $antes = [W]::Trabalho()
  $d = Iniciar-Dock
  Start-Sleep 1

  # Todo botão do dock tem nome acessível, na ordem do canvas (mídia só com sessão tocando).
  $raiz = [Windows.Automation.AutomationElement]::FromHandle($d.Hwnd)
  $cond = New-Object Windows.Automation.PropertyCondition([Windows.Automation.AutomationElement]::ControlTypeProperty, [Windows.Automation.ControlType]::Button)
  # O WebView2 só monta a árvore de acessibilidade depois da primeira consulta: tenta por até 5 s.
  for ($t = 0; $t -lt 10; $t++) {
    $nomes = @($raiz.FindAll([Windows.Automation.TreeScope]::Descendants, $cond) | ForEach-Object { $_.Current.Name })
    if ($nomes.Count) { break }
    Start-Sleep -Milliseconds 500
  }
  $convite = 'dormindo. Conectar um modelo'
  $esperado = @('Abrir o Sistema', 'Hoje', 'Tarefas', 'Foco', 'Finanças', 'Dev', 'Notas', 'Arquivos',
    "Alba, $convite", "Tula, $convite", "Faina, $convite", "Nuno, $convite", 'Microfone mudo', 'Manter acordado')
  $semMidia = @($nomes | Where-Object { $_ -notmatch '^(Tocar|Pausar) ' })
  Conferir 'botões com rótulo, na ordem' ((($semMidia -join '|') -eq ($esperado -join '|')) -and -not ($nomes -contains '')) "$($nomes.Count) botões: $($nomes -join ', ')"

  Clicar-Em $janela.Handle; Bombear 0.5
  [W]::Teclar(0x44); Bombear 1
  Conferir 'Ctrl+Alt+D com o dock na tela dá o foco a ele' ([W]::GetForegroundWindow() -eq $d.Hwnd) "primeiro plano: '$([W]::Titulo([W]::GetForegroundWindow()))'"
  Conferir 'o foco começa na primeira área' ((Nome-Focado) -eq 'Hoje') "focado: '$(Nome-Focado)'"
  Tecla 0x28; Bombear 0.3
  Conferir 'seta para baixo anda' ((Nome-Focado) -eq 'Tarefas') "focado: '$(Nome-Focado)'"
  Tecla 0x23; Bombear 0.3
  Conferir 'End vai ao último' ((Nome-Focado) -eq 'Manter acordado') "focado: '$(Nome-Focado)'"
  Tecla 0x24; Bombear 0.3
  Conferir 'Home vai à marca' ((Nome-Focado) -eq 'Abrir o Sistema') "focado: '$(Nome-Focado)'"
  Tecla 0x1B; Bombear 1
  Conferir 'Esc devolve o foco à janela anterior' ([W]::GetForegroundWindow() -eq $janela.Handle) "primeiro plano: '$([W]::Titulo([W]::GetForegroundWindow()))'"
  $estilo = [W]::GetWindowLong($d.Hwnd, -20)
  Conferir 'Esc devolve o sem ativar' (($estilo -band 0x08000000) -ne 0) ("estilo estendido 0x{0:X}" -f $estilo)

  [W]::Teclar(0x44); Bombear 1
  [W]::Teclar(0x44); Bombear 1
  $a = [W]::Trabalho()
  Conferir 'com o foco, Ctrl+Alt+D esconde e devolve a faixa' (-not [W]::IsWindowVisible($d.Hwnd) -and (Texto $a) -eq (Texto $antes)) "dock visível: $([W]::IsWindowVisible($d.Hwnd)), área $(Texto $a)"
  [W]::Teclar(0x44); Bombear 1
  Conferir 'escondido, Ctrl+Alt+D mostra sem tirar o foco' ([W]::IsWindowVisible($d.Hwnd) -and [W]::GetForegroundWindow() -ne $d.Hwnd) "primeiro plano: '$([W]::Titulo([W]::GetForegroundWindow()))'"
  Fechar-Dock $d
  $janela.Close()
}

function Filhos-Node([int]$pai) {
  @(Get-CimInstance Win32_Process -Filter "ParentProcessId = $pai AND Name = 'node.exe'")
}

function Roteiro-Servico {
  Write-Host "`n== servico =="
  Get-Process moductus -ErrorAction SilentlyContinue | Stop-Process -Force
  Start-Sleep 1
  $log = Join-Path $env:APPDATA 'Moductus\moductus.log'
  $d = Iniciar-Dock
  Start-Sleep 2
  $antes = Filhos-Node $d.Processo.Id
  Conferir 'casca sobe o serviço' ($antes.Count -eq 1) "node filho: $($antes.ProcessId -join ', ')"

  $marca = (Get-Content $log).Count
  Stop-Process -Id $antes[0].ProcessId -Force
  Start-Sleep 3
  $depois = Filhos-Node $d.Processo.Id
  Conferir 'matar o serviço faz a casca subir outro' ($depois.Count -eq 1 -and $depois[0].ProcessId -ne $antes[0].ProcessId) "node novo: $($depois.ProcessId -join ', ')"
  $ui = @(Linhas-Novas $log $marca 'interface: servico ' | ForEach-Object { ($_ -split 'interface: servico ')[1] })
  Conferir 'dock mostra o estado enquanto isso' (($ui -join ',') -match 'reiniciando.*iniciando.*pronto') "interface: $($ui -join ' -> ')"
  $canal = @(Linhas-Novas $log $marca 'interface: canal ' | ForEach-Object { ($_ -split 'interface: canal ')[1] })
  Conferir 'interface reconecta sozinha ao serviço novo' (($canal -join ',') -match 'desconectado.*conectado$') "canal: $($canal -join ' -> ')"

  $ultimo = $depois[0].ProcessId
  Fechar-Dock $d
  Start-Sleep 1
  Conferir 'sair encerra o serviço' (-not (Get-Process -Id $ultimo -ErrorAction SilentlyContinue)) "node $ultimo ainda vivo: $([bool](Get-Process -Id $ultimo -ErrorAction SilentlyContinue))"
}

foreach ($r in $Roteiro) { & "Roteiro-$($r.Substring(0,1).ToUpper())$($r.Substring(1))" }
Write-Host "`nFalhas: $script:falhas"
exit [int]($script:falhas -gt 0)
