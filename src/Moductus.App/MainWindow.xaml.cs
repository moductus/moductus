using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using System.Windows.Controls.Primitives;
using System.Windows.Input;
using System.Windows.Threading;
using Moductus.UI;

namespace Moductus.App;

/// <summary>
/// A janela principal: todo módulo como cartão, de onde dá para usar,
/// configurar e ligar ou desligar cada um.
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
    private List<CartaoItem> _cartoes = [];

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

        // A tela de configurações liga e desliga módulo e troca a líder sem
        // avisar esta janela. Ao voltar para cá, o que mudou lá aparece; o
        // Refresh não reconstrói nada se nada mudou, então o foco fica onde
        // estava.
        Activated += (_, _) => Refresh();

        Refresh();
    }

    /// <summary>Record de propósito: a igualdade por valor é o que deixa o Refresh saber que nada mudou.</summary>
    private sealed record CartaoItem(string Id, string Nome, string Letra, string Descricao, bool Ativo, bool TemPainel);

    private void Refresh()
    {
        var lider = _model.Leader();

        Resumo.Text = $"{_model.Modules.Count} módulos · tecla líder";
        Lider.ItemsSource = lider.Binding.ToString().Split('+');
        LiderConflito.Visibility = lider.Active ? Visibility.Collapsed : Visibility.Visible;

        var letras = _model.Letters.All.ToDictionary(r => r.ModuleId);
        var busca = Busca.Text.Trim();

        // Todos os módulos, ligados ou não: desligado aparece atenuado, para
        // que dê para religar daqui sem ir às configurações.
        var cartoes = _model.Modules
            .Where(m => busca.Length == 0
                || m.Name.Contains(busca, StringComparison.CurrentCultureIgnoreCase)
                || m.Description.Contains(busca, StringComparison.CurrentCultureIgnoreCase))
            .Select(m =>
            {
                var ativo = _model.IsModuleEnabled(m.Id);

                // Desligado mostra a letra que vai usar, atenuada pelo cartão —
                // a mesma do overlay. O "—" fica para o que não tem letra que
                // funcione: nenhuma configurada, ou ligado com a letra em
                // conflito, que apertar não dispara.
                letras.TryGetValue(m.Id, out var letra);
                var tecla = ativo
                    ? letra is { Active: true } ? letra.Key : (char?)null
                    : _model.ConfiguredLetter(m.Id);

                return new CartaoItem(
                    m.Id,
                    m.Name,
                    tecla is { } t ? char.ToUpperInvariant(t).ToString() : "—",
                    m.Description,
                    ativo,
                    // Desligado não mostra painel, como nas configurações: o
                    // que ele configura não está rodando.
                    ativo && Painel(m.Id) is not null);
            })
            .ToList();

        if (cartoes.SequenceEqual(_cartoes))
        {
            return;
        }

        _cartoes = cartoes;
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

    /// <summary>
    /// Enter na busca abre o primeiro módulo ligado que sobrou no filtro: é a
    /// ação primária da tela, e quem digitou "por" quer o Ports, não tabular
    /// até o botão dele.
    /// </summary>
    private void OnBuscaKeyDown(object sender, KeyEventArgs e)
    {
        if (e.Key != Key.Enter)
        {
            return;
        }

        if (_cartoes.FirstOrDefault(c => c.Ativo) is { } primeiro)
        {
            _model.Modules.First(m => m.Id == primeiro.Id).Invoke();
        }

        e.Handled = true;
    }

    private void OnAbrirClick(object sender, RoutedEventArgs e)
    {
        if (sender is Button { Tag: string id })
        {
            _model.Modules.First(m => m.Id == id).Invoke();
        }
    }

    /// <summary>
    /// O switch do cartão usa o mesmo caminho das configurações: o host liga ou
    /// desliga o módulo, registra ou solta a letra e grava na config.
    /// </summary>
    /// <remarks>
    /// Checked/Unchecked, e não Click: o leitor de tela alterna pelo padrão
    /// Toggle da automação, que muda o IsChecked sem disparar Click — o switch
    /// mudaria de lado e o módulo continuaria como estava. Os dois eventos
    /// também disparam quando o binding monta o cartão, por isso a comparação
    /// com o estado real antes de qualquer coisa: só age o que mudou de fato.
    /// </remarks>
    private void OnAtivoChanged(object sender, RoutedEventArgs e)
    {
        if (sender is not ToggleButton { Tag: string id } chave)
        {
            return;
        }

        var ligar = chave.IsChecked == true;

        if (_model.IsModuleEnabled(id) == ligar)
        {
            return;
        }
        var peloTeclado = InputManager.Current.MostRecentInputDevice is KeyboardDevice;

        _model.SetModuleEnabled(id, ligar);

        // Desligado não tem painel: o que ele configura não roda mais.
        if (!ligar && _janelas.TryGetValue(id, out var janela))
        {
            janela.Close();
        }

        Refresh();

        // O Refresh troca os cartões, e o switch que tinha o foco some com o
        // cartão antigo. Quem estava no teclado perderia o lugar na grade; o
        // foco volta para o switch do cartão novo assim que ele existir.
        if (peloTeclado)
        {
            Dispatcher.BeginInvoke(DispatcherPriority.Loaded, () => Chave(id)?.Focus());
        }
    }

    /// <summary>O switch do cartão do módulo, achado pelo template do item.</summary>
    private ToggleButton? Chave(string id)
    {
        var item = _cartoes.FirstOrDefault(c => c.Id == id);

        return item is not null
            && Modulos.ItemContainerGenerator.ContainerFromItem(item) is ContentPresenter cartao
            && cartao.ContentTemplate?.FindName("Ativo", cartao) is ToggleButton chave
                ? chave
                : null;
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
    /// dividida pela largura mínima de uma célula, no mínimo uma coluna.
    /// </summary>
    private void OnSizeChanged(object sender, SizeChangedEventArgs e)
    {
        if (!e.WidthChanged || Grade() is not { } grade)
        {
            return;
        }

        var minima = (double)FindResource("size.home.card");
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

    /// <summary>
    /// "/" leva à busca de qualquer lugar da janela, como nos sites de
    /// documentação. Vai pelo texto digitado, e não pela tecla: no ABNT2 a
    /// barra é outra tecla física, e o teclado numérico tem a dele.
    /// </summary>
    /// <remarks>
    /// Com a busca vazia a barra nunca vira texto, nem com o foco já nela: a
    /// janela abre com o foco na busca, e quem aperta "/" por hábito estava
    /// pedindo a busca, não procurando por uma barra. Com algo digitado, ela é
    /// só mais um caractere.
    /// </remarks>
    private void OnPreviewTextInput(object sender, TextCompositionEventArgs e)
    {
        if (e.Text == "/" && (!Busca.IsKeyboardFocusWithin || Busca.Text.Length == 0))
        {
            Busca.Focus();
            Busca.SelectAll();
            e.Handled = true;
        }
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
