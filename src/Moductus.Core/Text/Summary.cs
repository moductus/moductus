namespace Moductus.Core.Text;

/// <summary>
/// Texto arbitrário reduzido ao que cabe numa linha de lista, de HUD ou de
/// legenda.
/// </summary>
/// <remarks>
/// Vive no núcleo porque todo módulo que mostra conteúdo de fora — clipboard,
/// mensagem de erro, caminho de arquivo, título de janela — precisa da mesma
/// redução, e porque é a única parte disso que dá para testar sem sessão
/// gráfica.
/// </remarks>
public static class Summary
{
    /// <summary>
    /// Uma linha só, sem sobra de espaço, cortada em <paramref name="max"/>
    /// com reticências.
    /// </summary>
    /// <remarks>
    /// <para>
    /// Quebra de linha vira espaço em vez de sumir: "linha1\nlinha2" sem a
    /// troca viraria "linha1linha2", e duas palavras coladas mentem sobre o
    /// conteúdo. Espaços repetidos colapsam logo depois, porque texto indentado
    /// — JSON, log, código — desperdiçaria metade da linha com o recuo.
    /// </para>
    /// <para>
    /// O corte conta caracteres, não palavras: o objetivo é caber, e cortar na
    /// palavra faria a largura variar a cada item de uma lista.
    /// </para>
    /// </remarks>
    public static string OneLine(string text, int max)
    {
        if (string.IsNullOrEmpty(text))
        {
            return string.Empty;
        }

        var linha = Collapse(text.ReplaceLineEndings(" "));

        return linha.Length > max ? linha[..max] + "…" : linha;
    }

    /// <summary>Espaço repetido vira um só. Um passo, sem varrer a string N vezes.</summary>
    private static string Collapse(string texto)
    {
        var saida = new System.Text.StringBuilder(texto.Length);
        var espaco = false;

        foreach (var c in texto)
        {
            if (c == ' ')
            {
                espaco = true;
                continue;
            }

            if (espaco && saida.Length > 0)
            {
                saida.Append(' ');
            }

            espaco = false;
            saida.Append(c);
        }

        return saida.ToString();
    }
}
