using System.Text.Json;
using System.Text.Json.Nodes;

namespace Moductus.Core.Config;

/// <summary>Configuração do app, em JSON versionado.</summary>
/// <remarks>
/// <para>
/// A árvore é mantida como <see cref="JsonObject"/> e <b>nunca</b> desserializada
/// para um POCO. Isso não é preguiça: desserializar descarta toda chave que o
/// tipo não conhece, e reserializar a apagaria do disco. Como consequência,
/// abrir uma versão antiga depois de ter testado uma nova destruiria em
/// silêncio a configuração de quem colaborou testando.
/// </para>
/// <para>
/// Pelo mesmo motivo, <see cref="Save"/> nunca rebaixa o campo de versão.
/// </para>
/// </remarks>
public sealed class ConfigStore
{
    public const int CurrentVersion = 1;

    internal const string VersionKey = "version";
    internal const string ModulesKey = "modules";

    private static readonly JsonSerializerOptions Formato = new() { WriteIndented = true };

    private readonly IConfigFile _file;

    private ConfigStore(IConfigFile file, JsonObject root)
    {
        _file = file;
        Root = root;
    }

    /// <summary>A árvore inteira, incluindo o que este app não reconhece.</summary>
    public JsonObject Root { get; }

    public int Version => Root[VersionKey]?.GetValue<int>() ?? 0;

    public static ConfigStore Load(IConfigFile file, ConfigMigrator? migrator = null)
    {
        ArgumentNullException.ThrowIfNull(file);

        var root = file.Exists() ? Parse(file.Read(), file.Path) : Padrao();

        (migrator ?? ConfigMigrator.Default).Migrate(root);

        return new ConfigStore(file, root);
    }

    public void Save()
    {
        // Só sobe. Uma config gravada por versão futura mantém o número dela,
        // para que a versão futura não perca o que escreveu.
        if (Version < CurrentVersion)
        {
            Root[VersionKey] = CurrentVersion;
        }

        _file.WriteAtomic(Root.ToJsonString(Formato));
    }

    /// <summary>
    /// Escopo isolado de um módulo, sob <c>modules.&lt;id&gt;</c>. Criado na
    /// primeira chamada. Módulo não enxerga a raiz.
    /// </summary>
    public JsonObject ModuleScope(string moduleId)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(moduleId);

        if (Root[ModulesKey] is not JsonObject modules)
        {
            modules = [];
            Root[ModulesKey] = modules;
        }

        if (modules[moduleId] is not JsonObject scope)
        {
            scope = [];
            modules[moduleId] = scope;
        }

        return scope;
    }

    private static JsonObject Padrao() => new()
    {
        [VersionKey] = CurrentVersion,
        [ModulesKey] = new JsonObject(),
    };

    private static JsonObject Parse(string texto, string caminho)
    {
        JsonNode? node;

        try
        {
            node = JsonNode.Parse(texto);
        }
        catch (JsonException e)
        {
            throw new ConfigCorruptException(caminho, e);
        }

        return node as JsonObject ?? throw new ConfigCorruptException(caminho, null);
    }
}

/// <summary>
/// O arquivo existe mas não é um objeto JSON válido.
/// </summary>
/// <remarks>
/// Sobe em vez de ser engolida de propósito: apagar em silêncio a config de
/// alguém é pior que falhar de forma visível. A política de recuperação — se
/// renomeia o arquivo e começa do zero, ou se pede confirmação — é decisão do
/// host, não desta camada.
/// </remarks>
public sealed class ConfigCorruptException(string path, Exception? inner)
    : Exception($"Configuração inválida em '{path}'.", inner)
{
    public string Path { get; } = path;
}
