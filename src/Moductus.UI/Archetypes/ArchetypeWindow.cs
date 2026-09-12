using System.Windows;
using System.Windows.Controls;
using System.Windows.Shell;
using System.Windows.Input;
using System.Windows.Interop;
using Moductus.Core.Interop;

namespace Moductus.UI.Archetypes;

/// <summary>
/// O que os quatro arquétipos têm em comum. Módulo nenhum herda disto:
/// módulo escolhe um dos quatro e preenche o conteúdo.
/// </summary>
/// <remarks>
/// <para>
/// São singletons, construídos em tempo ocioso e nunca destruídos. Mostrar é
/// <see cref="Present"/>, fechar é <see cref="Dismiss"/>. O spike mediu ~490ms
/// na primeira janela de um processo; <see cref="Prewarm"/> paga isso fora do
/// caminho do usuário.
/// </para>
/// <para>
/// Contrato de interação, valendo para todos: Esc fecha sem confirmar; a
/// hotkey é toggle; a superfície aparece no monitor da janela em foreground.
/// </para>
/// </remarks>
public abstract class ArchetypeWindow : Window
{
    private readonly ContentPresenter _slot = new();
    private bool _dismissing;

    protected ArchetypeWindow(bool stealsFocus)
    {
        StealsFocus = stealsFocus;

        // Estilo implícito não casa com subclasse. Sem esta linha, a janela
        // nasce branca com texto claro.
        SetResourceReference(StyleProperty, typeof(Window));

        WindowStyle = WindowStyle.None;
        ResizeMode = ResizeMode.NoResize;
        ShowInTaskbar = false;
        Topmost = true;
        ShowActivated = stealsFocus;
        WindowStartupLocation = WindowStartupLocation.Manual;

        // Frame do DWM estendido para dentro da área de cliente. É o que
        // devolve a sombra nativa a uma janela sem borda, e a condição para o
        // Windows 11 aceitar pintar material atrás dela. CaptionHeight zero
        // porque a barra de título é nossa; ResizeBorder zero porque o
        // arquétipo controla o próprio redimensionamento.
        WindowChrome.SetWindowChrome(this, new WindowChrome
        {
            GlassFrameThickness = new Thickness(-1),
            CaptionHeight = 0,
            ResizeBorderThickness = default,
            CornerRadius = default,
            UseAeroCaptionButtons = false,
        });

        Content = BuildChrome(_slot);

        SourceInitialized += (_, _) => OnHandleCreated();
        PreviewKeyDown += OnPreviewKeyDown;
    }

    /// <summary>Palette e Canvas roubam; HUD e Panel nunca.</summary>
    public bool StealsFocus { get; }

    /// <summary>
    /// O material do DWM atrás desta superfície. Acrylic para o que aparece
    /// por cima e some, Mica para o que fica aberto durante o trabalho — é a
    /// regra do Fluent, e a diferença é perceptível: Acrylic borra o que está
    /// atrás, Mica só tinge o papel de parede.
    /// </summary>
    protected virtual Dwm.Backdrop Material => Dwm.Backdrop.Acrylic;

    /// <summary>
    /// A superfície que recebe a tinta quando o material entra. Cada
    /// <see cref="BuildChrome"/> aponta para o próprio Border de fundo; sem
    /// isso a janela fica com material atrás de um fundo opaco, ou seja, sem
    /// efeito nenhum.
    /// </summary>
    protected Border? Superficie { get; set; }

    /// <summary>Chave do fundo quando o material está no ar.</summary>
    protected virtual string FundoTranslucido => "bg.base.tint";

    /// <summary>O que o módulo coloca dentro do arquétipo.</summary>
    public object? SlotContent
    {
        get => _slot.Content;
        set => _slot.Content = value;
    }

    protected nint Handle => new WindowInteropHelper(this).Handle;

    /// <summary>Mostra, ou traz para o monitor certo se já estiver visível.</summary>
    public void Present() => Present(null);

    /// <summary>
    /// Mostra num monitor escolhido por quem chama — o Freeze precisa exibir
    /// no mesmo monitor que acabou de congelar.
    /// </summary>
    public void Present(MonitorArea? area)
    {
        var foreground = ForegroundWindow.Capture();
        OnPresenting(foreground);

        Place(area ?? Monitors.Around(foreground));

        if (!IsVisible)
        {
            Show();
            Enter();
        }

        if (StealsFocus)
        {
            // Activate() do WPF é só SetForegroundWindow, que o Windows
            // recusa em boa parte dos casos. Take() faz o contorno.
            ForegroundWindow.Take(Handle);
            Activate();
        }

        OnPresented();
    }

    /// <summary>Depois de esconder. Módulo solta o que segurava — miniatura, timer, arquivo.</summary>
    public event Action? Dismissed;

    /// <summary>Esconde. Nunca destrói: a janela é reutilizada.</summary>
    public void Dismiss()
    {
        if (_dismissing || !IsVisible)
        {
            return;
        }

        _dismissing = true;

        try
        {
            Hide();
            OnDismissed();
            Dismissed?.Invoke();
        }
        finally
        {
            _dismissing = false;
        }
    }

    /// <summary>
    /// Cria o HWND e força a primeira renderização fora da tela, em tempo
    /// ocioso. Depois disto, <see cref="Present"/> custa milissegundos.
    /// </summary>
    public void Prewarm()
    {
        if (Handle != 0)
        {
            return;
        }

        var ativava = ShowActivated;
        ShowActivated = false;
        Left = -32000;
        Top = -32000;

        Show();
        Hide();

        ShowActivated = ativava;
    }

    /// <summary>Onde e com que tamanho, em pixels físicos do monitor dado.</summary>
    protected abstract void Place(MonitorArea area);

    protected void PlacePhysical(MonitorArea area, int x, int y, int width, int height)
    {
        if (Handle != 0)
        {
            Monitors.Place(Handle, x, y, width, height);
        }
        else
        {
            // Só acontece se alguém chamar Present antes do Prewarm.
            Left = x / area.Scale;
            Top = y / area.Scale;
            Width = width / area.Scale;
            Height = height / area.Scale;
        }
    }

    protected double Token(string key) => (double)FindResource(key);

    /// <summary>
    /// Entrada: desliza 8px de cima em 140ms, ease-out. Com animações
    /// desligadas na acessibilidade os tokens vão a zero e nada se move.
    /// Nunca atrasa a exibição: a janela já está na tela quando começa.
    /// </summary>
    protected virtual void Enter()
    {
        var duracao = (Duration)FindResource("motion.enter");
        var offset = Token("motion.offset");

        if (!duracao.HasTimeSpan || duracao.TimeSpan == TimeSpan.Zero || offset == 0 || double.IsNaN(Top))
        {
            return;
        }

        var destino = Top;
        BeginAnimation(TopProperty, new System.Windows.Media.Animation.DoubleAnimation(destino - offset, destino, duracao)
        {
            EasingFunction = (System.Windows.Media.Animation.IEasingFunction)FindResource("ease.out"),
            FillBehavior = System.Windows.Media.Animation.FillBehavior.Stop,
        });
    }

    protected virtual FrameworkElement BuildChrome(ContentPresenter slot)
    {
        var moldura = new Border { Child = slot };
        Superficie = moldura;
        moldura.SetResourceReference(Border.BackgroundProperty, "bg.base");
        moldura.SetResourceReference(Border.BorderBrushProperty, "border.strong");
        moldura.SetResourceReference(Border.BorderThicknessProperty, "border.width");
        moldura.SetResourceReference(Border.CornerRadiusProperty, "radius.window");
        return moldura;
    }

    protected virtual void OnHandleCreated()
    {
        WindowStyles.MakeToolWindow(Handle);

        if (!StealsFocus)
        {
            WindowStyles.MakeNoActivate(Handle);
        }

        Dwm.RoundCorners(Handle);
        AplicarMaterial();
    }

    /// <summary>
    /// Pede o material ao DWM e, só se ele aceitar, deixa o fundo translúcido.
    /// O Windows recusa em Windows 10, em build antiga do 11 e quando a pessoa
    /// desliga efeitos de transparência nas configurações — e nesses casos a
    /// janela tem de continuar opaca, senão vira um retângulo preto com texto.
    /// </summary>
    private void AplicarMaterial()
    {
        if (Material == Dwm.Backdrop.None || Superficie is null)
        {
            return;
        }

        if (!Dwm.SetBackdrop(Handle, Material))
        {
            return;
        }

        // A janela precisa parar de pintar o próprio fundo para o material
        // aparecer; a tinta vai no Border, que é quem desenha o conteúdo.
        Background = System.Windows.Media.Brushes.Transparent;
        Superficie.SetResourceReference(Border.BackgroundProperty, FundoTranslucido);
    }

    protected virtual void OnPresenting(nint foreground)
    {
    }

    protected virtual void OnPresented()
    {
    }

    /// <summary>
    /// Limpa ao esconder, não ao exibir: limpar na exibição gastaria tempo
    /// dentro do orçamento de 140ms.
    /// </summary>
    protected virtual void OnDismissed() => SlotContent = null;

    private void OnPreviewKeyDown(object sender, KeyEventArgs e)
    {
        if (e.Key == Key.Escape)
        {
            e.Handled = true;
            Dismiss();
        }
    }
}
