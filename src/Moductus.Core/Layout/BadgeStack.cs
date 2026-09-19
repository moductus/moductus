using Moductus.Core.Interop;

namespace Moductus.Core.Layout;

/// <summary>Quanto uma pastilha mede, em pixels físicos do monitor.</summary>
public readonly record struct BadgeSize(int Width, int Height);

/// <summary>Onde uma pastilha fica, em pixels físicos do monitor.</summary>
public readonly record struct BadgeSpot(int X, int Y, int Width, int Height);

/// <summary>
/// De onde a pilha pende: o canto inferior direito do bloco, em pixels
/// físicos da área de trabalho virtual.
/// </summary>
/// <remarks>
/// É este ponto que o arrasto move. Uma âncora para a pilha inteira, e não uma
/// posição por pastilha, é o que mantém as várias juntas enquanto a pessoa
/// arrasta qualquer uma delas.
/// </remarks>
public readonly record struct BadgeAnchor(int Right, int Bottom);

/// <summary>
/// Onde cada pastilha fica quando são várias.
/// </summary>
/// <remarks>
/// <para>
/// Cada pastilha é uma janela própria, do tamanho exato do cartão — é o que
/// devolve o desktop ao vão entre duas delas, que nenhuma API de composição
/// resolveria numa janela só cobrindo a união. O empilhamento, por isso,
/// deixou de ser um <c>StackPanel</c> e virou conta de coordenada.
/// </para>
/// <para>
/// A conta é de baixo para cima: o bloco pende de uma âncora e cresce para
/// cima. A âncora é o piso, então a pastilha mais antiga fica no topo e a que
/// chega entra embaixo, empurrando as anteriores para cima — é de propósito,
/// porque o canto de baixo é onde o olho já procura aviso no Windows e é a
/// pastilha nova que precisa ser vista.
/// </para>
/// <para>
/// A âncora nasce no canto inferior direito da área de trabalho e é o que o
/// arrasto move. Mover a âncora, e não cada pastilha, é o que faz as várias
/// andarem juntas: arrastar qualquer uma leva o bloco inteiro, com o vão
/// intacto entre elas.
/// </para>
/// </remarks>
public static class BadgeStack
{
    /// <summary>
    /// Empilha a partir da âncora da pilha.
    /// </summary>
    /// <param name="area">Monitor de destino, em pixels físicos.</param>
    /// <param name="tamanhos">Tamanho de cada pastilha, do topo para a base.</param>
    /// <param name="folga">Afastamento das bordas da área de trabalho.</param>
    /// <param name="vao">Espaço entre duas pastilhas. Não existe antes da primeira nem depois da última.</param>
    /// <param name="ancora">
    /// Onde a pilha foi largada. Nulo devolve o canto inferior direito da área
    /// de trabalho — é o caso de quem nunca arrastou, e o de quem arrastou para
    /// um monitor que deixou de existir.
    /// </param>
    public static IReadOnlyList<BadgeSpot> Empilhar(
        MonitorArea area,
        IReadOnlyList<BadgeSize> tamanhos,
        int folga,
        int vao,
        BadgeAnchor? ancora = null)
    {
        ArgumentNullException.ThrowIfNull(tamanhos);

        if (tamanhos.Count == 0)
        {
            return [];
        }

        var lugares = new BadgeSpot[tamanhos.Count];
        var (direita, piso) = Ancorar(area, ancora, Bloco(tamanhos, vao), folga);

        for (var i = tamanhos.Count - 1; i >= 0; i--)
        {
            var tamanho = tamanhos[i];
            var topo = piso - tamanho.Height;

            // Pilha mais alta que a área de trabalho é caso degenerado, e
            // pastilha fora da tela é pastilha que ninguém desfaz: prende nas
            // bordas mesmo que isso faça duas se sobreporem.
            lugares[i] = new BadgeSpot(
                Math.Max(area.WorkLeft, direita - tamanho.Width),
                Math.Max(area.WorkTop, topo),
                tamanho.Width,
                tamanho.Height);

            piso = topo - vao;
        }

        return lugares;
    }

    /// <summary>
    /// Onde a pilha ancora de verdade: no canto inferior direito da área de
    /// trabalho quando ninguém arrastou, e presa na área de trabalho quando
    /// alguém arrastou.
    /// </summary>
    /// <param name="area">Monitor de destino, em pixels físicos.</param>
    /// <param name="ancora">
    /// Onde a pilha foi largada. Nulo cobre dois casos que dão no mesmo
    /// resultado: nunca foi arrastada, e foi arrastada para um monitor que não
    /// existe mais — quem descobre o segundo é o Win32, e o que chega aqui é a
    /// ausência.
    /// </param>
    /// <param name="bloco">O retângulo que a pilha inteira ocupa.</param>
    /// <param name="folga">Afastamento das bordas, só no canto padrão.</param>
    /// <remarks>
    /// A folga vale para o canto padrão e não para a âncora arrastada: quem
    /// levou a pilha para a borda quis a borda, e afastá-la de volta seria
    /// desfazer o gesto. O que a âncora arrastada não pode é sair da área de
    /// trabalho — pastilha fora da tela é pastilha que ninguém desfaz.
    /// </remarks>
    public static BadgeAnchor Ancorar(MonitorArea area, BadgeAnchor? ancora, BadgeSize bloco, int folga)
    {
        if (ancora is not { } largada)
        {
            return new BadgeAnchor(
                area.WorkLeft + area.WorkWidth - folga,
                area.WorkTop + area.WorkHeight - folga);
        }

        // Bloco maior que a área de trabalho é caso degenerado: o Math.Max fica
        // por fora e a borda que ganha é a de cima e a da esquerda, o mesmo
        // critério do empilhamento apertado.
        return new BadgeAnchor(
            Math.Max(Math.Min(largada.Right, area.WorkLeft + area.WorkWidth), area.WorkLeft + bloco.Width),
            Math.Max(Math.Min(largada.Bottom, area.WorkTop + area.WorkHeight), area.WorkTop + bloco.Height));
    }

    /// <summary>
    /// O retângulo que a pilha inteira ocupa: a maior largura e a soma das
    /// alturas com os vãos. É o que a âncora precisa saber para não empurrar
    /// a pilha para fora da área de trabalho.
    /// </summary>
    public static BadgeSize Bloco(IReadOnlyList<BadgeSize> tamanhos, int vao)
    {
        ArgumentNullException.ThrowIfNull(tamanhos);

        if (tamanhos.Count == 0)
        {
            return default;
        }

        var largura = 0;
        var altura = vao * (tamanhos.Count - 1);

        foreach (var tamanho in tamanhos)
        {
            largura = Math.Max(largura, tamanho.Width);
            altura += tamanho.Height;
        }

        return new BadgeSize(largura, altura);
    }
}
