using System.Text.Json;
using System.Text.Json.Serialization;
using Moductus.Core.Config;

namespace Moductus.Core.Clipboard;

public sealed record Clip(string Text, DateTimeOffset When);

/// <summary>
/// O histórico do Clips: texto, mais recente primeiro, sem repetição, com
/// teto. Persistido em JSON pelo mesmo <see cref="IConfigFile"/> da config,
/// que garante a escrita atômica.
/// </summary>
public sealed class ClipStore
{
    public const int Max = 200;

    private static readonly JsonSerializerOptions Formato = new() { WriteIndented = false };

    private readonly IConfigFile _file;
    private readonly List<Clip> _clips;

    private ClipStore(IConfigFile file, List<Clip> clips)
    {
        _file = file;
        _clips = clips;
    }

    /// <summary>Mais recente primeiro.</summary>
    public IReadOnlyList<Clip> All => _clips;

    public int Count => _clips.Count;

    /// <summary>Histórico ilegível não é precioso: começa vazio, sem apagar o arquivo.</summary>
    public static ClipStore Load(IConfigFile file)
    {
        ArgumentNullException.ThrowIfNull(file);

        List<Clip> clips = [];

        if (file.Exists())
        {
            try
            {
                clips = JsonSerializer.Deserialize<List<Clip>>(file.Read(), Formato) ?? [];
            }
            catch (JsonException)
            {
                clips = [];
            }
        }

        return new ClipStore(file, clips.Take(Max).ToList());
    }

    /// <summary>
    /// Adiciona no topo. Texto repetido sobe em vez de duplicar. Vazio é ignorado.
    /// </summary>
    /// <returns>Falso se nada mudou.</returns>
    public bool Add(string? text, DateTimeOffset when)
    {
        if (string.IsNullOrWhiteSpace(text))
        {
            return false;
        }

        if (_clips.Count > 0 && _clips[0].Text == text)
        {
            return false;
        }

        _clips.RemoveAll(c => c.Text == text);
        _clips.Insert(0, new Clip(text, when));

        if (_clips.Count > Max)
        {
            _clips.RemoveRange(Max, _clips.Count - Max);
        }

        return true;
    }

    public void Remove(string text) => _clips.RemoveAll(c => c.Text == text);

    public void Clear() => _clips.Clear();

    public void Save() => _file.WriteAtomic(JsonSerializer.Serialize(_clips, Formato));
}
