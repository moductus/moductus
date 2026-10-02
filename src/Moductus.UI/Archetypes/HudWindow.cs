using System.Windows;
using System.Windows.Controls;
using System.Windows.Documents;
using System.Windows.Media;
using System.Windows.Media.Animation;
using System.Windows.Shapes;
using System.Windows.Threading;
using Moductus.Core.Interop;

namespace Moductus.UI.Archetypes;

/// <summary>
/// Como o HUD e a pastilha se colorem. Muda o ponto e o ícone, nunca o fundo.
/// </summary>
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
/// O que cada tom pinta e desenha. Num lugar só, para a pílula do HUD e a
/// pastilha não divergirem no dia em que alguém mexer numa delas.
/// </summary>
/// <remarks>
/// O glifo sai do tom porque nenhum módulo escolhe ícone hoje: o contrato do
/// HUD é título, detalhe e tom. Com isso o quadrado diz "deu certo", "deu
/// errado" ou "aconteceu" antes de o texto ser lido — o mesmo que o ponto diz,
/// em tamanho que se acha com o canto do olho.
/// </remarks>
internal static class TomVisual
{
    /// <summary>Preenchimento do ponto de estado.</summary>
    public static string Ponto(HudTone tom) => tom switch
    {
        HudTone.Sucesso => "success",
        HudTone.Alerta => "danger",
        _ => "accent",
    };

    /// <summary>
    /// Cor do glifo. O neutro é accent.text e não accent: glifo é traço fino,
    /// lê como texto, e o accent cheio do Lima claro some sobre bg.inset.
    /// </summary>
    public static string Glifo(HudTone tom) => tom switch
    {
        HudTone.Sucesso => "success",
        HudTone.Alerta => "danger",
        _ => "accent.text",
    };

    /// <summary>
    /// CheckMark, Warning e Info do Segoe Fluent Icons — pontos de código que
    /// o Segoe MDL2 Assets do Windows 10 também tem, por isso a pilha de
    /// font.icon funciona nos dois.
    /// </summary>
    public static string Simbolo(HudTone tom) => tom switch
    {
        HudTone.Sucesso => "",
        HudTone.Alerta => "",
        _ => "",
    };
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
/// <para>
/// "Pílula" ficou como nome, não como forma: o raio é o do recorte do DWM, o
/// único que a janela consegue ter sem <c>AllowsTransparency</c>. Com raio de
/// pílula sobrava fundo quadrado em volta das duas pontas.
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
    private readonly Border _icone = new();
    private readonly TextBlock _glifo = new();
    private readonly Border _brilho = new();
    private readonly DispatcherTimer _timer = new();

    private Border? _pilula;
    private bool _saindo;

    public HudWindow() : base(stealsFocus: false)
    {
        IsHitTestVisible = false;
        _timer.Tick += (_, _) => Sair();
    }

    /// <summary>A pílula é a superfície elevada, não o fundo da janela.</summary>
    protected override string FundoTranslucido => "bg.raised.tint";

    /// <summary>Mostra o texto e reinicia a contagem para sumir.</summary>
    public void Flash(string text) => Flash(text, null);

    /// <summary>
    /// Mostra título, detalhe opcional e o tom do ponto e do ícone, e
    /// reinicia a contagem para sumir.
    /// </summary>
    public void Flash(string titulo, string? detalhe, HudTone tom = HudTone.Neutro)
    {
        _titulo.Text = titulo;
        _detalhe.Text = detalhe ?? string.Empty;
        _detalhe.Visibility = string.IsNullOrEmpty(detalhe) ? Visibility.Collapsed : Visibility.Visible;

        _ponto.SetResourceReference(Shape.FillProperty, TomVisual.Ponto(tom));
        _glifo.Text = TomVisual.Simbolo(tom);
        _icone.SetResourceReference(TextElement.ForegroundProperty, TomVisual.Glifo(tom));

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
        // Ícone à esquerda, ponto à direita: o quadrado é o que o olho acha
        // primeiro, e o ponto fecha a linha no lado oposto em vez de disputar
        // com ele o mesmo canto.
        _glifo.SetResourceReference(FrameworkElement.StyleProperty, "style.status.glyph");
        _icone.Child = _glifo;
        _icone.SetResourceReference(FrameworkElement.StyleProperty, "style.status.icon");
        _icone.SetResourceReference(FrameworkElement.MarginProperty, "inset.end.12");

        _ponto.SetResourceReference(FrameworkElement.StyleProperty, "style.dot");
        _ponto.SetResourceReference(FrameworkElement.MarginProperty, "inset.start.12");

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
        conteudo.SetResourceReference(FrameworkElement.MarginProperty, "inset.pill");
        conteudo.Children.Add(_icone);
        conteudo.Children.Add(texto);
        conteudo.Children.Add(slot);
        conteudo.Children.Add(_ponto);

        // A folga é margem do conteúdo, não Padding da pílula: o brilho de
        // cima tem de encostar na borda, e Padding o empurraria para dentro.
        _brilho.SetResourceReference(FrameworkElement.StyleProperty, "style.surface.highlight");

        var camadas = new Grid();
        camadas.Children.Add(conteudo);
        camadas.Children.Add(_brilho);

        _pilula = new Border { Child = camadas };
        Superficie = _pilula;

        // Mensagem de erro carrega texto de exceção, que não tem tamanho. Sem
        // teto a pílula fica mais larga que o monitor e sangra pelas bordas.
        _pilula.SetResourceReference(FrameworkElement.MaxWidthProperty, "size.palette.width");
        _pilula.SetResourceReference(Border.BackgroundProperty, "bg.raised");
        _pilula.SetResourceReference(Border.BorderBrushProperty, "border.strong");
        _pilula.SetResourceReference(Border.BorderThicknessProperty, "border.width");

        // Não é pílula de raio 999, por mais que o nome tenha ficado: a janela
        // é do tamanho exato dela e quem arredonda a janela é o recorte do DWM,
        // em raio fixo. Com 999 as duas pontas ficavam dentro de um retângulo
        // recortado em 8, e sobrava fundo quadrado em volta das curvas. O raio
        // certo é o do recorte; OnSuperficieDecidida derruba para canto vivo
        // onde o sistema nem conhece o atributo de recorte.
        _pilula.SetResourceReference(Border.CornerRadiusProperty, "radius.clip");

        // Sem sombra: a janela é dimensionada exatamente na pílula e não tem
        // AllowsTransparency, então o halo inteiro cairia fora da área cliente.
        // Custava um passe de render para não aparecer. Quem separa a pílula do
        // fundo é a borda.

        return _pilula;
    }

    protected override void OnSuperficieDecidida()
    {
        _pilula?.SetResourceReference(Border.CornerRadiusProperty, RaioDaSuperficie);

        // O brilho acompanha a curva da pílula; com o raio do recorte num
        // canto vivo ele sobraria arredondado por dentro do retângulo.
        _brilho.SetResourceReference(Border.CornerRadiusProperty, RaioDaSuperficie);
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
