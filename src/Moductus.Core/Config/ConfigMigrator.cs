using System.Text.Json.Nodes;

namespace Moductus.Core.Config;

/// <summary>Leva a configuração de uma versão para a seguinte.</summary>
public interface IConfigMigration
{
    /// <summary>Versão de origem. Esta migração produz <c>From + 1</c>.</summary>
    int From { get; }

    void Apply(JsonObject root);
}

/// <summary>
/// Aplica migrações em cadeia até <see cref="ConfigStore.CurrentVersion"/>.
/// </summary>
public sealed class ConfigMigrator
{
    private readonly List<IConfigMigration> _migrations;

    public ConfigMigrator(IEnumerable<IConfigMigration> migrations)
    {
        ArgumentNullException.ThrowIfNull(migrations);
        _migrations = [.. migrations.OrderBy(m => m.From)];
    }

    /// <summary>
    /// Ainda não há migração: a v1 é a primeira versão do schema. A máquina
    /// existe desde já porque acrescentar versionamento depois de haver
    /// usuários é o que torna migração cara.
    /// </summary>
    public static ConfigMigrator Default { get; } = new([]);

    public void Migrate(JsonObject root)
    {
        ArgumentNullException.ThrowIfNull(root);

        var versao = root[ConfigStore.VersionKey]?.GetValue<int>() ?? 0;

        // Config de versão futura não é tocada. Rebaixar o schema apagaria o
        // que a versão nova escreveu.
        if (versao > ConfigStore.CurrentVersion)
        {
            return;
        }

        foreach (var migration in _migrations.Where(m => m.From >= versao))
        {
            migration.Apply(root);
            versao = migration.From + 1;
        }

        root[ConfigStore.VersionKey] = Math.Max(versao, ConfigStore.CurrentVersion);
    }
}
