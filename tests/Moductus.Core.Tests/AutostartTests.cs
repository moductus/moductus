using Moductus.Core.Startup;

namespace Moductus.Core.Tests;

internal sealed class FakeAutostartRegistry : IAutostartRegistry
{
    public string? Command { get; set; }

    public byte[]? Approved { get; set; }

    public string? ReadRunCommand() => Command;

    public void WriteRunCommand(string command) => Command = command;

    public void DeleteRunCommand() => Command = null;

    public byte[]? ReadStartupApproved() => Approved;

    public void DeleteStartupApproved() => Approved = null;
}

public class AutostartTests
{
    private const string Exe = @"C:\Apps\Moductus\Moductus.exe";
    private const string ComandoEsperado = "\"C:\\Apps\\Moductus\\Moductus.exe\"";

    private static readonly byte[] VetoDoUsuario = [0x03, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    private static readonly byte[] AprovadoExplicito = [0x02, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];

    [Fact]
    public void Sem_entrada_esta_desligado()
    {
        var autostart = new Autostart(new FakeAutostartRegistry(), Exe);

        Assert.Equal(AutostartState.Off, autostart.State);
    }

    [Fact]
    public void Ligar_grava_o_caminho_entre_aspas()
    {
        var registry = new FakeAutostartRegistry();

        new Autostart(registry, Exe).Enable();

        Assert.Equal(ComandoEsperado, registry.Command);
    }

    [Fact]
    public void Entrada_presente_sem_veto_esta_ligado()
    {
        var registry = new FakeAutostartRegistry { Command = ComandoEsperado };

        Assert.Equal(AutostartState.On, new Autostart(registry, Exe).State);
    }

    // O teste que justifica ler dois valores de registro em vez de um.
    [Fact]
    public void Entrada_presente_com_veto_do_gerenciador_de_tarefas_aparece_como_desligada_pelo_usuario()
    {
        var registry = new FakeAutostartRegistry { Command = ComandoEsperado, Approved = VetoDoUsuario };

        Assert.Equal(AutostartState.DisabledByUser, new Autostart(registry, Exe).State);
    }

    [Theory]
    [InlineData(new byte[] { 0x02, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0 })]
    [InlineData(new byte[] { 0x06, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0 })]
    [InlineData(new byte[0])]
    public void Variantes_de_aprovacao_contam_como_ligado(byte[] approved)
    {
        var registry = new FakeAutostartRegistry { Command = ComandoEsperado, Approved = approved };

        Assert.Equal(AutostartState.On, new Autostart(registry, Exe).State);
    }

    [Fact]
    public void Ligar_limpa_o_veto_do_usuario()
    {
        var registry = new FakeAutostartRegistry { Command = ComandoEsperado, Approved = VetoDoUsuario };
        var autostart = new Autostart(registry, Exe);

        autostart.Enable();

        Assert.Null(registry.Approved);
        Assert.Equal(AutostartState.On, autostart.State);
    }

    [Fact]
    public void Desligar_remove_entrada_e_veto()
    {
        var registry = new FakeAutostartRegistry { Command = ComandoEsperado, Approved = AprovadoExplicito };
        var autostart = new Autostart(registry, Exe);

        autostart.Disable();

        Assert.Null(registry.Command);
        Assert.Null(registry.Approved);
        Assert.Equal(AutostartState.Off, autostart.State);
    }

    [Fact]
    public void Entrada_apontando_para_outro_executavel_e_denunciada()
    {
        var registry = new FakeAutostartRegistry { Command = "\"D:\\outra\\copia\\Moductus.exe\"" };

        Assert.Equal(AutostartState.PointsElsewhere, new Autostart(registry, Exe).State);
    }

    [Fact]
    public void Comparacao_de_caminho_ignora_caixa_e_espacos()
    {
        var registry = new FakeAutostartRegistry { Command = "  \"c:\\apps\\moductus\\MODUCTUS.EXE\"  " };

        Assert.Equal(AutostartState.On, new Autostart(registry, Exe).State);
    }

    [Fact]
    public void Ligar_sobre_entrada_de_outro_caminho_corrige_o_caminho()
    {
        var registry = new FakeAutostartRegistry { Command = "\"D:\\velho\\Moductus.exe\"" };
        var autostart = new Autostart(registry, Exe);

        autostart.Enable();

        Assert.Equal(ComandoEsperado, registry.Command);
        Assert.Equal(AutostartState.On, autostart.State);
    }

    [Theory]
    [InlineData("")]
    [InlineData("  ")]
    public void Caminho_vazio_e_recusado(string vazio)
        => Assert.Throws<ArgumentException>(() => new Autostart(new FakeAutostartRegistry(), vazio));
}
