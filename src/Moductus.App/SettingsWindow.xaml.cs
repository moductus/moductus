using System.Windows;
using System.Windows.Input;
using Moductus.Core.Config;
using Moductus.Core.Hotkeys;
using Moductus.Core.Startup;
using Moductus.UI;

namespace Moductus.App;

public partial class SettingsWindow : Window
{
    private readonly Autostart _autostart;
    private readonly HotkeyRegistry _hotkeys;
    private readonly Func<HotkeyRegistration> _leader;
    private readonly Func<HotkeyBinding, HotkeyRegistration> _rebindLeader;

    internal SettingsWindow(
        Autostart autostart,
        HotkeyRegistry hotkeys,
        ConfigLocation location,
        Theme theme,
        string? configWarning,
        Func<HotkeyRegistration> leader,
        Func<HotkeyBinding, HotkeyRegistration> rebindLeader)
    {
        InitializeComponent();

        _autostart = autostart;
        _hotkeys = hotkeys;
        _leader = leader;
        _rebindLeader = rebindLeader;

        SourceInitialized += (_, _) => TitleBar.Sync(this, theme);

        if (configWarning is not null)
        {
            Aviso.Text = configWarning;
            AvisoBorda.Visibility = Visibility.Visible;
        }

        Rodape.Text = location.Portable
            ? $"Modo portable — configuração em {location.Path}"
            : $"Configuração em {location.Path}";

        Refresh();
    }

    private sealed record AtalhoItem(string Combinacao, string Detalhe, bool Conflito);

    private void Refresh()
    {
        var lider = _leader();
        Lider.Text = lider.Binding.ToString();
        LiderDetalhe.Text = lider.Active
            ? "Clique no campo e pressione a combinação nova."
            : $"Em conflito: {lider.ConflictDetail}. Clique no campo e pressione outra combinação.";

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

        Atalhos.ItemsSource = _hotkeys.All
            .Select(r => new AtalhoItem(
                r.Binding.ToString(),
                r.Active ? r.Owner : $"{r.Owner} — em conflito: {r.ConflictDetail}",
                !r.Active))
            .ToList();
    }

    private void OnLiderKeyDown(object sender, KeyEventArgs e)
    {
        e.Handled = true;

        // Alt chega como Key.System com a tecla real em SystemKey.
        var key = e.Key == Key.System ? e.SystemKey : e.Key;

        if (EhModificador(key) || key == Key.Escape)
        {
            return;
        }

        var mods = HotkeyModifiers.None;
        if (Keyboard.Modifiers.HasFlag(ModifierKeys.Control)) mods |= HotkeyModifiers.Control;
        if (Keyboard.Modifiers.HasFlag(ModifierKeys.Alt)) mods |= HotkeyModifiers.Alt;
        if (Keyboard.Modifiers.HasFlag(ModifierKeys.Shift)) mods |= HotkeyModifiers.Shift;
        if (Keyboard.Modifiers.HasFlag(ModifierKeys.Windows)) mods |= HotkeyModifiers.Windows;

        var binding = new HotkeyBinding(mods, (uint)KeyInterop.VirtualKeyFromKey(key));

        if (!binding.HasModifier)
        {
            LiderDetalhe.Text = "Precisa de pelo menos um modificador: Ctrl, Alt, Shift ou Win.";
            return;
        }

        var resultado = _rebindLeader(binding);
        Refresh();

        if (!resultado.Active)
        {
            LiderDetalhe.Text = $"{binding} está em conflito: {resultado.ConflictDetail}. A anterior foi mantida.";
        }
    }

    private static bool EhModificador(Key key) => key is
        Key.LeftCtrl or Key.RightCtrl or
        Key.LeftAlt or Key.RightAlt or
        Key.LeftShift or Key.RightShift or
        Key.LWin or Key.RWin;

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
