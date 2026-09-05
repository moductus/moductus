using Windows.Win32;
using Windows.Win32.Foundation;
using Windows.Win32.Graphics.Dwm;
using Windows.Win32.UI.WindowsAndMessaging;

namespace Moductus.Core.Interop;

public sealed record TopLevelWindow(nint Handle, string Title, uint ProcessId);

/// <summary>As janelas que o usuário reconhece como "abertas": o que o Alt+Tab mostra.</summary>
public static class WindowList
{
    public static unsafe IReadOnlyList<TopLevelWindow> AltTab()
    {
        var lista = new List<TopLevelWindow>();
        var nossoProcesso = (uint)Environment.ProcessId;

        PInvoke.EnumWindows((hwnd, _) =>
        {
            if (!PInvoke.IsWindowVisible(hwnd))
            {
                return true;
            }

            var estilo = (WINDOW_EX_STYLE)(uint)PInvoke.GetWindowLongPtr(hwnd, WINDOW_LONG_PTR_INDEX.GWL_EXSTYLE);
            if (estilo.HasFlag(WINDOW_EX_STYLE.WS_EX_TOOLWINDOW))
            {
                return true;
            }

            // UWP em segundo plano fica "cloaked": invisível, mas enumerado.
            // Sem este filtro a lista enche de janelas fantasma.
            var cloaked = 0;
            PInvoke.DwmGetWindowAttribute(hwnd, DWMWINDOWATTRIBUTE.DWMWA_CLOAKED, &cloaked, sizeof(int));
            if (cloaked != 0)
            {
                return true;
            }

            var tamanho = PInvoke.GetWindowTextLength(hwnd);
            if (tamanho == 0)
            {
                return true;
            }

            Span<char> buffer = stackalloc char[tamanho + 1];
            var lidos = PInvoke.GetWindowText(hwnd, buffer);
            var titulo = new string(buffer[..lidos]);

            uint pid;
            PInvoke.GetWindowThreadProcessId(hwnd, &pid);
            if (pid == nossoProcesso)
            {
                return true;
            }

            lista.Add(new TopLevelWindow((nint)hwnd.Value, titulo, pid));
            return true;
        }, default);

        return lista;
    }
}
