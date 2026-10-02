using System.Windows;
using System.Windows.Media;
using System.Windows.Media.Animation;

namespace Moductus.UI;

/// <summary>
/// Desliza o polegar do <c>style.switch</c> de uma ponta à outra do trilho.
/// </summary>
/// <remarks>
/// <para>
/// Existe porque o XAML não consegue fazer isso sozinho sem quebrar uma regra
/// do produto. Storyboard dentro de template é congelado, e congelado não
/// aceita <c>DynamicResource</c>: a duração teria de ser <c>StaticResource</c>
/// e ficaria presa ao <c>Motion.xaml</c> que estava carregado quando o
/// template nasceu. Quem desliga as animações na acessibilidade continuaria
/// vendo o polegar correr. Aqui a duração é lida no instante da troca, do
/// dicionário em vigor — com o reduzido, ela vale zero e o polegar salta.
/// </para>
/// <para>
/// O curso também sai do layout, não de número: a largura do trilho menos o
/// polegar e o vão dele, todos vindos dos tokens.
/// </para>
/// </remarks>
public static class SwitchMotion
{
    /// <summary>
    /// Ligado no elemento do polegar, com <c>{TemplateBinding IsChecked}</c>.
    /// Anulável porque <c>IsChecked</c> é: o estado indeterminado fica na
    /// ponta de desligado.
    /// </summary>
    public static readonly DependencyProperty OnProperty = DependencyProperty.RegisterAttached(
        "On",
        typeof(bool?),
        typeof(SwitchMotion),
        new PropertyMetadata(null, OnOnChanged));

    public static bool? GetOn(DependencyObject element) => (bool?)element.GetValue(OnProperty);

    public static void SetOn(DependencyObject element, bool? value) => element.SetValue(OnProperty, value);

    private static void OnOnChanged(DependencyObject d, DependencyPropertyChangedEventArgs e)
    {
        if (d is not FrameworkElement polegar)
        {
            return;
        }

        // Primeira vez neste polegar: o transform é nosso, e a posição inicial
        // é acertada sem animação quando o layout existir. Animar ao nascer
        // faria todo switch ligado deslizar ao abrir a janela.
        if (polegar.RenderTransform is not TranslateTransform { IsFrozen: false })
        {
            polegar.RenderTransform = new TranslateTransform();
            polegar.Loaded += (_, _) => Posicionar(polegar, animar: false);
        }

        Posicionar(polegar, animar: polegar.IsLoaded);
    }

    private static void Posicionar(FrameworkElement polegar, bool animar)
    {
        if (VisualTreeHelper.GetParent(polegar) is not FrameworkElement trilho || trilho.ActualWidth <= 0)
        {
            return;
        }

        var margem = polegar.Margin;
        var curso = Math.Max(0, trilho.ActualWidth - polegar.ActualWidth - margem.Left - margem.Right);
        var destino = GetOn(polegar) == true ? curso : 0;
        var transform = (TranslateTransform)polegar.RenderTransform;

        if (!animar)
        {
            transform.BeginAnimation(TranslateTransform.XProperty, null);
            transform.X = destino;
            return;
        }

        var duracao = polegar.TryFindResource("motion.hover") as Duration? ?? new Duration(TimeSpan.Zero);
        transform.BeginAnimation(TranslateTransform.XProperty, new DoubleAnimation(destino, duracao)
        {
            EasingFunction = polegar.TryFindResource("ease.out") as IEasingFunction,
        });
    }
}
