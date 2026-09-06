using Moductus.Core.Clipboard;

namespace Moductus.Core.Tests;

public class ClipStoreTests
{
    private static readonly DateTimeOffset T0 = new(2026, 9, 6, 12, 0, 0, TimeSpan.Zero);

    [Fact]
    public void Mais_recente_primeiro()
    {
        var store = ClipStore.Load(new FakeConfigFile());

        store.Add("um", T0);
        store.Add("dois", T0.AddSeconds(1));

        Assert.Equal(["dois", "um"], store.All.Select(c => c.Text));
    }

    [Fact]
    public void Repetido_sobe_em_vez_de_duplicar()
    {
        var store = ClipStore.Load(new FakeConfigFile());
        store.Add("um", T0);
        store.Add("dois", T0.AddSeconds(1));

        var mudou = store.Add("um", T0.AddSeconds(2));

        Assert.True(mudou);
        Assert.Equal(["um", "dois"], store.All.Select(c => c.Text));
    }

    [Fact]
    public void Mesmo_texto_no_topo_nao_muda_nada()
    {
        var store = ClipStore.Load(new FakeConfigFile());
        store.Add("um", T0);

        Assert.False(store.Add("um", T0.AddSeconds(1)));
        Assert.Single(store.All);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   \n")]
    public void Vazio_e_ignorado(string? texto)
        => Assert.False(ClipStore.Load(new FakeConfigFile()).Add(texto, T0));

    [Fact]
    public void Teto_descarta_os_mais_antigos()
    {
        var store = ClipStore.Load(new FakeConfigFile());

        for (var i = 0; i < ClipStore.Max + 10; i++)
        {
            store.Add($"clip {i}", T0.AddSeconds(i));
        }

        Assert.Equal(ClipStore.Max, store.Count);
        Assert.Equal($"clip {ClipStore.Max + 9}", store.All[0].Text);
        Assert.DoesNotContain(store.All, c => c.Text == "clip 0");
    }

    [Fact]
    public void Persiste_e_volta_igual()
    {
        var file = new FakeConfigFile();
        var store = ClipStore.Load(file);
        store.Add("com\nquebra", T0);
        store.Add("acentuação ✓", T0.AddSeconds(1));
        store.Save();

        var relido = ClipStore.Load(new FakeConfigFile(file.Content));

        Assert.Equal(store.All, relido.All);
    }

    [Fact]
    public void Arquivo_ilegivel_comeca_vazio_sem_explodir()
        => Assert.Empty(ClipStore.Load(new FakeConfigFile("{ nao e uma lista")).All);

    [Fact]
    public void Remove_e_limpa()
    {
        var store = ClipStore.Load(new FakeConfigFile());
        store.Add("um", T0);
        store.Add("dois", T0);

        store.Remove("um");
        Assert.Equal(["dois"], store.All.Select(c => c.Text));

        store.Clear();
        Assert.Empty(store.All);
    }
}

public class ClipboardPrivacyTests
{
    [Fact]
    public void Formato_de_exclusao_presente_exclui()
        => Assert.True(ClipboardPrivacy.IsExcluded(f => f == ClipboardPrivacy.ExcludeFormat, _ => null));

    [Fact]
    public void CanIncludeInClipboardHistory_zero_exclui()
        => Assert.True(ClipboardPrivacy.IsExcluded(
            f => f == ClipboardPrivacy.HistoryFormat,
            _ => [0, 0, 0, 0]));

    [Fact]
    public void CanIncludeInClipboardHistory_um_nao_exclui()
        => Assert.False(ClipboardPrivacy.IsExcluded(
            f => f == ClipboardPrivacy.HistoryFormat,
            _ => [1, 0, 0, 0]));

    [Fact]
    public void Sem_marcacao_nao_exclui()
        => Assert.False(ClipboardPrivacy.IsExcluded(_ => false, _ => null));
}
