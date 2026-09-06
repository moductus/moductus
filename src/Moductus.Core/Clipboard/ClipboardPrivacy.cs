namespace Moductus.Core.Clipboard;

/// <summary>
/// Os formatos com que gerenciadores de senha marcam o clipboard. Respeitar
/// é obrigatório: sem isto, o histórico vira algo que grava senha em disco.
/// </summary>
public static class ClipboardPrivacy
{
    /// <summary>Presente = não processe. É o que KeePass, 1Password e Bitwarden usam.</summary>
    public const string ExcludeFormat = "ExcludeClipboardContentFromMonitorProcessing";

    /// <summary>DWORD; zero = não guarde no histórico. É o que o Windows lê para o Win+V.</summary>
    public const string HistoryFormat = "CanIncludeInClipboardHistory";

    /// <summary>Recebe funções em vez do clipboard para ser testável sem sessão gráfica.</summary>
    public static bool IsExcluded(Func<string, bool> hasFormat, Func<string, byte[]?> readBytes)
    {
        ArgumentNullException.ThrowIfNull(hasFormat);
        ArgumentNullException.ThrowIfNull(readBytes);

        if (hasFormat(ExcludeFormat))
        {
            return true;
        }

        if (hasFormat(HistoryFormat))
        {
            var bytes = readBytes(HistoryFormat);
            if (bytes is { Length: >= 4 } && BitConverter.ToInt32(bytes, 0) == 0)
            {
                return true;
            }
        }

        return false;
    }
}
