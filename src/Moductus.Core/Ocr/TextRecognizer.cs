using System.Windows.Media;
using System.Windows.Media.Imaging;
using Windows.Graphics.Imaging;
using Windows.Media.Ocr;
using Windows.Security.Cryptography;

namespace Moductus.Core.Ocr;

/// <summary>
/// OCR nativo do Windows, via <c>Windows.Media.Ocr</c>. Sem dependência
/// externa, sem modelo para baixar, sem rede: usa os idiomas que o
/// usuário já tem instalados.
/// </summary>
public static class TextRecognizer
{
    /// <summary>Falso quando não há pacote de idioma com OCR instalado.</summary>
    public static bool Available => OcrEngine.TryCreateFromUserProfileLanguages() is not null;

    public static async Task<string> RecognizeAsync(BitmapSource image)
    {
        ArgumentNullException.ThrowIfNull(image);

        var engine = OcrEngine.TryCreateFromUserProfileLanguages()
            ?? throw new InvalidOperationException("Nenhum idioma com OCR instalado no Windows.");

        BitmapSource fonte = image;

        // O motor tem um limite de dimensão; acima dele, reduz mantendo a proporção.
        var maior = Math.Max(image.PixelWidth, image.PixelHeight);
        if (maior > OcrEngine.MaxImageDimension)
        {
            var fator = OcrEngine.MaxImageDimension / (double)maior;
            fonte = new TransformedBitmap(image, new ScaleTransform(fator, fator));
        }

        var bgra = new FormatConvertedBitmap(fonte, PixelFormats.Bgra32, null, 0);
        var largura = bgra.PixelWidth;
        var altura = bgra.PixelHeight;
        var stride = largura * 4;
        var pixels = new byte[stride * altura];
        bgra.CopyPixels(pixels, stride, 0);

        using var bitmap = SoftwareBitmap.CreateCopyFromBuffer(
            CryptographicBuffer.CreateFromByteArray(pixels),
            BitmapPixelFormat.Bgra8, largura, altura, BitmapAlphaMode.Premultiplied);

        var resultado = await engine.RecognizeAsync(bitmap);

        return string.Join('\n', resultado.Lines.Select(l => l.Text));
    }
}
