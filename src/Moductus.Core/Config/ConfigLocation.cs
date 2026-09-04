using System.IO;

namespace Moductus.Core.Config;

/// <summary>
/// Decide onde o <c>config.json</c> vive: ao lado do executável em modo
/// portable, ou sob <c>%APPDATA%</c> quando instalado.
/// </summary>
/// <remarks>
/// Os diretórios entram por parâmetro em vez de serem lidos do ambiente. Isso
/// é o que torna a detecção de modo portable testável sem tocar em disco real.
/// </remarks>
public sealed class ConfigLocation
{
    /// <summary>Arquivo cuja presença ao lado do executável liga o modo portable.</summary>
    public const string PortableMarker = "portable.txt";

    public const string FileName = "config.json";
    public const string AppFolder = "Moductus";

    private ConfigLocation(bool portable, string path)
    {
        Portable = portable;
        Path = path;
    }

    public bool Portable { get; }

    public string Path { get; }

    /// <param name="executableDirectory">Pasta onde o executável está.</param>
    /// <param name="appDataDirectory">Normalmente <c>%APPDATA%</c>.</param>
    /// <param name="fileExists">Sonda de existência. Padrão: o disco real.</param>
    public static ConfigLocation Resolve(
        string executableDirectory,
        string appDataDirectory,
        Func<string, bool>? fileExists = null)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(executableDirectory);
        ArgumentException.ThrowIfNullOrWhiteSpace(appDataDirectory);

        fileExists ??= File.Exists;

        var marker = System.IO.Path.Combine(executableDirectory, PortableMarker);

        return fileExists(marker)
            ? new ConfigLocation(true, System.IO.Path.Combine(executableDirectory, FileName))
            : new ConfigLocation(false, System.IO.Path.Combine(appDataDirectory, AppFolder, FileName));
    }
}
