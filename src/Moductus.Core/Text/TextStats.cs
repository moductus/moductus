using System.Globalization;

namespace Moductus.Core.Text;

/// <summary>
/// Quanto texto há: a contagem de caracteres e palavras do rodapé do Scratch.
/// </summary>
/// <remarks>
/// No núcleo porque "o que é uma palavra" num bloco de markdown tem resposta
/// discutível, e a resposta escolhida precisa de teste que a segure.
/// </remarks>
public static class TextStats
{
    /// <summary>
    /// O rodapé fala português, então o número também: "1.234", com o ponto de
    /// milhar daqui, em qualquer máquina.
    /// </summary>
    private static readonly CultureInfo Brasil = CultureInfo.GetCultureInfo("pt-BR");

    /// <summary>
    /// Caracteres que se veem, sem as quebras de linha. Conta por elemento de
    /// texto, não por <c>char</c>: um emoji ou um acento combinado é uma letra
    /// na tela, e contar os pares substitutos daria dois.
    /// </summary>
    public static int Characters(string text)
    {
        if (string.IsNullOrEmpty(text))
        {
            return 0;
        }

        var semQuebras = text.Replace("\r", string.Empty, StringComparison.Ordinal)
            .Replace("\n", string.Empty, StringComparison.Ordinal);

        return new StringInfo(semQuebras).LengthInTextElements;
    }

    /// <summary>
    /// Pedaços separados por espaço que têm ao menos uma letra ou um dígito.
    /// O marcador de lista, a cerquilha do título e a régua de markdown não
    /// são palavras de quem escreve; "café", "v2" e "node_modules" são.
    /// </summary>
    public static int Words(string text)
    {
        if (string.IsNullOrEmpty(text))
        {
            return 0;
        }

        var total = 0;
        var dentro = false;
        var temLetra = false;

        foreach (var c in text)
        {
            if (char.IsWhiteSpace(c))
            {
                if (dentro && temLetra)
                {
                    total++;
                }

                dentro = false;
                temLetra = false;
                continue;
            }

            dentro = true;
            temLetra |= char.IsLetterOrDigit(c);
        }

        return dentro && temLetra ? total + 1 : total;
    }

    /// <summary>"342 caracteres · 48 palavras", com o singular no um.</summary>
    public static string Label(string text)
    {
        var caracteres = Characters(text);
        var palavras = Words(text);

        return $"{Numero(caracteres)} {(caracteres == 1 ? "caractere" : "caracteres")} · "
            + $"{Numero(palavras)} {(palavras == 1 ? "palavra" : "palavras")}";
    }

    private static string Numero(int n) => n.ToString("N0", Brasil);
}
