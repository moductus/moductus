using System.Windows;
using System.Windows.Input;
using Moductus.Core.Config;
using Moductus.Core.Hotkeys;
using Moductus.Core.Startup;

namespace Moductus.App;

public partial class SettingsWindow : Window
{
    private readonly Autostart _autostart;
    private readonly HotkeyRegistry _hotkeys;

    internal SettingsWindow(
        Autostart autostart,
        HotkeyRegistry hotkeys,
        ConfigLocation location,
        string? configWarning)
    {
        InitializeComponent();

        _autostart = autostart;
        _hotkeys = hotkeys;

        if (configWarning is not null)
        {
            Aviso.Text = configWarning;
            Aviso.Visibility = Visibility.Visible;
        }

        Rodape.Text = location.Portable
            ? $"Modo portable — configuração em {location.Path}"
            : $"Configuração em {location.Path}";

        Refresh();
    }

    private void Refresh()
    {
        var estado = _autostart.State;

        IniciarComWindows.IsChecked = estado is AutostartState.On or AutostartState.DisabledByUser;

        AutostartDetalhe.Text = estado switch
        {
            AutostartState.On => "Sobe junto com o Windows.",
            AutostartState.Off => "Não sobe com o Windows.",
            AutostartState.DisabledByUser =>
                "Está desativado na aba Inicializar do Gerenciador de Tarefas. Desmarque e marque de novo para reativar.",
            AutostartState.PointsElsewhere =>
                "A entrada de inicialização aponta para outra cópia do Moductus. Desmarque e marque de novo para corrigir.",
            _ => string.Empty,
        };

        Atalhos.ItemsSource = _hotkeys.All.Select(r => r.ToString()).ToList();
    }

    private void OnAutostartClick(object sender, RoutedEventArgs e)
    {
        if (IniciarComWindows.IsChecked == true)
        {
            _autostart.Enable();
        }
        else
        {
            _autostart.Disable();
        }

        Refresh();
    }

    // Esc fecha, sempre, sem confirmar nada.
    private void OnKeyDown(object sender, KeyEventArgs e)
    {
        if (e.Key == Key.Escape)
        {
            Close();
        }
    }
}
