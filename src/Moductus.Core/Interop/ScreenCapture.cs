using System.Windows;
using System.Windows.Interop;
using System.Windows.Media.Imaging;
using Windows.Win32;
using Windows.Win32.Foundation;
using Windows.Win32.Graphics.Gdi;

namespace Moductus.Core.Interop;

/// <summary>
/// Congela um monitor como bitmap. É o que o Canvas exibe por baixo: régua,
/// lupa, conta-gotas e OCR operam sobre isto em memória, precisos e
/// independentes do que estava se movendo na tela.
/// </summary>
public static class ScreenCapture
{
    public static unsafe BitmapSource Capture(MonitorArea area)
    {
        var tela = PInvoke.GetDC(HWND.Null);
        var memoria = PInvoke.CreateCompatibleDC(tela);
        var bitmap = PInvoke.CreateCompatibleBitmap(tela, area.Width, area.Height);
        var anterior = PInvoke.SelectObject(memoria, bitmap);

        try
        {
            // CAPTUREBLT inclui janelas em camadas (transparentes), que o
            // SRCCOPY sozinho deixa de fora.
            PInvoke.BitBlt(memoria, 0, 0, area.Width, area.Height, tela, area.Left, area.Top,
                ROP_CODE.SRCCOPY | ROP_CODE.CAPTUREBLT);

            PInvoke.SelectObject(memoria, anterior);

            var fonte = Imaging.CreateBitmapSourceFromHBitmap(
                (nint)bitmap.Value, 0, Int32Rect.Empty, BitmapSizeOptions.FromEmptyOptions());
            fonte.Freeze();
            return fonte;
        }
        finally
        {
            PInvoke.DeleteObject(bitmap);
            PInvoke.DeleteDC(memoria);
            PInvoke.ReleaseDC(HWND.Null, tela);
        }
    }
}
