using Moductus.Core.Leader;

namespace Moductus.Core.Tests;

public class LeaderRegistryTests
{
    [Fact]
    public void Registra_e_dispara()
    {
        var registry = new LeaderRegistry();
        var chamou = false;

        var r = registry.Register('A', "awake", "Awake", "Impede hibernar", () => chamou = true);

        Assert.True(r.Active);
        Assert.Equal('a', r.Key);
        Assert.True(registry.TryInvoke('a'));
        Assert.True(chamou);
    }

    [Fact]
    public void Disparo_ignora_caixa()
    {
        var registry = new LeaderRegistry();
        var chamou = false;
        registry.Register('p', "ports", "Ports", "", () => chamou = true);

        Assert.True(registry.TryInvoke('P'));
        Assert.True(chamou);
    }

    // O motivo de este registro existir: Peek, Ports e Palette disputam o p.
    [Fact]
    public void Segunda_letra_igual_fica_em_conflito_e_nomeia_o_dono()
    {
        var registry = new LeaderRegistry();
        registry.Register('p', "peek", "Peek", "", () => { });

        var segundo = registry.Register('p', "ports", "Ports", "", () => { });

        Assert.Equal(LeaderKeyState.Conflict, segundo.State);
        Assert.Contains("Peek", segundo.ConflictDetail);
        Assert.Single(registry.Conflicts);
    }

    [Fact]
    public void Conflito_nao_dispara_o_perdedor()
    {
        var registry = new LeaderRegistry();
        var quem = string.Empty;
        registry.Register('p', "peek", "Peek", "", () => quem = "peek");
        registry.Register('p', "ports", "Ports", "", () => quem = "ports");

        registry.TryInvoke('p');

        Assert.Equal("peek", quem);
    }

    [Fact]
    public void Letra_de_ninguem_devolve_falso()
        => Assert.False(new LeaderRegistry().TryInvoke('z'));

    [Fact]
    public void Remover_libera_a_letra()
    {
        var registry = new LeaderRegistry();
        registry.Register('s', "scratch", "Scratch", "", () => { });

        registry.Unregister("scratch");
        var de_novo = registry.Register('s', "shelf", "Shelf", "", () => { });

        Assert.True(de_novo.Active);
        Assert.Single(registry.All);
    }

    [Fact]
    public void Mesmo_modulo_duas_vezes_e_erro()
    {
        var registry = new LeaderRegistry();
        registry.Register('a', "awake", "Awake", "", () => { });

        Assert.Throws<InvalidOperationException>(() => registry.Register('b', "awake", "Awake", "", () => { }));
    }

    [Theory]
    [InlineData(' ')]
    [InlineData('ç')]
    [InlineData('-')]
    public void Letra_fora_do_ascii_e_recusada(char key)
        => Assert.Throws<ArgumentException>(() => new LeaderRegistry().Register(key, "x", "X", "", () => { }));
}
