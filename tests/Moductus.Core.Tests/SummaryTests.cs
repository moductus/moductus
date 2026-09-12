using Moductus.Core.Text;

namespace Moductus.Core.Tests;

/// <summary>
/// O que aparece na linha de lista e no HUD vem daqui, e o conteúdo é sempre
/// de fora: clipboard, mensagem de exceção, título de janela. Texto que vaza
/// quebra de linha ou recuo estraga o alinhamento de uma lista inteira.
/// </summary>
public class SummaryTests
{
    [Fact]
    public void Junta_as_linhas_num_espaco_so()
    {
        // Sem a troca por espaço, as duas palavras colariam e mentiriam sobre
        // o conteúdo.
        Assert.Equal("linha1 linha2", Summary.OneLine("linha1\r\nlinha2", 80));
        Assert.Equal("linha1 linha2", Summary.OneLine("linha1\nlinha2", 80));
    }

    [Fact]
    public void Colapsa_o_recuo_de_texto_indentado()
    {
        // JSON e log gastariam metade da linha com o recuo.
        Assert.Equal("{ \"a\": 1 }", Summary.OneLine("{\n    \"a\": 1\n}", 80));
    }

    [Fact]
    public void Tira_o_espaco_das_pontas()
    {
        Assert.Equal("texto", Summary.OneLine("   texto\n\n", 80));
    }

    [Fact]
    public void Corta_com_reticencias_no_limite()
    {
        Assert.Equal("abcde…", Summary.OneLine("abcdefghij", 5));
    }

    [Fact]
    public void Nao_corta_o_que_ja_cabe()
    {
        // Exatamente no limite não leva reticências: elas mentiriam sobre haver
        // mais texto.
        Assert.Equal("abcde", Summary.OneLine("abcde", 5));
    }

    [Fact]
    public void Texto_vazio_sai_vazio()
    {
        Assert.Equal(string.Empty, Summary.OneLine("", 80));
        Assert.Equal(string.Empty, Summary.OneLine("   \n  ", 80));
    }

    [Theory]
    [InlineData("a\tb", "a\tb")]
    [InlineData("café ☕", "café ☕")]
    public void Nao_mexe_no_que_nao_e_espaco_nem_quebra(string entrada, string esperado)
    {
        Assert.Equal(esperado, Summary.OneLine(entrada, 80));
    }
}
