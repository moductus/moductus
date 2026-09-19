using Windows.Win32;
using Windows.Win32.Foundation;
using Windows.Win32.Graphics.Dwm;

namespace Moductus.Core.Interop;

/// <summary>
/// Miniatura ao vivo de outra janela, desenhada pelo DWM por cima da nossa.
/// </summary>
/// <remarks>
/// Não é um visual do WPF: o DWM pinta direto na região indicada da janela
/// de destino, por cima de qualquer coisa que esteja lá. Quem usa precisa
/// reservar o espaço e atualizar o retângulo quando o layout mudar.
/// Coordenadas em pixels físicos, relativas à área cliente do destino.
/// </remarks>
public sealed class DwmThumbnail : IDisposable
{
    private nint _id;

    private DwmThumbnail(nint id) => _id = id;

    /// <summary><c>null</c> se a janela de origem não pode ser espelhada.</summary>
    public static unsafe DwmThumbnail? Register(nint destination, nint source)
    {
        nint id;
        var hr = PInvoke.DwmRegisterThumbnail((HWND)destination, (HWND)source, &id);
        return hr.Succeeded ? new DwmThumbnail(id) : null;
    }

    /// <summary>Tamanho da origem em pixels físicos, para manter a proporção.</summary>
    public unsafe (int Width, int Height) SourceSize()
    {
        SIZE tamanho;
        PInvoke.DwmQueryThumbnailSourceSize(_id, &tamanho);
        return (tamanho.cx, tamanho.cy);
    }

    /// <summary>
    /// Move a miniatura e diz com quanta tinta desenhá-la.
    /// </summary>
    /// <remarks>
    /// A opacidade vem por parâmetro porque nenhuma outra tem como chegar
    /// aqui: o DWM pinta por cima do HWND, fora da árvore visual do WPF, e
    /// opacidade de elemento ou de pincel não alcança um pixel que não é
    /// nosso. Este campo do struct é o único lugar onde ela existe.
    /// </remarks>
    /// <param name="opacity">0 é invisível, 255 é a origem intacta.</param>
    public void Update(int left, int top, int right, int bottom, byte opacity, bool visible = true)
    {
        var props = new DWM_THUMBNAIL_PROPERTIES
        {
            dwFlags = PInvoke.DWM_TNP_RECTDESTINATION | PInvoke.DWM_TNP_VISIBLE | PInvoke.DWM_TNP_SOURCECLIENTAREAONLY | PInvoke.DWM_TNP_OPACITY,
            rcDestination = new RECT { left = left, top = top, right = right, bottom = bottom },
            fVisible = visible,
            fSourceClientAreaOnly = true,
            opacity = opacity,
        };

        PInvoke.DwmUpdateThumbnailProperties(_id, in props);
    }

    public void Dispose()
    {
        if (_id != 0)
        {
            PInvoke.DwmUnregisterThumbnail(_id);
            _id = 0;
        }
    }
}
