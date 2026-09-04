using System.IO;
using System.Text.Json.Nodes;
using Moductus.Core.Config;
using Moductus.Core.Hotkeys;

namespace Moductus.Core.Tests;

/// <summary>Arquivo de config em memória, com contagem de escritas.</summary>
internal sealed class FakeConfigFile(string? conteudoInicial = null) : IConfigFile
{
    public string Path => @"C:\fake\config.json";

    public string? Content { get; private set; } = conteudoInicial;

    public int Writes { get; private set; }

    public bool Exists() => Content is not null;

    public string Read() => Content ?? throw new FileNotFoundException(Path);

    public void WriteAtomic(string content)
    {
        Content = content;
        Writes++;
    }
}

/// <summary>
/// Sink que aceita tudo, menos as combinações declaradas como tomadas por
/// outro aplicativo.
/// </summary>
internal sealed class FakeHotkeySink(params HotkeyBinding[] tomadasPorTerceiros) : IHotkeySink
{
    private readonly HashSet<HotkeyBinding> _tomadas = [.. tomadasPorTerceiros];

    public List<int> Registrados { get; } = [];

    public List<int> Removidos { get; } = [];

    public bool TryRegister(int id, HotkeyBinding binding)
    {
        if (_tomadas.Contains(binding))
        {
            return false;
        }

        Registrados.Add(id);
        return true;
    }

    public void Unregister(int id) => Removidos.Add(id);
}

/// <summary>Migração de mentira que carimba a passagem na árvore.</summary>
internal sealed class MigracaoFake(int from) : IConfigMigration
{
    public int From => from;

    public int Aplicacoes { get; private set; }

    public void Apply(JsonObject root)
    {
        Aplicacoes++;
        root[$"passou-por-{From}"] = true;
    }
}
