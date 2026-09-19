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

    [Fact]
    public void O_bloco_mede_a_maior_largura_e_a_soma_das_alturas_com_os_vaos()
    {
        var bloco = BadgeStack.Bloco([new BadgeSize(200, 50), new BadgeSize(300, 80)], vao: 8);

        Assert.Equal(new BadgeSize(300, 50 + 8 + 80), bloco);
    }

    [Fact]
    public void O_bloco_de_uma_pastilha_so_nao_tem_vao()
        => Assert.Equal(new BadgeSize(200, 50), BadgeStack.Bloco([new BadgeSize(200, 50)], vao: 8));

    [Fact]
    public void Sem_ancora_a_pilha_fica_no_canto_inferior_direito_com_folga()
    {
        var ancora = BadgeStack.Ancorar(Tela, ancora: null, new BadgeSize(200, 50), folga: 16);

        Assert.Equal(new BadgeAnchor(1920 - 16, 1040 - 16), ancora);
    }

    /// <summary>
    /// O monitor onde a pilha foi largada deixou de existir. Quem descobre isso
    /// é o Win32 — <c>MonitorFromPoint</c> sem monitor nenhum sob o ponto — e o
    /// que chega até a conta é a âncora ausente: o canto padrão do monitor que
    /// sobrou, e não um ponto num desktop que não existe mais.
    /// </summary>
    [Fact]
    public void Ancora_de_monitor_que_sumiu_volta_ao_canto_padrao()
    {
        var ancora = BadgeStack.Ancorar(Tela, ancora: null, new BadgeSize(200, 50), folga: 16);

        Assert.Equal(
            new BadgeAnchor(Tela.WorkLeft + Tela.WorkWidth - 16, Tela.WorkTop + Tela.WorkHeight - 16),
            ancora);
    }

    /// <summary>
    /// O monitor não sumiu, encolheu — trocar a resolução deixa a âncora num
    /// ponto que ainda existe, mas fora da área de trabalho. Prender é melhor
    /// que ignorar: a pilha fica na borda mais perto de onde ela estava.
    /// </summary>
    [Fact]
    public void Ancora_fora_da_area_por_mudanca_de_resolucao_e_puxada_para_a_borda()
    {
        var ancora = BadgeStack.Ancorar(Tela, new BadgeAnchor(3000, 900), new BadgeSize(200, 50), folga: 16);

        Assert.Equal(new BadgeAnchor(1920, 900), ancora);
    }

    [Fact]
    public void Ancora_dentro_da_area_fica_onde_foi_largada()
    {
        var largada = new BadgeAnchor(700, 400);

        Assert.Equal(largada, BadgeStack.Ancorar(Tela, largada, new BadgeSize(200, 50), folga: 16));
    }

    [Fact]
    public void Ancora_arrastada_pode_encostar_na_borda_sem_a_folga()
    {
        // A folga é do canto padrão. Quem levou a pilha até a borda quis a
        // borda, e devolver a folga desfaria o gesto.
        var largada = new BadgeAnchor(1920, 1040);

        Assert.Equal(largada, BadgeStack.Ancorar(Tela, largada, new BadgeSize(200, 50), folga: 16));
    }

    [Fact]
    public void Ancora_fora_a_direita_e_presa_na_borda_direita()
    {
        var ancora = BadgeStack.Ancorar(Tela, new BadgeAnchor(5000, 400), new BadgeSize(200, 50), folga: 16);

        Assert.Equal(1920, ancora.Right);
        Assert.Equal(400, ancora.Bottom);
    }

    [Fact]
    public void Ancora_fora_abaixo_e_presa_no_piso_da_area_de_trabalho()
    {
        var ancora = BadgeStack.Ancorar(Tela, new BadgeAnchor(700, 5000), new BadgeSize(200, 50), folga: 16);

        Assert.Equal(700, ancora.Right);

        // O piso é o da área de trabalho, não o do monitor: barra de tarefas
        // não é lugar de pastilha.
        Assert.Equal(1040, ancora.Bottom);
    }

    [Fact]
    public void Ancora_fora_a_esquerda_e_presa_com_a_pilha_inteira_dentro()
    {
        var ancora = BadgeStack.Ancorar(Tela, new BadgeAnchor(-500, 400), new BadgeSize(200, 50), folga: 16);

        // A âncora é o canto direito do bloco: prendê-la na borda esquerda é
        // empurrá-la até a largura do bloco.
        Assert.Equal(Tela.WorkLeft + 200, ancora.Right);
    }

    [Fact]
    public void Ancora_fora_acima_e_presa_com_a_pilha_inteira_dentro()
    {
        var ancora = BadgeStack.Ancorar(Tela, new BadgeAnchor(700, -500), new BadgeSize(200, 50), folga: 16);

        Assert.Equal(Tela.WorkTop + 50, ancora.Bottom);
    }

    [Fact]
    public void Pilha_mais_alta_que_a_area_encosta_no_topo_mesmo_arrastada()
    {
        var baixinho = new MonitorArea(
            Left: 0, Top: 0, Width: 800, Height: 200,
            WorkLeft: 0, WorkTop: 0, WorkWidth: 800, WorkHeight: 200,
            Scale: 1.0);

        IReadOnlyList<BadgeSize> tres = [new BadgeSize(100, 90), new BadgeSize(100, 90), new BadgeSize(100, 90)];
        var bloco = BadgeStack.Bloco(tres, vao: 8);

        var ancora = BadgeStack.Ancorar(baixinho, new BadgeAnchor(400, 150), bloco, folga: 16);

        // Bloco de 286 numa área de 200: não cabe de jeito nenhum, e aí o
        // Math.Max fica por fora — a âncora desce até o bloco começar no topo,
        // e o empilhamento prende o resto na borda de cima.
        Assert.Equal(baixinho.WorkTop + bloco.Height, ancora.Bottom);

        var lugares = BadgeStack.Empilhar(baixinho, tres, folga: 16, vao: 8, ancora);
        Assert.All(lugares, l => Assert.True(l.Y >= baixinho.WorkTop));
    }

    [Fact]
    public void Arrastar_leva_a_pilha_inteira_com_o_vao_intacto()
    {
        IReadOnlyList<BadgeSize> tamanhos = [new BadgeSize(200, 50), new BadgeSize(300, 80)];

        var parada = BadgeStack.Empilhar(Tela, tamanhos, folga: 16, vao: 8);
        var arrastada = BadgeStack.Empilhar(Tela, tamanhos, folga: 16, vao: 8, new BadgeAnchor(900, 600));

        // As duas andaram o mesmo tanto...
        var dx = arrastada[0].X - parada[0].X;
        var dy = arrastada[0].Y - parada[0].Y;
        Assert.Equal(dx, arrastada[1].X - parada[1].X);
        Assert.Equal(dy, arrastada[1].Y - parada[1].Y);

        // ...e o espaço entre elas continua sendo só o vão.
        Assert.Equal(8, arrastada[1].Y - (arrastada[0].Y + arrastada[0].Height));

        // A de baixo encosta na âncora, que é o canto inferior direito do bloco.
        Assert.Equal(900, arrastada[1].X + arrastada[1].Width);
        Assert.Equal(600, arrastada[1].Y + arrastada[1].Height);
    }

    [Fact]
    public void Ancora_fora_da_area_nao_deixa_pastilha_nenhuma_sair_da_tela()
    {
        var lugares = BadgeStack.Empilhar(
            Tela,
            [new BadgeSize(200, 50), new BadgeSize(300, 80)],
            folga: 16,
            vao: 8,
            new BadgeAnchor(9000, 9000));

        Assert.All(lugares, l => Assert.True(l.X >= Tela.WorkLeft));
        Assert.All(lugares, l => Assert.True(l.Y >= Tela.WorkTop));
        Assert.All(lugares, l => Assert.True(l.X + l.Width <= Tela.WorkLeft + Tela.WorkWidth));
        Assert.All(lugares, l => Assert.True(l.Y + l.Height <= Tela.WorkTop + Tela.WorkHeight));
    }
}
