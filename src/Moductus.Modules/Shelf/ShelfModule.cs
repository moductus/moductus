using System.IO;
using System.Text.Json.Nodes;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using Moductus.Core.Commands;
using Moductus.Core.Modules;
using Moductus.UI.Archetypes;
using Moductus.UI.Modules;

namespace Moductus.Modules.Shelf;

/// <summary>
/// Bandeja temporária na borda para segurar arquivos entre uma pasta e
/// outra. Arraste para dentro, arraste para fora.
/// </summary>
/// <remarks>
/// <para>
/// Guarda <b>caminhos</b>, nunca cópias: nada é movido nem duplicado, e
/// fechar a bandeja não apaga arquivo nenhum. Arrastar para fora entrega os
/// caminhos ao Explorer, que decide copiar ou mover como faria com qualquer
/// seleção.
/// </para>
/// <para>
/// A lista sobrevive a reinício, no escopo de configuração do módulo. Item
/// cujo arquivo sumiu aparece riscado em vez de desaparecer: sumir sozinho
/// faria a pessoa duvidar do que colocou lá.
/// </para>
/// </remarks>
public sealed class ShelfModule(ModuleContext context) : IModule
{
    private const string ItemsKey = "items";

    private readonly ListBox _lista = new();
    private readonly TextBlock _vazio = new();
    private readonly DockPanel _corpo = new();
    private readonly List<string> _caminhos = [];

    private Point _arrasteInicio;
    private bool _arrastando;

    /// <summary>A árvore visual só é construída uma vez, por mais que Enable repita.</summary>
    private bool _montado;

    public string Id => "shelf";

    public string Name => "Shelf";

    public string Description => "Bandeja para segurar arquivos";

    public ModuleArchetype Archetype => ModuleArchetype.Panel;

    public char SuggestedLeaderKey => 'h';

    public bool HasSurface => true;

    public void Enable()
    {
        Montar();

        context.Commands.Register(Id, new PaletteCommand(
            "shelf:clear", "Esvaziar a bandeja", "Solta os arquivos guardados, sem apagar nada", null,
            () => { _caminhos.Clear(); Render(); Salvar(); context.Archetypes.Hud.Flash("Bandeja esvaziada.", "Os arquivos continuam onde estavam.", HudTone.Sucesso); }));
    }

    /// <summary>
    /// A árvore visual, montada uma vez só. O registro do comando fica fora
    /// porque Disable o remove, e religar o módulo precisa recolocá-lo.
    /// </summary>
    private void Montar()
    {
        // Enable roda de novo toda vez que o módulo é religado nas configurações.
        // A árvore visual já está montada, e readicionar um filho que já tem pai
        // derruba o processo inteiro — ver docs/MODULES.md, "Armadilhas conhecidas".
        if (_montado)
        {
            return;
        }

        _montado = true;

        Carregar();

        _lista.SelectionMode = SelectionMode.Extended;
        _lista.AllowDrop = true;
        _lista.Background = null;
        _lista.BorderThickness = new Thickness(0);
        _lista.ItemTemplate = Modelo();
        ScrollViewer.SetHorizontalScrollBarVisibility(_lista, ScrollBarVisibility.Disabled);

        _lista.DragOver += OnDragOver;
        _lista.Drop += OnDrop;
        _lista.PreviewMouseLeftButtonDown += (_, e) => _arrasteInicio = e.GetPosition(null);
        _lista.PreviewMouseMove += OnMouseMove;
        _lista.KeyDown += OnKey;

        _vazio.Text = "Arraste arquivos para cá.\nDepois arraste para onde eles vão.";
        _vazio.TextAlignment = TextAlignment.Center;
        _vazio.SetResourceReference(FrameworkElement.StyleProperty, "style.secondary");
        _vazio.SetResourceReference(FrameworkElement.MarginProperty, "inset.24");
        _vazio.VerticalAlignment = VerticalAlignment.Center;

        var limpar = new Button { Content = "Esvaziar", Height = 26, Padding = new Thickness(10, 0, 10, 0) };
        limpar.Click += (_, _) => { _caminhos.Clear(); Render(); Salvar(); };

        var rodape = new DockPanel();
        rodape.SetResourceReference(FrameworkElement.MarginProperty, "inset.8");
        DockPanel.SetDock(limpar, Dock.Right);
        rodape.Children.Add(limpar);
        rodape.Children.Add(Dica());

        // A zona de soltar precisa cobrir a área toda, inclusive quando vazia.
        var area = new Grid { AllowDrop = true, Background = System.Windows.Media.Brushes.Transparent };
        area.DragOver += OnDragOver;
        area.Drop += OnDrop;
        area.Children.Add(_vazio);
        area.Children.Add(_lista);

        DockPanel.SetDock(rodape, Dock.Bottom);
        _corpo.Children.Add(rodape);
        _corpo.Children.Add(area);

    }

    public void Disable()
    {
        context.Commands.Unregister(Id);
        Salvar();
    }

    public void Invoke()
    {
        var panel = context.Archetypes.Panel;

        if (panel.IsVisible && panel.Owner == Id && !panel.IsPinned)
        {
            panel.Dismiss();
            return;
        }

        Render();

        panel.Owner = Id;
        panel.Heading = $"Shelf · {_caminhos.Count} item(ns)";
        panel.Placement = PanelPlacement.Edge;
        panel.SlotContent = _corpo;
        panel.Present();

        // Toma o foco porque a lista tem teclado próprio — Delete tira da
        // bandeja, Esc fecha. Panel sem foco não recebe tecla nenhuma.
        panel.TakeFocus(_lista);
    }

    // ---- Entrada e saída de arquivos ----------------------------------------

    private void OnDragOver(object sender, DragEventArgs e)
    {
        e.Effects = e.Data.GetDataPresent(DataFormats.FileDrop) ? DragDropEffects.Link : DragDropEffects.None;
        e.Handled = true;
    }

    private void OnDrop(object sender, DragEventArgs e)
    {
        if (e.Data.GetData(DataFormats.FileDrop) is not string[] caminhos)
        {
            return;
        }

        var novos = 0;
        foreach (var c in caminhos.Where(c => !_caminhos.Contains(c, StringComparer.OrdinalIgnoreCase)))
        {
            _caminhos.Add(c);
            novos++;
        }

        e.Handled = true;

        if (novos == 0)
        {
            return;
        }

        Render();
        Salvar();
        context.Archetypes.Panel.Heading = $"Shelf · {_caminhos.Count} item(ns)";
    }

    private void OnMouseMove(object sender, MouseEventArgs e)
    {
        if (_arrastando || e.LeftButton != MouseButtonState.Pressed || _lista.SelectedItems.Count == 0)
        {
            return;
        }

        var agora = e.GetPosition(null);
        if (Math.Abs(agora.X - _arrasteInicio.X) < SystemParameters.MinimumHorizontalDragDistance
            && Math.Abs(agora.Y - _arrasteInicio.Y) < SystemParameters.MinimumVerticalDragDistance)
        {
            return;
        }

        var selecionados = _lista.SelectedItems.Cast<Item>()
            .Where(i => i.Existe)
            .Select(i => i.Caminho)
            .ToArray();

        if (selecionados.Length == 0)
        {
            return;
        }

        _arrastando = true;
        try
        {
            var dados = new DataObject(DataFormats.FileDrop, selecionados);
            DragDrop.DoDragDrop(_lista, dados, DragDropEffects.Copy | DragDropEffects.Move | DragDropEffects.Link);
        }
        finally
        {
            _arrastando = false;
        }

        // O Explorer pode ter movido o arquivo: o que sumiu vira riscado.
        Render();
    }

    private void OnKey(object sender, KeyEventArgs e)
    {
        if (e.Key != Key.Delete || _lista.SelectedItems.Count == 0)
        {
            return;
        }

        e.Handled = true;

        // Tira da bandeja. Nunca apaga do disco.
        foreach (var item in _lista.SelectedItems.Cast<Item>().ToList())
        {
            _caminhos.Remove(item.Caminho);
        }

        Render();
        Salvar();
    }

    // ---- Estado --------------------------------------------------------------

    private void Render()
    {
        _lista.ItemsSource = _caminhos.Select(c => new Item(c)).ToList();
        _vazio.Visibility = _caminhos.Count == 0 ? Visibility.Visible : Visibility.Collapsed;
        _lista.Visibility = _caminhos.Count == 0 ? Visibility.Collapsed : Visibility.Visible;
    }

    private void Carregar()
    {
        _caminhos.Clear();

        if (context.ConfigScope(Id)[ItemsKey] is JsonArray guardados)
        {
            _caminhos.AddRange(guardados.Select(n => n?.GetValue<string>()).OfType<string>());
        }
    }

    private void Salvar()
    {
        context.ConfigScope(Id)[ItemsKey] = new JsonArray([.. _caminhos.Select(c => JsonValue.Create(c))]);
        context.SaveConfig();
    }

    private static TextBlock Dica()
    {
        var t = new TextBlock { Text = "Delete tira da bandeja, sem apagar o arquivo.", VerticalAlignment = VerticalAlignment.Center };
        t.SetResourceReference(FrameworkElement.StyleProperty, "style.caption");
        return t;
    }

    private static DataTemplate Modelo()
    {
        // O nome é obrigatório: setter de DataTrigger sem TargetName cai na
        // raiz do template, que é um StackPanel e não tem TextDecorations —
        // e o WPF só reclama ao selar, quando o primeiro item renderiza.
        var nome = new FrameworkElementFactory(typeof(TextBlock), "Nome");
        nome.SetBinding(TextBlock.TextProperty, new System.Windows.Data.Binding(nameof(Item.Nome)));
        nome.SetValue(TextBlock.TextTrimmingProperty, TextTrimming.CharacterEllipsis);
        nome.SetValue(TextBlock.TextWrappingProperty, TextWrapping.NoWrap);

        var pasta = new FrameworkElementFactory(typeof(TextBlock));
        pasta.SetBinding(TextBlock.TextProperty, new System.Windows.Data.Binding(nameof(Item.Detalhe)));
        pasta.SetResourceReference(TextBlock.StyleProperty, "style.caption");
        pasta.SetValue(TextBlock.TextTrimmingProperty, TextTrimming.CharacterEllipsis);
        pasta.SetValue(TextBlock.TextWrappingProperty, TextWrapping.NoWrap);

        var pilha = new FrameworkElementFactory(typeof(StackPanel));
        pilha.SetValue(FrameworkElement.MarginProperty, new Thickness(0, 4, 0, 4));
        pilha.AppendChild(nome);
        pilha.AppendChild(pasta);

        var modelo = new DataTemplate { VisualTree = pilha };

        var sumiu = new DataTrigger
        {
            Binding = new System.Windows.Data.Binding(nameof(Item.Existe)),
            Value = false,
        };
        sumiu.Setters.Add(new Setter(TextBlock.TextDecorationsProperty, TextDecorations.Strikethrough, "Nome"));
        modelo.Triggers.Add(sumiu);

        return modelo;
    }

    private sealed record Item(string Caminho)
    {
        public bool Existe { get; } = File.Exists(Caminho) || Directory.Exists(Caminho);

        public string Nome { get; } = Path.GetFileName(Caminho.TrimEnd(Path.DirectorySeparatorChar)) is { Length: > 0 } n
            ? n
            : Caminho;

        public string Detalhe { get; } = File.Exists(Caminho) || Directory.Exists(Caminho)
            ? Path.GetDirectoryName(Caminho) ?? Caminho
            : "não está mais lá";
    }

    public UserControl? BuildSettings() => null;
}
