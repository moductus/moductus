using Moductus.Core.Text;

namespace Moductus.Core.Tests;

public class ExpressionTests
{
    [Theory]
    [InlineData("2+2", 4)]
    [InlineData("10-3", 7)]
    [InlineData("6*7", 42)]
    [InlineData("9/2", 4.5)]
    [InlineData("10%3", 1)]
    [InlineData("  8  *  2  ", 16)]
    public void Resolve_as_quatro_operacoes_e_o_resto(string entrada, double esperado)
    {
        Assert.True(Expression.TryEvaluate(entrada, out var resultado));
        Assert.Equal(esperado, resultado, 10);
    }

    [Theory]
    [InlineData("2+3*4", 14)]
    [InlineData("2*3+4", 10)]
    [InlineData("10-2*3", 4)]
    [InlineData("1+10%3", 2)]
    [InlineData("20/2/5", 2)]
    [InlineData("10-3-2", 5)]
    public void Multiplicacao_vem_antes_da_soma_e_igual_resolve_da_esquerda(string entrada, double esperado)
    {
        Assert.True(Expression.TryEvaluate(entrada, out var resultado));
        Assert.Equal(esperado, resultado, 10);
    }

    [Theory]
    [InlineData("(2+3)*4", 20)]
    [InlineData("2*(3+4)", 14)]
    [InlineData("((1+2)*(3+4))", 21)]
    [InlineData("(10-(2+3))/5", 1)]
    public void Parenteses_mudam_a_ordem(string entrada, double esperado)
    {
        Assert.True(Expression.TryEvaluate(entrada, out var resultado));
        Assert.Equal(esperado, resultado, 10);
    }

    [Theory]
    [InlineData("1,5+1,5", 3)]
    [InlineData("0,5*4", 2)]
    [InlineData("1.5+1.5", 3)]
    [InlineData("0.1+0.2", 0.3)]
    [InlineData("2,25*2", 4.5)]
    public void Decimal_aceita_ponto_e_virgula(string entrada, double esperado)
    {
        Assert.True(Expression.TryEvaluate(entrada, out var resultado));
        Assert.Equal(esperado, resultado, 10);
    }

    [Theory]
    [InlineData("-3+1", -2)]
    [InlineData("4*-2", -8)]
    [InlineData("-(2+3)", -5)]
    [InlineData("--5", 5)]
    [InlineData("3--2", 5)]
    public void Numero_negativo_e_sinal_unario(string entrada, double esperado)
    {
        Assert.True(Expression.TryEvaluate(entrada, out var resultado));
        Assert.Equal(esperado, resultado, 10);
    }

    [Theory]
    [InlineData("1/0")]
    [InlineData("0/0")]
    [InlineData("5%0")]
    [InlineData("(3+1)/(2-2)")]
    public void Divisao_por_zero_nao_e_resultado(string entrada)
    {
        Assert.False(Expression.TryEvaluate(entrada, out var resultado));
        Assert.Equal(0d, resultado);
    }

    [Theory]
    [InlineData("abacate")]
    [InlineData("2+")]
    [InlineData("*3")]
    [InlineData("2 2")]
    [InlineData("(2+3")]
    [InlineData("2+3)")]
    [InlineData("2++")]
    [InlineData("()")]
    [InlineData("1,2,3")]
    [InlineData("abrir ports")]
    [InlineData("R$ 10")]
    public void Entrada_invalida_devolve_falso_sem_lancar(string entrada)
    {
        Assert.False(Expression.TryEvaluate(entrada, out var resultado));
        Assert.Equal(0d, resultado);
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("\t")]
    public void Expressao_vazia_devolve_falso(string entrada)
        => Assert.False(Expression.TryEvaluate(entrada, out _));

    [Fact]
    public void Numero_solto_ainda_e_expressao_valida()
    {
        Assert.True(Expression.TryEvaluate("42", out var resultado));
        Assert.Equal(42, resultado, 10);
    }

    [Fact]
    public void Entrada_longa_demais_nao_e_avaliada()
        => Assert.False(Expression.TryEvaluate(string.Join('+', Enumerable.Repeat("1", 200)), out _));

    [Fact]
    public void Aninhamento_absurdo_nao_estoura_a_pilha()
        => Assert.False(Expression.TryEvaluate(new string('(', 60) + "1", out _));
}
