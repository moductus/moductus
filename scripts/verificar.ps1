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

.EXAMPLE
  pnpm tauri build --debug --no-bundle
  pwsh -File scripts\verificar.ps1 -Roteiro appbar
#>
param(
  [ValidateSet('appbar')]
  [string[]]$Roteiro = @('appbar'),
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
function Iniciar-Dock {
  $p = Start-Process $Exe -PassThru
  $h = [IntPtr]::Zero
  for ($i = 0; $i -lt 50 -and $h -eq [IntPtr]::Zero; $i++) { Start-Sleep -Milliseconds 200; $h = [W]::FindWindow([NullString]::Value, 'Moductus dock') }
  Start-Sleep 2
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

foreach ($r in $Roteiro) { & "Roteiro-$($r.Substring(0,1).ToUpper())$($r.Substring(1))" }
Write-Host "`nFalhas: $script:falhas"
exit [int]($script:falhas -gt 0)
