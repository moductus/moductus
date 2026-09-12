using System.Windows.Media;
using System.Windows.Media.Imaging;
using Moductus.Core.Tray;

namespace Moductus.Core.Tests;

/// <summary>
/// O ícone de 16px é o ativo visual mais visto do produto, e o que quebra em
/// silêncio: meio pixel de deslocamento vira bloco cinza, e ninguém percebe
/// olhando o código. Estes testes olham os pixels que saíram.
/// </summary>
public class MarkTests
{
    /// <summary>Os quatro tamanhos que a bandeja pede conforme o scaling.</summary>
    public static TheoryData<int> TamanhosDaBandeja => [16, 20, 24, 32];

    [Theory]
    [MemberData(nameof(TamanhosDaBandeja))]
    public void Sai_no_tamanho_pedido(int tamanho)
    {
        var bmp = Renderizar(() => Mark.Render(tamanho, onLightTaskbar: false));

        Assert.Equal(tamanho, bmp.PixelWidth);
        Assert.Equal(tamanho, bmp.PixelHeight);
    }

    [Theory]
    [MemberData(nameof(TamanhosDaBandeja))]
    public void Modulos_ficam_alinhados_a_grade_de_pixel(int tamanho)
    {
        var pixels = Ler(Renderizar(() => Mark.Render(tamanho, onLightTaskbar: false)), tamanho);

        // Só os cantos arredondados dos quatro módulos podem ter alfa parcial.
        // Se a aritmética sair do inteiro, a borda reta inteira vira meio-tom
        // e esta fração dispara.
        var parciais = pixels.Count(p => p.A is > 0 and < 255);
        var fracao = (double)parciais / (tamanho * tamanho);

        Assert.True(fracao < 0.12, $"{fracao:P1} dos pixels com alfa parcial em {tamanho}px — a borda saiu fora da grade.");
    }

    [Theory]
    [MemberData(nameof(TamanhosDaBandeja))]
    public void O_vao_entre_os_modulos_atravessa_o_centro(int tamanho)
    {
        var pixels = Ler(Renderizar(() => Mark.Render(tamanho, onLightTaskbar: false)), tamanho);

        // São quatro módulos separados, não um bloco só: o centro exato cai no
        // cruzamento dos vãos e tem de estar vazio.
        var centro = pixels[(tamanho / 2) * tamanho + (tamanho / 2)];

        Assert.Equal(0, centro.A);
    }

    [Fact]
    public void Barra_clara_inverte_a_tinta()
    {
        var escura = Ler(Renderizar(() => Mark.Render(16, onLightTaskbar: false)), 16);
        var clara = Ler(Renderizar(() => Mark.Render(16, onLightTaskbar: true)), 16);

        // Mesmo ponto dentro do primeiro módulo nos dois temas.
        var naEscura = escura[4 * 16 + 4];
        var naClara = clara[4 * 16 + 4];

        Assert.Equal(255, naEscura.A);
        Assert.Equal(255, naClara.A);

        // Barra escura pede tinta clara, e vice-versa. Ícone branco em barra
        // clara desaparece.
        Assert.True(naEscura.R > 200, "barra escura devia receber tinta clara");
        Assert.True(naClara.R < 60, "barra clara devia receber tinta escura");
    }

    [Fact]
    public void O_progresso_do_timer_pinta_em_ambar()
    {
        var semArco = Ler(Renderizar(() => Mark.Render(32, onLightTaskbar: false)), 32);
        var comArco = Ler(Renderizar(() => Mark.Render(32, onLightTaskbar: false, progress: 0.7)), 32);

        Assert.DoesNotContain(semArco, EhAmbar);
        Assert.Contains(comArco, EhAmbar);
    }

    [Fact]
    public void O_mudo_do_mic_risca_em_ambar()
    {
        var aberto = Ler(Renderizar(() => Mark.Render(32, onLightTaskbar: false)), 32);
        var mudo = Ler(Renderizar(() => Mark.Render(32, onLightTaskbar: false, slashed: true)), 32);

        Assert.DoesNotContain(aberto, EhAmbar);
        Assert.Contains(mudo, EhAmbar);
    }

    // ---- Apoio ---------------------------------------------------------------

    private static bool EhAmbar(Cor c) => c.A > 128 && c.R > 180 && c.G is > 100 and < 220 && c.B < 120;

    private readonly record struct Cor(byte B, byte G, byte R, byte A);

    private static Cor[] Ler(BitmapSource bmp, int tamanho)
    {
        var bytes = new byte[tamanho * tamanho * 4];
        bmp.CopyPixels(bytes, tamanho * 4, 0);

        var pixels = new Cor[tamanho * tamanho];
        for (var i = 0; i < pixels.Length; i++)
        {
            var o = i * 4;
            var a = bytes[o + 3];

            // Pbgra32 é pré-multiplicado: desfaz para comparar a cor real.
            pixels[i] = a == 0
                ? new Cor(0, 0, 0, 0)
                : new Cor(
                    (byte)(bytes[o] * 255 / a),
                    (byte)(bytes[o + 1] * 255 / a),
                    (byte)(bytes[o + 2] * 255 / a),
                    a);
        }

        return pixels;
    }

    /// <summary>
    /// WPF só desenha em STA, e o xunit roda em MTA. O thread é o menor preço
    /// para testar o que o usuário realmente vê.
    /// </summary>
    private static BitmapSource Renderizar(Func<BitmapSource> desenhar)
    {
        BitmapSource? resultado = null;
        Exception? falha = null;

        var t = new Thread(() =>
        {
            try
            {
                resultado = desenhar();
            }
            catch (Exception e)
            {
                falha = e;
            }
        });

        t.SetApartmentState(ApartmentState.STA);
        t.Start();
        t.Join();

        if (falha is not null)
        {
            throw falha;
        }

        return resultado!;
    }
}
