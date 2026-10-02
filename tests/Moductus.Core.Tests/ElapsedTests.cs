using Moductus.Core.Text;

namespace Moductus.Core.Tests;

/// <summary>
/// O "Atualizado há …" do Ports. Arredondar para cima diria que a lista é
/// mais velha do que é; para baixo, nunca mente contra a pessoa.
/// </summary>
public class ElapsedTests
{
    [Theory]
    [InlineData(0, "agora")]
    [InlineData(4, "agora")]
    [InlineData(5, "há 5 s")]
    [InlineData(59, "há 59 s")]
    [InlineData(60, "há 1 min")]
    [InlineData(119, "há 1 min")]
    [InlineData(3599, "há 59 min")]
    [InlineData(3600, "há 1 h")]
    [InlineData(7300, "há 2 h")]
    public void Arredonda_para_baixo_em_cada_degrau(int segundos, string esperado)
    {
        Assert.Equal(esperado, Elapsed.Since(TimeSpan.FromSeconds(segundos)));
    }

    [Fact]
    public void Relogio_para_tras_e_agora()
    {
        Assert.Equal("agora", Elapsed.Since(TimeSpan.FromSeconds(-30)));
    }
}
