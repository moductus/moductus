using System.Diagnostics;
using Moductus.Core.Commands;
using Moductus.Core.Text;
using Moductus.UI.Archetypes;
using Moductus.UI.Modules;

namespace Moductus.Modules.Palette;

/// <summary>
/// Executa um comando num console visível e avisa no HUD quando termina,
/// com o tempo gasto e o código de saída. Trivial, e resolve dor real:
/// disparar o build longo e ir fazer outra coisa.
/// </summary>
internal sealed class RunNotify(ModuleContext context)
{
    public const string Owner = "runnotify";

    public void Register() =>
        context.Commands.Register(Owner, new PaletteCommand(
            "run",
            "Executar comando…",
            "Abre um console, roda, e avisa quando terminar",
            null,
            PedirComando));

    private void PedirComando()
    {
        var palette = context.Archetypes.Palette;

        palette.Placeholder = "comando e Enter — ex.: dotnet build";
        palette.EmptyText = "Digite o comando e pressione Enter.";
        palette.SetItems([]);
        palette.QuerySubmit = Executar;
        palette.Present();
    }

    private bool Executar(string comando)
    {
        var hud = context.Archetypes.Hud;
        var cronometro = Stopwatch.StartNew();

        Process processo;
        try
        {
            processo = Process.Start(new ProcessStartInfo("cmd.exe", $"/c {comando}")
            {
                UseShellExecute = true,
                WorkingDirectory = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),
            }) ?? throw new InvalidOperationException("o processo não iniciou");
        }
        catch (Exception e)
        {
            hud.Flash("O comando não iniciou", Summary.OneLine(e.Message, 80), HudTone.Alerta);
            return false;
        }

        processo.EnableRaisingEvents = true;
        processo.Exited += (_, _) =>
        {
            cronometro.Stop();
            var codigo = processo.ExitCode;
            var tempo = cronometro.Elapsed.TotalMinutes >= 1
                ? $"{(int)cronometro.Elapsed.TotalMinutes}m{cronometro.Elapsed.Seconds:00}s"
                : $"{cronometro.Elapsed.TotalSeconds:F1}s";

            hud.Dispatcher.BeginInvoke(() =>
            {
                if (codigo == 0)
                {
                    hud.Flash($"Terminou em {tempo}", $"{comando} — saiu sem erro.", HudTone.Sucesso);
                }
                else
                {
                    hud.Flash($"Falhou em {tempo}", $"{comando} — código {codigo}.", HudTone.Alerta);
                }
            });

            processo.Dispose();
        };

        hud.Flash("Rodando", $"{comando} — aviso aqui quando terminar.", HudTone.Neutro);
        return true;
    }
}
