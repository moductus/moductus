using Moductus.Core.Hotkeys;

namespace Moductus.Core.Tests;

public class HotkeyRegistryTests
{
    private const uint VkSpace = 0x20;
    private const uint VkP = 0x50;

    private static readonly HotkeyBinding Lider =
        new(HotkeyModifiers.Control | HotkeyModifiers.Alt, VkSpace);

    [Fact]
    public void Registro_bem_sucedido_fica_ativo_e_chega_ao_sistema()
    {
        var sink = new FakeHotkeySink();
        var registry = new HotkeyRegistry(sink);

        var r = registry.Register("leader", Lider, () => { });

        Assert.Equal(HotkeyState.Registered, r.State);
        Assert.True(r.Active);
        Assert.Null(r.ConflictDetail);
        Assert.Equal([r.Id], sink.Registrados);
    }

    [Fact]
    public void Segundo_pedido_da_mesma_combinacao_marca_conflito_interno_e_nomeia_o_dono()
    {
        var registry = new HotkeyRegistry(new FakeHotkeySink());
        registry.Register("leader", Lider, () => { });

        var segundo = registry.Register("ports", Lider, () => { });

        Assert.Equal(HotkeyState.ConflictInternal, segundo.State);
        Assert.Contains("leader", segundo.ConflictDetail);
    }

    [Fact]
    public void Conflito_interno_nao_chega_ao_sistema()
    {
        var sink = new FakeHotkeySink();
        var registry = new HotkeyRegistry(sink);

        registry.Register("leader", Lider, () => { });
        registry.Register("ports", Lider, () => { });

        Assert.Single(sink.Registrados);
    }

    [Fact]
    public void Combinacao_tomada_por_outro_aplicativo_vira_conflito_externo()
    {
        var registry = new HotkeyRegistry(new FakeHotkeySink(Lider));

        var r = registry.Register("leader", Lider, () => { });

        Assert.Equal(HotkeyState.ConflictExternal, r.State);
        Assert.False(r.Active);
        Assert.NotNull(r.ConflictDetail);
    }

    // O pedido que falha continua listado. É isso que permite a tela de
    // configuração explicar por que um atalho não funciona, em vez de o
    // usuário descobrir sozinho que ele sumiu.
    [Fact]
    public void Pedido_em_conflito_continua_visivel_na_listagem()
    {
        var registry = new HotkeyRegistry(new FakeHotkeySink(Lider));

        registry.Register("leader", Lider, () => { });

        Assert.Single(registry.All);
        Assert.Single(registry.Conflicts);
    }

    [Fact]
    public void Combinacoes_diferentes_convivem()
    {
        var registry = new HotkeyRegistry(new FakeHotkeySink());

        var a = registry.Register("leader", Lider, () => { });
        var b = registry.Register("ports", new HotkeyBinding(HotkeyModifiers.Control, VkP), () => { });

        Assert.True(a.Active);
        Assert.True(b.Active);
        Assert.Empty(registry.Conflicts);
    }

    [Fact]
    public void Dispatch_chama_o_callback_do_id_certo()
    {
        var registry = new HotkeyRegistry(new FakeHotkeySink());
        var chamou = string.Empty;

        var a = registry.Register("leader", Lider, () => chamou = "leader");
        registry.Register("ports", new HotkeyBinding(HotkeyModifiers.Control, VkP), () => chamou = "ports");

        Assert.True(registry.Dispatch(a.Id));
        Assert.Equal("leader", chamou);
    }

    [Fact]
    public void Dispatch_de_id_desconhecido_nao_explode()
        => Assert.False(new HotkeyRegistry(new FakeHotkeySink()).Dispatch(4242));

    [Fact]
    public void Dispatch_de_registro_em_conflito_nao_chama_nada()
    {
        var registry = new HotkeyRegistry(new FakeHotkeySink(Lider));
        var chamou = false;

        var r = registry.Register("leader", Lider, () => chamou = true);

        Assert.False(registry.Dispatch(r.Id));
        Assert.False(chamou);
    }

    [Fact]
    public void Unregister_libera_no_sistema_e_some_da_listagem()
    {
        var sink = new FakeHotkeySink();
        var registry = new HotkeyRegistry(sink);

        var r = registry.Register("leader", Lider, () => { });
        registry.Unregister(r.Id);

        Assert.Equal([r.Id], sink.Removidos);
        Assert.Empty(registry.All);
    }

    [Fact]
    public void Unregister_de_conflito_nao_toca_no_sistema()
    {
        var sink = new FakeHotkeySink(Lider);
        var registry = new HotkeyRegistry(sink);

        var r = registry.Register("leader", Lider, () => { });
        registry.Unregister(r.Id);

        // Nunca chegou a registrar, então não pode tentar liberar.
        Assert.Empty(sink.Removidos);
    }

    [Fact]
    public void UnregisterAll_limpa_tudo()
    {
        var sink = new FakeHotkeySink();
        var registry = new HotkeyRegistry(sink);

        registry.Register("leader", Lider, () => { });
        registry.Register("ports", new HotkeyBinding(HotkeyModifiers.Control, VkP), () => { });
        registry.UnregisterAll();

        Assert.Empty(registry.All);
        Assert.Equal(2, sink.Removidos.Count);
    }

    [Theory]
    [InlineData("")]
    [InlineData(" ")]
    public void Dono_sem_nome_e_recusado(string owner)
        => Assert.Throws<ArgumentException>(
            () => new HotkeyRegistry(new FakeHotkeySink()).Register(owner, Lider, () => { }));
}

public class HotkeyBindingTests
{
    [Theory]
    [InlineData(HotkeyModifiers.Control | HotkeyModifiers.Alt, 0x20, "Ctrl+Alt+Space")]
    [InlineData(HotkeyModifiers.Control, 0x50, "Ctrl+P")]
    [InlineData(HotkeyModifiers.Windows | HotkeyModifiers.Shift, 0x53, "Shift+Win+S")]
    [InlineData(HotkeyModifiers.None, 0x70, "F1")]
    public void Texto_legivel_para_a_tela_de_configuracao(
        HotkeyModifiers mods, uint vk, string esperado)
        => Assert.Equal(esperado, new HotkeyBinding(mods, vk).ToString());

    [Fact]
    public void Combinacoes_iguais_sao_iguais()
        => Assert.Equal(
            new HotkeyBinding(HotkeyModifiers.Control, 0x41),
            new HotkeyBinding(HotkeyModifiers.Control, 0x41));
}
