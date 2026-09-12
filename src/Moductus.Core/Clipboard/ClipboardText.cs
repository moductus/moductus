namespace Moductus.Core.Clipboard;

/// <summary>
/// Ler e escrever texto no clipboard sem que cada chamador repita o mesmo
/// <c>try</c>.
/// </summary>
/// <remarks>
/// <para>
/// O clipboard do Windows é um recurso global, aberto por um processo de cada
/// vez. Quando outro app o está segurando — e basta um gerenciador de senhas,
/// uma máquina virtual ou uma área de transferência de terceiros —, a chamada
/// lança <c>ExternalException</c> em vez de esperar. Isso não é erro do app:
/// é o estado normal de um recurso disputado, e o certo é dizer na interface
/// e seguir.
/// </para>
/// <para>
/// O histórico do Clips não passa por aqui: ele lê o <c>IDataObject</c> inteiro
/// para respeitar as marcas de privacidade, o que é outro problema.
/// </para>
/// </remarks>
public static class ClipboardText
{
    /// <summary>
    /// O texto do clipboard, ou vazio quando o que está lá não é texto.
    /// </summary>
    /// <returns><c>false</c> quando não deu para abrir o clipboard.</returns>
    public static bool TryRead(out string text, out string error)
    {
        try
        {
            text = System.Windows.Clipboard.ContainsText()
                ? System.Windows.Clipboard.GetText()
                : string.Empty;
            error = string.Empty;
            return true;
        }
        catch (Exception e)
        {
            text = string.Empty;
            error = e.Message;
            return false;
        }
    }

    /// <returns><c>false</c> quando não deu para abrir o clipboard.</returns>
    public static bool TryWrite(string text, out string error)
    {
        try
        {
            System.Windows.Clipboard.SetText(text);
            error = string.Empty;
            return true;
        }
        catch (Exception e)
        {
            error = e.Message;
            return false;
        }
    }
}
