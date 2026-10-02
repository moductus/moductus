using Moductus.Core.Clipboard;

namespace Moductus.Core.Tests;

public class ClipPeriodTests
{
    // Fuso de Brasília fixo: o teste não pode depender do relógio da máquina.
    private static readonly TimeSpan Fuso = TimeSpan.FromHours(-3);
    private static readonly DateTimeOffset Agora = new(2026, 10, 1, 0, 5, 0, Fuso);

    [Fact]
    public void Copiado_minutos_antes_hoje_e_hoje()
        => Assert.Equal(ClipPeriod.Hoje, ClipPeriods.Of(Agora.AddMinutes(-3), Agora));

    [Fact]
    public void Virada_da_meia_noite_conta_pelo_calendario()
        => Assert.Equal(ClipPeriod.Ontem, ClipPeriods.Of(Agora.AddMinutes(-10), Agora));

    [Fact]
    public void Dois_dias_atras_e_antes()
        => Assert.Equal(ClipPeriod.Antes, ClipPeriods.Of(Agora.AddDays(-2), Agora));

    [Fact]
    public void Horario_gravado_em_UTC_e_lido_no_fuso_de_agora()
    {
        // 02:30 UTC do dia 1 é 23:30 do dia 30 no fuso de Agora.
        var quando = new DateTimeOffset(2026, 10, 1, 2, 30, 0, TimeSpan.Zero);

        Assert.Equal(ClipPeriod.Ontem, ClipPeriods.Of(quando, Agora));
    }

    [Fact]
    public void Relogio_que_voltou_nao_joga_o_item_para_o_passado()
        => Assert.Equal(ClipPeriod.Hoje, ClipPeriods.Of(Agora.AddHours(2), Agora));
}
