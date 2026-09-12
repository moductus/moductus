using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using System.Windows.Media.Animation;
using System.Windows.Shapes;
using System.Windows.Threading;
using Moductus.Core.Interop;

namespace Moductus.UI.Archetypes;

/// <summary>Como o HUD se colore. Muda só o ponto, nunca o fundo.</summary>
public enum HudTone
{
    /// <summary>Aconteceu. O caso comum.</summary>
    Neutro,

    /// <summary>Terminou bem — contagem concluída, arquivo gravado.</summary>
    Sucesso,

    /// <summary>Não deu, mas não é erro de programa.</summary>
    Alerta,
}

/// <summary>
/// HUD: pílula pequena, ancorada embaixo. Transitória, não aceita clique,
/// nunca rouba foco. Puro feedback.
/// </summary>
/// <remarks>
/// <para>
/// Duas linhas: a primeira diz o que aconteceu, a segunda dá o detalhe que
/// evita a próxima pergunta. "Copiado" sozinho obriga a pessoa a conferir; o
/// detalhe existe para ela não precisar.
/// </para>
/// <para>
/// A permanência acompanha o tamanho do texto. Um aviso de duas palavras e um
/// de duas linhas não podem sumir no mesmo instante — o segundo nem terminou
/// de ser lido.
/// </para>
/// </remarks>
public class HudWindow : ArchetypeWindow
{
    private static readonly TimeSpan Minima = TimeSpan.FromMilliseconds(1600);
    private static readonly TimeSpan Maxima = TimeSpan.FromMilliseconds(4200);

    /// <summary>Tempo de leitura por caractere, folgado de propósito.</summary>
    private static readonly TimeSpan PorLetra = TimeSpan.FromMilliseconds(38);

    private readonly TextBlock _titulo = new();
    private readonly TextBlock _detalhe = new();
    private readonly Ellipse _ponto = new();
    private readonly DispatcherTimer _timer = new();

    private Border? _pilula;
    private bool _saindo;

    public HudWindow() : base(stealsFocus: false)
    {
        IsHitTestVisible = false;
        _timer.Tick += (_, _) => Sair();
    }

    /// <summary>Mostra o texto e reinicia a contagem para sumir.</summary>
    public void Flash(string text) => Flash(text, null);

    /// <summary>
    /// Mostra título, detalhe opcional e o tom do ponto, e reinicia a
    /// contagem para sumir.
    /// </summary>
    public void Flash(string titulo, string? detalhe, HudTone tom = HudTone.Neutro)
    {
        _titulo.Text = titulo;
        _detalhe.Text = detalhe ?? string.Empty;
        _detalhe.Visibility = string.IsNullOrEmpty(detalhe) ? Visibility.Collapsed : Visibility.Visible;

        _ponto.SetResourceReference(Shape.FillProperty, tom switch
        {
            HudTone.Sucesso => "success",
            HudTone.Alerta => "danger",
            _ => "accent",
        });

        // Uma linha fecha em pílula; duas linhas em pílula viram um comprimido
        // torto, então o raio cai para o de cartão.
        _pilula?.SetResourceReference(
            Border.CornerRadiusProperty,
            _detalhe.Visibility == Visibility.Visible ? "radius.card" : "radius.pill");

        _timer.Stop();
        _timer.Interval = Permanencia(titulo, detalhe);

        _saindo = false;
        BeginAnimation(OpacityProperty, null);
        Opacity = 1;

        Present();
        _timer.Start();
    }

    private static TimeSpan Permanencia(string titulo, string? detalhe)
    {
        var letras = titulo.Length + (detalhe?.Length ?? 0);
        var leitura = Minima + PorLetra * letras;
        return leitura > Maxima ? Maxima : leitura;
    }

    protected override FrameworkElement BuildChrome(ContentPresenter slot)
    {
        _ponto.Width = 8;
        _ponto.Height = 8;
        _ponto.VerticalAlignment = VerticalAlignment.Center;
        _ponto.Margin = new Thickness(0, 0, 12, 0);

        _titulo.SetResourceReference(TextBlock.FontSizeProperty, "type.body-lg");
        _titulo.SetResourceReference(TextBlock.LineHeightProperty, "type.body-lg.line");
        _titulo.SetResourceReference(TextBlock.FontWeightProperty, "weight.semibold");
        _titulo.TextWrapping = TextWrapping.NoWrap;
        _titulo.TextTrimming = TextTrimming.CharacterEllipsis;

        _detalhe.SetResourceReference(FrameworkElement.StyleProperty, "style.caption");
        _detalhe.TextWrapping = TextWrapping.NoWrap;
        _detalhe.TextTrimming = TextTrimming.CharacterEllipsis;
        _detalhe.Visibility = Visibility.Collapsed;

        var texto = new StackPanel { VerticalAlignment = VerticalAlignment.Center };
        texto.Children.Add(_titulo);
        texto.Children.Add(_detalhe);

        var conteudo = new StackPanel { Orientation = Orientation.Horizontal };
        conteudo.Children.Add(_ponto);
        conteudo.Children.Add(texto);
        conteudo.Children.Add(slot);

        _pilula = new Border { Child = conteudo, Padding = new Thickness(16, 8, 16, 8) };

        // Mensagem de erro carrega texto de exceção, que não tem tamanho. Sem
        // teto a pílula fica mais larga que o monitor e sangra pelas bordas.
        _pilula.SetResourceReference(FrameworkElement.MaxWidthProperty, "size.palette.width");
        _pilula.SetResourceReference(Border.BackgroundProperty, "bg.raised");
        _pilula.SetResourceReference(Border.BorderBrushProperty, "border.strong");
        _pilula.SetResourceReference(Border.BorderThicknessProperty, "border.width");
        _pilula.SetResourceReference(Border.CornerRadiusProperty, "radius.pill");

        // Sem sombra: a janela é dimensionada exatamente na pílula e não tem
        // AllowsTransparency, então o halo inteiro cairia fora da área cliente.
        // Custava um passe de render para não aparecer. Quem separa a pílula do
        // fundo é a borda.

        return _pilula;
    }

    protected override void Enter()
    {
        base.Enter();

        var duracao = (Duration)FindResource("motion.enter");
        if (!duracao.HasTimeSpan || duracao.TimeSpan == TimeSpan.Zero)
        {
            return;
        }

        BeginAnimation(OpacityProperty, new DoubleAnimation(0, 1, duracao)
        {
            EasingFunction = (IEasingFunction)FindResource("ease.out"),
        });
    }

    /// <summary>
    /// Some com fade em vez de desaparecer de um quadro para o outro. Sumiço
    /// seco no canto da tela é o que faz notificação parecer falha de desenho.
    /// </summary>
    private void Sair()
    {
        _timer.Stop();

        if (_saindo || !IsVisible)
        {
            return;
        }

        var duracao = (Duration)FindResource("motion.exit");
        if (!duracao.HasTimeSpan || duracao.TimeSpan == TimeSpan.Zero)
        {
            Dismiss();
            return;
        }

        _saindo = true;

        var fade = new DoubleAnimation(1, 0, duracao)
        {
            EasingFunction = (IEasingFunction)FindResource("ease.in"),
        };

        fade.Completed += (_, _) =>
        {
            if (_saindo)
            {
                Dismiss();
            }
        };

        BeginAnimation(OpacityProperty, fade);
    }

    protected override void Place(MonitorArea a)
    {
        // SizeToContent + UpdateLayout, não Measure: quando a mensagem anterior
        // não mudou o tamanho da janela não há WM_SIZE, o DesiredSize fica em
        // cache e a pílula é posicionada com a medida da mensagem passada — sai
        // fora do centro e corta a segunda linha. A PaletteWindow já faz assim.
        SizeToContent = SizeToContent.WidthAndHeight;
        UpdateLayout();

        var w = a.Px(ActualWidth);
        var h = a.Px(ActualHeight);

        var x = a.WorkLeft + (a.WorkWidth - w) / 2;
        var y = a.WorkTop + a.WorkHeight - h - a.Px(Token("space.32"));

        PlacePhysical(a, x, y, w, h);
    }

    protected override void OnDismissed()
    {
        _timer.Stop();
        _saindo = false;
        BeginAnimation(OpacityProperty, null);
        Opacity = 1;
        base.OnDismissed();
    }
}
