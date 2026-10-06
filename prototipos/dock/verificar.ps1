$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms, System.Drawing
Add-Type @"
using System; using System.Runtime.InteropServices; using System.Text;
public static class W {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  [DllImport("user32.dll")] public static extern bool SystemParametersInfo(int a, int b, ref RECT r, int c);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern IntPtr FindWindow(string c, string t);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint m, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(int f, int x, int y, int d, int e);
  [DllImport("shell32.dll")] public static extern int SHQueryUserNotificationState(out int s);
  public static RECT Trabalho() { var r = new RECT(); SystemParametersInfo(0x30, 0, ref r, 0); return r; }
  public static string Titulo(IntPtr h) { var s = new StringBuilder(256); GetWindowText(h, s, 256); return s.ToString(); }
}
"@
$base = 'C:\Desenvolvimento\moductus-testes\dock'
[IO.File]::WriteAllText("$base\eventos.log", '')
$r = [ordered]@{}
$antes = [W]::Trabalho(); $r.area_antes = "$($antes.L),$($antes.T),$($antes.R),$($antes.B)"

$np = Start-Process notepad -PassThru; Start-Sleep 2
$hNp = $np.MainWindowHandle; [W]::SetForegroundWindow($hNp) | Out-Null; Start-Sleep 1

$dock = Start-Process "$base\src-tauri\target\debug\dock.exe" -PassThru; Start-Sleep 5
$hDock = (Get-Process -Id $dock.Id).MainWindowHandle
if ($hDock -eq [IntPtr]::Zero) { $hDock = [W]::FindWindow($null, 'Moductus dock') }
$r.hwnd_dock = $hDock
$depois = [W]::Trabalho(); $r.area_depois = "$($depois.L),$($depois.T),$($depois.R),$($depois.B)"
$rd = New-Object W+RECT; [W]::GetWindowRect($hDock, [ref]$rd) | Out-Null; $r.dock_rect = "$($rd.L),$($rd.T),$($rd.R),$($rd.B)"
$r.foco_apos_abrir_dock = [W]::Titulo([W]::GetForegroundWindow())

[W]::ShowWindow($hNp, 3) | Out-Null; Start-Sleep 1
$rn = New-Object W+RECT; [W]::GetWindowRect($hNp, [ref]$rn) | Out-Null; $r.notepad_maximizado = "$($rn.L),$($rn.T),$($rn.R),$($rn.B)"
[W]::SetForegroundWindow($hNp) | Out-Null; Start-Sleep 1

$cx = [int](($rd.L + $rd.R) / 2); $cy = $rd.T + 120
[W]::SetCursorPos($cx, $cy) | Out-Null; [W]::mouse_event(2,0,0,0,0); [W]::mouse_event(4,0,0,0,0); Start-Sleep 1
$r.foco_apos_clicar_dock = [W]::Titulo([W]::GetForegroundWindow())

$tela = [Windows.Forms.Screen]::PrimaryScreen.Bounds
$bmp = New-Object Drawing.Bitmap $tela.Width, $tela.Height
$g = [Drawing.Graphics]::FromImage($bmp); $g.CopyFromScreen(0,0,0,0,$bmp.Size); $bmp.Save("$base\print-dock.png"); $g.Dispose(); $bmp.Dispose()

$f = New-Object Windows.Forms.Form -Property @{ FormBorderStyle='None'; WindowState='Maximized'; TopMost=$true; BackColor='Black'; Text='tela cheia de teste' }
$f.Show(); $f.Activate(); [Windows.Forms.Application]::DoEvents(); Start-Sleep 2; [Windows.Forms.Application]::DoEvents()
$s = 0; [W]::SHQueryUserNotificationState([ref]$s) | Out-Null; $r.estado_notificacao_tela_cheia = $s
$r.dock_visivel_em_tela_cheia = [W]::IsWindowVisible($hDock)
$f.Close(); [Windows.Forms.Application]::DoEvents(); Start-Sleep 2
$r.dock_visivel_depois = [W]::IsWindowVisible($hDock)

$ids = @($dock.Id); $filhos = Get-CimInstance Win32_Process | Where-Object { $_.Name -like 'msedgewebview2*' }
do { $novos = $filhos | Where-Object { $ids -contains $_.ParentProcessId -and $ids -notcontains $_.ProcessId }; $ids += $novos.ProcessId } while ($novos)
$r.processos = $ids.Count
$ps = Get-Process -Id $ids -ErrorAction SilentlyContinue
$r.memoria_ws_MB = [math]::Round((($ps | Measure-Object WorkingSet64 -Sum).Sum / 1MB), 1)
$r.memoria_privada_MB = [math]::Round((($ps | Measure-Object PrivateMemorySize64 -Sum).Sum / 1MB), 1)

[W]::PostMessage($hDock, 0x10, [IntPtr]::Zero, [IntPtr]::Zero) | Out-Null; Start-Sleep 3
$fim = [W]::Trabalho(); $r.area_apos_fechar = "$($fim.L),$($fim.T),$($fim.R),$($fim.B)"
$r.dock_ainda_rodando = -not $dock.HasExited
Stop-Process -Id $np.Id -Force
$r.log = (Get-Content "$base\eventos.log") -join ' | '
[pscustomobject]$r | Format-List
