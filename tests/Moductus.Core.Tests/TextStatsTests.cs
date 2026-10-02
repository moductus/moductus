using Moductus.Core.Text;

namespace Moductus.Core.Tests;

/// <summary>
/// O rodapé do Scratch conta o que a pessoa escreveu. Contar marcação de
/// markdown como palavra, ou quebra de linha como caractere, faz o número
/// mudar sem a pessoa ter escrito nada.
/// </summary>
public class TextStatsTests
{
    [Fact]
    public void Texto_vazio_conta_zero()
    {
        Assert.Equal(0, TextStats.Characters(""));
        Assert.Equal(0, TextStats.Words(""));
        Assert.Equal(0, TextStats.Words("   \r\n  "));
    }

    [Fact]
    public void Quebra_de_linha_nao_e_caractere()
    {
        Assert.Equal(6, TextStats.Characters("abc\r\ndef"));
        Assert.Equal(6, TextStats.Characters("abc\ndef"));
    }

    [Fact]
    public void Emoji_e_acento_combinado_contam_um()
    {
        // O par substituto do emoji e o acento combinado são dois char cada;
        // na tela, uma letra só.
        Assert.Equal(1, TextStats.Characters("☕"));
        Assert.Equal(1, TextStats.Characters("😀"));
        Assert.Equal(1, TextStats.Characters("é"));
    }

    [Theory]
    [InlineData("uma palavra", 2)]
    [InlineData("  espaço   nas pontas  ", 3)]
    [InlineData("linha1\r\nlinha2", 2)]
    [InlineData("café v2 node_modules", 3)]
    public void Conta_palavras_separadas_por_espaco(string texto, int esperado)
    {
        Assert.Equal(esperado, TextStats.Words(texto));
    }

    [Theory]
    [InlineData("# Título", 1)]
    [InlineData("- [ ] tarefa", 1)]
    [InlineData("---", 0)]
    [InlineData("**negrito** e `código`", 3)]
    public void Marcacao_de_markdown_sozinha_nao_e_palavra(string texto, int esperado)
    {
        Assert.Equal(esperado, TextStats.Words(texto));
    }

    [Fact]
    public void Rotulo_usa_o_singular_no_um()
    {
        Assert.Equal("1 caractere · 1 palavra", TextStats.Label("a"));
        Assert.Equal("0 caracteres · 0 palavras", TextStats.Label(""));
        Assert.Equal("5 caracteres · 2 palavras", TextStats.Label("ab cd"));
    }

    [Fact]
    public void Rotulo_separa_milhar_com_ponto()
    {
        Assert.Equal("1.200 caracteres · 1 palavra", TextStats.Label(new string('a', 1200)));
    }
}
