using System.Collections.ObjectModel;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using Moductus.Core.Interop;

namespace Moductus.UI.Archetypes;

/// <summary>Uma entrada da paleta. <see cref="Hint"/> é o atalho à direita.</summary>
public sealed record PaletteItem(string Text, string? Detail, string? Hint, Action Execute);

/// <summary>
/// Palette: centro, terço superior, 640px. Campo de busca e lista. Rouba o
/// foco, guarda o <c>HWND</c> anterior e o devolve ao fechar.
/// </summary>
/// <remarks>
/// Ao executar um item, o foco volta <b>antes</b> da ação rodar. Assim um
/// módulo HUD ou Panel aparece com o usuário ainda digitando onde estava; e
/// um que rouba foco parte de um estado limpo.
/// </remarks>
public class PaletteWindow : ArchetypeWindow
{
    private readonly TextBox _input = new();
    private readonly TextBlock _placeholder = new();
    private readonly ListBox _list = new();
    private readonly TextBlock _empty = new();
    private readonly ObservableCollection<PaletteItem> _visible = [];

    private Func<string, IEnumerable<PaletteItem>>? _provider;
    private nint _previousForeground;

    /// <summary>
    /// Enter com a lista vazia entrega o texto digitado. É assim que
    /// "Executar comando…" recebe o comando. Limpo ao fechar.
    /// </summary>
    public Func<string, bool>? QuerySubmit { get; set; }

    public PaletteWindow() : base(stealsFocus: true)
    {
        _list.ItemsSource = _visible;
        _input.TextChanged += (_, _) => Refilter();
        Deactivated += (_, _) => Dismiss();
        PreviewKeyDown += OnKeys;
    }

    public string Placeholder
    {
        get => _placeholder.Text;
        set => _placeholder.Text = value;
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
        _input.SetResourceReference(Control.FontSizeProperty, "type.body-lg");
        _input.SetResourceReference(FrameworkElement.MarginProperty, "inset.12");

        _placeholder.SetResourceReference(TextBlock.ForegroundProperty, "text.muted");
        _placeholder.SetResourceReference(TextBlock.FontSizeProperty, "type.body-lg");
        _placeholder.IsHitTestVisible = false;
        _placeholder.VerticalAlignment = VerticalAlignment.Center;
        _placeholder.Margin = new Thickness(24, 0, 0, 0);

        var cabecalho = new Grid();
        cabecalho.Children.Add(_input);
        cabecalho.Children.Add(_placeholder);

        _list.BorderThickness = new Thickness(0);
        _list.Background = null;
        _list.Margin = new Thickness(8, 0, 8, 8);
        _list.SetResourceReference(ListBox.MaxHeightProperty, "size.palette.maxheight");
        _list.ItemTemplate = ItemTemplate();
        ScrollViewer.SetHorizontalScrollBarVisibility(_list, ScrollBarVisibility.Disabled);

        _empty.SetResourceReference(TextBlock.ForegroundProperty, "text.muted");
        _empty.SetResourceReference(FrameworkElement.MarginProperty, "inset.16");
        _empty.HorizontalAlignment = HorizontalAlignment.Center;
        _empty.Visibility = Visibility.Collapsed;

        var corpo = new StackPanel();
        corpo.Children.Add(cabecalho);
        corpo.Children.Add(_list);
        corpo.Children.Add(_empty);
        corpo.Children.Add(slot);

        return base.BuildChrome(new ContentPresenter { Content = corpo });
    }

    private static DataTemplate ItemTemplate()
    {
        var grade = new FrameworkElementFactory(typeof(Grid));
        var c1 = new FrameworkElementFactory(typeof(ColumnDefinition));
        c1.SetValue(ColumnDefinition.WidthProperty, new GridLength(1, GridUnitType.Star));
        var c2 = new FrameworkElementFactory(typeof(ColumnDefinition));
        c2.SetValue(ColumnDefinition.WidthProperty, GridLength.Auto);
        grade.AppendChild(c1);
        grade.AppendChild(c2);

        var texto = new FrameworkElementFactory(typeof(TextBlock));
        texto.SetBinding(TextBlock.TextProperty, new System.Windows.Data.Binding(nameof(PaletteItem.Text)));
        texto.SetValue(TextBlock.VerticalAlignmentProperty, VerticalAlignment.Center);
        texto.SetValue(TextBlock.TextTrimmingProperty, TextTrimming.CharacterEllipsis);
        texto.SetValue(TextBlock.TextWrappingProperty, TextWrapping.NoWrap);

        var detalhe = new FrameworkElementFactory(typeof(TextBlock));
        detalhe.SetBinding(TextBlock.TextProperty, new System.Windows.Data.Binding(nameof(PaletteItem.Detail)));
        detalhe.SetResourceReference(TextBlock.StyleProperty, "text.caption");
        detalhe.SetValue(TextBlock.MarginProperty, new Thickness(12, 0, 0, 0));
        detalhe.SetValue(TextBlock.VerticalAlignmentProperty, VerticalAlignment.Center);
        detalhe.SetValue(TextBlock.TextTrimmingProperty, TextTrimming.CharacterEllipsis);
        detalhe.SetValue(TextBlock.TextWrappingProperty, TextWrapping.NoWrap);

        var esquerda = new FrameworkElementFactory(typeof(StackPanel));
        esquerda.SetValue(StackPanel.OrientationProperty, Orientation.Horizontal);
        esquerda.AppendChild(texto);
        esquerda.AppendChild(detalhe);

        var dica = new FrameworkElementFactory(typeof(TextBlock));
        dica.SetBinding(TextBlock.TextProperty, new System.Windows.Data.Binding(nameof(PaletteItem.Hint)));
        dica.SetResourceReference(TextBlock.StyleProperty, "text.caption");
        dica.SetResourceReference(TextBlock.FontFamilyProperty, "font.mono");
        dica.SetValue(Grid.ColumnProperty, 1);
        dica.SetValue(TextBlock.MarginProperty, new Thickness(16, 0, 0, 0));
        dica.SetValue(TextBlock.VerticalAlignmentProperty, VerticalAlignment.Center);

        grade.AppendChild(esquerda);
        grade.AppendChild(dica);

        return new DataTemplate { VisualTree = grade };
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
    }

    protected override void OnDismissed()
    {
        var anterior = _previousForeground;
        _previousForeground = 0;

        _input.Clear();
        _provider = null;
        QuerySubmit = null;
        _visible.Clear();
        base.OnDismissed();

        ForegroundWindow.Restore(anterior);
    }

    private void Refilter()
    {
        var q = _input.Text.Trim();
        _placeholder.Visibility = q.Length == 0 && _input.Text.Length == 0 ? Visibility.Visible : Visibility.Collapsed;

        _visible.Clear();
        foreach (var item in _provider?.Invoke(q) ?? [])
        {
            _visible.Add(item);
        }

        _list.SelectedIndex = _visible.Count > 0 ? 0 : -1;
        _list.Visibility = _visible.Count > 0 ? Visibility.Visible : Visibility.Collapsed;
        _empty.Visibility = _visible.Count == 0 ? Visibility.Visible : Visibility.Collapsed;
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
        if (_visible.Count == 0)
        {
            return;
        }

        var i = Math.Clamp(_list.SelectedIndex + delta, 0, _visible.Count - 1);
        _list.SelectedIndex = i;
        _list.ScrollIntoView(_visible[i]);
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
