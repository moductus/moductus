using System.Windows;
using System.Windows.Controls;
using System.Windows.Controls.Primitives;
using System.Windows.Data;
using System.Windows.Input;
using System.Windows.Shell;
using Moductus.Core.Interop;

namespace Moductus.UI.Archetypes;

/// <summary>Onde o Panel aparece na primeira vez.</summary>
public enum PanelPlacement
{
    Center,

    /// <summary>Encostado no topo, como o Scratch que desliza de cima.</summary>
    Top,

    /// <summary>Alto e estreito na borda direita, como a bandeja do Shelf.</summary>
    Edge,
}

/// <summary>O tom do chip ao lado do nome, na barra de título do Panel.</summary>
public enum PanelChip
{
    /// <summary>Contagem e estado sem juízo: "8 em escuta", "Salvando…".</summary>
    Neutro,

    /// <summary>Deu certo e está valendo: o "Salvo" do Scratch.</summary>
    Sucesso,

    /// <summary>Não deu: o "Não salvou" do Scratch.</summary>
    Perigo,
}

/// <summary>
/// Panel: flutuante, redimensionável, pode ficar aberto durante o trabalho.
/// Tem botão de fixar. Nunca rouba foco ao aparecer.
/// </summary>
/// <remarks>
/// <para>
/// Guarda posição e tamanho enquanto o processo vive: reabrir traz de volta
/// onde estava. Persistir em disco, e o que fazer quando o monitor some, é
/// decisão em aberto no ARCHITECTURE.md.
/// </para>
/// <para>
/// <c>WS_EX_NOACTIVATE</c> impede que clique ou exibição tomem o foco, mas
/// não impede tomada explícita. Módulo que precisa de digitação (Scratch)
/// chama <see cref="TakeFocus"/>; os outros nunca interrompem o usuário.
/// </para>
/// </remarks>
public class PanelWindow : OwnedWindow
{
    // Fixar no Segoe Fluent Icons: o alfinete vazado solto, o cheio fixado.
    // O glifo troca junto com o estado para que dê para ler o alfinete sem
    // depender só da cor, que no Grafite é a mesma tinta do texto.
    private const string GlifoFixar = "";
    private const string GlifoFixado = "";

    private readonly TextBlock _heading = new();
    private readonly TextBlock _detail = new();
    private readonly Border _keycap = new();
    private readonly TextBlock _letra = new();
    private readonly Border _chip = new();
    private readonly TextBlock _chipTexto = new();
    private readonly TextBlock _glifoFixar = new();
    private readonly ToggleButton _pin = new();
    private Border? _cabecalho;
    private Border? _destaque;
    private PanelPlacement _placement;
    private bool _placed;

    public PanelWindow() : base(stealsFocus: false)
    {
        ResizeMode = ResizeMode.CanResize;
        SetResourceReference(MinWidthProperty, "size.panel.minwidth");
        SetResourceReference(MinHeightProperty, "size.panel.minheight");

        // Borda de redimensionar sem barra de título nativa. O frame continua
        // estendido para dentro, como o do arquétipo base: com espessura zero
        // o DWM não tem onde pintar a Mica, o fundo transparente da janela
        // compõe sobre preto, e o "tint" do corpo vira cinza no tema claro.
        WindowChrome.SetWindowChrome(this, new WindowChrome
        {
            CaptionHeight = 0,
            ResizeBorderThickness = (Thickness)FindResource("border.resize"),
            GlassFrameThickness = new Thickness(-1),
            CornerRadius = new CornerRadius(0),
            UseAeroCaptionButtons = false,
        });
    }

    public string Heading
    {
        get => _heading.Text;
        set => _heading.Text = value;
    }

    /// <summary>
    /// O complemento do nome, em tom secundário: o título da janela que o
    /// Peek espelha. Vazio some. É ele, e não o nome, que corta com
    /// reticências quando a barra aperta — o nome do módulo é o que diz de
    /// quem é a superfície, e não pode ser o primeiro a sumir.
    /// </summary>
    public string? Detail
    {
        get => _detail.Text;
        set
        {
            _detail.Text = value ?? string.Empty;
            _detail.Visibility = string.IsNullOrEmpty(value) ? Visibility.Collapsed : Visibility.Visible;
        }
    }

    /// <summary>
    /// A letra da tecla líder de quem ocupa a superfície, pelo id do módulo.
    /// Quem responde é o host, que é o dono do registro de letras; o Panel
    /// só pergunta, no <see cref="Occupy"/>. Nulo, ou sem letra ativa, e a
    /// keycap some — o QR da Palette ocupa o Panel e não tem letra própria.
    /// </summary>
    public Func<string, char?>? LetterOf { get; set; }

    /// <summary>Fixado não fecha quando a hotkey do módulo alterna.</summary>
    public override bool IsPinned => _pin.IsChecked == true;

    public PanelPlacement Placement
    {
        get => _placement;
        set
        {
            if (_placement != value)
            {
                _placement = value;
                _placed = false;
            }
        }
    }

    /// <summary>
    /// Toma posse, veste e mostra, que é o que todo módulo faz depois da
    /// guarda de toggle. Os quatro passos andam juntos: esquecer o
    /// <see cref="OwnedWindow.Owner"/> faz a hotkey do módulo vizinho fechar
    /// esta superfície, e trocar o conteúdo sem trocar o cabeçalho deixa o
    /// painel mentindo sobre o que mostra.
    /// </summary>
    /// <remarks>
    /// <para>
    /// Foco continua de fora, por <see cref="TakeFocus"/>: tomá-lo é opt-in
    /// deliberado, e só vale para módulo com digitação própria.
    /// </para>
    /// <para>
    /// O detalhe e o chip voltam a vazio aqui: são do dono anterior, e a
    /// contagem de portas não pode sobrar na barra do Scratch. Quem quer os
    /// dois os escreve depois do Occupy.
    /// </para>
    /// </remarks>
    public void Occupy(string owner, string heading, PanelPlacement placement, object content)
    {
        Owner = owner;
        Heading = heading;
        Detail = null;
        ShowChip(null);
        MostrarLetra(LetterOf?.Invoke(owner));
        Placement = placement;
        SlotContent = content;
        Present();
    }

    /// <summary>
    /// O chip ao lado do nome: contagem ou estado do que o painel mostra.
    /// Nulo ou vazio esconde.
    /// </summary>
    public void ShowChip(string? text, PanelChip tone = PanelChip.Neutro)
    {
        if (string.IsNullOrEmpty(text))
        {
            _chip.Visibility = Visibility.Collapsed;
            return;
        }

        _chipTexto.Text = text;
        _chip.SetResourceReference(FrameworkElement.StyleProperty, tone switch
        {
            PanelChip.Sucesso => "style.chip.success",
            PanelChip.Perigo => "style.chip.danger",
            _ => "style.chip",
        });
        _chip.Visibility = Visibility.Visible;
    }

    /// <summary>
    /// Toma o foco explicitamente, para módulos com digitação. O usuário
    /// pediu esta superfície, então tomar o foco aqui não é interrupção.
    /// </summary>
    public void TakeFocus(IInputElement? element = null)
    {
        ForegroundWindow.Take(Handle);
        Activate();

        if (element is null)
        {
            return;
        }

        // O conteúdo acabou de ser trocado e ainda não passou pelo layout;
        // focar agora não pega. Depois do Loaded, pega.
        Dispatcher.BeginInvoke(
            System.Windows.Threading.DispatcherPriority.Loaded,
            () => Keyboard.Focus(element));
    }

    /// <summary>
    /// Mica, não Acrylic: o Panel fica aberto enquanto a pessoa trabalha, e
    /// Acrylic embaixo de conteúdo que se lê por minutos cansa a vista. É a
    /// regra do Fluent para superfície de longa permanência.
    /// </summary>
    protected override Dwm.Backdrop Material => Dwm.Backdrop.Mica;

    /// <summary>
    /// O Panel é uma das duas superfícies que ficam na tela, então o fundo
    /// dele obedece à opacidade que a pessoa escolheu nas configurações.
    /// </summary>
    protected override string FundoTranslucido => "bg.base.tint.ajustada";

    private void MostrarLetra(char? letra)
    {
        if (letra is not { } l)
        {
            _keycap.Visibility = Visibility.Collapsed;
            return;
        }

        _letra.Text = char.ToUpperInvariant(l).ToString();
        _keycap.Visibility = Visibility.Visible;
    }

    protected override FrameworkElement BuildChrome(ContentPresenter slot)
    {
        // A letra que abre este painel, desenhada como tecla: quem olha a barra
        // aprende o atalho sem abrir o overlay da líder.
        _letra.SetResourceReference(FrameworkElement.StyleProperty, "style.keycap.text");
        _keycap.Child = _letra;
        _keycap.SetResourceReference(FrameworkElement.StyleProperty, "style.keycap");
        _keycap.SetResourceReference(FrameworkElement.MarginProperty, "inset.end.8");
        _keycap.Visibility = Visibility.Collapsed;

        _heading.SetResourceReference(TextBlock.FontWeightProperty, "weight.semibold");
        _heading.VerticalAlignment = VerticalAlignment.Center;
        _heading.TextWrapping = TextWrapping.NoWrap;

        _chipTexto.SetResourceReference(FrameworkElement.StyleProperty, "style.chip.text");
        _chip.Child = _chipTexto;
        _chip.SetResourceReference(FrameworkElement.StyleProperty, "style.chip");
        _chip.SetResourceReference(FrameworkElement.MarginProperty, "inset.start.8");
        _chip.Visibility = Visibility.Collapsed;

        _detail.SetResourceReference(FrameworkElement.StyleProperty, "style.secondary");
        _detail.SetResourceReference(FrameworkElement.MarginProperty, "inset.start.8");
        _detail.VerticalAlignment = VerticalAlignment.Center;
        _detail.TextTrimming = TextTrimming.CharacterEllipsis;
        _detail.TextWrapping = TextWrapping.NoWrap;
        _detail.Visibility = Visibility.Collapsed;

        _glifoFixar.Text = GlifoFixar;
        _glifoFixar.SetResourceReference(FrameworkElement.StyleProperty, "style.icon");
        Tingir(_glifoFixar, _pin);

        _pin.Content = _glifoFixar;
        _pin.SetResourceReference(FrameworkElement.StyleProperty, "style.titlebar.toggle");
        _pin.ToolTip = "Fixar: mantém o painel aberto quando você chama outro módulo";
        _pin.Checked += (_, _) => _glifoFixar.Text = GlifoFixado;
        _pin.Unchecked += (_, _) => _glifoFixar.Text = GlifoFixar;

        // ChromeClose do Segoe Fluent Icons, não o "✕" de texto: o caractere
        // tipográfico muda de desenho e de peso conforme a fonte da UI, e
        // nunca bate com o X que o Windows desenha nas próprias janelas.
        var glifoFechar = new TextBlock { Text = "" };
        glifoFechar.SetResourceReference(FrameworkElement.StyleProperty, "style.icon");

        var fechar = new Button { Content = glifoFechar, ToolTip = "Fechar (Esc)" };
        fechar.SetResourceReference(FrameworkElement.MarginProperty, "inset.start.4");
        fechar.SetResourceReference(FrameworkElement.StyleProperty, "style.titlebar.button");
        Tingir(glifoFechar, fechar);
        fechar.Click += (_, _) => Dismiss();

        var acoes = new StackPanel { Orientation = Orientation.Horizontal, VerticalAlignment = VerticalAlignment.Center };
        acoes.Children.Add(_pin);
        acoes.Children.Add(fechar);

        // Nome, chip e detalhe encostados à esquerda, nesta ordem: o detalhe é
        // o último porque é o único que pode cortar, e DockPanel mede cada
        // filho com o que sobrou dos anteriores.
        var titulo = new DockPanel { LastChildFill = true, VerticalAlignment = VerticalAlignment.Center };
        DockPanel.SetDock(_keycap, Dock.Left);
        DockPanel.SetDock(_heading, Dock.Left);
        DockPanel.SetDock(_chip, Dock.Left);
        titulo.Children.Add(_keycap);
        titulo.Children.Add(_heading);
        titulo.Children.Add(_chip);
        titulo.Children.Add(_detail);

        var barra = new DockPanel { LastChildFill = true };
        DockPanel.SetDock(acoes, Dock.Right);
        barra.Children.Add(acoes);
        barra.Children.Add(titulo);

        // A barra é mais alta que os botões de propósito: com a mesma altura
        // eles encostam nas duas bordas e a barra parece achatada. O filete de
        // baixo separa a barra do conteúdo sem precisar de sombra.
        var cabecalho = new Border { Child = barra };
        _cabecalho = cabecalho;
        cabecalho.SetResourceReference(FrameworkElement.HeightProperty, "size.titlebar");
        cabecalho.SetResourceReference(Border.PaddingProperty, "inset.panel.bar");
        cabecalho.SetResourceReference(Border.BackgroundProperty, "bg.raised");
        cabecalho.SetResourceReference(Border.BorderBrushProperty, "border.subtle");
        cabecalho.SetResourceReference(Border.BorderThicknessProperty, "border.width.bottom");
        cabecalho.MouseLeftButtonDown += (_, e) =>
        {
            if (e.ButtonState == MouseButtonState.Pressed)
            {
                DragMove();
            }
        };

        var corpo = new DockPanel();
        DockPanel.SetDock(cabecalho, Dock.Top);
        corpo.Children.Add(cabecalho);
        corpo.Children.Add(slot);

        // O brilho de 1px no topo vai por cima da barra, como camada própria:
        // é ele que faz a borda de cima pegar luz, igual às outras superfícies
        // flutuantes.
        var destaque = new Border();
        _destaque = destaque;
        destaque.SetResourceReference(FrameworkElement.StyleProperty, "style.surface.highlight");

        var camadas = new Grid();
        camadas.Children.Add(corpo);
        camadas.Children.Add(destaque);

        return base.BuildChrome(new ContentPresenter { Content = camadas });
    }

    /// <summary>
    /// O glifo segue a cor do botão que o contém. O style.icon fixa a cor em
    /// text.primary, e sem a ligação o hover e o fixado não teriam como
    /// trocar a cor do alfinete.
    /// </summary>
    private static void Tingir(TextBlock glifo, Control dono) =>
        glifo.SetBinding(TextBlock.ForegroundProperty, new Binding(nameof(Control.Foreground)) { Source = dono });

    /// <summary>
    /// A barra de título tem fundo próprio, mais fechado que o corpo. Sem um
    /// par que dilua junto, ela ficaria opaca sobre um corpo que deixa ver o
    /// que está atrás, e o painel sairia bicolor.
    /// </summary>
    /// <remarks>
    /// <para>
    /// O pincel ajustado parte do <c>bg.raised</c> opaco, que é o que a barra
    /// usa quando a opção está no máximo: assim quem nunca mexeu nela continua
    /// vendo a barra de hoje, e a diferença de fechamento entre barra e corpo
    /// se mantém na faixa inteira, em vez de só perto do mínimo.
    /// </para>
    /// <para>
    /// O raio da moldura e do brilho copia o recorte do DWM, como na pastilha:
    /// com o radius.window de 12 sobrava uma lasca entre a curva do Border e o
    /// corte de 8 do sistema.
    /// </para>
    /// </remarks>
    protected override void OnSuperficieDecidida()
    {
        Superficie?.SetResourceReference(Border.CornerRadiusProperty, RaioDaSuperficie);
        _destaque?.SetResourceReference(Border.CornerRadiusProperty, RaioDaSuperficie);

        if (MaterialAtivo)
        {
            _cabecalho?.SetResourceReference(Border.BackgroundProperty, "bg.raised.ajustada");
        }
    }

    protected override void Place(MonitorArea a)
    {
        // Só a primeira vez para cada posicionamento. Depois, fica onde o usuário deixou.
        if (_placed)
        {
            return;
        }

        int w, h, x, y;

        if (_placement == PanelPlacement.Edge)
        {
            w = a.Px(Token("size.panel.minwidth"));
            h = (int)(a.WorkHeight * Token("size.panel.edge.height"));
            x = a.WorkLeft + a.WorkWidth - w - a.Px(Token("space.16"));
            y = a.WorkTop + (a.WorkHeight - h) / 2;
        }
        else
        {
            w = a.Px(Token("size.panel.width"));
            h = a.Px(Token("size.panel.height"));
            x = a.WorkLeft + (a.WorkWidth - w) / 2;
            y = _placement == PanelPlacement.Top
                ? a.WorkTop + a.Px(Token("space.16"))
                : a.WorkTop + (a.WorkHeight - h) / 2;
        }

        PlacePhysical(a, x, y, w, h);
        _placed = true;
    }

    protected override void OnDismissed()
    {
        Owner = null;
        base.OnDismissed();
    }
}
