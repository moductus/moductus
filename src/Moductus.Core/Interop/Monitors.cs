using Windows.Win32;
using Windows.Win32.Foundation;
using Windows.Win32.Graphics.Gdi;
using Windows.Win32.UI.HiDpi;
using Windows.Win32.UI.WindowsAndMessaging;

namespace Moductus.Core.Interop;

/// <summary>
/// Um monitor, em pixels físicos, com a escala para converter de DIP.
/// </summary>
public readonly record struct MonitorArea(
    int Left, int Top, int Width, int Height,
    int WorkLeft, int WorkTop, int WorkWidth, int WorkHeight,
    double Scale)
{
    /// <summary>DIP para pixel físico deste monitor.</summary>
    public int Px(double dip) => (int)Math.Round(dip * Scale);
}

/// <summary>
/// Onde uma superfície deve aparecer: no monitor da janela em foreground,
/// não no primário. A conversão entre pixel físico e DIP acontece aqui, uma
/// vez, e nunca espalhada pelo código de módulo.
/// </summary>
public static class Monitors
{
    public static unsafe MonitorArea Around(nint foreground)
    {
        HMONITOR monitor;

        if (foreground != 0 && PInvoke.IsWindow((HWND)foreground))
        {
            monitor = PInvoke.MonitorFromWindow((HWND)foreground, MONITOR_FROM_FLAGS.MONITOR_DEFAULTTONEAREST);
        }
        else
        {
            PInvoke.GetCursorPos(out var cursor);
            monitor = PInvoke.MonitorFromPoint(cursor, MONITOR_FROM_FLAGS.MONITOR_DEFAULTTONEAREST);
        }

        var info = new MONITORINFO { cbSize = (uint)sizeof(MONITORINFO) };
        PInvoke.GetMonitorInfo(monitor, ref info);

        // Per-Monitor V2: cada monitor tem a própria escala, e ela pode ser
        // diferente da do primário. Errar isto é overlay borrado ou fora de lugar.
        PInvoke.GetDpiForMonitor(monitor, MONITOR_DPI_TYPE.MDT_EFFECTIVE_DPI, out var dpiX, out _);

        var m = info.rcMonitor;
        var w = info.rcWork;

        return new MonitorArea(
            m.left, m.top, m.right - m.left, m.bottom - m.top,
            w.left, w.top, w.right - w.left, w.bottom - w.top,
            dpiX / 96.0);
    }

    /// <summary>
    /// Posiciona em pixels físicos, sem passar pela conversão de DIP do WPF —
    /// que, para janela ainda não exibida, usa a escala do monitor errado.
    /// </summary>
    public static void Place(nint window, int x, int y, int width, int height) =>
        PInvoke.SetWindowPos(
            (HWND)window, HWND.Null, x, y, width, height,
            SET_WINDOW_POS_FLAGS.SWP_NOZORDER | SET_WINDOW_POS_FLAGS.SWP_NOACTIVATE);
}
