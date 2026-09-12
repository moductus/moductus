using System.Diagnostics;
using System.IO;
using Moductus.Core.Commands;
using Moductus.UI.Archetypes;
using Moductus.UI.Modules;

namespace Moductus.Modules.Palette;

/// <summary>
/// Acha arquivo e pasta pelo nome e abre no Explorer com o item já
/// selecionado.
/// </summary>
/// <remarks>
/// O escopo é deliberadamente estreito — quatro pastas do perfil, três
/// níveis, teto de resultados. É a diferença entre responder em dezenas de
/// milissegundos e varrer o disco inteiro travando a digitação. A varredura
/// roda em <c>Task.Run</c>; a lista aparece quando o resultado chega.
/// </remarks>
internal sealed class FileFinder(ModuleContext context)
{
    public const string Owner = "filefinder";

    /// <summary>Menos que isto casa com meio perfil do usuário.</summary>
    private const int MinimoCaracteres = 3;

    private const int Teto = 40;
    private const int Profundidade = 3;

    private static readonly string[] Subpastas = ["Desktop", "Documents", "Downloads", "Pictures"];

    private string _consulta = string.Empty;
    private IReadOnlyList<Achado> _resultado = [];
    private bool _varrendo;

    /// <summary>A varredura terminou depois da digitação; a Palette refaz a lista.</summary>
    public Action? Atualizou { get; set; }

    public void Register() => context.Commands.RegisterProvider(Owner, Procurar);

    private static IReadOnlyList<Achado> Coletar(string q)
    {
        var raiz = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);

        if (string.IsNullOrEmpty(raiz))
        {
            return [];
        }

        var opcoes = new EnumerationOptions
        {
            IgnoreInaccessible = true,
            RecurseSubdirectories = true,
            MaxRecursionDepth = Profundidade,
        };

        List<Achado> achados = [];

        foreach (var sub in Subpastas)
        {
            var pasta = Path.Combine(raiz, sub);

            if (!Directory.Exists(pasta))
            {
                continue;
            }

            try
            {
                // FileSystemInfo já traz o atributo da própria enumeração:
                // perguntar "é pasta?" depois custaria um acesso a disco por item.
                foreach (var item in new DirectoryInfo(pasta).EnumerateFileSystemInfos("*", opcoes))
                {
                    if (!item.Name.Contains(q, StringComparison.CurrentCultureIgnoreCase))
                    {
                        continue;
                    }

                    achados.Add(new Achado(item.Name, item.FullName, item is DirectoryInfo));

                    if (achados.Count >= Teto)
                    {
                        return achados;
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

        return achados;
    }

    private static string Detalhe(Achado achado)
    {
        var pasta = Path.GetDirectoryName(achado.Caminho) ?? string.Empty;
        return achado.EhPasta ? $"Pasta · {pasta}" : pasta;
    }

    private static string Resumo(string t, int max)
    {
        var linha = t.ReplaceLineEndings(" ").Trim();
        return linha.Length > max ? linha[..max] + "…" : linha;
    }

    private IEnumerable<PaletteCommand> Procurar(string consulta)
    {
        var q = consulta.Trim();

        if (q.Length < MinimoCaracteres)
        {
            _consulta = string.Empty;
            _resultado = [];
            return [];
        }

        if (!string.Equals(q, _consulta, StringComparison.CurrentCultureIgnoreCase))
        {
            _consulta = q;
            _resultado = [];
            Disparar(q);
            return [];
        }

        return
        [
            .. _resultado.Select(a => new PaletteCommand(
                $"file:{a.Caminho}",
                a.Nome,
                Detalhe(a),
                null,
                () => Abrir(a))),
        ];
    }

    /// <summary>
    /// Uma varredura por vez: quem digita rápido geraria uma por tecla. A
    /// que estiver correndo recomeça com a consulta atual ao terminar.
    /// </summary>
    private void Disparar(string q)
    {
        if (_varrendo)
        {
            return;
        }

        _varrendo = true;
        Task.Run(() => Varrer(q));
    }

    private void Varrer(string q)
    {
        var achados = Coletar(q);

        // Todo o estado é tocado na thread de UI; a varredura só entrega.
        context.Archetypes.Palette.Dispatcher.BeginInvoke(() =>
        {
            _varrendo = false;

            if (!string.Equals(q, _consulta, StringComparison.CurrentCultureIgnoreCase))
            {
                if (_consulta.Length >= MinimoCaracteres)
                {
                    Disparar(_consulta);
                }

                return;
            }

            _resultado = achados;
            Atualizou?.Invoke();
        });
    }

    private void Abrir(Achado achado)
    {
        try
        {
            Process.Start(new ProcessStartInfo("explorer.exe", $"/select,\"{achado.Caminho}\"")
            {
                UseShellExecute = true,
            })?.Dispose();
        }
        catch (Exception e)
        {
            context.Archetypes.Hud.Flash($"Não deu para abrir {achado.Nome}", Resumo(e.Message, 80), HudTone.Alerta);
        }
    }

    private sealed record Achado(string Nome, string Caminho, bool EhPasta);
}
