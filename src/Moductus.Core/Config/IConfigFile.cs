namespace Moductus.Core.Config;

/// <summary>
/// Acesso ao arquivo de configuração. Existe para que o <see cref="ConfigStore"/>
/// seja testável sem disco, e para concentrar a garantia de escrita atômica
/// num lugar só.
/// </summary>
public interface IConfigFile
{
    string Path { get; }

    bool Exists();

    string Read();

    /// <summary>
    /// Grava de forma que um crash no meio da operação não deixe o arquivo
    /// pela metade.
    /// </summary>
    void WriteAtomic(string content);
}
