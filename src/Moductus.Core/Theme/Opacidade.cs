namespace Moductus.Core.Theme;

/// <summary>
/// A opacidade que a pessoa escolhe, em porcentagem, e como ela vira alfa.
/// </summary>
/// <remarks>
/// <para>
/// Mora no Core porque dois lados muito diferentes precisam da mesma faixa: a
/// superfície do WPF, onde o alfa vai no pincel de fundo, e a miniatura do
/// Peek, onde o alfa vai num campo de struct do DWM. Deixar a conversão em
/// cada um deles era repetir o mesmo clamp com números soltos nos dois.
/// </para>
/// <para>
/// O mínimo não é zero de propósito: superfície invisível não é ajuste de
/// opacidade, é desligar o módulo, e isso já se faz em outro lugar.
/// </para>
/// </remarks>
public static class Opacidade
{
    /// <summary>Abaixo disto a superfície some e o texto dela deixa de se ler.</summary>
    public const int Minimo = 20;

    /// <summary>Nada além do que a paleta ou a origem já dão.</summary>
    public const int Maximo = 100;

    public const int Padrao = Maximo;

    /// <summary>Prende o valor na faixa. Número fora dela vira a ponta mais próxima.</summary>
    public static int Faixa(int valor) => Math.Clamp(valor, Minimo, Maximo);

    /// <summary>
    /// Alfa de 0 a 255 para quem parte do opaco, como a miniatura do DWM:
    /// <see cref="Maximo"/> é a origem intacta.
    /// </summary>
    public static byte Alfa(int porcento) => Alfa(byte.MaxValue, porcento);

    /// <summary>
    /// Escala o alfa que o tema já escolheu, em vez de substituí-lo.
    /// </summary>
    /// <remarks>
    /// A paleta não pinta todas as superfícies com a mesma translucidez — o
    /// fundo elevado é mais fechado que o de base, e a diferença é decisão de
    /// desenho, não descuido. Um valor absoluto achataria as duas na mesma
    /// tinta; escalar mantém a proporção entre elas e faz
    /// <see cref="Maximo"/> devolver exatamente o que a paleta define.
    /// </remarks>
    /// <param name="referencia">O alfa do pincel da paleta.</param>
    public static byte Alfa(byte referencia, int porcento) =>
        (byte)Math.Round(referencia * Faixa(porcento) / (double)Maximo, MidpointRounding.AwayFromZero);
}
