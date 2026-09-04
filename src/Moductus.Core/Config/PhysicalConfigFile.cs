using System.IO;
using System.Text;

namespace Moductus.Core.Config;

/// <summary>O arquivo de verdade, no disco.</summary>
public sealed class PhysicalConfigFile(string path) : IConfigFile
{
    private static readonly UTF8Encoding Utf8SemBom = new(encoderShouldEmitUTF8Identifier: false);

    public string Path { get; } = path;

    public bool Exists() => File.Exists(Path);

    public string Read() => File.ReadAllText(Path, Encoding.UTF8);

    /// <remarks>
    /// Grava num temporário e troca. Config corrompida por queda no meio da
    /// escrita transforma um app de conveniência num app que a pessoa
    /// desinstala, e o custo de evitar isso são estas cinco linhas.
    /// </remarks>
    public void WriteAtomic(string content)
    {
        var dir = System.IO.Path.GetDirectoryName(Path);
        if (!string.IsNullOrEmpty(dir))
        {
            Directory.CreateDirectory(dir);
        }

        var temp = Path + ".tmp";
        File.WriteAllText(temp, content, Utf8SemBom);

        if (File.Exists(Path))
        {
            File.Replace(temp, Path, destinationBackupFileName: null);
        }
        else
        {
            File.Move(temp, Path);
        }
    }
}
