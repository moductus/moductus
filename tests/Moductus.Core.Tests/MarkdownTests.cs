using Moductus.Core.Text;

namespace Moductus.Core.Tests;

public class MarkdownTests
{
    [Theory]
    [InlineData("# Título", MarkdownBloco.Titulo, 1)]
    [InlineData("### Terceiro", MarkdownBloco.Titulo, 3)]
    [InlineData("###### Sexto", MarkdownBloco.Titulo, 6)]
    [InlineData("####### Sete não é título", MarkdownBloco.Paragrafo, 0)]
    [InlineData("#tag", MarkdownBloco.Paragrafo, 0)]
    [InlineData("> citação", MarkdownBloco.Citacao, 0)]
    [InlineData("- item", MarkdownBloco.Lista, 0)]
    [InlineData("  * item recuado", MarkdownBloco.Lista, 0)]
    [InlineData("1. primeiro", MarkdownBloco.Lista, 0)]
    [InlineData("12) décimo segundo", MarkdownBloco.Lista, 0)]
    [InlineData("-- não é lista", MarkdownBloco.Paragrafo, 0)]
    [InlineData("---", MarkdownBloco.Regua, 0)]
    [InlineData("* * *", MarkdownBloco.Regua, 0)]
    [InlineData("```", MarkdownBloco.Cerca, 0)]
    [InlineData("```csharp", MarkdownBloco.Cerca, 0)]
    [InlineData("texto comum", MarkdownBloco.Paragrafo, 0)]
    [InlineData("", MarkdownBloco.Paragrafo, 0)]
    public void ClassificaALinha(string linha, MarkdownBloco bloco, int nivel)
    {
        var realce = Markdown.Realcar(linha);

        Assert.Equal(bloco, realce.Bloco);
        Assert.Equal(nivel, realce.Nivel);
    }

    [Fact]
    public void DentroDaCercaTudoEhCodigo()
    {
        var realce = Markdown.Realcar("# isto não é título", dentroDeCerca: true);

        Assert.Equal(MarkdownBloco.Codigo, realce.Bloco);
        Assert.All(realce.Trechos, t => Assert.True(t.Estilo.HasFlag(MarkdownEstilo.Mono)));
    }

    [Fact]
    public void CercaFechaMesmoDentroDeCerca()
        => Assert.Equal(MarkdownBloco.Cerca, Markdown.Realcar("```", dentroDeCerca: true).Bloco);

    [Theory]
    [InlineData("**negrito**", MarkdownEstilo.Negrito)]
    [InlineData("__negrito__", MarkdownEstilo.Negrito)]
    [InlineData("*itálico*", MarkdownEstilo.Italico)]
    [InlineData("~~riscado~~", MarkdownEstilo.Riscado)]
    [InlineData("`código`", MarkdownEstilo.Mono)]
    public void ParFechadoMarcaOMiolo(string linha, MarkdownEstilo esperado)
    {
        var miolo = Trecho(linha, esperado);

        Assert.Equal(1, Ocorrencias(linha, miolo));
        Assert.DoesNotContain(miolo, c => c is '*' or '_' or '~' or '`');
    }

    [Theory]
    [InlineData("sem par aberto **assim")]
    [InlineData("snake_case_aqui")]
    [InlineData("~/pasta/arquivo")]
    [InlineData("2 * 3 * 4")]
    public void ParSemFechamentoNaoMarcaNada(string linha)
    {
        var realce = Markdown.Realcar(linha);

        Assert.All(realce.Trechos, t => Assert.Equal(MarkdownEstilo.Nenhum, t.Estilo));
    }

    [Fact]
    public void NegritoCarregaItalicoDentro()
    {
        var realce = Markdown.Realcar("**forte com *ênfase* dentro**");
        var ambos = realce.Trechos.Single(t =>
            t.Estilo.HasFlag(MarkdownEstilo.Negrito)
            && t.Estilo.HasFlag(MarkdownEstilo.Italico)
            && !t.Estilo.HasFlag(MarkdownEstilo.Marcador));

        Assert.Equal("ênfase", Recorte("**forte com *ênfase* dentro**", ambos));
    }

    [Fact]
    public void CraseProtegeOQueEstaDentro()
    {
        const string linha = "veja `a**b**c` aqui";

        Assert.DoesNotContain(Markdown.Realcar(linha).Trechos, t => t.Estilo.HasFlag(MarkdownEstilo.Negrito));
    }

    [Fact]
    public void LinkSeparaRotuloDeAlvo()
    {
        const string linha = "veja [o site](https://exemplo.br) agora";
        var realce = Markdown.Realcar(linha);

        Assert.Equal("o site", Recorte(linha, realce.Trechos.Single(t => t.Estilo == MarkdownEstilo.Link)));
        Assert.Contains(realce.Trechos, t =>
            t.Estilo.HasFlag(MarkdownEstilo.Marcador) && Recorte(linha, t).Contains("https://exemplo.br"));
    }

    [Fact]
    public void ColchetesSemAlvoNaoSaoLink()
        => Assert.DoesNotContain(Markdown.Realcar("lista [rascunho] de itens").Trechos,
            t => t.Estilo.HasFlag(MarkdownEstilo.Link));

    [Fact]
    public void CaixaDeTarefaEntraNoMarcador()
    {
        const string linha = "- [x] comprar pão";
        var realce = Markdown.Realcar(linha);

        Assert.Equal(MarkdownBloco.Lista, realce.Bloco);
        Assert.Equal("comprar pão", Recorte(linha, realce.Trechos.Last()));
        Assert.All(realce.Trechos.SkipLast(1), t => Assert.True(t.Estilo.HasFlag(MarkdownEstilo.Destaque)));
    }

    [Theory]
    [InlineData("# Título")]
    [InlineData("- [ ] tarefa com **peso** e `código`")]
    [InlineData("> citação com [link](a) dentro")]
    [InlineData("texto ~~solto~~ e *misto* no meio")]
    [InlineData("```")]
    [InlineData("")]
    [InlineData("   ")]
    public void TrechosCobremALinhaInteiraSemBuraco(string linha)
    {
        var esperado = 0;

        foreach (var trecho in Markdown.Realcar(linha).Trechos)
        {
            Assert.Equal(esperado, trecho.Inicio);
            Assert.True(trecho.Comprimento > 0);
            esperado += trecho.Comprimento;
        }

        Assert.Equal(linha.Length, esperado);
    }

    [Fact]
    public void TextoDepoisDoLinkVoltaAoNormal()
    {
        const string linha = "Um [link para o repositório](https://github.com/moductus/moductus) no meio.";
        var ultimo = Markdown.Realcar(linha).Trechos[^1];

        Assert.Equal(" no meio.", Recorte(linha, ultimo));
        Assert.Equal(MarkdownEstilo.Nenhum, ultimo.Estilo);
    }

    private static string Trecho(string linha, MarkdownEstilo estilo)
    {
        var achado = Markdown.Realcar(linha).Trechos
            .Single(t => t.Estilo.HasFlag(estilo) && !t.Estilo.HasFlag(MarkdownEstilo.Marcador));

        return Recorte(linha, achado);
    }

    private static string Recorte(string linha, MarkdownTrecho trecho)
        => linha.Substring(trecho.Inicio, trecho.Comprimento);

    private static int Ocorrencias(string linha, string miolo)
        => Markdown.Realcar(linha).Trechos.Count(t => Recorte(linha, t) == miolo);
}
