using System.Text.Json.Nodes;
using Moductus.Core.Config;

namespace Moductus.Core.Tests;

public class ConfigStoreTests
{
    [Fact]
    public void Sem_arquivo_cria_config_padrao_na_versao_atual()
    {
        var store = ConfigStore.Load(new FakeConfigFile());

        Assert.Equal(ConfigStore.CurrentVersion, store.Version);
    }

    [Fact]
    public void Nada_e_gravado_ate_pedirem()
    {
        var file = new FakeConfigFile();

        ConfigStore.Load(file);

        Assert.Equal(0, file.Writes);
    }

    // O teste mais importante deste arquivo. Ver o comentário do ConfigStore:
    // desserializar para POCO apagaria estas chaves, e um downgrade destruiria
    // em silêncio a config de quem testou uma versão nova.
    [Fact]
    public void Chave_desconhecida_sobrevive_a_um_ciclo_de_leitura_e_escrita()
    {
        var original = """
        {
          "version": 1,
          "recursoQueAindaNaoExiste": { "profundo": [1, 2, 3] },
          "modules": { "ports": { "opcaoFutura": true } }
        }
        """;

        var file = new FakeConfigFile(original);
        var store = ConfigStore.Load(file);
        store.Save();

        var depois = JsonNode.Parse(file.Content!)!.AsObject();

        Assert.Equal(3, depois["recursoQueAindaNaoExiste"]!["profundo"]!.AsArray().Count);
        Assert.True(depois["modules"]!["ports"]!["opcaoFutura"]!.GetValue<bool>());
    }

    [Fact]
    public void Config_de_versao_futura_nao_e_rebaixada()
    {
        var file = new FakeConfigFile("""{ "version": 99, "coisaNova": "preservar" }""");

        var store = ConfigStore.Load(file);
        store.Save();

        var depois = JsonNode.Parse(file.Content!)!.AsObject();

        Assert.Equal(99, depois["version"]!.GetValue<int>());
        Assert.Equal("preservar", depois["coisaNova"]!.GetValue<string>());
    }

    [Fact]
    public void Config_sem_campo_de_versao_e_promovida_para_a_atual()
    {
        var store = ConfigStore.Load(new FakeConfigFile("""{ "algo": 1 }"""));

        Assert.Equal(ConfigStore.CurrentVersion, store.Version);
    }

    [Fact]
    public void Escopo_de_modulo_e_isolado_por_id()
    {
        var store = ConfigStore.Load(new FakeConfigFile());

        store.ModuleScope("ports")["intervalo"] = 5;
        store.ModuleScope("scratch")["intervalo"] = 9;

        Assert.Equal(5, store.ModuleScope("ports")["intervalo"]!.GetValue<int>());
        Assert.Equal(9, store.ModuleScope("scratch")["intervalo"]!.GetValue<int>());
    }

    [Fact]
    public void Escopo_de_modulo_persiste_no_arquivo()
    {
        var file = new FakeConfigFile();
        var store = ConfigStore.Load(file);

        store.ModuleScope("awake")["ligado"] = true;
        store.Save();

        var relido = ConfigStore.Load(new FakeConfigFile(file.Content));

        Assert.True(relido.ModuleScope("awake")["ligado"]!.GetValue<bool>());
    }

    [Fact]
    public void Escopo_do_mesmo_modulo_devolve_a_mesma_instancia()
    {
        var store = ConfigStore.Load(new FakeConfigFile());

        Assert.Same(store.ModuleScope("ports"), store.ModuleScope("ports"));
    }

    [Fact]
    public void Json_invalido_falha_de_forma_visivel_em_vez_de_apagar()
    {
        var file = new FakeConfigFile("{ isto nao e json");

        var e = Assert.Throws<ConfigCorruptException>(() => ConfigStore.Load(file));

        Assert.Equal(file.Path, e.Path);
        Assert.Equal("{ isto nao e json", file.Content);
    }

    [Fact]
    public void Json_valido_que_nao_e_objeto_tambem_falha()
        => Assert.Throws<ConfigCorruptException>(() => ConfigStore.Load(new FakeConfigFile("[1, 2, 3]")));
}
