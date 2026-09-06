using System.Globalization;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace Moductus.Core.Text;

/// <summary>
/// As transformações do PasteFlow. Puras: texto entra, texto sai. Quem lê e
/// escreve o clipboard é a Palette.
/// </summary>
public static class ClipboardTransforms
{
    private static readonly JsonSerializerOptions Indentado = new() { WriteIndented = true };

    /// <summary>"Olá, Mundo!" → "ola-mundo".</summary>
    public static string Slug(string text)
    {
        var sem = SemAcentos(text).ToLowerInvariant();
        var sb = new StringBuilder(sem.Length);
        var pendente = false;

        foreach (var c in sem)
        {
            if (char.IsAsciiLetterOrDigit(c))
            {
                if (pendente && sb.Length > 0)
                {
                    sb.Append('-');
                }

                sb.Append(c);
                pendente = false;
            }
            else
            {
                pendente = true;
            }
        }

        return sb.ToString();
    }

    /// <summary>"nome do campo" → "nomeDoCampo".</summary>
    public static string CamelCase(string text)
    {
        var partes = Palavras(text);
        if (partes.Count == 0)
        {
            return string.Empty;
        }

        var sb = new StringBuilder(partes[0].ToLowerInvariant());
        foreach (var p in partes.Skip(1))
        {
            sb.Append(char.ToUpperInvariant(p[0])).Append(p[1..].ToLowerInvariant());
        }

        return sb.ToString();
    }

    /// <summary>"nome do campo" → "nome_do_campo".</summary>
    public static string SnakeCase(string text) =>
        string.Join('_', Palavras(text).Select(p => p.ToLowerInvariant()));

    /// <summary>Indenta. Lança <see cref="JsonException"/> se não for JSON.</summary>
    public static string FormatJson(string text) =>
        (JsonNode.Parse(text) ?? throw new JsonException("vazio")).ToJsonString(Indentado);

    /// <summary>Base64 comum ou URL-safe, com ou sem padding, para texto UTF-8.</summary>
    public static string DecodeBase64(string text)
    {
        var s = text.Trim().Replace('-', '+').Replace('_', '/');
        s = s.PadRight(s.Length + (4 - s.Length % 4) % 4, '=');
        return Encoding.UTF8.GetString(Convert.FromBase64String(s));
    }

    /// <summary>Header e payload de um JWT, cada um como JSON indentado.</summary>
    public static string DecodeJwt(string text)
    {
        var partes = text.Trim().Split('.');
        if (partes.Length < 2)
        {
            throw new FormatException("JWT precisa de pelo menos duas partes separadas por ponto.");
        }

        var header = FormatJson(DecodeBase64(partes[0]));
        var payload = FormatJson(DecodeBase64(partes[1]));
        return $"{header}\n\n{payload}";
    }

    private static List<string> Palavras(string text)
    {
        var lista = new List<string>();
        var atual = new StringBuilder();

        void Fecha()
        {
            if (atual.Length > 0)
            {
                lista.Add(atual.ToString());
                atual.Clear();
            }
        }

        foreach (var c in SemAcentos(text))
        {
            if (char.IsAsciiLetterOrDigit(c))
            {
                // "nomeDoCampo" também quebra em maiúscula.
                if (char.IsUpper(c) && atual.Length > 0 && char.IsLower(atual[^1]))
                {
                    Fecha();
                }

                atual.Append(c);
            }
            else
            {
                Fecha();
            }
        }

        Fecha();
        return lista;
    }

    private static string SemAcentos(string text)
    {
        var normalizado = text.Normalize(NormalizationForm.FormD);
        var sb = new StringBuilder(normalizado.Length);

        foreach (var c in normalizado)
        {
            if (CharUnicodeInfo.GetUnicodeCategory(c) != UnicodeCategory.NonSpacingMark)
            {
                sb.Append(c);
            }
        }

        return sb.ToString().Normalize(NormalizationForm.FormC);
    }
}
