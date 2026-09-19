using Moductus.Core.Theme;

namespace Moductus.Core.Tests;

public class OpacidadeTests
{
    [Theory]
    [InlineData(0, Opacidade.Minimo)]
    [InlineData(19, Opacidade.Minimo)]
    [InlineData(-40, Opacidade.Minimo)]
    [InlineData(Opacidade.Minimo, Opacidade.Minimo)]
    [InlineData(57, 57)]
    [InlineData(Opacidade.Maximo, Opacidade.Maximo)]
    [InlineData(101, Opacidade.Maximo)]
    [InlineData(int.MaxValue, Opacidade.Maximo)]
    public void Valor_fora_da_faixa_vira_a_ponta_mais_proxima(int valor, int esperado)
        => Assert.Equal(esperado, Opacidade.Faixa(valor));

    [Theory]
    [InlineData(Opacidade.Maximo, 255)]
    [InlineData(Opacidade.Minimo, 51)]
    [InlineData(0, 51)]
    [InlineData(200, 255)]
    public void Miniatura_opaca_no_maximo_e_nunca_abaixo_do_minimo(int porcento, byte esperado)
        => Assert.Equal(esperado, Opacidade.Alfa(porcento));

    /// <summary>
    /// 216 é o alfa do fundo elevado da paleta escura; 200, o do fundo de
    /// base. No máximo os dois têm de voltar intactos, senão a opção mudaria
    /// o visual de quem nunca a tocou.
    /// </summary>
    [Theory]
    [InlineData(216, Opacidade.Maximo, 216)]
    [InlineData(200, Opacidade.Maximo, 200)]
    [InlineData(255, Opacidade.Maximo, 255)]
    public void No_maximo_o_pincel_da_paleta_volta_intacto(byte referencia, int porcento, byte esperado)
        => Assert.Equal(esperado, Opacidade.Alfa(referencia, porcento));

    [Theory]
    [InlineData(216, Opacidade.Minimo, 43)]
    [InlineData(200, Opacidade.Minimo, 40)]
    [InlineData(216, 0, 43)]
    [InlineData(216, 1000, 216)]
    public void O_alfa_da_paleta_e_escalado_e_o_porcento_continua_preso_a_faixa(byte referencia, int porcento, byte esperado)
        => Assert.Equal(esperado, Opacidade.Alfa(referencia, porcento));

    /// <summary>
    /// 255 × 50% dá 127,5. Truncar entregaria 127 e a metade exata ficaria
    /// mais transparente do que a outra metade.
    /// </summary>
    [Fact]
    public void A_meia_unidade_arredonda_para_cima()
        => Assert.Equal(128, Opacidade.Alfa(255, 50));

    [Fact]
    public void Pincel_totalmente_transparente_continua_transparente()
        => Assert.Equal(0, Opacidade.Alfa(0, Opacidade.Maximo));

    /// <summary>
    /// Na ponta de baixo ainda tem de sobrar tinta: superfície sem fundo
    /// nenhum deixa o texto sobre o desktop e nada mais se lê.
    /// </summary>
    [Theory]
    [InlineData(200)]
    [InlineData(216)]
    [InlineData(255)]
    public void O_minimo_nunca_zera_a_tinta_de_uma_superficie_da_paleta(byte referencia)
        => Assert.True(Opacidade.Alfa(referencia, Opacidade.Minimo) > 0);
}
