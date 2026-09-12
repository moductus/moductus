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
    private const string ChaveEsvaziar = "clearOnExit";

    private readonly ListBox _lista = new();
    private readonly TextBlock _vazio = new();
    private readonly DockPanel _corpo = new();
    private readonly List<string> _caminhos = [];

    private Point _arrasteInicio;
    private bool _arrastando;

    /// <summary>A árvore visual só é construída uma vez, por mais que Enable repita.</summary>
    private bool _montado;

    /// <summary>O que já se conferiu no disco. Sem entrada é "ainda não sei".</summary>
    private readonly Dictionary<string, bool> _existe = new(StringComparer.OrdinalIgnoreCase);

    /// <summary>Sobe a cada Invoke; conferência que volta com número velho é descartada.</summary>
    private int _geracao;

    public string Id => "shelf";

    public string Name => "Shelf";

    public string Description => "Bandeja para segurar arquivos";

    public ModuleArchetype Archetype => ModuleArchetype.Panel;

    public char SuggestedLeaderKey => 'h';

    public bool HasSurface => true;

    private bool EsvaziarAoSair => context.ConfigScope(Id)[ChaveEsvaziar]?.GetValue<bool>() ?? false;

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

        var limpar = new Button { Content = "Esvaziar" };
        limpar.SetResourceReference(FrameworkElement.StyleProperty, "style.button.compact");
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
        // O Panel continuaria na tela operando um módulo desligado — aceitando
        // drop e gravando a config.
        var panel = context.Archetypes.Panel;
        if (panel.IsShowingFor(Id))
        {
            panel.Dismiss();
        }

        context.Commands.Unregister(Id);
        context.Archetypes.Badge.Soltar(Id);

        if (EsvaziarAoSair)
        {
            _caminhos.Clear();
        }

        Salvar();
    }

    public void Invoke()
    {
        var panel = context.Archetypes.Panel;

        if (panel.DismissIfShowing(Id))
        {
            return;
        }

        Render();

        panel.Occupy(Id, $"Shelf · {_caminhos.Count} item(ns)", PanelPlacement.Edge, _corpo);

        // Toma o foco porque a lista tem teclado próprio — Delete tira da
        // bandeja, Esc fecha. Panel sem foco não recebe tecla nenhuma.
        panel.TakeFocus(_lista);

        Conferir();
    }

    /// <summary>
    /// Pergunta ao disco quais itens ainda estão lá. Fora da thread de UI porque
    /// um caminho de rede fora do ar faz File.Exists esperar o timeout inteiro do
    /// SMB, e antes do Present isso era o painel simplesmente não abrir.
    /// </summary>
    private async void Conferir()
    {
        var alvos = _caminhos.ToArray();
        var desta = ++_geracao;

        var achados = await Task.Run(() => alvos
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToDictionary(c => c, c => File.Exists(c) || Directory.Exists(c), StringComparer.OrdinalIgnoreCase));

        // Abriu de novo enquanto a rede pensava: quem manda é a abertura nova.
        if (desta != _geracao)
        {
            return;
        }

        foreach (var (caminho, existe) in achados)
        {
            _existe[caminho] = existe;
        }

        Render();
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
            // Nulo é "ainda não conferido": deixa tentar, e quem reclama é o
            // shell. Só o que se sabe que sumiu fica de fora.
            .Where(i => i.Existe != false)
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
        // Render roda de novo quando a conferência de existência volta, que num
        // caminho de rede fora do ar são segundos — tempo de sobra para a pessoa
        // já ter escolhido o que quer abrir. Trocar o ItemsSource descarta a
        // seleção, então ela é remontada por caminho logo abaixo.
        var escolhidos = _lista.SelectedItems
            .Cast<Item>()
            .Select(i => i.Caminho)
            .ToHashSet(StringComparer.OrdinalIgnoreCase);

        // TryGetValue e não GetValueOrDefault: o dicionário é de bool, e o
        // default dele é false, não nulo. Com GetValueOrDefault todo item nascia
        // "sumiu" antes de a conferência voltar — riscado na lista, e descartado
        // pelo Enter, que só abre o que não é falso.
        _lista.ItemsSource = _caminhos
            .Select(c => new Item(c, _existe.TryGetValue(c, out var existe) ? existe : null))
            .ToList();

        foreach (var item in _lista.Items.Cast<Item>().Where(i => escolhidos.Contains(i.Caminho)))
        {
            _lista.SelectedItems.Add(item);
        }
        _vazio.Visibility = _caminhos.Count == 0 ? Visibility.Visible : Visibility.Collapsed;
        _lista.Visibility = _caminhos.Count == 0 ? Visibility.Collapsed : Visibility.Visible;
        Repintar();
    }

    /// <summary>
    /// Redesenha a pastilha. Sai daqui, e não do Enable, porque Enable roda
    /// antes de a UI existir — a lista gravada só vira pastilha no primeiro
    /// Invoke e a cada mudança depois dele.
    /// </summary>
    private void Repintar()
    {
        if (_caminhos.Count == 0)
        {
            context.Archetypes.Badge.Soltar(Id);
            return;
        }

        context.Archetypes.Badge.Fixar(
            Id,
            $"Bandeja — {_caminhos.Count} item(ns)",
            new Item(_caminhos[0], null).Nome,
            HudTone.Neutro,
            aoClicar: null,
            [
                new BadgeAction("Abrir", "Mostra a bandeja", Invoke),
                new BadgeAction("Esvaziar", "Solta os arquivos guardados, sem apagar nada", Esvaziar),
            ]);
    }

    private void Esvaziar()
    {
        _caminhos.Clear();
        Render();
        Salvar();
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
        pilha.SetResourceReference(FrameworkElement.MarginProperty, "inset.y.4");
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

    /// <summary>
    /// Nome e pasta saem do próprio texto do caminho, sem tocar em disco, para a
    /// lista poder aparecer antes de qualquer I/O. <paramref name="Existe"/> é
    /// nulo até a conferência voltar; o item riscado é o que já se sabe que
    /// sumiu, não o que ainda não se perguntou.
    /// </summary>
    private sealed record Item(string Caminho, bool? Existe)
    {
        public string Nome { get; } = Path.GetFileName(Caminho.TrimEnd(Path.DirectorySeparatorChar)) is { Length: > 0 } n
            ? n
            : Caminho;

        public string Detalhe { get; } = Path.GetDirectoryName(Caminho) ?? Caminho;
    }

    // ---- Configuração ---------------------------------------------------------

    public UserControl? BuildSettings()
    {
        var corpo = new StackPanel();

        var esvaziar = new CheckBox { Content = "Esvaziar a bandeja ao sair", IsChecked = EsvaziarAoSair };
        esvaziar.SetResourceReference(FrameworkElement.MarginProperty, "inset.4");
        esvaziar.Checked += (_, _) => Gravar(ChaveEsvaziar, true);
        esvaziar.Unchecked += (_, _) => Gravar(ChaveEsvaziar, false);
        corpo.Children.Add(esvaziar);

        corpo.Children.Add(SettingsUI.Note("A bandeja guarda caminhos, não cópias: esvaziar solta os arquivos e não apaga nenhum."));
        corpo.Children.Add(SettingsUI.Note("Desligar o módulo aqui nas configurações também esvazia, pelo mesmo caminho de saída."));

        return new UserControl { Content = corpo };
    }

    private void Gravar(string chave, bool valor)
    {
        context.ConfigScope(Id)[chave] = valor;
        context.SaveConfig();
    }
}
