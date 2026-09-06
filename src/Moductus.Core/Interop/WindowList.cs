using Windows.Win32;
using Windows.Win32.Foundation;
using Windows.Win32.Graphics.Dwm;
using Windows.Win32.UI.WindowsAndMessaging;

namespace Moductus.Core.Interop;

public sealed record TopLevelWindow(nint Handle, string Title, uint ProcessId);

/// <summary>As janelas que o usuário reconhece como "abertas": o que o Alt+Tab mostra.</summary>
public static class WindowList
{
    /// <summary>
    /// A janela de topo sob um ponto da tela, ignorando as nossas. Usa a
    /// ordem Z do EnumWindows em vez de WindowFromPoint, porque este
    /// devolveria o próprio Canvas fullscreen que está por cima.
    /// </summary>
    public static unsafe TopLevelWindow? TopLevelAt(int x, int y)
    {
        var nossoProcesso = (uint)Environment.ProcessId;
        TopLevelWindow? achada = null;

        PInvoke.EnumWindows((hwnd, _) =>
        {
            if (!PInvoke.IsWindowVisible(hwnd))
            {
                return true;
            }

            uint pid;
            PInvoke.GetWindowThreadProcessId(hwnd, &pid);
            if (pid == nossoProcesso)
            {
                return true;
            }

            var cloaked = 0;
            PInvoke.DwmGetWindowAttribute(hwnd, DWMWINDOWATTRIBUTE.DWMWA_CLOAKED, &cloaked, sizeof(int));
            if (cloaked != 0)
            {
                return true;
            }

            PInvoke.GetWindowRect(hwnd, out var r);
            if (x < r.left || x >= r.right || y < r.top || y >= r.bottom)
            {
                return true;
            }

            var tamanho = PInvoke.GetWindowTextLength(hwnd);
            Span<char> buffer = stackalloc char[tamanho + 1];
            var lidos = PInvoke.GetWindowText(hwnd, buffer);

            achada = new TopLevelWindow((nint)hwnd.Value, new string(buffer[..lidos]), pid);
            return false; // a primeira na ordem Z é a que está por cima
        }, default);

        return achada;
    }

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
