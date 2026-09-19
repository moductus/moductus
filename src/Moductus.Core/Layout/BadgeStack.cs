using Moductus.Core.Interop;

namespace Moductus.Core.Layout;

/// <summary>Quanto uma pastilha mede, em pixels físicos do monitor.</summary>
public readonly record struct BadgeSize(int Width, int Height);

/// <summary>Onde uma pastilha fica, em pixels físicos do monitor.</summary>
public readonly record struct BadgeSpot(int X, int Y, int Width, int Height);

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
/// A conta é de baixo para cima: o bloco encosta no canto inferior direito da
/// área de trabalho e cresce para cima. A âncora é o piso, então a pastilha
/// mais antiga fica no topo e a que chega entra embaixo, empurrando as
/// anteriores para cima — é de propósito, porque o canto de baixo é onde o olho
/// já procura aviso no Windows e é a pastilha nova que precisa ser vista.
/// </para>
/// </remarks>
public static class BadgeStack
{
    /// <summary>
    /// Empilha no canto inferior direito da área de trabalho do monitor.
    /// </summary>
    /// <param name="area">Monitor de destino, em pixels físicos.</param>
    /// <param name="tamanhos">Tamanho de cada pastilha, do topo para a base.</param>
    /// <param name="folga">Afastamento das bordas da área de trabalho.</param>
    /// <param name="vao">Espaço entre duas pastilhas. Não existe antes da primeira nem depois da última.</param>
    public static IReadOnlyList<BadgeSpot> Empilhar(
        MonitorArea area,
        IReadOnlyList<BadgeSize> tamanhos,
        int folga,
        int vao)
    {
        ArgumentNullException.ThrowIfNull(tamanhos);

        if (tamanhos.Count == 0)
        {
            return [];
        }

        var lugares = new BadgeSpot[tamanhos.Count];
        var direita = area.WorkLeft + area.WorkWidth - folga;
        var piso = area.WorkTop + area.WorkHeight - folga;

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
}
