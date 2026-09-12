using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using Moductus.Core.Hotkeys;
using Moductus.Core.Startup;
using Moductus.UI;

namespace Moductus.App;

public partial class SettingsWindow : Window
{
    private readonly SettingsModel _model;
    private readonly Dictionary<string, UserControl?> _paineis = [];
    private string? _ajusteAberto;

    internal SettingsWindow(SettingsModel model)
    {
        InitializeComponent();
        _model = model;

        SourceInitialized += (_, _) => TitleBar.Sync(this, model.Theme);

        if (model.ConfigWarning is not null)
        {
            Aviso.Text = model.ConfigWarning;
            AvisoBorda.Visibility = Visibility.Visible;
        }

        Rodape.Text = model.Location.Portable
            ? $"Modo portable — configuração em {model.Location.Path}"
            : $"Configuração em {model.Location.Path}";

        Refresh();
    }

    private sealed record AtalhoItem(string Combinacao, string Detalhe, bool Conflito);

    private sealed record ModuloItem(string Id, string Nome, bool Ativo, string Letra, string Detalhe, bool Conflito, bool TemAjuste);

    private void Refresh()
    {
        var lider = _model.Leader();
        Lider.Text = lider.Binding.ToString();
        LiderDetalhe.Text = lider.Active
            ? "Clique no campo e pressione a combinação nova."
            : $"Em conflito: {lider.ConflictDetail}. Clique no campo e pressione outra combinação.";

        var estado = _model.Autostart.State;

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

        var letras = _model.Letters.All.ToDictionary(r => r.ModuleId);

        Modulos.ItemsSource = _model.Modules
            .Select(m =>
            {
                var ativo = _model.IsModuleEnabled(m.Id);
                letras.TryGetValue(m.Id, out var letra);

                return new ModuloItem(
                    m.Id,
                    m.Name,
                    ativo,
                    ativo && letra is not null ? letra.Key.ToString().ToUpperInvariant() : "—",
                    letra is { Active: false } ? $"em conflito: {letra.ConflictDetail}" : m.Description,
                    letra is { Active: false },
                    ativo && Painel(m.Id) is not null);
            })
            .ToList();

        Atalhos.ItemsSource = _model.Hotkeys.All
            .Select(r => new AtalhoItem(
                r.Binding.ToString(),
                r.Active ? r.Owner : $"{r.Owner} — em conflito: {r.ConflictDetail}",
                !r.Active))
            .ToList();
    }

    private void OnModuloClick(object sender, RoutedEventArgs e)
    {
        if (sender is CheckBox { Tag: string id } caixa)
        {
            _model.SetModuleEnabled(id, caixa.IsChecked == true);

            // Módulo desligado não mostra painel: o que ele configura não roda.
            if (caixa.IsChecked != true && _ajusteAberto == id)
            {
                FecharAjuste();
            }

            Refresh();
        }
    }

    /// <summary>
    /// O painel de cada módulo, construído uma vez e reaproveitado. Reconstruir
    /// a cada abertura jogaria fora o que o usuário digitou e não gravou ainda.
    /// </summary>
    private UserControl? Painel(string id)
    {
        if (_paineis.TryGetValue(id, out var pronto))
        {
            return pronto;
        }

        var modulo = _model.Modules.FirstOrDefault(m => m.Id == id);
        var painel = modulo?.BuildSettings();
        _paineis[id] = painel;
        return painel;
    }

    private void OnAjustarClick(object sender, RoutedEventArgs e)
    {
        if (sender is not Button { Tag: string id })
        {
            return;
        }

        if (_ajusteAberto == id)
        {
            FecharAjuste();
            return;
        }

        var painel = Painel(id);
        if (painel is null)
        {
            return;
        }

        // Solta o anterior antes de montar o novo: um elemento do WPF só pode
        // ter um pai lógico, e trocar sem limpar derruba a janela.
        AjusteCorpo.Content = null;
        AjusteCorpo.Content = painel;

        AjusteTitulo.Text = _model.Modules.First(m => m.Id == id).Name;
        AjusteCartao.Visibility = Visibility.Visible;
        _ajusteAberto = id;
    }

    private void OnFecharAjusteClick(object sender, RoutedEventArgs e) => FecharAjuste();

    private void FecharAjuste()
    {
        AjusteCorpo.Content = null;
        AjusteCartao.Visibility = Visibility.Collapsed;
        _ajusteAberto = null;
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

        var resultado = _model.RebindLeader(binding);
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
            _model.Autostart.Enable();
        }
        else
        {
            _model.Autostart.Disable();
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
