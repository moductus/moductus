using System.Windows;
using System.Windows.Controls;
using System.Windows.Controls.Primitives;
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
public class PanelWindow : ArchetypeWindow
{
    private readonly TextBlock _heading = new();
    private readonly ToggleButton _pin = new();
    private PanelPlacement _placement;
    private bool _placed;

    public PanelWindow() : base(stealsFocus: false)
    {
        ResizeMode = ResizeMode.CanResize;
        SetResourceReference(MinWidthProperty, "size.panel.minwidth");
        SetResourceReference(MinHeightProperty, "size.panel.minheight");

        // Borda de redimensionar sem barra de título nativa.
        WindowChrome.SetWindowChrome(this, new WindowChrome
        {
            CaptionHeight = 0,
            ResizeBorderThickness = new Thickness(6),
            GlassFrameThickness = new Thickness(0),
            CornerRadius = new CornerRadius(0),
            UseAeroCaptionButtons = false,
        });
    }

    public string Heading
    {
        get => _heading.Text;
        set => _heading.Text = value;
    }

    /// <summary>Fixado não fecha quando a hotkey do módulo alterna.</summary>
    public bool IsPinned => _pin.IsChecked == true;

    /// <summary>Quem está usando o Panel agora. Módulos checam antes de alternar.</summary>
    public string? Owner { get; set; }

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

    protected override FrameworkElement BuildChrome(ContentPresenter slot)
    {
        _heading.SetResourceReference(TextBlock.FontWeightProperty, "weight.semibold");
        _heading.VerticalAlignment = VerticalAlignment.Center;
        _heading.TextTrimming = TextTrimming.CharacterEllipsis;
        _heading.TextWrapping = TextWrapping.NoWrap;

        _pin.Content = "Fixar";
        _pin.Padding = new Thickness(8, 0, 8, 0);
        _pin.Height = 26;

        var fechar = new Button { Content = "✕", Padding = new Thickness(8, 0, 8, 0), Height = 26, Margin = new Thickness(6, 0, 0, 0) };
        fechar.Click += (_, _) => Dismiss();

        var acoes = new StackPanel { Orientation = Orientation.Horizontal, VerticalAlignment = VerticalAlignment.Center, Margin = new Thickness(0, 0, 6, 0) };
        acoes.Children.Add(_pin);
        acoes.Children.Add(fechar);

        var cabecalho = new DockPanel { LastChildFill = true };
        cabecalho.SetResourceReference(FrameworkElement.HeightProperty, "size.input");
        cabecalho.SetResourceReference(Panel.BackgroundProperty, "bg.raised");
        DockPanel.SetDock(acoes, Dock.Right);
        cabecalho.Children.Add(acoes);
        _heading.Margin = new Thickness(12, 0, 0, 0);
        cabecalho.Children.Add(_heading);
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

        return base.BuildChrome(new ContentPresenter { Content = corpo });
    }

    protected override void Place(MonitorArea a)
    {
        // Só a primeira vez para cada posicionamento. Depois, fica onde o usuário deixou.
        if (_placed)
        {
            return;
        }

        var w = a.Px(560);
        var h = a.Px(360);
        var x = a.WorkLeft + (a.WorkWidth - w) / 2;
        var y = _placement == PanelPlacement.Top
            ? a.WorkTop + a.Px(Token("space.16"))
            : a.WorkTop + (a.WorkHeight - h) / 2;

        PlacePhysical(a, x, y, w, h);
        _placed = true;
    }

    protected override void OnDismissed()
    {
        Owner = null;
        base.OnDismissed();
    }
}
