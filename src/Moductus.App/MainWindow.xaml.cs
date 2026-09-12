using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using Moductus.UI;

namespace Moductus.App;

/// <summary>
/// A janela principal: todo módulo ativo como cartão, de onde dá para usar e
/// configurar cada um.
/// </summary>
/// <remarks>
/// Abre no clique esquerdo da bandeja. Antes esse clique caía na tela de
/// configurações — uma lista de caixas de seleção, que responde "o que está
/// ligado" e não "o que o Moductus faz".
/// </remarks>
public partial class MainWindow : Window
{
    private readonly SettingsModel _model;
    private readonly Action _abrirAjuda;
    private readonly Action _abrirConfiguracoes;
    private readonly Dictionary<string, UserControl?> _paineis = [];
    private string? _painelAberto;

    internal MainWindow(SettingsModel model, Action abrirAjuda, Action abrirConfiguracoes)
    {
        InitializeComponent();

        _model = model;
        _abrirAjuda = abrirAjuda;
        _abrirConfiguracoes = abrirConfiguracoes;

        SourceInitialized += (_, _) => TitleBar.Sync(this, model.Theme);

        // Busca com o foco: quem abriu a janela para achar um módulo já pode
        // digitar, sem precisar clicar no campo antes.
        Loaded += (_, _) => Busca.Focus();

        Subtitulo.Text = $"Chame qualquer módulo com {model.Leader().Binding} e a letra dele.";

        Refresh();
    }

    private sealed record CartaoItem(string Id, string Nome, string Letra, string Descricao, bool TemPainel);

    private void Refresh()
    {
        var letras = _model.Letters.All.ToDictionary(r => r.ModuleId);
        var busca = Busca.Text.Trim();

        var cartoes = _model.Modules
            .Where(m => _model.IsModuleEnabled(m.Id))
            .Where(m => busca.Length == 0
                || m.Name.Contains(busca, StringComparison.CurrentCultureIgnoreCase)
                || m.Description.Contains(busca, StringComparison.CurrentCultureIgnoreCase))
            .Select(m => new CartaoItem(
                m.Id,
                m.Name,
                letras.TryGetValue(m.Id, out var letra) && letra.Active
                    ? letra.Key.ToString().ToUpperInvariant()
                    : "—",
                m.Description,
                Painel(m.Id) is not null))
            .ToList();

        Modulos.ItemsSource = cartoes;
        Vazio.Visibility = cartoes.Count == 0 ? Visibility.Visible : Visibility.Collapsed;

        // O painel aberto some junto com o cartão que o abriu: painel sem
        // cartão à vista vira um bloco órfão no fim da tela.
        if (_painelAberto is not null && !cartoes.Any(c => c.Id == _painelAberto))
        {
            FecharPainel();
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

    private void OnBuscaChanged(object sender, TextChangedEventArgs e) => Refresh();

    private void OnAbrirClick(object sender, RoutedEventArgs e)
    {
        if (sender is Button { Tag: string id })
        {
            _model.Modules.First(m => m.Id == id).Invoke();
        }
    }

    private void OnConfigurarClick(object sender, RoutedEventArgs e)
    {
        if (sender is not Button { Tag: string id })
        {
            return;
        }

        if (_painelAberto == id)
        {
            FecharPainel();
            return;
        }

        var painel = Painel(id);
        if (painel is null)
        {
            return;
        }

        // Solta o anterior antes de montar o novo: um elemento do WPF só pode
        // ter um pai lógico, e trocar sem limpar derruba a janela.
        PainelCorpo.Content = null;
        PainelCorpo.Content = painel;

        PainelTitulo.Text = _model.Modules.First(m => m.Id == id).Name;
        PainelCartao.Visibility = Visibility.Visible;
        _painelAberto = id;
    }

    private void OnFecharPainelClick(object sender, RoutedEventArgs e) => FecharPainel();

    private void FecharPainel()
    {
        PainelCorpo.Content = null;
        PainelCartao.Visibility = Visibility.Collapsed;
        _painelAberto = null;
    }

    private void OnComoUsarClick(object sender, RoutedEventArgs e) => _abrirAjuda();

    private void OnConfiguracoesClick(object sender, RoutedEventArgs e) => _abrirConfiguracoes();

    // Esc fecha, sempre, sem confirmar nada.
    private void OnKeyDown(object sender, KeyEventArgs e)
    {
        if (e.Key == Key.Escape)
        {
            Close();
        }
    }
}
