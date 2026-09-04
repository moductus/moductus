using System.Text.Json.Nodes;
using Moductus.Core.Config;

namespace Moductus.Core.Tests;

public class ConfigMigratorTests
{
    [Fact]
    public void Migracoes_sao_aplicadas_em_ordem_a_partir_da_versao_do_arquivo()
    {
        var m0 = new MigracaoFake(0);
        var m1 = new MigracaoFake(1);
        var m2 = new MigracaoFake(2);

        // Fora de ordem de propósito: o migrador é que ordena.
        var migrator = new ConfigMigrator([m2, m0, m1]);
        var root = new JsonObject { ["version"] = 1 };

        migrator.Migrate(root);

        Assert.Equal(0, m0.Aplicacoes);
        Assert.Equal(1, m1.Aplicacoes);
        Assert.Equal(1, m2.Aplicacoes);
        Assert.Equal(3, root["version"]!.GetValue<int>());
    }

    [Fact]
    public void Arquivo_sem_versao_passa_por_todas()
    {
        var m0 = new MigracaoFake(0);
        var migrator = new ConfigMigrator([m0]);

        migrator.Migrate([]);

        Assert.Equal(1, m0.Aplicacoes);
    }

    [Fact]
    public void Versao_futura_nao_e_tocada()
    {
        var m0 = new MigracaoFake(0);
        var root = new JsonObject { ["version"] = 99 };

        new ConfigMigrator([m0]).Migrate(root);

        Assert.Equal(0, m0.Aplicacoes);
        Assert.Equal(99, root["version"]!.GetValue<int>());
    }

    [Fact]
    public void Sem_migracao_a_versao_e_promovida_para_a_atual()
    {
        var root = new JsonObject();

        ConfigMigrator.Default.Migrate(root);

        Assert.Equal(ConfigStore.CurrentVersion, root["version"]!.GetValue<int>());
    }
}
