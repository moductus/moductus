using System.Diagnostics;
using System.IO;
using System.Text.Json.Nodes;
using Moductus.Core.Commands;
using Moductus.Core.Text;
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

    private const string ChaveRecentes = "recentApps";

    private const int Teto = 12;

    /// <summary>Quantos aparecem na Palette aberta sem se digitar nada.</summary>
    private const int TetoRecentes = 4;

    /// <summary>Quantos ficam guardados — os de baixo ainda desempatam a busca.</summary>
    private const int MemoriaRecentes = 40;

    private IReadOnlyList<Atalho> _indice = [];
    private List<string> _recentes = [];
    private bool _pedido;
    private bool _leuRecentes;

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

        if (q.Length == 0)
        {
            return Recentes();
        }

        if (_indice.Count == 0)
        {
            return [];
        }

        return
        [
            .. _indice
                .Select(a => (Atalho: a, Nota: Nota(a.Nome, q)))
                .Where(x => x.Nota >= 0)
                .OrderBy(x => x.Nota)
                // Entre dois que casam igual, ganha o que foi aberto por último.
                .ThenBy(x => Posicao(x.Atalho.Caminho))
                .ThenBy(x => x.Atalho.Nome, StringComparer.CurrentCultureIgnoreCase)
                .Take(Teto)
                .Select(x => Comando(x.Atalho)),
        ];
    }

    /// <summary>
    /// A Palette aberta sem texto nenhum: o que se abriu por último, do mais
    /// recente para o mais antigo. Não espera a varredura do Menu Iniciar —
    /// o nome sai do próprio caminho guardado, então a lista está pronta no
    /// primeiro quadro.
    /// </summary>
    private IEnumerable<PaletteCommand> Recentes()
    {
        LerRecentes();

        return
        [
            .. _recentes
                .Take(TetoRecentes)
                .Select(caminho => Comando(new Atalho(Path.GetFileNameWithoutExtension(caminho), caminho))),
        ];
    }

    private PaletteCommand Comando(Atalho atalho)
        => new($"app:{atalho.Caminho}", atalho.Nome, "Abrir aplicativo", null, () => Abrir(atalho));

    /// <summary>Onde o atalho está na lista de recentes; fora dela, no fim da fila.</summary>
    private int Posicao(string caminho)
    {
        LerRecentes();

        var i = _recentes.IndexOf(caminho);
        return i < 0 ? int.MaxValue : i;
    }

    private void Abrir(Atalho atalho)
    {
        try
        {
            // UseShellExecute resolve o .lnk sozinho; sem ele seria COM.
            Process.Start(new ProcessStartInfo(atalho.Caminho) { UseShellExecute = true })?.Dispose();
            Lembrar(atalho.Caminho);
        }
        catch (Exception e)
        {
            // Programa desinstalado deixa o atalho para trás. Some da lista em
            // vez de continuar oferecendo o que não abre mais.
            Esquecer(atalho.Caminho);
            context.Archetypes.Hud.Flash($"Não deu para abrir {atalho.Nome}", Summary.OneLine(e.Message, 80), HudTone.Alerta);
        }
    }

    // ---- Os que se abriu por último -------------------------------------------

    private void LerRecentes()
    {
        if (_leuRecentes)
        {
            return;
        }

        _leuRecentes = true;

        if (context.ConfigScope(PaletteModule.Id)[ChaveRecentes] is not JsonArray guardados)
        {
            return;
        }

        _recentes = [.. guardados
            .Select(n => n?.GetValue<string>())
            .Where(c => !string.IsNullOrWhiteSpace(c))
            .Select(c => c!)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .Take(MemoriaRecentes)];
    }

    private void Lembrar(string caminho)
    {
        LerRecentes();

        _recentes.RemoveAll(c => string.Equals(c, caminho, StringComparison.OrdinalIgnoreCase));
        _recentes.Insert(0, caminho);

        if (_recentes.Count > MemoriaRecentes)
        {
            _recentes.RemoveRange(MemoriaRecentes, _recentes.Count - MemoriaRecentes);
        }

        GravarRecentes();
    }

    private void Esquecer(string caminho)
    {
        LerRecentes();

        if (_recentes.RemoveAll(c => string.Equals(c, caminho, StringComparison.OrdinalIgnoreCase)) > 0)
        {
            GravarRecentes();
        }
    }

    private void GravarRecentes()
    {
        context.ConfigScope(PaletteModule.Id)[ChaveRecentes] = new JsonArray([.. _recentes.Select(c => JsonValue.Create(c))]);
        context.SaveConfig();
    }

    private sealed record Atalho(string Nome, string Caminho);
}
