using System.Windows.Media;
using System.Windows.Media.Imaging;
using Windows.Win32;
using Windows.Win32.Foundation;
using Windows.Win32.Graphics.Gdi;
using Windows.Win32.UI.WindowsAndMessaging;

namespace Moductus.Core.Tray;

/// <summary>
/// Converte um bitmap do WPF em <c>HICON</c>, e diz o tamanho que a bandeja
/// está pedindo.
/// </summary>
public static class IconFactory
{
    private const uint BiRgb = 0;

    /// <summary>
    /// 16, 20, 24 ou 32 conforme o scaling. Gerar o bitmap neste tamanho é
    /// obrigatório: renderizar fixo em 16 e deixar o Windows escalar borra
    /// exatamente o ativo visual mais visível do produto.
    /// </summary>
    public static int TraySize()
    {
        var dpi = PInvoke.GetDpiForSystem();
        var tamanho = PInvoke.GetSystemMetricsForDpi(SYSTEM_METRICS_INDEX.SM_CXSMICON, dpi);
        return tamanho > 0 ? tamanho : 16;
    }

    /// <summary>
    /// Cria um <c>HICON</c> de 32 bits com canal alfa. Quem chama é dono do
    /// handle e precisa destruí-lo com <see cref="Destroy"/>.
    /// </summary>
    public static unsafe nint FromBitmap(BitmapSource source)
    {
        ArgumentNullException.ThrowIfNull(source);

        var bgra = source.Format == PixelFormats.Bgra32
            ? source
            : new FormatConvertedBitmap(source, PixelFormats.Bgra32, null, 0);

        var largura = bgra.PixelWidth;
        var altura = bgra.PixelHeight;

        var info = new BITMAPINFO
        {
            bmiHeader = new BITMAPINFOHEADER
            {
                biSize = (uint)sizeof(BITMAPINFOHEADER),
                biWidth = largura,
                biHeight = -altura, // negativo = topo para baixo, a ordem do WPF
                biPlanes = 1,
                biBitCount = 32,
                biCompression = BiRgb,
            },
        };

        // Os dois SafeHandles liberam os bitmaps na saída; o Windows já
        // terá copiado o conteúdo para dentro do ícone.
        using var cor = PInvoke.CreateDIBSection(HDC.Null, &info, DIB_USAGE.DIB_RGB_COLORS, out var pixels, null, 0);

        if (cor.IsInvalid)
        {
            throw new InvalidOperationException("CreateDIBSection falhou.");
        }

        // Máscara obrigatória mesmo em 32 bits; zerada, o alfa é que manda.
        // Esta vem como HBITMAP cru, então a liberação é manual.
        var mascara = PInvoke.CreateBitmap(largura, altura, 1, 1, null);

        try
        {
            bgra.CopyPixels(
                new System.Windows.Int32Rect(0, 0, largura, altura),
                (nint)pixels,
                largura * altura * 4,
                largura * 4);

            var iconInfo = new ICONINFO
            {
                fIcon = true,
                hbmColor = (HBITMAP)cor.DangerousGetHandle(),
                hbmMask = mascara,
            };

            // CreateIconIndirect devolve um SafeHandle que destruiria o ícone
            // ao ser coletado. Aqui a vida do handle é nossa: o Windows fica
            // com ele até o próximo Shell_NotifyIcon.
            var handle = PInvoke.CreateIconIndirect(in iconInfo);

            if (handle.IsInvalid)
            {
                throw new InvalidOperationException("CreateIconIndirect falhou.");
            }

            var bruto = handle.DangerousGetHandle();
            handle.SetHandleAsInvalid();
            return bruto;
        }
        finally
        {
            PInvoke.DeleteObject(mascara);
        }
    }

    public static void Destroy(nint icon)
    {
        if (icon != 0)
        {
            PInvoke.DestroyIcon(new HICON(icon));
        }
    }
}
