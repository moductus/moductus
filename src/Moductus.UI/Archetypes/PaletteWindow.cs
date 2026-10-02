using System.Windows;
using System.Windows.Controls;
using System.Windows.Data;
using System.Windows.Input;
using System.Windows.Media;
using Moductus.Core.Commands;
using Moductus.Core.Interop;

namespace Moductus.UI.Archetypes;

/// <summary>Uma entrada da paleta. <see cref="Hint"/> é o atalho à direita.</summary>
/// <remarks>
/// <para>
/// <see cref="Section"/> agrupa a lista sob um cabeçalho em caixa-alta — já
/// escrito assim por quem preenche. <see cref="Kind"/> é o tipo do resultado,
/// dito no chip ao lado da busca quando a linha está selecionada.
/// <see cref="Icon"/> é um glifo do <c>font.icon</c>, desenhado num quadrado
/// no começo da linha. Os três são opcionais: lista sem seção não ganha
/// cabeçalho, linha sem ícone não ganha quadrado vazio.
/// </para>
/// <para>
/// A dica que parece atalho — nomes curtos de tecla ligados por "+", como
/// "P" ou "Ctrl+Shift+C" — vira keycap. O resto ("Enter copia") fica texto.
/// </para>
/// </remarks>
public sealed record PaletteItem(string Text, string? Detail, string? Hint, Action Execute)
{
    /// <summary>Mais que isto não é nome de tecla: é frase.</summary>
    private const int MaiorTecla = 5;

    public string? Section { get; init; }

    public string? Kind { get; init; }

    public string? Icon { get; init; }

    /// <summary>A dica como teclas, quando ela é atalho; vazia quando não é.</summary>
    public IReadOnlyList<string> Keys => PareceAtalho(Hint) ? Hint!.Split('+') : [];

    /// <summary>A dica como texto, quando ela não é atalho.</summary>
    public string? HintText => PareceAtalho(Hint) ? null : Hint;

    private static bool PareceAtalho(string? dica) =>
        !string.IsNullOrEmpty(dica)
        && dica.Split('+').All(p => p.Length is > 0 and <= MaiorTecla && !p.Any(char.IsWhiteSpace));
}

/// <summary>
/// Palette: centro, terço superior, 640px. Campo de busca e lista. Rouba o
/// foco, guarda o <c>HWND</c> anterior e o devolve ao fechar.
/// </summary>
/// <remarks>
/// <para>
/// Ao executar um item, o foco volta <b>antes</b> da ação rodar. Assim um
/// módulo HUD ou Panel aparece com o usuário ainda digitando onde estava; e
/// um que rouba foco parte de um estado limpo.
/// </para>
/// <para>
/// A lista chega ranqueada de quem a preenche e é agrupada aqui por
/// <see cref="Sections.Grouped"/>, que não desfaz o ranking: a seção do melhor
/// resultado vem primeiro, e o primeiro da lista continua sendo o que o Enter
/// executa.
/// </para>
/// </remarks>
public class PaletteWindow : ArchetypeWindow
{
    private readonly TextBox _input = new();
    private readonly TextBlock _lupa = new() { Text = "" };
    private readonly Border _tipo = new();
    private readonly TextBlock _tipoTexto = new();
    private readonly ListBox _list = new();
    private readonly TextBlock _empty = new();
    private readonly TextBlock _contagem = new();
    private readonly Border _brilho = new();

    private List<PaletteItem> _itens = [];
    private Func<string, IEnumerable<PaletteItem>>? _provider;
    private nint _previousForeground;

    /// <summary>
    /// Enter com a lista vazia entrega o texto digitado. É assim que
    /// "Executar comando…" recebe o comando. Limpo ao fechar.
    /// </summary>
    public Func<string, bool>? QuerySubmit { get; set; }

    public PaletteWindow() : base(stealsFocus: true)
    {
        _input.TextChanged += (_, _) => Refilter();
        _list.SelectionChanged += (_, _) => MostrarTipo();
        _tipo.SizeChanged += (_, _) => AbrirEspacoParaOTipo();
        Deactivated += (_, _) => Dismiss();
        PreviewKeyDown += OnKeys;
    }

    public string Placeholder
    {
        // Vai no Tag: o template do TextBox mostra o Tag como dica quando o
        // texto está vazio. A Palette tinha um TextBlock próprio por cima do
        // campo, e acertar a margem dele contra o recuo do texto real nunca
        // fechou — errava por 1px. Dentro do template a dica repete o Padding
        // do campo e a folga que o WPF guarda para o cursor, então os dois
        // partem do mesmo ponto.
        get => _input.Tag as string ?? string.Empty;
        set => _input.Tag = value;
    }

    /// <summary>Estado vazio sempre tem texto explicando o que fazer.</summary>
    public string EmptyText
    {
        get => _empty.Text;
        set => _empty.Text = value;
    }

    public string Query => _input.Text;

    /// <summary>Lista fixa, filtrada por trecho no texto ou no detalhe.</summary>
    public void SetItems(IEnumerable<PaletteItem> items)
    {
        var todos = items.ToList();
        SetProvider(q => q.Length == 0
            ? todos
            : todos.Where(i =>
                i.Text.Contains(q, StringComparison.OrdinalIgnoreCase)
                || (i.Detail?.Contains(q, StringComparison.OrdinalIgnoreCase) ?? false)));
    }

    /// <summary>Quem decide o que aparece para cada texto digitado — com ranking próprio.</summary>
    public void SetProvider(Func<string, IEnumerable<PaletteItem>> provider)
    {
        _provider = provider ?? throw new ArgumentNullException(nameof(provider));
        Refilter();
    }

    protected override FrameworkElement BuildChrome(ContentPresenter slot)
    {
        var corpo = new DockPanel { LastChildFill = false };

        var cabecalho = Cabecalho();
        DockPanel.SetDock(cabecalho, Dock.Top);
        corpo.Children.Add(cabecalho);

        // O rodapé entra antes da lista no DockPanel para ficar preso embaixo
        // mesmo quando a lista encosta no teto de altura.
        var rodape = Rodape();
        DockPanel.SetDock(rodape, Dock.Bottom);
        corpo.Children.Add(rodape);

        _list.BorderThickness = new Thickness(0);
        _list.Background = null;
        _list.SetResourceReference(FrameworkElement.MarginProperty, "inset.list");
        _list.SetResourceReference(ListBox.MaxHeightProperty, "size.palette.maxheight");
        _list.ItemTemplate = ItemTemplate();
        _list.ItemContainerStyle = LinhaComIcone();
        _list.GroupStyle.Add(new GroupStyle { HeaderTemplate = CabecalhoDeSecao() });
        ScrollViewer.SetHorizontalScrollBarVisibility(_list, ScrollBarVisibility.Disabled);
        DockPanel.SetDock(_list, Dock.Top);

        _empty.SetResourceReference(TextBlock.ForegroundProperty, "text.muted");
        _empty.SetResourceReference(FrameworkElement.MarginProperty, "inset.16");
        _empty.HorizontalAlignment = HorizontalAlignment.Center;
        _empty.TextAlignment = TextAlignment.Center;
        _empty.Visibility = Visibility.Collapsed;
        DockPanel.SetDock(_empty, Dock.Top);

        DockPanel.SetDock(slot, Dock.Top);

        corpo.Children.Add(_list);
        corpo.Children.Add(_empty);
        corpo.Children.Add(slot);

        // O brilho do Fluent vai por cima de tudo, como camada própria.
        _brilho.SetResourceReference(FrameworkElement.StyleProperty, "style.surface.highlight");

        var raiz = new Grid();
        raiz.Children.Add(corpo);
        raiz.Children.Add(_brilho);

        return base.BuildChrome(new ContentPresenter { Content = raiz });
    }

    /// <summary>
    /// A moldura acompanha o recorte do DWM, como a pílula do HUD: com o raio
    /// de janela, maior que o corte, sobrava uma lasca de material sem tinta
    /// nos quatro cantos.
    /// </summary>
    protected override void OnSuperficieDecidida()
    {
        Superficie?.SetResourceReference(Border.CornerRadiusProperty, RaioDaSuperficie);
        _brilho.SetResourceReference(Border.CornerRadiusProperty, RaioDaSuperficie);
    }

    /// <summary>O campo de busca com a lupa por dentro e o chip do tipo à direita.</summary>
    private Grid Cabecalho()
    {
        _input.SetResourceReference(FrameworkElement.StyleProperty, "style.input.search");
        _input.SetResourceReference(Control.FontSizeProperty, "type.body-lg");
        // FontSize sem LineHeight herda o line-height do corpo (18) numa fonte
        // de 15, e a baseline do texto sai do lugar. Os dois andam juntos.
        _input.SetResourceReference(Control.FontFamilyProperty, "font.ui");
        _input.SetResourceReference(Control.PaddingProperty, "inset.palette.input");

        // Lupa e chip ficam POR CIMA do campo, sem receber clique, e o campo
        // abre espaço para eles no próprio recuo. Assim o clique em qualquer
        // ponto da caixa continua caindo no texto, e o anel de foco do campo é
        // o da caixa inteira.
        _lupa.SetResourceReference(FrameworkElement.StyleProperty, "style.icon");
        _lupa.SetResourceReference(TextBlock.FontSizeProperty, "size.icon");
        _lupa.SetResourceReference(TextBlock.LineHeightProperty, "size.icon");
        _lupa.SetResourceReference(TextBlock.ForegroundProperty, "text.muted");
        _lupa.SetResourceReference(FrameworkElement.MarginProperty, "inset.start.12");
        _lupa.HorizontalAlignment = HorizontalAlignment.Left;
        _lupa.IsHitTestVisible = false;

        _tipoTexto.SetResourceReference(FrameworkElement.StyleProperty, "style.chip.text");
        _tipo.Child = _tipoTexto;
        _tipo.SetResourceReference(FrameworkElement.StyleProperty, "style.chip.accent");
        _tipo.SetResourceReference(FrameworkElement.MarginProperty, "inset.end.8");
        _tipo.HorizontalAlignment = HorizontalAlignment.Right;
        _tipo.IsHitTestVisible = false;
        _tipo.Visibility = Visibility.Collapsed;

        var cabecalho = new Grid();
        cabecalho.SetResourceReference(FrameworkElement.MarginProperty, "inset.palette.header");
        cabecalho.Children.Add(_input);
        cabecalho.Children.Add(_lupa);
        cabecalho.Children.Add(_tipo);
        return cabecalho;
    }

    /// <summary>As teclas que a Palette entende, e quantos resultados há.</summary>
    private Border Rodape()
    {
        var dicas = new StackPanel { Orientation = Orientation.Horizontal, VerticalAlignment = VerticalAlignment.Center };
        dicas.Children.Add(Tecla("↑", null));
        dicas.Children.Add(Tecla("↓", "inset.palette.keycap.gap"));
        dicas.Children.Add(Legenda("navegar", "inset.start.8"));
        dicas.Children.Add(Legenda("·", "inset.start.8"));
        dicas.Children.Add(Tecla("↵", "inset.start.8"));
        dicas.Children.Add(Legenda("executar", "inset.start.8"));
        dicas.Children.Add(Legenda("·", "inset.start.8"));
        dicas.Children.Add(Tecla("Esc", "inset.start.8"));
        dicas.Children.Add(Legenda("fechar", "inset.start.8"));

        _contagem.SetResourceReference(FrameworkElement.StyleProperty, "style.caption");
        _contagem.SetResourceReference(TextBlock.ForegroundProperty, "text.muted");
        _contagem.TextWrapping = TextWrapping.NoWrap;
        _contagem.VerticalAlignment = VerticalAlignment.Center;
        DockPanel.SetDock(_contagem, Dock.Right);

        var linha = new DockPanel();
        linha.Children.Add(_contagem);
        linha.Children.Add(dicas);

        var rodape = new Border { Child = linha };
        rodape.SetResourceReference(Border.BorderBrushProperty, "border.subtle");
        rodape.SetResourceReference(Border.BorderThicknessProperty, "border.width.top");
        rodape.SetResourceReference(Border.PaddingProperty, "inset.palette.footer");
        return rodape;

        static Border Tecla(string nome, string? recuo)
        {
            var texto = new TextBlock { Text = nome };
            texto.SetResourceReference(FrameworkElement.StyleProperty, "style.keycap.text");

            var tecla = new Border { Child = texto };
            tecla.SetResourceReference(FrameworkElement.StyleProperty, "style.keycap");

            if (recuo is not null)
            {
                tecla.SetResourceReference(FrameworkElement.MarginProperty, recuo);
            }

            return tecla;
        }

        static TextBlock Legenda(string texto, string recuo)
        {
            var legenda = new TextBlock { Text = texto, TextWrapping = TextWrapping.NoWrap, VerticalAlignment = VerticalAlignment.Center };
            legenda.SetResourceReference(FrameworkElement.StyleProperty, "style.caption");
            legenda.SetResourceReference(TextBlock.ForegroundProperty, "text.muted");
            legenda.SetResourceReference(FrameworkElement.MarginProperty, recuo);
            return legenda;
        }
    }

    /// <summary>
    /// A linha implícita com outro recuo: o quadrado do ícone tem 24 e a linha
    /// continua com 36. O resto — hover, seleção, barra de 2px — é o do
    /// <c>style.row</c>, para a Palette não ter uma lista própria.
    /// </summary>
    private Style LinhaComIcone()
    {
        var linha = new Style(typeof(ListBoxItem), (Style)FindResource("style.row"));
        linha.Setters.Add(new Setter(Control.PaddingProperty, new DynamicResourceExtension("inset.palette.row")));
        return linha;
    }

    private static DataTemplate CabecalhoDeSecao()
    {
        var titulo = new FrameworkElementFactory(typeof(TextBlock), "Titulo");
        titulo.SetBinding(TextBlock.TextProperty, new Binding(nameof(CollectionViewGroup.Name)));
        titulo.SetResourceReference(FrameworkElement.StyleProperty, "style.section");
        titulo.SetResourceReference(FrameworkElement.MarginProperty, "inset.palette.section");

        var modelo = new DataTemplate { VisualTree = titulo };

        // Lista com seção e item sem ela: o grupo do sem-seção existe, mas
        // não tem nome a mostrar, e um cabeçalho vazio seria só um buraco.
        modelo.Triggers.Add(new DataTrigger
        {
            Binding = new Binding(nameof(CollectionViewGroup.Name)),
            Value = null,
            Setters = { new Setter(UIElement.VisibilityProperty, Visibility.Collapsed, "Titulo") },
        });

        return modelo;
    }

    private static DataTemplate ItemTemplate()
    {
        var grade = new FrameworkElementFactory(typeof(Grid));
        foreach (var largura in new[] { GridLength.Auto, new GridLength(1, GridUnitType.Star), GridLength.Auto })
        {
            var coluna = new FrameworkElementFactory(typeof(ColumnDefinition));
            coluna.SetValue(ColumnDefinition.WidthProperty, largura);
            grade.AppendChild(coluna);
        }

        // O quadrado do ícone: rebaixado em bg.inset, como a keycap, para ler
        // como etiqueta do tipo e não como botão.
        var glifo = new FrameworkElementFactory(typeof(TextBlock));
        glifo.SetBinding(TextBlock.TextProperty, new Binding(nameof(PaletteItem.Icon)));
        glifo.SetResourceReference(FrameworkElement.StyleProperty, "style.icon");
        glifo.SetResourceReference(TextBlock.FontSizeProperty, "type.body");
        glifo.SetResourceReference(TextBlock.LineHeightProperty, "type.body");
        glifo.SetResourceReference(TextBlock.ForegroundProperty, "text.secondary");

        var quadrado = new FrameworkElementFactory(typeof(Border), "Quadrado");
        quadrado.SetResourceReference(FrameworkElement.WidthProperty, "size.palette.icon");
        quadrado.SetResourceReference(FrameworkElement.HeightProperty, "size.palette.icon");
        quadrado.SetResourceReference(Border.BackgroundProperty, "bg.inset");
        quadrado.SetResourceReference(Border.BorderBrushProperty, "border.subtle");
        quadrado.SetResourceReference(Border.BorderThicknessProperty, "border.width");
        quadrado.SetResourceReference(Border.CornerRadiusProperty, "radius.control");
        quadrado.SetResourceReference(FrameworkElement.MarginProperty, "inset.end.12");
        quadrado.SetValue(FrameworkElement.VerticalAlignmentProperty, VerticalAlignment.Center);
        quadrado.AppendChild(glifo);

        grade.AppendChild(quadrado);
        grade.AppendChild(TextoEDetalhe());
        grade.AppendChild(Dica());

        var modelo = new DataTemplate { VisualTree = grade };

        modelo.Triggers.Add(new DataTrigger
        {
            Binding = new Binding(nameof(PaletteItem.Icon)),
            Value = null,
            Setters = { new Setter(UIElement.VisibilityProperty, Visibility.Collapsed, "Quadrado") },
        });

        return modelo;
    }

    /// <summary>
    /// Nome e detalhe na mesma linha, o detalhe cortado primeiro. DockPanel, e
    /// não StackPanel nem coluna Auto: os dois medem o nome com largura
    /// infinita, e nome comprido (o começo de um clip) passava da borda sem
    /// reticências. O DockPanel mede o nome com a largura que existe e dá ao
    /// detalhe só o que sobra.
    /// </summary>
    private static FrameworkElementFactory TextoEDetalhe()
    {
        var grade = new FrameworkElementFactory(typeof(DockPanel));
        grade.SetValue(Grid.ColumnProperty, 1);
        grade.SetValue(DockPanel.LastChildFillProperty, true);

        var texto = new FrameworkElementFactory(typeof(TextBlock));
        texto.SetBinding(TextBlock.TextProperty, new Binding(nameof(PaletteItem.Text)));
        texto.SetValue(DockPanel.DockProperty, Dock.Left);
        texto.SetValue(TextBlock.VerticalAlignmentProperty, VerticalAlignment.Center);
        texto.SetValue(TextBlock.TextTrimmingProperty, TextTrimming.CharacterEllipsis);
        texto.SetValue(TextBlock.TextWrappingProperty, TextWrapping.NoWrap);

        var detalhe = new FrameworkElementFactory(typeof(TextBlock));
        detalhe.SetBinding(TextBlock.TextProperty, new Binding(nameof(PaletteItem.Detail)));
        detalhe.SetResourceReference(TextBlock.StyleProperty, "style.caption");
        detalhe.SetResourceReference(TextBlock.MarginProperty, "inset.start.12");
        detalhe.SetValue(TextBlock.VerticalAlignmentProperty, VerticalAlignment.Center);
        detalhe.SetValue(TextBlock.TextTrimmingProperty, TextTrimming.CharacterEllipsis);
        detalhe.SetValue(TextBlock.TextWrappingProperty, TextWrapping.NoWrap);

        grade.AppendChild(texto);
        grade.AppendChild(detalhe);
        return grade;
    }

    /// <summary>À direita: o atalho em keycaps, ou a dica em texto.</summary>
    private static FrameworkElementFactory Dica()
    {
        var letra = new FrameworkElementFactory(typeof(TextBlock));
        letra.SetBinding(TextBlock.TextProperty, new Binding());
        letra.SetResourceReference(FrameworkElement.StyleProperty, "style.keycap.text");

        var tecla = new FrameworkElementFactory(typeof(Border));
        tecla.SetResourceReference(FrameworkElement.StyleProperty, "style.keycap");
        tecla.SetResourceReference(FrameworkElement.MarginProperty, "inset.palette.keycap.gap");
        tecla.AppendChild(letra);

        var enfileiradas = new FrameworkElementFactory(typeof(StackPanel));
        enfileiradas.SetValue(StackPanel.OrientationProperty, Orientation.Horizontal);

        var teclas = new FrameworkElementFactory(typeof(ItemsControl));
        teclas.SetBinding(ItemsControl.ItemsSourceProperty, new Binding(nameof(PaletteItem.Keys)));
        teclas.SetValue(ItemsControl.ItemsPanelProperty, new ItemsPanelTemplate(enfileiradas));
        teclas.SetValue(ItemsControl.ItemTemplateProperty, new DataTemplate { VisualTree = tecla });
        teclas.SetValue(UIElement.FocusableProperty, false);
        teclas.SetValue(FrameworkElement.VerticalAlignmentProperty, VerticalAlignment.Center);

        var texto = new FrameworkElementFactory(typeof(TextBlock));
        texto.SetBinding(TextBlock.TextProperty, new Binding(nameof(PaletteItem.HintText)));
        texto.SetResourceReference(TextBlock.StyleProperty, "style.caption");
        texto.SetValue(TextBlock.VerticalAlignmentProperty, VerticalAlignment.Center);
        texto.SetValue(TextBlock.TextWrappingProperty, TextWrapping.NoWrap);

        var dica = new FrameworkElementFactory(typeof(StackPanel));
        dica.SetValue(StackPanel.OrientationProperty, Orientation.Horizontal);
        dica.SetValue(Grid.ColumnProperty, 2);
        dica.SetResourceReference(FrameworkElement.MarginProperty, "inset.start.16");
        dica.AppendChild(teclas);
        dica.AppendChild(texto);
        return dica;
    }

    protected override void Place(MonitorArea a)
    {
        var w = a.Px(Token("size.palette.width"));
        var h = a.Px(Token("size.palette.maxheight"));
        var x = a.WorkLeft + (a.WorkWidth - w) / 2;
        var y = a.WorkTop + a.WorkHeight / 6;

        // Só posição e largura; a altura acompanha o conteúdo.
        SizeToContent = SizeToContent.Height;
        PlacePhysical(a, x, y, w, h);
    }

    protected override void OnPresenting(nint foreground) => _previousForeground = foreground;

    protected override void OnPresented()
    {
        _input.Focus();
        Keyboard.Focus(_input);

        // O módulo costuma entregar a lista antes de mostrar, com a janela
        // escondida e sem layout para medir; o encaixe de verdade é este.
        EncaixarLinhas();
    }

    protected override void OnDismissed()
    {
        var anterior = _previousForeground;
        _previousForeground = 0;

        _input.Clear();
        _provider = null;
        QuerySubmit = null;
        _itens = [];
        _list.ItemsSource = null;
        MostrarTipo();
        base.OnDismissed();

        ForegroundWindow.Restore(anterior);
    }

    private void Refilter()
    {
        var q = _input.Text.Trim();

        // Lista nova a cada tecla, e não Clear + Add numa coleção só: com
        // agrupamento, cada Add avisaria a view e reagruparia — duzentas vezes
        // no histórico do Clips cheio.
        List<PaletteItem> itens = [.. Sections.Grouped(_provider?.Invoke(q) ?? [], i => i.Section)];

        if (itens.Any(i => i.Section is not null))
        {
            CollectionViewSource.GetDefaultView(itens).GroupDescriptions.Add(new PropertyGroupDescription(nameof(PaletteItem.Section)));
        }

        _itens = itens;
        _list.ItemsSource = itens;

        _list.SelectedIndex = itens.Count > 0 ? 0 : -1;
        _list.Visibility = itens.Count > 0 ? Visibility.Visible : Visibility.Collapsed;
        _empty.Visibility = itens.Count == 0 ? Visibility.Visible : Visibility.Collapsed;

        _contagem.Text = itens.Count == 1 ? "1 resultado" : $"{itens.Count} resultados";
        _contagem.Visibility = itens.Count > 0 ? Visibility.Visible : Visibility.Collapsed;

        MostrarTipo();
        EncaixarLinhas();
    }

    /// <summary>
    /// A lista termina numa linha inteira. No teto de altura ela cortava a
    /// última pela metade contra o filete do rodapé, e a linha cortada lia
    /// como defeito, não como "tem mais para baixo" — quem diz isso é a
    /// barra de rolagem.
    /// </summary>
    /// <remarks>
    /// Mede as linhas de verdade, depois do layout, em vez de calcular pelo
    /// token da altura: o cabeçalho de seção tem outra altura, e a soma só
    /// fecha olhando o que foi desenhado. Encaixa só na lista nova, com a
    /// rolagem no topo; rolar depois não redimensiona, que a janela pulando a
    /// cada seta seria pior que a meia linha.
    /// </remarks>
    private void EncaixarLinhas()
    {
        _list.ClearValue(HeightProperty);

        if (_itens.Count == 0)
        {
            return;
        }

        _list.UpdateLayout();

        if (Rolagem(_list) is not { } rolagem || rolagem.ActualHeight <= 0)
        {
            return;
        }

        var visivel = rolagem.ActualHeight;
        var ultimaInteira = 0.0;

        for (var i = 0; i < _itens.Count; i++)
        {
            // Sem container é linha que a virtualização nem desenhou: está
            // abaixo do que se vê, e o que se vê já foi medido.
            if (_list.ItemContainerGenerator.ContainerFromIndex(i) is not ListBoxItem linha || !linha.IsVisible)
            {
                break;
            }

            var fundo = linha.TransformToAncestor(rolagem).Transform(default).Y + linha.ActualHeight;

            if (fundo > visivel)
            {
                if (ultimaInteira > 0)
                {
                    _list.Height = _list.ActualHeight - (visivel - ultimaInteira);
                }

                break;
            }

            ultimaInteira = fundo;
        }
    }

    /// <summary>O chip diz o tipo do que está selecionado: o que o Enter vai abrir.</summary>
    private void MostrarTipo()
    {
        var tipo = (_list.SelectedItem as PaletteItem)?.Kind;

        _tipoTexto.Text = tipo;
        _tipo.Visibility = tipo is null ? Visibility.Collapsed : Visibility.Visible;
        AbrirEspacoParaOTipo();
    }

    /// <summary>
    /// O texto digitado não pode correr por baixo do chip. O recuo da direita
    /// cresce com a largura dele, que muda conforme o tipo.
    /// </summary>
    private void AbrirEspacoParaOTipo()
    {
        var recuo = (Thickness)FindResource("inset.palette.input");

        if (_tipo.Visibility == Visibility.Visible && _tipo.ActualWidth > 0)
        {
            recuo.Right = Math.Max(recuo.Right, _tipo.ActualWidth + _tipo.Margin.Right + Token("space.8"));
        }

        _input.Padding = recuo;
    }

    private void OnKeys(object sender, KeyEventArgs e)
    {
        switch (e.Key)
        {
            case Key.Down:
                Move(+1);
                e.Handled = true;
                break;
            case Key.Up:
                Move(-1);
                e.Handled = true;
                break;
            case Key.Enter:
                e.Handled = true;
                ExecuteSelected();
                break;
        }
    }

    private void Move(int delta)
    {
        if (_itens.Count == 0)
        {
            return;
        }

        // Os itens já chegam na ordem dos grupos, então o índice da lista e o
        // da view são o mesmo.
        var i = Math.Clamp(_list.SelectedIndex + delta, 0, _itens.Count - 1);
        _list.SelectedIndex = i;

        if (i == 0)
        {
            // ScrollIntoView para na linha e deixa o cabeçalho da primeira
            // seção escondido em cima; no topo, o topo da lista.
            Rolagem(_list)?.ScrollToTop();
        }
        else
        {
            _list.ScrollIntoView(_itens[i]);
        }
    }

    private static ScrollViewer? Rolagem(DependencyObject raiz)
    {
        for (var i = 0; i < VisualTreeHelper.GetChildrenCount(raiz); i++)
        {
            var filho = VisualTreeHelper.GetChild(raiz, i);

            if (filho is ScrollViewer rolagem)
            {
                return rolagem;
            }

            if (Rolagem(filho) is { } achada)
            {
                return achada;
            }
        }

        return null;
    }

    private void ExecuteSelected()
    {
        if (_list.SelectedItem is PaletteItem item)
        {
            // Foco volta primeiro; a ação roda partindo de um estado limpo.
            Dismiss();
            item.Execute();
            return;
        }

        var submit = QuerySubmit;
        var texto = _input.Text.Trim();

        if (submit is not null && texto.Length > 0)
        {
            Dismiss();
            submit(texto);
        }
    }
}
