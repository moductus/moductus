using System.Windows.Threading;

namespace Moductus.UI.Archetypes;

/// <summary>
/// Dono dos quatro singletons. Constrói e pré-aquece em tempo ocioso, fora
/// do caminho crítico do startup.
/// </summary>
public sealed class ArchetypeHost : IDisposable
{
    private PaletteWindow? _palette;
    private HudWindow? _hud;
    private PanelWindow? _panel;
    private CanvasWindow? _canvas;

    public PaletteWindow Palette => _palette ??= new PaletteWindow();

    public HudWindow Hud => _hud ??= new HudWindow();

    public PanelWindow Panel => _panel ??= new PanelWindow();

    public CanvasWindow Canvas => _canvas ??= new CanvasWindow();

    /// <summary>
    /// Agenda em <see cref="DispatcherPriority.ApplicationIdle"/>: o ícone de
    /// bandeja já apareceu e ninguém aperta hotkey nos primeiros segundos.
    /// </summary>
    public void Prewarm(Dispatcher dispatcher) =>
        dispatcher.BeginInvoke(DispatcherPriority.ApplicationIdle, () =>
        {
            // A primeira paga o framework (~490ms medidos); as outras custam
            // milissegundos. Palette vai primeiro porque é a mais invocada.
            Palette.Prewarm();
            Hud.Prewarm();
            Panel.Prewarm();
            Canvas.Prewarm();
        });

    public void Dispose()
    {
        _palette?.Close();
        _hud?.Close();
        _panel?.Close();
        _canvas?.Close();
    }
}
