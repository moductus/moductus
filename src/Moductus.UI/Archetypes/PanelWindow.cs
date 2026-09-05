using System.Windows;
using System.Windows.Controls;
using System.Windows.Controls.Primitives;
using System.Windows.Input;
using System.Windows.Shell;
using Moductus.Core.Interop;

namespace Moductus.UI.Archetypes;

/// <summary>
/// Panel: flutuante, redimensionável, pode ficar aberto durante o trabalho.
/// Tem botão de fixar. Nunca rouba foco.
/// </summary>
/// <remarks>
/// Guarda posição e tamanho enquanto o processo vive: reabrir traz de volta
/// onde estava. Persistir em disco, e o que fazer quando o monitor some, é
/// decisão em aberto no ARCHITECTURE.md.
/// </remarks>
public class PanelWindow : ArchetypeWindow
{
    private readonly TextBlock _title = new();
    private readonly ToggleButton _pin = new();
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

    public string Title2
    {
        get => _title.Text;
        set => _title.Text = value;
    }

    /// <summary>Fixado não fecha ao clicar fora nem quando a hotkey alterna.</summary>
    public bool IsPinned => _pin.IsChecked == true;

    protected override FrameworkElement BuildChrome(ContentPresenter slot)
    {
        _title.SetResourceReference(TextBlock.FontWeightProperty, "weight.semibold");
        _title.VerticalAlignment = VerticalAlignment.Center;

        _pin.Content = "Fixar";
        _pin.SetResourceReference(FrameworkElement.StyleProperty, typeof(ToggleButton));
        _pin.Padding = new Thickness(8, 0, 8, 0);

        var fechar = new Button { Content = "✕", Padding = new Thickness(8, 0, 8, 0) };
        fechar.Click += (_, _) => Dismiss();

        var acoes = new StackPanel { Orientation = Orientation.Horizontal };
        acoes.Children.Add(_pin);
        acoes.Children.Add(fechar);

        var cabecalho = new DockPanel { LastChildFill = true };
        cabecalho.SetResourceReference(FrameworkElement.HeightProperty, "size.input");
        cabecalho.SetResourceReference(Panel.BackgroundProperty, "bg.raised");
        DockPanel.SetDock(acoes, Dock.Right);
        cabecalho.Children.Add(acoes);
        cabecalho.Children.Add(_title);
        _title.Margin = new Thickness(12, 0, 0, 0);
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
        // Só a primeira vez. Depois, fica onde o usuário deixou.
        if (_placed)
        {
            return;
        }

        var w = a.Px(480);
        var h = a.Px(360);
        var x = a.WorkLeft + (a.WorkWidth - w) / 2;
        var y = a.WorkTop + (a.WorkHeight - h) / 2;

        PlacePhysical(a, x, y, w, h);
        _placed = true;
    }
}
