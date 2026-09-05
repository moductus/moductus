using Windows.Win32;
using Windows.Win32.Foundation;
using Windows.Win32.UI.WindowsAndMessaging;

namespace Moductus.Core.Interop;

/// <summary>Estilos estendidos que o WPF não expõe.</summary>
public static class WindowStyles
{
    /// <summary>
    /// A janela aparece sem tirar o foco de ninguém. É o que HUD e Panel usam
    /// para nunca interromper o que o usuário estava digitando.
    /// </summary>
    public static void MakeNoActivate(nint window) => Add(window, WINDOW_EX_STYLE.WS_EX_NOACTIVATE);

    /// <summary>Fora do Alt+Tab. <c>ShowInTaskbar=false</c> sozinho não basta.</summary>
    public static void MakeToolWindow(nint window) => Add(window, WINDOW_EX_STYLE.WS_EX_TOOLWINDOW);

    private static void Add(nint window, WINDOW_EX_STYLE flag)
    {
        var hwnd = (HWND)window;
        var atual = PInvoke.GetWindowLongPtr(hwnd, WINDOW_LONG_PTR_INDEX.GWL_EXSTYLE);
        PInvoke.SetWindowLongPtr(hwnd, WINDOW_LONG_PTR_INDEX.GWL_EXSTYLE, atual | (nint)flag);
    }
}
