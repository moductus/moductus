using Moductus.Core.Theme;

namespace Moductus.Core.Tests;

public class ThemeCatalogTests
{
    [Fact]
    public void Grafite_e_o_padrao()
        => Assert.Equal("grafite", ThemeCatalog.Padrao.Id);

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("solarizado")]
    [InlineData("Palette.Dark")]
    public void Id_ausente_ou_desconhecido_cai_no_padrao(string? id)
        => Assert.Same(ThemeCatalog.Padrao, ThemeCatalog.Resolver(id));

    [Theory]
    [InlineData("lima", "lima")]
    [InlineData("Lima", "lima")]
    [InlineData("MEIA-NOITE", "meia-noite")]
    [InlineData(" ambar ", "ambar")]
    [InlineData("aluminio", "aluminio")]
    public void Caixa_e_espaco_em_volta_nao_contam(string id, string esperado)
        => Assert.Equal(esperado, ThemeCatalog.Resolver(id).Id);

    [Fact]
    public void Todo_tema_se_resolve_para_ele_mesmo()
    {
        foreach (var tema in ThemeCatalog.Todos)
        {
            Assert.Same(tema, ThemeCatalog.Resolver(tema.Id));
        }
    }

    /// <summary>
    /// Id repetido faria a segunda entrada nunca ser escolhida; arquivo
    /// repetido faria dois temas pintarem igual.
    /// </summary>
    [Fact]
    public void Ids_e_arquivos_sao_unicos()
    {
        Assert.Equal(ThemeCatalog.Todos.Count, ThemeCatalog.Todos.Select(t => t.Id.ToLowerInvariant()).Distinct().Count());
        Assert.Equal(ThemeCatalog.Todos.Count, ThemeCatalog.Todos.Select(t => t.Arquivo).Distinct().Count());
    }

    /// <summary>
    /// O id vai para a config: minúsculo e sem acento, para sobreviver a
    /// qualquer editor e qualquer codificação de arquivo.
    /// </summary>
    [Fact]
    public void Id_e_minusculo_e_ascii()
    {
        foreach (var tema in ThemeCatalog.Todos)
        {
            Assert.Matches("^[a-z]+(-[a-z]+)*$", tema.Id);
        }
    }

    [Fact]
    public void O_padrao_esta_no_catalogo()
        => Assert.Contains(ThemeCatalog.Padrao, ThemeCatalog.Todos);
}
