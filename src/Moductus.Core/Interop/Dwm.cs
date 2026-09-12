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

    /// <summary>
    /// Cantos arredondados pelo DWM (Win11). Sem transparência de janela, que
    /// custa GPU: o DWM recorta a região e a borda do conteúdo acompanha.
    /// </summary>
    /// <summary>Material que o DWM pinta atrás da janela.</summary>
    public enum Backdrop
    {
        /// <summary>Sem material: a janela pinta o próprio fundo.</summary>
        None = 1,

        /// <summary>Mica — para superfície que fica aberta durante o trabalho.</summary>
        Mica = 2,

        /// <summary>Acrylic — para superfície transitória, que aparece por cima e some.</summary>
        Acrylic = 3,

        /// <summary>Mica Alt — variante mais escura, para janela com abas.</summary>
        MicaAlt = 4,
    }

    /// <summary>
    /// Pede ao DWM o material do fundo. Devolve <c>false</c> quando o sistema
    /// recusa — Windows 10, build antiga do 11, ou transparência desligada nas
    /// configurações de acessibilidade.
    /// </summary>
    /// <remarks>
    /// <para>
    /// <b>Quem chama precisa respeitar o retorno.</b> O material só aparece se
    /// a janela deixar o fundo transparente; se o DWM recusar e a janela ficar
    /// transparente mesmo assim, sobra um retângulo preto com texto por cima.
    /// </para>
    /// <para>
    /// Não usamos <c>AllowsTransparency</c> do WPF para isso, de propósito: ele
    /// liga <c>WS_EX_LAYERED</c>, que derruba a aceleração de hardware, mata a
    /// sombra e os cantos arredondados nativos — e as APIs de material do
    /// Windows 11 simplesmente ignoram janela layered. O caminho certo é
    /// estender o frame com <c>WindowChrome.GlassFrameThickness = -1</c>.
    /// </para>
    /// </remarks>
    public static unsafe bool SetBackdrop(nint window, Backdrop tipo)
    {
        var valor = (int)tipo;
        var hr = PInvoke.DwmSetWindowAttribute(
            (HWND)window,
            DWMWINDOWATTRIBUTE.DWMWA_SYSTEMBACKDROP_TYPE,
            &valor,
            sizeof(int));

        return hr.Succeeded;
    }

    public static unsafe void RoundCorners(nint window)
    {
        var preferencia = DWM_WINDOW_CORNER_PREFERENCE.DWMWCP_ROUND;
        PInvoke.DwmSetWindowAttribute((HWND)window, DWMWINDOWATTRIBUTE.DWMWA_WINDOW_CORNER_PREFERENCE, &preferencia, sizeof(DWM_WINDOW_CORNER_PREFERENCE));
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
