using System.Windows;
using Moductus.Core.Commands;
using Moductus.Core.Text;
using Moductus.UI.Modules;

namespace Moductus.Modules.Palette;

/// <summary>
/// Transformações do clipboard como comandos da Palette. Lê, transforma,
/// escreve de volta, e o HUD mostra o começo do resultado. Nunca cola:
/// injetar Ctrl+V no app do usuário é o tipo de coisa que anti-cheat marca.
/// </summary>
internal sealed class PasteFlow(ModuleContext context)
{
    public const string Owner = "pasteflow";

    private const int Preview = 48;

    public void Register()
    {
        Add("plain", "Clipboard: só texto", "Descarta formatação (HTML, RTF), mantém o texto", t => t);
        Add("slug", "Clipboard: slug", "\"Olá, Mundo!\" vira \"ola-mundo\"", ClipboardTransforms.Slug);
        Add("camel", "Clipboard: camelCase", "\"nome do campo\" vira \"nomeDoCampo\"", ClipboardTransforms.CamelCase);
        Add("snake", "Clipboard: snake_case", "\"nome do campo\" vira \"nome_do_campo\"", ClipboardTransforms.SnakeCase);
        Add("json", "Clipboard: formatar JSON", "Indenta o JSON copiado", ClipboardTransforms.FormatJson);
        Add("base64", "Clipboard: decodificar Base64", "Também aceita URL-safe e sem padding", ClipboardTransforms.DecodeBase64);
        Add("jwt", "Clipboard: decodificar JWT", "Header e payload, indentados", ClipboardTransforms.DecodeJwt);
    }

    private void Add(string id, string text, string detail, Func<string, string> transform) =>
        context.Commands.Register(Owner, new PaletteCommand(id, text, detail, null, () => Aplicar(transform)));

    private void Aplicar(Func<string, string> transform)
    {
        var hud = context.Archetypes.Hud;

        string entrada;
        try
        {
            entrada = Clipboard.ContainsText() ? Clipboard.GetText() : string.Empty;
        }
        catch (Exception e)
        {
            hud.Flash($"Clipboard indisponível: {e.Message}");
            return;
        }

        if (string.IsNullOrWhiteSpace(entrada))
        {
            hud.Flash("Nada de texto no clipboard.");
            return;
        }

        string saida;
        try
        {
            saida = transform(entrada);
        }
        catch (Exception e)
        {
            hud.Flash($"Não deu: {e.Message}");
            return;
        }

        try
        {
            Clipboard.SetText(saida);
        }
        catch (Exception e)
        {
            hud.Flash($"Não consegui escrever no clipboard: {e.Message}");
            return;
        }

        var linha = saida.ReplaceLineEndings(" ").Trim();
        hud.Flash(linha.Length > Preview ? $"Copiado: {linha[..Preview]}…" : $"Copiado: {linha}");
    }
}
