using Moductus.Core.Interop;
using Moductus.Core.Layout;

namespace Moductus.Core.Tests;

public class BadgeStackTests
{
    /// <summary>
    /// Monitor 1920x1080 com barra de tarefas de 40px embaixo, sem escala.
    /// </summary>
    private static readonly MonitorArea Tela = new(
        Left: 0, Top: 0, Width: 1920, Height: 1080,
        WorkLeft: 0, WorkTop: 0, WorkWidth: 1920, WorkHeight: 1040,
        Scale: 1.0);

    [Fact]
    public void Sem_pastilha_nao_sobra_lugar_nenhum()
        => Assert.Empty(BadgeStack.Empilhar(Tela, [], folga: 16, vao: 8));

    [Fact]
    public void Uma_pastilha_encosta_no_canto_inferior_direito_com_folga()
    {
        var lugares = BadgeStack.Empilhar(Tela, [new BadgeSize(200, 50)], folga: 16, vao: 8);

        Assert.Equal(new BadgeSpot(1920 - 16 - 200, 1040 - 16 - 50, 200, 50), Assert.Single(lugares));
    }

    [Fact]
    public void A_segunda_pastilha_vai_embaixo_e_a_primeira_sobe()
    {
        var lugares = BadgeStack.Empilhar(
            Tela,
            [new BadgeSize(200, 50), new BadgeSize(300, 80)],
            folga: 16,
            vao: 8);

        // A de baixo encosta na folga; a de cima fica um vão acima dela.
        Assert.Equal(new BadgeSpot(1920 - 16 - 300, 1040 - 16 - 80, 300, 80), lugares[1]);
        Assert.Equal(new BadgeSpot(1920 - 16 - 200, 1040 - 16 - 80 - 8 - 50, 200, 50), lugares[0]);
    }

    [Fact]
    public void O_vao_existe_so_entre_pastilhas()
    {
        var lugares = BadgeStack.Empilhar(
            Tela,
            [new BadgeSize(100, 40), new BadgeSize(100, 40), new BadgeSize(100, 40)],
            folga: 16,
            vao: 8);

        Assert.Equal(1040 - 16 - 40, lugares[2].Y);
        Assert.Equal(lugares[2].Y - 8 - 40, lugares[1].Y);
        Assert.Equal(lugares[1].Y - 8 - 40, lugares[0].Y);
    }

    [Fact]
    public void A_area_de_trabalho_deslocada_leva_a_pilha_junto()
    {
        var segundoMonitor = new MonitorArea(
            Left: 1920, Top: 0, Width: 1280, Height: 1024,
            WorkLeft: 1920, WorkTop: 24, WorkWidth: 1280, WorkHeight: 1000,
            Scale: 1.0);

        var lugar = Assert.Single(BadgeStack.Empilhar(segundoMonitor, [new BadgeSize(200, 50)], folga: 16, vao: 8));

        Assert.Equal(1920 + 1280 - 16 - 200, lugar.X);
        Assert.Equal(24 + 1000 - 16 - 50, lugar.Y);
    }

    [Fact]
    public void Pilha_mais_alta_que_a_tela_fica_presa_na_area_de_trabalho()
    {
        var baixinho = new MonitorArea(
            Left: 0, Top: 0, Width: 800, Height: 200,
            WorkLeft: 0, WorkTop: 0, WorkWidth: 800, WorkHeight: 200,
            Scale: 1.0);

        var lugares = BadgeStack.Empilhar(
            baixinho,
            [new BadgeSize(100, 90), new BadgeSize(100, 90), new BadgeSize(100, 90)],
            folga: 16,
            vao: 8);

        // Nenhuma sai da área de trabalho...
        Assert.All(lugares, l => Assert.True(l.Y >= baixinho.WorkTop));
        Assert.All(lugares, l => Assert.True(l.X >= baixinho.WorkLeft));

        // ...e quem se sobrepõe é o topo, não o piso: a de baixo continua
        // encostada na folga e a pilha não desmonta a ordem por causa do corte.
        Assert.Equal(200 - 16 - 90, lugares[2].Y);
        Assert.True(lugares[1].Y < lugares[2].Y);
        Assert.Equal(baixinho.WorkTop, lugares[0].Y);
    }

    [Fact]
    public void A_ordem_da_lista_e_de_cima_para_baixo()
    {
        var lugares = BadgeStack.Empilhar(
            Tela,
            [new BadgeSize(100, 40), new BadgeSize(100, 40), new BadgeSize(100, 40)],
            folga: 16,
            vao: 8);

        // Inverter o sentido do laço quebra aqui: a última da lista é a que
        // encosta no piso, e o índice cresce para baixo.
        Assert.True(lugares[0].Y < lugares[1].Y);
        Assert.True(lugares[1].Y < lugares[2].Y);
        Assert.Equal(Tela.WorkTop + Tela.WorkHeight - 16, lugares[2].Y + lugares[2].Height);
    }

    [Fact]
    public void Pastilha_mais_larga_que_a_tela_nao_sai_pela_esquerda()
    {
        var lugar = Assert.Single(BadgeStack.Empilhar(Tela, [new BadgeSize(4000, 50)], folga: 16, vao: 8));

        Assert.Equal(Tela.WorkLeft, lugar.X);
    }
}
