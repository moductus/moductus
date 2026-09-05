using System.Windows;
using System.Windows.Controls;
using System.Windows.Threading;
using Moductus.Core.Interop;

namespace Moductus.UI.Archetypes;

/// <summary>
/// HUD: pílula pequena, ancorada embaixo. Transitória, some sozinha em
/// ~1,5s, não aceita clique, nunca rouba foco. Puro feedback.
/// </summary>
public class HudWindow : ArchetypeWindow
{
    private static readonly TimeSpan Permanencia = TimeSpan.FromMilliseconds(1500);

    private readonly TextBlock _text = new();
    private readonly DispatcherTimer _timer;

    public HudWindow() : base(stealsFocus: false)
    {
        IsHitTestVisible = false;
        _timer = new DispatcherTimer { Interval = Permanencia };
        _timer.Tick += (_, _) => Dismiss();
    }

    /// <summary>Mostra o texto e reinicia a contagem para sumir.</summary>
    public void Flash(string text)
    {
        _text.Text = text;
        _timer.Stop();
        Present();
        _timer.Start();
    }

    protected override FrameworkElement BuildChrome(ContentPresenter slot)
    {
        _text.SetResourceReference(TextBlock.FontSizeProperty, "type.body-lg");
        _text.VerticalAlignment = VerticalAlignment.Center;
        _text.TextWrapping = TextWrapping.NoWrap;

        var conteudo = new StackPanel { Orientation = Orientation.Horizontal };
        conteudo.Children.Add(_text);
        conteudo.Children.Add(slot);

        var pilula = new Border { Child = conteudo, Padding = new Thickness(20, 10, 20, 10) };
        pilula.SetResourceReference(Border.BackgroundProperty, "bg.raised");
        pilula.SetResourceReference(Border.BorderBrushProperty, "border.strong");
        pilula.SetResourceReference(Border.BorderThicknessProperty, "border.width");
        pilula.SetResourceReference(Border.CornerRadiusProperty, "radius.pill");
        return pilula;
    }

    protected override void OnHandleCreated()
    {
        base.OnHandleCreated();
        // Pílula: o DWM arredonda por fora e a borda por dentro; sem canto quadrado sobrando.
    }

    protected override void Place(MonitorArea a)
    {
        // Mede o conteúdo para saber o tamanho antes de posicionar.
        Measure(new Size(double.PositiveInfinity, double.PositiveInfinity));
        var w = a.Px(DesiredSize.Width);
        var h = a.Px(DesiredSize.Height);

        var x = a.WorkLeft + (a.WorkWidth - w) / 2;
        var y = a.WorkTop + a.WorkHeight - h - a.Px(Token("space.32"));

        PlacePhysical(a, x, y, w, h);
    }

    protected override void OnDismissed()
    {
        _timer.Stop();
        base.OnDismissed();
    }
}
