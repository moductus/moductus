using System.Windows;
using System.Windows.Controls;
using System.Windows.Controls.Primitives;
using System.Windows.Documents;
using System.Windows.Input;
using System.Windows.Shapes;
using System.Windows.Threading;
using Moductus.Core.Interop;
using Moductus.UI.Archetypes;

namespace Moductus.UI;

/// <param name="Key">A letra que dispara o módulo.</param>
/// <param name="Name">Nome do módulo, embaixo da tecla.</param>
/// <param name="Description">Uma linha. Vai no tooltip: o bloco não tem lugar para ela.</param>
/// <param name="Active">
/// Falso para módulo desligado: aparece atenuado, para a grade mostrar a
/// suíte inteira e a pessoa lembrar que a letra existe, mas a letra não
/// dispara nada — pisca, como letra de ninguém.
/// </param>
public sealed record LeaderEntry(char Key, string Name, string Description, bool Active = true);

/// <summary>
/// A superfície da tecla líder. Não é o módulo Palette: é infraestrutura do
/// host, mostra as letras e dispara módulos.
/// </summary>
/// <remarks>
/// <para>
/// Sem hook global de teclado. É uma janela comum que recebe foco; capturar a
/// próxima tecla vira um <c>KeyDown</c> banal, e nada faz anti-cheat ou
/// antivírus levantar a sobrancelha.
/// </para>
/// <para>
/// Três regras que não são óbvias: o timeout existe e se renova a cada tecla,
/// porque ele está lá para não segurar o foco de quem foi interrompido, não
/// para apressar quem está lendo; letra desconhecida <b>não</b> fecha, só
/// pisca, porque fechar puniria erro de digitação com a perda do estado
/// inteiro; e o foco volta <b>antes</b> de o módulo ser invocado.
/// </para>
/// <para>
/// O desenho é uma grade de blocos — tecla grande em cima, nome embaixo — e
/// não uma lista de linhas: o que se procura aqui é a letra, e numa grade o
/// olho acha a letra sem ler nome nenhum. O cabeçalho repete a combinação que
/// acabou de ser apertada, para quem chegou aqui sem querer saber como.
/// </para>
/// </remarks>
public sealed class LeaderOverlay : ArchetypeWindow
{
    private readonly Func<char, bool> _dispatch;
    private readonly UniformGrid _grade = new();
    private readonly TextBlock _empty = new();
    private readonly StackPanel _combinacao = new() { Orientation = Orientation.Horizontal };
    private readonly Border _brilho = new();
    private readonly DispatcherTimer _timer;
    private readonly DispatcherTimer _blink;
    private Border? _moldura;
    private nint _previousForeground;

    public LeaderOverlay(Func<char, bool> dispatch) : base(stealsFocus: true)
    {
        _dispatch = dispatch ?? throw new ArgumentNullException(nameof(dispatch));

        // O intervalo é lido em Armar, a cada exibição, e não aqui: a janela é
        // singleton e vive o processo inteiro, então ler uma vez só prenderia
        // o prazo ao dicionário que estava no ar quando ela nasceu.
        _timer = new DispatcherTimer();
        _timer.Tick += (_, _) => Dismiss();

        // Interval não é DependencyProperty, então a duração é lida do
        // dicionário na mão. Chave própria e não motion.enter: com animações
        // desligadas na acessibilidade motion.enter vale zero, e o pisca
        // sumiria — mas ele é resposta a erro de digitação, não transição.
        _blink = new DispatcherTimer { Interval = Duracao("motion.blink") };
        _blink.Tick += (_, _) =>
        {
            _blink.Stop();
            _moldura?.SetResourceReference(Border.BorderBrushProperty, "border.strong");
        };

        Deactivated += (_, _) => Dismiss();
        PreviewKeyDown += OnKey;
    }

    public void SetEntries(IEnumerable<LeaderEntry> entries)
    {
        _grade.Children.Clear();

        var algumAtivo = false;

        foreach (var e in entries.OrderBy(e => e.Key))
        {
            _grade.Children.Add(BuildEntry(e));
            algumAtivo |= e.Active;
        }

        // Grade só de desligados também é estado vazio: nenhuma letra ali
        // dispara nada, e a pessoa precisa saber onde se liga.
        _empty.Visibility = algumAtivo ? Visibility.Collapsed : Visibility.Visible;
    }

    /// <summary>
    /// A combinação da tecla líder, no formato de <c>HotkeyBinding.ToString</c>
    /// ("Ctrl+Alt+M"). Vira uma keycap por tecla no cabeçalho.
    /// </summary>
    /// <remarks>
    /// Recebida a cada exibição, e não no construtor, porque a líder pode ser
    /// trocada nas configurações com o processo no ar.
    /// </remarks>
    public void SetCombination(string combinacao)
    {
        _combinacao.Children.Clear();

        var teclas = combinacao.Split('+', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);

        for (var i = 0; i < teclas.Length; i++)
        {
            if (i > 0)
            {
                var mais = new TextBlock { Text = "+", VerticalAlignment = VerticalAlignment.Center };
                mais.SetResourceReference(StyleProperty, "style.caption");
                mais.SetResourceReference(TextBlock.ForegroundProperty, "text.muted");
                mais.SetResourceReference(FrameworkElement.MarginProperty, "inset.4");
                _combinacao.Children.Add(mais);
            }

            _combinacao.Children.Add(Keycap(teclas[i], "style.keycap", "style.keycap.text"));
        }
    }

    protected override FrameworkElement BuildChrome(ContentPresenter slot)
    {
        var corpo = new StackPanel();
        corpo.Children.Add(BuildHeader());
        corpo.Children.Add(Divisor());

        _grade.SetResourceReference(UniformGrid.ColumnsProperty, "size.leader.columns");
        _grade.SetResourceReference(FrameworkElement.MarginProperty, "inset.leader.grid");
        corpo.Children.Add(_grade);

        _empty.Text = "Nenhum módulo ativo. Ative um nas configurações.";
        _empty.SetResourceReference(TextBlock.ForegroundProperty, "text.muted");
        _empty.SetResourceReference(FrameworkElement.MarginProperty, "inset.leader.header");
        _empty.Visibility = Visibility.Collapsed;
        corpo.Children.Add(_empty);

        corpo.Children.Add(slot);
        corpo.Children.Add(Divisor());
        corpo.Children.Add(BuildFooter());

        // O brilho de 1px no topo, por cima de tudo e sem receber clique.
        _brilho.SetResourceReference(StyleProperty, "style.surface.highlight");

        var camadas = new Grid();
        camadas.Children.Add(corpo);
        camadas.Children.Add(_brilho);

        _moldura = (Border)base.BuildChrome(new ContentPresenter { Content = camadas });
        return _moldura;
    }

    /// <summary>
    /// Combinação em keycaps, o pedido, e o chip que diz que a janela está
    /// esperando uma tecla — sem ele, o overlay parado parece um menu que
    /// pede clique.
    /// </summary>
    private FrameworkElement BuildHeader()
    {
        var titulo = new TextBlock { Text = "Escolha um módulo", VerticalAlignment = VerticalAlignment.Center };
        titulo.SetResourceReference(TextBlock.FontWeightProperty, "weight.semibold");
        titulo.SetResourceReference(FrameworkElement.MarginProperty, "inset.start.12");

        var esquerda = new StackPanel { Orientation = Orientation.Horizontal };
        esquerda.Children.Add(_combinacao);
        esquerda.Children.Add(titulo);

        var ponto = new Ellipse();
        ponto.SetResourceReference(StyleProperty, "style.dot.accent");
        ponto.SetResourceReference(FrameworkElement.MarginProperty, "inset.end.8");

        var ouvindo = new TextBlock { Text = "Ouvindo tecla…" };
        ouvindo.SetResourceReference(StyleProperty, "style.chip.text");

        var conteudoDoChip = new StackPanel { Orientation = Orientation.Horizontal };
        conteudoDoChip.Children.Add(ponto);
        conteudoDoChip.Children.Add(ouvindo);

        var chip = new Border { Child = conteudoDoChip };
        chip.SetResourceReference(StyleProperty, "style.chip.accent");
        chip.SetResourceReference(FrameworkElement.MarginProperty, "inset.start.16");
        DockPanel.SetDock(chip, Dock.Right);

        var cabecalho = new DockPanel { LastChildFill = false };
        cabecalho.SetResourceReference(FrameworkElement.MarginProperty, "inset.leader.header");
        cabecalho.Children.Add(chip);
        cabecalho.Children.Add(esquerda);
        return cabecalho;
    }

    private static FrameworkElement BuildFooter()
    {
        var fecha = new TextBlock { Text = "fecha", VerticalAlignment = VerticalAlignment.Center };
        fecha.SetResourceReference(StyleProperty, "style.caption");
        fecha.SetResourceReference(TextBlock.ForegroundProperty, "text.muted");
        fecha.SetResourceReference(FrameworkElement.MarginProperty, "inset.start.8");

        var rodape = new StackPanel { Orientation = Orientation.Horizontal };
        rodape.SetResourceReference(FrameworkElement.MarginProperty, "inset.leader.footer");
        rodape.Children.Add(Keycap("Esc", "style.keycap", "style.keycap.text"));
        rodape.Children.Add(fecha);
        return rodape;
    }

    /// <summary>Linha de ponta a ponta entre as faixas.</summary>
    private static Border Divisor()
    {
        var linha = new Border();
        linha.SetResourceReference(Border.BorderBrushProperty, "border.subtle");
        linha.SetResourceReference(Border.BorderThicknessProperty, "border.width.top");
        return linha;
    }

    private static Border Keycap(string texto, string estilo, string estiloDoTexto)
    {
        var rotulo = new TextBlock { Text = texto };
        rotulo.SetResourceReference(StyleProperty, estiloDoTexto);

        var keycap = new Border { Child = rotulo };
        keycap.SetResourceReference(StyleProperty, estilo);
        return keycap;
    }

    /// <summary>
    /// Um bloco: keycap grande em cima, nome embaixo. A letra ativa vem em
    /// accent.text, que é o que separa "isto dispara" de "isto está aqui"
    /// sem pintar a grade inteira de accent — no Grafite isso seria doze
    /// quadrados brancos.
    /// </summary>
    private static FrameworkElement BuildEntry(LeaderEntry e)
    {
        var keycap = Keycap(e.Key.ToString().ToUpperInvariant(), "style.keycap.lg", "style.keycap.lg.text");
        keycap.HorizontalAlignment = HorizontalAlignment.Center;

        if (e.Active)
        {
            keycap.SetResourceReference(TextElement.ForegroundProperty, "accent.text");
        }

        var nome = new TextBlock
        {
            Text = e.Name,
            TextAlignment = TextAlignment.Center,
            TextTrimming = TextTrimming.CharacterEllipsis,
            TextWrapping = TextWrapping.NoWrap,
        };
        nome.SetResourceReference(FrameworkElement.MarginProperty, "inset.top.8");

        var pilha = new StackPanel();
        pilha.Children.Add(keycap);
        pilha.Children.Add(nome);

        var bloco = new Border { Child = pilha, ToolTip = e.Description };
        bloco.SetResourceReference(StyleProperty, "style.card");
        bloco.SetResourceReference(Border.PaddingProperty, "inset.leader.tile");
        bloco.SetResourceReference(FrameworkElement.WidthProperty, "size.leader.tile");
        bloco.SetResourceReference(FrameworkElement.MarginProperty, "inset.4");

        if (!e.Active)
        {
            // Atenuado, não escondido nem em vermelho: desligado não é perigo.
            bloco.SetResourceReference(OpacityProperty, "opacity.disabled");
        }

        return bloco;
    }

    protected override void OnSuperficieDecidida()
    {
        // A janela é do tamanho exato da moldura, e quem arredonda a janela é
        // o recorte do DWM, em 8. Com o radius.window de 12 sobrava uma lasca
        // do fundo em cada canto — o mesmo caso da pílula do HUD.
        _moldura?.SetResourceReference(Border.CornerRadiusProperty, RaioDaSuperficie);
        _brilho.SetResourceReference(Border.CornerRadiusProperty, RaioDaSuperficie);
    }

    protected override void Place(MonitorArea a)
    {
        // A largura sai da grade (colunas × bloco), não de um token de janela:
        // a janela segue o conteúdo. Mede o conteúdo e não a janela, porque na
        // primeira exibição ela ainda não tem HWND e não fez layout nenhum.
        var conteudo = (FrameworkElement)Content;
        conteudo.Measure(new Size(double.PositiveInfinity, double.PositiveInfinity));

        var w = a.Px(conteudo.DesiredSize.Width);
        var h = a.Px(conteudo.DesiredSize.Height);
        var x = a.WorkLeft + (a.WorkWidth - w) / 2;
        var y = a.WorkTop + a.WorkHeight / 6;

        SizeToContent = SizeToContent.WidthAndHeight;
        PlacePhysical(a, x, y, w, h);
    }

    protected override void OnPresenting(nint foreground) => _previousForeground = foreground;

    protected override void OnPresented()
    {
        Focus();
        Armar();
    }

    /// <summary>
    /// (Re)arma o prazo. O relógio volta ao zero a cada tecla recebida: o
    /// timeout existe para soltar o foco de quem foi interrompido, e quem
    /// digita não foi interrompido — errar a letra encurtava o tempo que
    /// sobrava para ler a grade, o contrário do que o "pisca, não fecha" quer.
    /// </summary>
    private void Armar()
    {
        _timer.Stop();
        _timer.Interval = Duracao("motion.leader.timeout");
        _timer.Start();
    }

    protected override void OnDismissed()
    {
        _timer.Stop();
        _blink.Stop();

        var anterior = _previousForeground;
        _previousForeground = 0;

        // Não limpa o slot: o overlay não tem conteúdo de módulo.
        ForegroundWindow.Restore(anterior);
    }

    private void OnKey(object sender, KeyEventArgs e)
    {
        var key = e.Key == Key.System ? e.SystemKey : e.Key;

        // Qualquer tecla renova o prazo, inclusive a que não vira letra:
        // quem está mexendo no teclado está usando o overlay, não largado.
        Armar();

        // Só letra ou dígito, sem modificador: o líder já foi apertado.
        if (Keyboard.Modifiers != ModifierKeys.None || !TryChar(key, out var c))
        {
            return;
        }

        e.Handled = true;

        // Foco volta antes de o módulo aparecer. Quem não rouba foco deixa o
        // usuário digitando onde estava; quem rouba parte de um estado limpo.
        Dismiss();

        if (!_dispatch(c))
        {
            // Letra de ninguém: pisca e continua armado.
            Present();
            _moldura?.SetResourceReference(Border.BorderBrushProperty, "danger");
            _blink.Stop();
            _blink.Start();
        }
    }

    private static bool TryChar(Key key, out char c)
    {
        c = key switch
        {
            >= Key.A and <= Key.Z => (char)('a' + (key - Key.A)),
            >= Key.D0 and <= Key.D9 => (char)('0' + (key - Key.D0)),
            >= Key.NumPad0 and <= Key.NumPad9 => (char)('0' + (key - Key.NumPad0)),
            _ => '\0',
        };

        return c != '\0';
    }

    /// <summary>
    /// Duração vinda do dicionário. Existe porque DispatcherTimer.Interval não é
    /// DependencyProperty e não aceita SetResourceReference.
    /// </summary>
    private static TimeSpan Duracao(string chave)
        => Application.Current?.TryFindResource(chave) is Duration { HasTimeSpan: true } d
            ? d.TimeSpan
            : TimeSpan.Zero;
}
