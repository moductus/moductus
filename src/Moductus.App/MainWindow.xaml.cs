using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using System.Windows.Controls.Primitives;
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
    /// <summary>
    /// Uma janela por módulo, para o segundo clique trazer para frente em vez
    /// de abrir outra com o mesmo painel dentro — o que estouraria no "um pai
    /// lógico só" do WPF.
    /// </summary>
    private readonly Dictionary<string, ModuleSettingsWindow> _janelas = [];

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

    /// <summary>
    /// Abre a configuração do módulo em janela própria. Inline, abaixo da
    /// grade, ela empurrava os cartões para baixo e obrigava a rolar para ver
    /// o que estava sendo ajustado.
    /// </summary>
    private void OnConfigurarClick(object sender, RoutedEventArgs e)
    {
        if (sender is not Button { Tag: string id })
        {
            return;
        }

        // Já aberta para este módulo: traz para frente em vez de abrir outra.
        if (_janelas.TryGetValue(id, out var existente) && existente.IsLoaded)
        {
            existente.Activate();
            return;
        }

        var painel = Painel(id);
        if (painel is null)
        {
            return;
        }

        var modulo = _model.Modules.First(m => m.Id == id);

        var janela = new ModuleSettingsWindow(_model.Theme, modulo.Name, modulo.Description, painel)
        {
            Owner = this,
        };

        janela.Closed += (_, _) => _janelas.Remove(id);
        _janelas[id] = janela;
        janela.Show();
    }

    /// <summary>
    /// Recalcula quantas colunas cabem. O UniformGrid divide a largura em
    /// partes iguais, então quem decide o número somos nós: largura útil
    /// dividida pela largura mínima de um cartão, no mínimo uma coluna.
    /// </summary>
    private void OnSizeChanged(object sender, SizeChangedEventArgs e)
    {
        if (!e.WidthChanged || Grade() is not { } grade)
        {
            return;
        }

        var minima = (double)FindResource("size.panel.minwidth");
        var util = grade.ActualWidth > 0 ? grade.ActualWidth : ActualWidth;

        grade.Columns = Math.Max(1, (int)(util / minima));
    }

    /// <summary>
    /// O painel de itens vive dentro de um ItemsPanelTemplate, então x:Name
    /// não chega ao code-behind: é preciso achá-lo na árvore visual.
    /// </summary>
    private UniformGrid? Grade()
    {
        if (VisualTreeHelper.GetChildrenCount(Modulos) == 0)
        {
            return null;
        }

        var atual = VisualTreeHelper.GetChild(Modulos, 0);

        while (atual is not null and not UniformGrid)
        {
            atual = VisualTreeHelper.GetChildrenCount(atual) > 0
                ? VisualTreeHelper.GetChild(atual, 0)
                : null;
        }

        return atual as UniformGrid;
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
