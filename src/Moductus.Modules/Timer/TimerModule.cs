using System.Windows.Controls;
using System.Windows.Threading;
using Moductus.Core.Commands;
using Moductus.Core.Modules;
using Moductus.Core.Tray;
using Moductus.UI.Modules;

namespace Moductus.Modules.Timer;

/// <summary>
/// Pomodoro desenhado dentro do ícone da bandeja. O arco fecha conforme o
/// tempo passa; nenhuma janela fica aberta.
/// </summary>
/// <remarks>
/// O ícone é redesenhado só quando o arco mudaria de verdade — um por cento
/// de 25 minutos são 15 segundos, então uma volta inteira custa cem
/// redesenhos, não mil e quinhentos.
/// </remarks>
public sealed class TimerModule(ModuleContext context) : IModule
{
    /// <summary>Abaixo do Mic (100): perder a contagem de vista custa menos.</summary>
    public const int TrayPriority = 50;

    private static readonly TimeSpan Foco = TimeSpan.FromMinutes(25);
    private static readonly TimeSpan Pausa = TimeSpan.FromMinutes(5);

    private readonly DispatcherTimer _tique = new() { Interval = TimeSpan.FromSeconds(1) };
    private IDisposable? _claim;
    private DateTimeOffset _fim;
    private TimeSpan _total;
    private string _rotulo = string.Empty;
    private int _ultimoPercentual = -1;

    public string Id => "timer";

    public string Name => "Timer";

    public string Description => "Pomodoro no ícone da bandeja";

    public ModuleArchetype Archetype => ModuleArchetype.Hud;

    public char SuggestedLeaderKey => 't';

    public bool HasSurface => false;

    private bool Rodando => _claim is not null;

    public void Enable()
    {
        _tique.Tick += (_, _) => Tique();

        context.Commands.Register(Id, new PaletteCommand(
            "timer:focus", "Pomodoro: 25 minutos de foco", "O arco na bandeja mostra quanto falta", null,
            () => Iniciar(Foco, "Foco")));

        context.Commands.Register(Id, new PaletteCommand(
            "timer:break", "Pomodoro: 5 minutos de pausa", null, null,
            () => Iniciar(Pausa, "Pausa")));

        context.Commands.Register(Id, new PaletteCommand(
            "timer:stop", "Pomodoro: parar", "Cancela a contagem em andamento", null, Parar));
    }

    public void Disable()
    {
        context.Commands.Unregister(Id);
        _tique.Stop();
        _claim?.Dispose();
        _claim = null;
    }

    /// <summary>A tecla líder alterna: rodando para, parado começa o foco.</summary>
    public void Invoke()
    {
        if (Rodando)
        {
            Parar();
        }
        else
        {
            Iniciar(Foco, "Foco");
        }
    }

    private void Iniciar(TimeSpan duracao, string rotulo)
    {
        _total = duracao;
        _fim = DateTimeOffset.Now + duracao;
        _rotulo = rotulo;
        _ultimoPercentual = -1;

        _claim ??= context.Tray.Claim(Id, TrayPriority, Desenhar, Tooltip());
        _tique.Start();

        Redesenhar();
        context.Archetypes.Hud.Flash($"{rotulo}: {duracao.TotalMinutes:F0} minutos");
    }

    private void Parar()
    {
        if (!Rodando)
        {
            context.Archetypes.Hud.Flash("Nenhuma contagem em andamento.");
            return;
        }

        _tique.Stop();
        _claim?.Dispose();
        _claim = null;
        context.Archetypes.Hud.Flash("Contagem cancelada.");
    }

    private void Tique()
    {
        if (Restante() > TimeSpan.Zero)
        {
            Redesenhar();
            return;
        }

        var rotulo = _rotulo;
        _tique.Stop();
        _claim?.Dispose();
        _claim = null;

        context.Archetypes.Hud.Flash($"{rotulo} terminado.");
    }

    private TimeSpan Restante()
    {
        var falta = _fim - DateTimeOffset.Now;
        return falta > TimeSpan.Zero ? falta : TimeSpan.Zero;
    }

    private double Fracao() => _total <= TimeSpan.Zero
        ? 0
        : Math.Clamp(1 - Restante().TotalSeconds / _total.TotalSeconds, 0, 1);

    private void Redesenhar()
    {
        var percentual = (int)(Fracao() * 100);
        if (percentual == _ultimoPercentual)
        {
            return;
        }

        _ultimoPercentual = percentual;
        context.Tray.Refresh(Id);
    }

    private System.Windows.Media.Imaging.BitmapSource Desenhar(int tamanho, bool claro) =>
        Mark.Render(tamanho, claro, progress: Math.Max(Fracao(), 0.001));

    private string Tooltip()
    {
        var falta = Restante();
        return $"Moductus — {_rotulo}, faltam {falta.Minutes:00}:{falta.Seconds:00}";
    }

    public UserControl? BuildSettings() => null;
}
