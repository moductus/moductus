using System.Windows.Media;
using Windows.Win32;
using Windows.Win32.Foundation;
using Windows.Win32.Graphics.Dwm;

namespace Moductus.Core.Interop;

/// <summary>Atributos de composição da janela: barra de título e afins.</summary>
public static class Dwm
{
    /// <summary>
    /// Pinta a barra de título com as cores dadas. Win11; no Win10 o DWM
    /// recusa e a chamada é ignorada, restando o modo escuro imersivo.
    /// </summary>
    public static unsafe void SetCaption(nint window, bool dark, Color? background, Color? text, Color? border)
    {
        var hwnd = (HWND)window;

        var imersivo = dark ? 1 : 0;
        PInvoke.DwmSetWindowAttribute(hwnd, DWMWINDOWATTRIBUTE.DWMWA_USE_IMMERSIVE_DARK_MODE, &imersivo, sizeof(int));

        if (background is { } fundo)
        {
            var cor = ToColorRef(fundo);
            PInvoke.DwmSetWindowAttribute(hwnd, DWMWINDOWATTRIBUTE.DWMWA_CAPTION_COLOR, &cor, sizeof(uint));
        }

        // A borda de 1px do Win11 também segue a cor de destaque do sistema.
        if (border is { } contorno)
        {
            var cor = ToColorRef(contorno);
            PInvoke.DwmSetWindowAttribute(hwnd, DWMWINDOWATTRIBUTE.DWMWA_BORDER_COLOR, &cor, sizeof(uint));
        }

        if (text is { } texto)
        {
            var cor = ToColorRef(texto);
            PInvoke.DwmSetWindowAttribute(hwnd, DWMWINDOWATTRIBUTE.DWMWA_TEXT_COLOR, &cor, sizeof(uint));
        }
    }

    /// <summary>Devolve a barra de título ao sistema — usado no alto contraste.</summary>
    public static unsafe void ResetCaption(nint window)
    {
        var hwnd = (HWND)window;
        const uint padrao = 0xFFFFFFFF; // DWMWA_COLOR_DEFAULT

        var cor = padrao;
        PInvoke.DwmSetWindowAttribute(hwnd, DWMWINDOWATTRIBUTE.DWMWA_CAPTION_COLOR, &cor, sizeof(uint));
        PInvoke.DwmSetWindowAttribute(hwnd, DWMWINDOWATTRIBUTE.DWMWA_TEXT_COLOR, &cor, sizeof(uint));
        PInvoke.DwmSetWindowAttribute(hwnd, DWMWINDOWATTRIBUTE.DWMWA_BORDER_COLOR, &cor, sizeof(uint));
    }

    // COLORREF é 0x00BBGGRR, o inverso do que o WPF usa.
    private static uint ToColorRef(Color c) => (uint)(c.R | (c.G << 8) | (c.B << 16));
}
