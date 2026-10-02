namespace Moductus.Core.Theme;

/// <summary>Um tema do catálogo: o que a pessoa escolhe e onde ele mora.</summary>
/// <param name="Id">
/// Estável, minúsculo e sem acento: é o que vai para a config. Trocar o
/// <paramref name="Nome"/> não pode invalidar a escolha de ninguém.
/// </param>
/// <param name="Nome">O nome de exibição, com acento.</param>
/// <param name="Descricao">Uma linha, para o cartão de escolha.</param>
/// <param name="Arquivo">
/// O prefixo dos dois arquivos do tema, <c>{Arquivo}.Dark.xaml</c> e
/// <c>{Arquivo}.Light.xaml</c>. Separado do id porque nome de arquivo é
/// convenção do código, e id é contrato com a config de quem já usa.
/// </param>
public sealed record ThemeDefinition(string Id, string Nome, string Descricao, string Arquivo);

/// <summary>
/// Os temas que existem. Um tema define só cor, fonte, sombra e
/// transparência; espaço, raio, tamanho e movimento são fixos e não variam
/// com ele.
/// </summary>
/// <remarks>
/// Mora no Core, e não ao lado dos XAML, porque a parte que pode dar errado —
/// um id vindo de config velha ou editada à mão — é lógica pura e merece
/// teste. A UI só pergunta qual arquivo carregar.
/// </remarks>
public static class ThemeCatalog
{
    public static ThemeDefinition Grafite { get; } = new(
        "grafite",
        "Grafite",
        "Monocromático: a própria tinta é o destaque, sem cor nenhuma.",
        "Grafite");

    public static ThemeDefinition MeiaNoite { get; } = new(
        "meia-noite",
        "Meia-noite",
        "Azul-marinho profundo, com destaque em azul.",
        "MeiaNoite");

    public static ThemeDefinition Aluminio { get; } = new(
        "aluminio",
        "Alumínio",
        "Cinzas neutros e o azul de sistema, sóbrio como um Mac.",
        "Aluminio");

    public static ThemeDefinition Lima { get; } = new(
        "lima",
        "Lima",
        "Grafite frio com um destaque verde-lima.",
        "Lima");

    public static ThemeDefinition Ambar { get; } = new(
        "ambar",
        "Âmbar",
        "O tema de origem do Moductus: grafite quente e destaque âmbar.",
        "Ambar");

    /// <summary>Na ordem em que aparecem na escolha. O padrão vem primeiro.</summary>
    public static IReadOnlyList<ThemeDefinition> Todos { get; } = [Grafite, MeiaNoite, Aluminio, Lima, Ambar];

    public static ThemeDefinition Padrao => Grafite;

    /// <summary>
    /// O tema do id, ou o padrão. Id desconhecido não é erro: é config de uma
    /// versão que tinha outro tema, ou editada à mão, e o app precisa subir
    /// igual. Caixa e espaço em volta não contam, porque quem edita o JSON à
    /// mão escreve "Lima" tão naturalmente quanto "lima".
    /// </summary>
    public static ThemeDefinition Resolver(string? id)
    {
        if (string.IsNullOrWhiteSpace(id))
        {
            return Padrao;
        }

        var procurado = id.Trim();
        return Todos.FirstOrDefault(t => string.Equals(t.Id, procurado, StringComparison.OrdinalIgnoreCase)) ?? Padrao;
    }
}
