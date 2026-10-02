using Windows.Win32;
using Windows.Win32.Foundation;
using Windows.Win32.UI.Input.KeyboardAndMouse;

namespace Moductus.Core.Interop;

/// <summary>
/// As mensagens da área não-cliente que a barra de título própria precisa
/// responder para o Windows tratar o botão maximizar como o botão dele.
/// </summary>
/// <remarks>
/// <para>
/// Existe por causa do Snap Layouts do Windows 11: o painel de encaixe só
/// aparece quando o <c>WM_NCHITTEST</c> sobre o botão responde
/// <c>HTMAXBUTTON</c>. Botão desenhado pelo WPF, que o <c>WindowChrome</c>
/// marca como área de cliente, nunca dispara o painel — e a janela perde um
/// recurso do sistema só por ter barra própria.
/// </para>
/// <para>
/// O preço de responder <c>HTMAXBUTTON</c> é que o mouse sobre o botão passa
/// a chegar como mensagem não-cliente, e o WPF deixa de ver hover e clique.
/// Por isso as outras mensagens daqui: quem responde o teste também acende o
/// hover e executa o clique.
/// </para>
/// </remarks>
public static class NonClient
{
    public static int HitTest => (int)PInvoke.WM_NCHITTEST;

    public static int MouseMove => (int)PInvoke.WM_NCMOUSEMOVE;

    public static int MouseLeave => (int)PInvoke.WM_NCMOUSELEAVE;

    public static int ButtonDown => (int)PInvoke.WM_NCLBUTTONDOWN;

    public static int ButtonUp => (int)PInvoke.WM_NCLBUTTONUP;

    public static int DoubleClick => (int)PInvoke.WM_NCLBUTTONDBLCLK;

    /// <summary>O código que faz o Windows tratar o ponto como botão maximizar.</summary>
    public static int MaximizeButton => (int)PInvoke.HTMAXBUTTON;

    /// <summary>
    /// Pede um <c>WM_NCMOUSELEAVE</c> quando o mouse sair da área não-cliente.
    /// Sem isso o hover aceso pelo <c>WM_NCMOUSEMOVE</c> fica preso quando o
    /// mouse sai do botão direto para fora da janela, por cima da borda.
    /// </summary>
    public static unsafe void TrackLeave(nint window)
    {
        var pedido = new TRACKMOUSEEVENT
        {
            cbSize = (uint)sizeof(TRACKMOUSEEVENT),
            dwFlags = TRACKMOUSEEVENT_FLAGS.TME_LEAVE | TRACKMOUSEEVENT_FLAGS.TME_NONCLIENT,
            hwndTrack = (HWND)window,
        };

        PInvoke.TrackMouseEvent(ref pedido);
    }

    /// <summary>As coordenadas de tela, em pixels físicos, do <c>lParam</c> de uma mensagem de mouse.</summary>
    /// <remarks>
    /// Com sinal: no segundo monitor à esquerda do primário o x é negativo, e
    /// ler a palavra sem sinal joga o ponto para o outro lado da área de trabalho.
    /// </remarks>
    public static (int X, int Y) Point(nint lParam) =>
        ((short)(lParam & 0xFFFF), (short)((lParam >> 16) & 0xFFFF));
}
