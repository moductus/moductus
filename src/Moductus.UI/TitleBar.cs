using System.Windows;
using System.Windows.Interop;
using System.Windows.Media;
using Moductus.Core.Interop;
using ThemeMode = Moductus.Core.Theme.ThemeMode;

namespace Moductus.UI;

/// <summary>
/// Faz a barra de título nativa seguir os tokens, em vez da cor de destaque
/// do sistema. Sem isto uma janela escura nasce com barra na cor que o
/// usuário escolheu para o Windows, que raramente combina.
/// </summary>
public static class TitleBar
{
    /// <summary>
    /// Sincroniza agora e a cada mudança de tema. Chamar depois que a janela
    /// tiver <c>HWND</c> — em <c>SourceInitialized</c> ou mais tarde.
    /// </summary>
    public static void Sync(Window window, Theme theme)
    {
        ArgumentNullException.ThrowIfNull(window);
        ArgumentNullException.ThrowIfNull(theme);

        void Aplicar() => Apply(window, theme);

        Aplicar();
        theme.Changed += Aplicar;
        window.Closed += (_, _) => theme.Changed -= Aplicar;
    }

    private static void Apply(Window window, Theme theme)
    {
        var hwnd = new WindowInteropHelper(window).Handle;
        if (hwnd == 0)
        {
            return;
        }

        if (theme.Mode == ThemeMode.HighContrast)
        {
            Dwm.ResetCaption(hwnd);
            return;
        }

        Dwm.SetCaption(
            hwnd,
            dark: theme.Mode == ThemeMode.Dark,
            background: window.TryFindResource("bg.base.color") as Color?,
            text: window.TryFindResource("text.primary.color") as Color?,
            border: window.TryFindResource("border.strong.color") as Color?);
    }
}
