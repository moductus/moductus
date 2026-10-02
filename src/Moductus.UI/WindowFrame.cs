using System.Windows;
using System.Windows.Input;
using System.Windows.Interop;
using System.Windows.Shell;
using Moductus.Core.Interop;

namespace Moductus.UI;

/// <summary>
/// A moldura das janelas comuns — a principal, as configurações, a ajuda, o
/// painel de um módulo: barra de título nossa no lugar da do Windows, sem
/// perder o que a do Windows dava de graça.
/// </summary>
/// <remarks>
/// <para>
/// Ninguém liga isto à mão. O estilo implícito de <c>Window</c> em
/// <c>Controls.xaml</c> liga <see cref="IsCustomProperty"/> e troca o
/// template em toda janela que ainda tem a moldura do sistema
/// (<c>WindowStyle</c> padrão). Os arquétipos põem <c>WindowStyle.None</c> no
/// construtor e saem do gatilho; janela nova do app ganha a barra sem uma
/// linha a mais.
/// </para>
/// <para>
/// A janela continua opaca, sem <c>AllowsTransparency</c>: o frame do DWM é
/// estendido para dentro com <c>GlassFrameThickness = -1</c>, e é isso que
/// mantém a sombra e os cantos arredondados do Windows 11 — o porquê está em
/// <see cref="Dwm"/>. No Windows 10 o DWM recusa os cantos, e a janela fica
/// retangular, funcional do mesmo jeito. Mica o frame estendido permitiria,
/// mas fica de fora: ver o comentário em <see cref="Instalar"/>.
/// </para>
/// <para>
/// O que o template não alcança mora aqui: os comandos dos três botões, o
/// <c>WM_NCHITTEST</c> do Snap Layouts (ver <see cref="NonClient"/>) e o recuo
/// da janela maximizada.
/// </para>
/// </remarks>
public static class WindowFrame
{
    /// <summary>Nome do botão maximizar no template, para o teste de clique achá-lo.</summary>
    public const string MaximizeButtonName = "PART_MaximizeButton";

    /// <summary>Ligado pelo estilo implícito de <c>Window</c>; ver o resumo da classe.</summary>
    public static readonly DependencyProperty IsCustomProperty = DependencyProperty.RegisterAttached(
        "IsCustom",
        typeof(bool),
        typeof(WindowFrame),
        new PropertyMetadata(false, OnIsCustomChanged));

    public static bool GetIsCustom(DependencyObject element) => (bool)element.GetValue(IsCustomProperty);

    public static void SetIsCustom(DependencyObject element, bool value) => element.SetValue(IsCustomProperty, value);

    /// <summary>
    /// Hover do botão maximizar vindo da área não-cliente. Enquanto o teste de
    /// clique responde <c>HTMAXBUTTON</c> o WPF não vê o mouse ali, e o
    /// <c>IsMouseOver</c> do botão fica falso; o estilo acende por este.
    /// </summary>
    public static readonly DependencyProperty IsHotProperty = DependencyProperty.RegisterAttached(
        "IsHot",
        typeof(bool),
        typeof(WindowFrame),
        new PropertyMetadata(false));

    public static bool GetIsHot(DependencyObject element) => (bool)element.GetValue(IsHotProperty);

    public static void SetIsHot(DependencyObject element, bool value) => element.SetValue(IsHotProperty, value);

    /// <summary>
    /// O quanto a janela maximizada passa da área de trabalho em cada borda,
    /// já em DIP. O template recua o conteúdo nisso.
    /// </summary>
    /// <remarks>
    /// Maximizada, o Windows põe a janela além da tela pela espessura da borda
    /// de redimensionar — ela existe, só fica fora de vista. Com a barra do
    /// sistema isso fica na moldura; com o <c>WindowChrome</c> tudo é área de
    /// cliente, e sem o recuo a barra de título e os botões sangram para fora
    /// do monitor. Medido do retângulo real contra a área de trabalho, e não da
    /// métrica do sistema, porque a métrica é do DPI do primário e a janela pode
    /// estar num monitor de outra escala.
    /// </remarks>
    public static readonly DependencyProperty MaximizedInsetProperty = DependencyProperty.RegisterAttached(
        "MaximizedInset",
        typeof(Thickness),
        typeof(WindowFrame),
        new PropertyMetadata(default(Thickness)));

    public static Thickness GetMaximizedInset(DependencyObject element) => (Thickness)element.GetValue(MaximizedInsetProperty);

    private static void SetMaximizedInset(DependencyObject element, Thickness value) => element.SetValue(MaximizedInsetProperty, value);

    // O estado de cada janela com a moldura: o que desfazer se o gatilho sair
    // (o arquétipo, que nasce com o estilo e logo põe WindowStyle.None) e o
    // botão apertado pela área não-cliente.
    private static readonly DependencyProperty StateProperty = DependencyProperty.RegisterAttached(
        "State",
        typeof(Estado),
        typeof(WindowFrame),
        new PropertyMetadata(null));

    private sealed class Estado(Window janela)
    {
        public Window Janela { get; } = janela;

        public CommandBinding[] Comandos { get; set; } = [];

        public HwndSource? Fonte { get; set; }

        public HwndSourceHook? Gancho { get; set; }

        /// <summary>O botão do pressionar, para o soltar só valer sobre ele.</summary>
        public bool Apertado { get; set; }
    }

    private static void OnIsCustomChanged(DependencyObject d, DependencyPropertyChangedEventArgs e)
    {
        if (d is not Window janela)
        {
            return;
        }

        if ((bool)e.NewValue)
        {
            Ligar(janela);
        }
        else
        {
            Desligar(janela);
        }
    }

    private static void Ligar(Window janela)
    {
        if (janela.GetValue(StateProperty) is Estado)
        {
            return;
        }

        var estado = new Estado(janela);
        janela.SetValue(StateProperty, estado);

        // Os botões do template disparam os comandos do sistema; quem os
        // executa é a janela. O SystemCommands passa pelo WM_SYSCOMMAND, e é
        // por isso que minimizar e maximizar animam como os de uma janela
        // comum.
        estado.Comandos =
        [
            new CommandBinding(SystemCommands.MinimizeWindowCommand, (_, _) => SystemCommands.MinimizeWindow(janela)),
            new CommandBinding(SystemCommands.MaximizeWindowCommand, (_, _) => SystemCommands.MaximizeWindow(janela)),
            new CommandBinding(SystemCommands.RestoreWindowCommand, (_, _) => SystemCommands.RestoreWindow(janela)),
            new CommandBinding(SystemCommands.CloseWindowCommand, (_, _) => SystemCommands.CloseWindow(janela)),
        ];
        janela.CommandBindings.AddRange(estado.Comandos);

        if (new WindowInteropHelper(janela).Handle != 0)
        {
            Instalar(estado);
        }
        else
        {
            janela.SourceInitialized += OnSourceInitialized;
        }
    }

    private static void Desligar(Window janela)
    {
        if (janela.GetValue(StateProperty) is not Estado estado)
        {
            return;
        }

        janela.SourceInitialized -= OnSourceInitialized;
        janela.StateChanged -= OnLayoutDaJanela;
        janela.SizeChanged -= OnLayoutDaJanela;

        foreach (var comando in estado.Comandos)
        {
            janela.CommandBindings.Remove(comando);
        }

        if (estado.Fonte is { } fonte && estado.Gancho is { } gancho)
        {
            fonte.RemoveHook(gancho);
        }

        janela.ClearValue(StateProperty);
    }

    private static void OnSourceInitialized(object? sender, EventArgs e)
    {
        if (sender is Window janela && janela.GetValue(StateProperty) is Estado estado)
        {
            janela.SourceInitialized -= OnSourceInitialized;
            Instalar(estado);
        }
    }

    /// <summary>
    /// Com o HWND na mão, antes da primeira medida: o <c>SourceInitialized</c>
    /// vem antes do layout, então a janela que se dimensiona pelo conteúdo já
    /// mede sem a moldura do sistema.
    /// </summary>
    private static void Instalar(Estado estado)
    {
        var janela = estado.Janela;
        var hwnd = new WindowInteropHelper(janela).Handle;

        // O WindowChrome é criado aqui, e não no estilo, por dois números que
        // o estilo não sabe calcular.
        //
        // A faixa de arrastar do WindowChrome começa DEPOIS da borda de
        // redimensionar de cima, e não no topo da janela. Com CaptionHeight
        // igual à barra, os primeiros pixels do conteúdo embaixo dela virariam
        // área de arrastar e deixariam de receber clique. A conta desconta a
        // borda para a faixa terminar exatamente onde a barra termina.
        //
        // E janela sem redimensionar — o painel de um módulo — não tem borda
        // nenhuma: com a borda padrão o cursor viraria seta de redimensionar
        // numa janela que não redimensiona.
        var redimensiona = janela.ResizeMode is ResizeMode.CanResize or ResizeMode.CanResizeWithGrip;
        var borda = redimensiona ? SystemParameters.WindowResizeBorderThickness : default;
        var barra = janela.TryFindResource("size.titlebar") as double? ?? 0;

        WindowChrome.SetWindowChrome(janela, new WindowChrome
        {
            GlassFrameThickness = new Thickness(-1),
            ResizeBorderThickness = borda,
            CaptionHeight = Math.Max(0, barra - borda.Top),
            CornerRadius = default,
            UseAeroCaptionButtons = false,
        });

        // Depois do WindowChrome, que também escuta o WM_NCHITTEST: o HwndSource
        // chama o gancho mais recente primeiro, e o nosso precisa responder
        // antes que o dele marque o ponto como área de cliente.
        if (HwndSource.FromHwnd(hwnd) is { } fonte)
        {
            estado.Fonte = fonte;
            estado.Gancho = (IntPtr _, int msg, IntPtr wParam, IntPtr lParam, ref bool handled) =>
                Gancho(estado, msg, wParam, lParam, ref handled);
            fonte.AddHook(estado.Gancho);
        }

        // Pedido explícito, embora seja o padrão do Win11 para janela com
        // moldura: sem ele, um WindowStyle que mude depois pode deixar o DWM
        // na dúvida. No Windows 10 é recusado e nada muda.
        Dwm.RoundCorners(hwnd);

        // Sem Mica aqui, de propósito, embora o frame estendido o permita. Com
        // o frame estendido e WS_CAPTION, o DWM continua desenhando a faixa da
        // legenda e os três botões do sistema por trás da área de cliente — o
        // UseAeroCaptionButtons=false só tira o clique deles, não o desenho. Com
        // fundo opaco eles ficam cobertos; com a tinta translúcida do Mica, os
        // botões do Windows apareciam como fantasmas ao lado dos nossos (visto
        // no app real, Win11 24H2). Tirar o WS_CAPTION apagaria os fantasmas e
        // levaria junto a animação de minimizar e o encaixe. A janela fica no
        // bg.base opaco do estilo; sombra e cantos continuam do DWM.

        janela.StateChanged += OnLayoutDaJanela;
        janela.SizeChanged += OnLayoutDaJanela;
        AcertarRecuo(janela);
    }

    private static void OnLayoutDaJanela(object? sender, EventArgs e)
    {
        if (sender is Window janela)
        {
            AcertarRecuo(janela);
        }
    }

    private static void AcertarRecuo(Window janela)
    {
        var hwnd = new WindowInteropHelper(janela).Handle;

        if (janela.WindowState != WindowState.Maximized || hwnd == 0)
        {
            SetMaximizedInset(janela, default);
            return;
        }

        var (x, y, largura, altura) = Monitors.Onde(hwnd);
        var area = Monitors.Around(hwnd);
        var escala = area.Scale > 0 ? area.Scale : 1;

        SetMaximizedInset(janela, new Thickness(
            Math.Max(0, area.WorkLeft - x) / escala,
            Math.Max(0, area.WorkTop - y) / escala,
            Math.Max(0, x + largura - (area.WorkLeft + area.WorkWidth)) / escala,
            Math.Max(0, y + altura - (area.WorkTop + area.WorkHeight)) / escala));
    }

    private static IntPtr Gancho(Estado estado, int msg, IntPtr wParam, IntPtr lParam, ref bool handled)
    {
        if (msg == NonClient.HitTest)
        {
            if (SobreMaximizar(estado.Janela, lParam) is not null)
            {
                handled = true;
                return NonClient.MaximizeButton;
            }

            // Saiu do botão para outro ponto da janela: o hover apaga aqui,
            // sem esperar o WM_NCMOUSELEAVE.
            Acender(estado, false);
            return IntPtr.Zero;
        }

        var noBotao = wParam == NonClient.MaximizeButton;

        if (msg == NonClient.MouseMove)
        {
            Acender(estado, noBotao);

            if (noBotao)
            {
                NonClient.TrackLeave(new WindowInteropHelper(estado.Janela).Handle);
            }

            return IntPtr.Zero;
        }

        if (msg == NonClient.MouseLeave)
        {
            Acender(estado, false);
            estado.Apertado = false;
            return IntPtr.Zero;
        }

        // Pressionar e soltar sobre o botão são nossos. Deixados para o
        // DefWindowProc, ele desenharia por cima o botão clássico do Windows e
        // entraria no laço de rastreio dele.
        if (noBotao && msg == NonClient.ButtonDown)
        {
            estado.Apertado = true;
            handled = true;
            return IntPtr.Zero;
        }

        if (noBotao && msg == NonClient.ButtonUp)
        {
            if (estado.Apertado)
            {
                AlternarMaximizar(estado.Janela);
            }

            estado.Apertado = false;
            handled = true;
            return IntPtr.Zero;
        }

        // O duplo clique na barra maximiza; no botão, ele já foi dois cliques.
        if (noBotao && msg == NonClient.DoubleClick)
        {
            handled = true;
        }

        return IntPtr.Zero;
    }

    /// <summary>O botão maximizar, se o ponto da mensagem está em cima dele.</summary>
    private static FrameworkElement? SobreMaximizar(Window janela, IntPtr lParam)
    {
        if (janela.Template?.FindName(MaximizeButtonName, janela) is not FrameworkElement botao
            || !botao.IsVisible
            || !botao.IsEnabled
            || PresentationSource.FromVisual(botao) is null)
        {
            return null;
        }

        var (x, y) = NonClient.Point(lParam);

        // PointToScreen devolve pixel físico: com Per-Monitor V2 é a mesma
        // unidade do lParam, em qualquer escala de monitor.
        var canto = botao.PointToScreen(new Point(0, 0));
        var oposto = botao.PointToScreen(new Point(botao.ActualWidth, botao.ActualHeight));
        var area = new Rect(canto, oposto);

        return area.Contains(x, y) ? botao : null;
    }

    private static void Acender(Estado estado, bool aceso)
    {
        if (estado.Janela.Template?.FindName(MaximizeButtonName, estado.Janela) is DependencyObject botao
            && GetIsHot(botao) != aceso)
        {
            SetIsHot(botao, aceso);
        }
    }

    private static void AlternarMaximizar(Window janela)
    {
        if (janela.WindowState == WindowState.Maximized)
        {
            SystemCommands.RestoreWindow(janela);
        }
        else
        {
            SystemCommands.MaximizeWindow(janela);
        }
    }
}
