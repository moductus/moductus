using System.Windows;
using System.Windows.Media;
using System.Windows.Media.Imaging;

namespace Moductus.Core.Tray;

/// <summary>
/// Desenha o mark do Moductus no tamanho que a bandeja pedir, mais as
/// sobreposições que os módulos usam.
/// </summary>
/// <remarks>
/// <para>
/// <b>Isto é um placeholder deliberado</b>, e o apêndice 13 do PRODUCT.md
/// registra o mark como decisão em aberto. É um keycap geométrico traçado em
/// código: contorno arredondado com uma legenda sólida dentro, alinhado ao
/// pixel, legível em 16px. Existe para destravar Mic e Timer, que precisam
/// desenhar estado no ícone, e para o produto não sair com o ícone genérico
/// do Windows. O mark de verdade substitui esta classe inteira.
/// </para>
/// <para>
/// Tudo é proporcional ao tamanho pedido, nunca escalado depois.
/// </para>
/// </remarks>
public static class Mark
{
    /// <param name="size">16, 20, 24 ou 32.</param>
    /// <param name="onLightTaskbar">
    /// Barra de tarefas clara pede mark escuro. Ícone branco em barra clara
    /// desaparece, e muita gente usa barra clara.
    /// </param>
    /// <param name="progress">
    /// De 0 a 1: desenha um arco em volta do keycap. É o que o Timer usa.
    /// </param>
    /// <param name="slashed">Risco diagonal — o Mic mudo.</param>
    /// <param name="accent">Cor do arco e do risco. Padrão: o âmbar dos tokens.</param>
    public static BitmapSource Render(
        int size,
        bool onLightTaskbar,
        double progress = 0,
        bool slashed = false,
        Color? accent = null)
    {
        var tinta = onLightTaskbar
            ? Color.FromRgb(0x17, 0x18, 0x1A)
            : Color.FromRgb(0xE8, 0xEA, 0xED);

        var destaque = accent ?? Color.FromRgb(0xFF, 0xB2, 0x24);

        var traco = Math.Max(1.0, Math.Round(size / 16.0));
        var margem = progress > 0 ? traco * 2 : traco;
        var lado = size - margem * 2;

        var visual = new DrawingVisual();
        RenderOptions.SetEdgeMode(visual, EdgeMode.Unspecified);

        using (var dc = visual.RenderOpen())
        {
            var pincel = new SolidColorBrush(tinta);
            pincel.Freeze();

            // Meio pixel de deslocamento alinha o traço à grade.
            var caneta = new Pen(pincel, traco);
            caneta.Freeze();

            var corpo = new Rect(margem + traco / 2, margem + traco / 2, lado - traco, lado - traco);
            var raio = Math.Max(1.5, size / 8.0);
            dc.DrawRoundedRectangle(null, caneta, corpo, raio, raio);

            // Legenda: quadradinho sólido no centro, o que faz ler como tecla.
            var legenda = size / 4.0;
            dc.DrawRectangle(pincel, null, new Rect(
                (size - legenda) / 2,
                (size - legenda) / 2,
                legenda,
                legenda));

            if (slashed)
            {
                var risco = new Pen(new SolidColorBrush(destaque), traco * 1.5);
                risco.Freeze();
                dc.DrawLine(risco, new Point(margem, size - margem), new Point(size - margem, margem));
            }

            if (progress > 0)
            {
                DesenharArco(dc, size, Math.Clamp(progress, 0, 1), destaque, traco);
            }
        }

        var bitmap = new RenderTargetBitmap(size, size, 96, 96, PixelFormats.Pbgra32);
        bitmap.Render(visual);
        bitmap.Freeze();
        return bitmap;
    }

    private static void DesenharArco(DrawingContext dc, int size, double fracao, Color cor, double traco)
    {
        var pincel = new SolidColorBrush(cor);
        pincel.Freeze();
        var caneta = new Pen(pincel, traco) { StartLineCap = PenLineCap.Round, EndLineCap = PenLineCap.Round };
        caneta.Freeze();

        var raio = (size - traco) / 2.0;
        var centro = new Point(size / 2.0, size / 2.0);
        var topo = new Point(centro.X, centro.Y - raio);

        if (fracao >= 0.999)
        {
            dc.DrawEllipse(null, caneta, centro, raio, raio);
            return;
        }

        var angulo = fracao * 2 * Math.PI;
        var fim = new Point(
            centro.X + raio * Math.Sin(angulo),
            centro.Y - raio * Math.Cos(angulo));

        var geometria = new StreamGeometry();
        using (var ctx = geometria.Open())
        {
            ctx.BeginFigure(topo, isFilled: false, isClosed: false);
            ctx.ArcTo(fim, new Size(raio, raio), 0, fracao > 0.5, SweepDirection.Clockwise, true, false);
        }

        geometria.Freeze();
        dc.DrawGeometry(null, caneta, geometria);
    }
}
