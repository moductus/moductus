using System.Globalization;
using System.Windows;
using Moductus.Core.Clipboard;
using Moductus.Core.Commands;
using Moductus.Core.Text;
using Moductus.UI.Archetypes;
using Moductus.UI.Modules;

// WPF tem um System.Windows.Expression próprio, sem relação com este.
using Expression = Moductus.Core.Text.Expression;

namespace Moductus.Modules.Palette;

/// <summary>
/// Conta direto na busca. O que parece expressão aritmética vira o primeiro
/// resultado, já resolvido, e Enter copia o valor.
/// </summary>
internal sealed class Calculator(ModuleContext context)
{
    public const string Owner = "calculator";

    /// <summary>Dez casas bastam para conta de cabeça e cortam o lixo do binário.</summary>
    private const string Formato = "0.##########";

    public void Register() => context.Commands.RegisterProvider(Owner, Procurar);

    /// <summary>
    /// Número solto não é conta: quem digita "50" está buscando, não
    /// somando. Exige dígito e um operador que não seja só o sinal inicial.
    /// </summary>
    private static bool ParecemConta(string q) =>
        q.Length >= 2
        && q.Any(char.IsAsciiDigit)
        && (q.IndexOfAny(['+', '*', '/', '%', '(']) >= 0 || q.IndexOf('-', 1) > 0);

    private static string Formatar(double valor)
    {
        // O zero negativo existe em double e imprimiria "-0".
        var n = valor == 0 ? 0d : valor;
        return n.ToString(Formato, CultureInfo.CurrentCulture);
    }

    private IEnumerable<PaletteCommand> Procurar(string consulta)
    {
        var q = consulta.Trim();

        if (!ParecemConta(q) || !Expression.TryEvaluate(q, out var valor))
        {
            return [];
        }

        var texto = Formatar(valor);

        return
        [
            new PaletteCommand("calc", texto, q, "Enter copia", () => Copiar(texto), Primary: true),
        ];
    }

    private void Copiar(string valor)
    {
        var hud = context.Archetypes.Hud;

        if (!ClipboardText.TryWrite(valor, out var erro))
        {
            hud.Flash("Não consegui escrever no clipboard", Summary.OneLine(erro, 80), HudTone.Alerta);
            return;
        }

        hud.Flash("Resultado copiado", valor, HudTone.Sucesso);
    }
}
