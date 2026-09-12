using Moductus.Core.Commands;

namespace Moductus.Core.Tests;

public class CommandRegistryTests
{
    private static PaletteCommand Cmd(string id, string text, string? detail = null) =>
        new(id, text, detail, null, () => { });

    private static CommandRegistry Registro()
    {
        var r = new CommandRegistry();
        r.Register("host", Cmd("settings", "Configurações", "Abrir a janela de configurações"));
        r.Register("host", Cmd("quit", "Sair do Moductus"));
        r.Register("module:ports", Cmd("open:ports", "Abrir Ports", "Portas locais ocupadas"));
        r.Register("pasteflow", Cmd("json", "Clipboard: formatar JSON", "Indenta o JSON copiado"));
        r.Register("pasteflow", Cmd("slug", "Clipboard: slug", "ola-mundo"));
        return r;
    }

    [Fact]
    public void Busca_vazia_lista_tudo_em_ordem_alfabetica()
    {
        var todos = Registro().Search("");

        Assert.Equal(5, todos.Count);
        Assert.Equal("Abrir Ports", todos[0].Text);
    }

    [Fact]
    public void Prefixo_do_texto_vem_antes_de_inicio_de_palavra_que_vem_antes_de_trecho()
    {
        var r = new CommandRegistry();
        r.Register("t", Cmd("a", "Portas abertas"));
        r.Register("t", Cmd("b", "Abrir Ports"));
        r.Register("t", Cmd("c", "Exportar"));

        var ordem = r.Search("por").Select(c => c.Text).ToList();

        Assert.Equal(["Portas abertas", "Abrir Ports", "Exportar"], ordem);
    }

    [Fact]
    public void Trecho_do_detalhe_conta_por_ultimo()
    {
        var resultado = Registro().Search("indenta");

        Assert.Single(resultado);
        Assert.Equal("json", resultado[0].Id);
    }

    [Fact]
    public void O_que_nao_casa_some()
        => Assert.Empty(Registro().Search("zzz"));

    [Fact]
    public void Busca_ignora_caixa()
        => Assert.Equal("quit", Registro().Search("SAIR")[0].Id);

    [Fact]
    public void Unregister_remove_so_o_dono()
    {
        var r = Registro();

        r.Unregister("pasteflow");

        Assert.Equal(3, r.All.Count);
        Assert.DoesNotContain(r.All, c => c.Id == "json");
    }

    [Fact]
    public void Registrar_o_mesmo_id_substitui()
    {
        var r = Registro();

        r.Register("host", Cmd("quit", "Encerrar"));

        Assert.Single(r.All, c => c.Id == "quit");
        Assert.Equal("Encerrar", r.All.First(c => c.Id == "quit").Text);
    }

    [Fact]
    public void Provedor_marcado_como_primary_vem_antes_de_tudo()
    {
        var r = Registro();
        r.RegisterProvider("calc", q => [new PaletteCommand("calc", "4", q, null, () => { }, Primary: true)]);

        var resultado = r.Search("Clipboard");

        Assert.Equal("calc", resultado[0].Id);
        Assert.Equal("json", resultado[1].Id);
    }

    [Fact]
    public void Resultado_de_provedor_entra_no_ranking_e_ganha_o_empate()
    {
        var r = new CommandRegistry();
        r.Register("host", Cmd("estatico", "Portas abertas"));
        r.RegisterProvider("apps", _ => [new PaletteCommand("app", "Portas do PC", "Abrir aplicativo", null, () => { })]);

        var ordem = r.Search("por").Select(c => c.Id).ToList();

        Assert.Equal(["app", "estatico"], ordem);
    }

    [Fact]
    public void Provedor_nao_aparece_em_busca_vazia_nem_em_All()
    {
        var r = Registro();
        r.RegisterProvider("apps", _ => [new PaletteCommand("app", "Notepad", null, null, () => { })]);

        Assert.Equal(5, r.All.Count);
        Assert.Equal(5, r.Search("").Count);
    }

    [Fact]
    public void Provedor_que_lanca_nao_derruba_a_busca()
    {
        var r = Registro();
        r.RegisterProvider("quebrado", _ => throw new InvalidOperationException("disco fora"));

        Assert.Equal("quit", r.Search("SAIR")[0].Id);
    }

    [Fact]
    public void UnregisterProvider_tira_so_o_provedor_do_dono()
    {
        var r = new CommandRegistry();
        r.RegisterProvider("a", _ => [new PaletteCommand("a", "Alfa", null, null, () => { })]);
        r.RegisterProvider("b", _ => [new PaletteCommand("b", "Alfa beta", null, null, () => { })]);

        r.UnregisterProvider("a");

        Assert.Equal(["b"], r.Search("alfa").Select(c => c.Id));
    }

    [Fact]
    public void Registrar_provedor_duas_vezes_para_o_mesmo_dono_substitui()
    {
        var r = new CommandRegistry();
        r.RegisterProvider("a", _ => [new PaletteCommand("velho", "Alfa", null, null, () => { })]);
        r.RegisterProvider("a", _ => [new PaletteCommand("novo", "Alfa", null, null, () => { })]);

        Assert.Equal(["novo"], r.Search("alfa").Select(c => c.Id));
    }
}
