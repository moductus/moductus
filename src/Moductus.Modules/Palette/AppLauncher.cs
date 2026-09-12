using System.Diagnostics;
using System.IO;
using Moductus.Core.Commands;
using Moductus.UI.Archetypes;
using Moductus.UI.Modules;

namespace Moductus.Modules.Palette;

/// <summary>
/// Abre programa instalado. A fonte é o Menu Iniciar — as duas pastas de
/// atalho, a da máquina e a do usuário —, a mesma que PowerToys Run e Flow
/// Launcher usam: é onde todo instalador deixa rastro, sem consultar o
/// registro nem o WinRT.
/// </summary>
/// <remarks>
/// Varrer o Menu Iniciar é I/O e não cabe no orçamento de 300ms do startup:
/// o índice é lido em <c>Task.Run</c> no primeiro <c>Invoke</c> da Palette e
/// vive pela sessão. Enquanto não chega, a Palette só não mostra apps.
/// </remarks>
internal sealed class AppLauncher(ModuleContext context)
{
    public const string Owner = "applauncher";

    private const int Teto = 12;

    private IReadOnlyList<Atalho> _indice = [];
    private bool _pedido;

    /// <summary>A varredura terminou depois da digitação; a Palette refaz a lista.</summary>
    public Action? Atualizou { get; set; }

    public void Register() => context.Commands.RegisterProvider(Owner, Procurar);

    /// <summary>Dispara a leitura do índice. Chamar só do <c>Invoke</c>.</summary>
    public void Aquecer()
    {
        if (_pedido)
        {
            return;
        }

        _pedido = true;
        Task.Run(Carregar);
    }

    private static IReadOnlyList<Atalho> Varrer()
    {
        string[] pastas =
        [
            Environment.GetFolderPath(Environment.SpecialFolder.CommonStartMenu),
            Environment.GetFolderPath(Environment.SpecialFolder.StartMenu),
        ];

        var opcoes = new EnumerationOptions { IgnoreInaccessible = true, RecurseSubdirectories = true };
        Dictionary<string, Atalho> achados = new(StringComparer.CurrentCultureIgnoreCase);

        foreach (var pasta in pastas)
        {
            if (string.IsNullOrEmpty(pasta) || !Directory.Exists(pasta))
            {
                continue;
            }

            try
            {
                foreach (var caminho in Directory.EnumerateFiles(pasta, "*.lnk", opcoes))
                {
                    var nome = Path.GetFileNameWithoutExtension(caminho);

                    if (nome.Length > 0)
                    {
                        achados.TryAdd(nome, new Atalho(nome, caminho));
                    }
                }
            }
            catch (IOException)
            {
            }
            catch (UnauthorizedAccessException)
            {
            }
        }

        return [.. achados.Values.OrderBy(a => a.Nome, StringComparer.CurrentCultureIgnoreCase)];
    }

    private static int Nota(string nome, string q)
    {
        const StringComparison cmp = StringComparison.CurrentCultureIgnoreCase;

        if (nome.StartsWith(q, cmp))
        {
            return 0;
        }

        if (nome.Split(' ', StringSplitOptions.RemoveEmptyEntries).Any(p => p.StartsWith(q, cmp)))
        {
            return 1;
        }

        return nome.Contains(q, cmp) ? 2 : -1;
    }

    private static string Resumo(string t, int max)
    {
        var linha = t.ReplaceLineEndings(" ").Trim();
        return linha.Length > max ? linha[..max] + "…" : linha;
    }

    private void Carregar()
    {
        var lido = Varrer();

        context.Archetypes.Palette.Dispatcher.BeginInvoke(() =>
        {
            _indice = lido;
            Atualizou?.Invoke();
        });
    }

    private IEnumerable<PaletteCommand> Procurar(string consulta)
    {
        var q = consulta.Trim();

        if (q.Length == 0 || _indice.Count == 0)
        {
            return [];
        }

        return
        [
            .. _indice
                .Select(a => (Atalho: a, Nota: Nota(a.Nome, q)))
                .Where(x => x.Nota >= 0)
                .OrderBy(x => x.Nota)
                .ThenBy(x => x.Atalho.Nome, StringComparer.CurrentCultureIgnoreCase)
                .Take(Teto)
                .Select(x => new PaletteCommand(
                    $"app:{x.Atalho.Caminho}",
                    x.Atalho.Nome,
                    "Abrir aplicativo",
                    null,
                    () => Abrir(x.Atalho))),
        ];
    }

    private void Abrir(Atalho atalho)
    {
        try
        {
            // UseShellExecute resolve o .lnk sozinho; sem ele seria COM.
            Process.Start(new ProcessStartInfo(atalho.Caminho) { UseShellExecute = true })?.Dispose();
        }
        catch (Exception e)
        {
            context.Archetypes.Hud.Flash($"Não deu para abrir {atalho.Nome}", Resumo(e.Message, 80), HudTone.Alerta);
        }
    }

    private sealed record Atalho(string Nome, string Caminho);
}
