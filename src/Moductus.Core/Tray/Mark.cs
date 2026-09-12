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
/// É a redução monocromática do mark de <c>assets/mark-512.png</c>: quatro
/// módulos num arranjo 2×2, o "pequenas medidas reunidas" que dá nome ao
/// projeto. O mark cheio tem um contêiner arredondado e um glifo dentro de
/// cada módulo — nada disso sobrevive a 16px, e por isso a bandeja recebe só
/// os quatro blocos. O contêiner some porque ícone de bandeja é tinta sobre
/// transparência, não placa colorida: placa escura desaparece em barra clara.
/// </para>
/// <para>
/// Tudo é proporcional ao tamanho pedido, nunca escalado depois, e a
/// aritmética fecha em inteiro nos quatro tamanhos que a bandeja usa — 16, 20,
/// 24 e 32. Meio pixel aqui é a diferença entre bloco nítido e bloco cinza.
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
    /// De 0 a 1: desenha um arco em volta dos módulos. É o que o Timer usa.
    /// </param>
    /// <param name="slashed">Risco diagonal — o Mic mudo.</param>
    /// <param name="accent">
    /// Cor do arco e do risco. Omitida, sai o <c>accent</c> da paleta em uso.
    /// </param>
    public static BitmapSource Render(
        int size,
        bool onLightTaskbar,
        double progress = 0,
        bool slashed = false,
        Color? accent = null)
    {
        // Os dois únicos valores de cor escritos no código do produto, e é
        // deliberado: eles seguem o tema da BARRA DE TAREFAS, que o Windows
        // mantém separado do tema dos aplicativos. Trocá-los por text.primary
        // faria o ícone acompanhar o app e sumir em quem usa barra clara com
        // apps escuros — a combinação padrão de muita gente.
        var tinta = onLightTaskbar
            ? Color.FromRgb(0x17, 0x18, 0x1A)
            : Color.FromRgb(0xE8, 0xEA, 0xED);

        var destaque = accent ?? Destaque(tinta);

        var traco = Math.Max(1.0, Math.Round(size / 16.0));

        // Com o arco no ar os módulos recuam, senão os cantos do arranjo
        // encostam no anel. O encolhimento é visível, e é o preço de caber:
        // arco e módulos disputam a mesma moldura de 16px.
        var margem = progress > 0 ? traco * 3 : traco;

        // Cada módulo é quadrado; o vão entre eles é o dobro do traço, que é o
        // menor vão que ainda separa dois blocos a 16px.
        var vao = traco * 2;
        var modulo = size / 2.0 - margem - traco;

        var visual = new DrawingVisual();
        RenderOptions.SetEdgeMode(visual, EdgeMode.Unspecified);

        using (var dc = visual.RenderOpen())
        {
            var pincel = new SolidColorBrush(tinta);
            pincel.Freeze();

            // O canto arredondado é o que liga o ícone de bandeja ao mark
            // cheio. Acima de 1px ele come o bloco inteiro, então é modesto.
            var raio = Math.Min(traco, modulo / 4.0);

            for (var linha = 0; linha < 2; linha++)
            {
                for (var coluna = 0; coluna < 2; coluna++)
                {
                    var quadro = new Rect(
                        margem + coluna * (modulo + vao),
                        margem + linha * (modulo + vao),
                        modulo,
                        modulo);

                    dc.DrawRoundedRectangle(pincel, null, quadro, raio, raio);
                }
            }

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

    /// <summary>
    /// O <c>accent</c> da paleta em uso, que é o que faz o arco do Timer e o
    /// risco do Mic serem a mesma cor que o resto do app — inclusive em alto
    /// contraste, onde o âmbar dá lugar à cor de destaque do sistema.
    /// </summary>
    /// <remarks>
    /// Sem paleta carregada — num teste, ou antes de o Theme subir — arco e
    /// risco saem na mesma tinta dos módulos. Escrever o âmbar aqui como
    /// fallback recriaria exatamente o literal que o token existe para tirar
    /// do código.
    /// </remarks>
    private static Color Destaque(Color tinta) =>
        Application.Current?.TryFindResource("accent.color") as Color? ?? tinta;

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
