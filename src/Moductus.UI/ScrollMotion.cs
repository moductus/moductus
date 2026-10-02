using System.Windows;
using System.Windows.Controls;
using System.Windows.Controls.Primitives;
using System.Windows.Media;
using System.Windows.Media.Animation;

namespace Moductus.UI;

/// <summary>
/// Engrossa o polegar da barra de rolagem quando o mouse entra na barra, e o
/// afina de volta quando sai.
/// </summary>
/// <remarks>
/// <para>
/// Pelo mesmo motivo do <see cref="SwitchMotion"/>: Storyboard em template é
/// congelado e não aceita a duração por <c>DynamicResource</c>, e quem
/// desligou as animações na acessibilidade continuaria vendo a barra crescer.
/// A duração é lida no instante da troca; com o dicionário reduzido ela vale
/// zero e a barra troca de espessura num quadro.
/// </para>
/// <para>
/// O raio troca junto, e nunca passa da metade da espessura: o WPF transforma
/// <c>CornerRadius</c> maior que metade do lado em ELIPSE, e o polegar de
/// raio "pílula" saía com pontas de ovo. Por isso, ao crescer, o raio largo
/// só entra quando a espessura chegou; ao encolher, o estreito entra antes.
/// Nos poucos quadros do meio a ponta fica um tico menos redonda — invisível
/// em 80ms, e o contrário de oval.
/// </para>
/// </remarks>
public static class ScrollMotion
{
    /// <summary>
    /// Ligado no Border visível do polegar, com o <c>IsMouseOver</c> da
    /// <see cref="ScrollBar"/> que o contém.
    /// </summary>
    public static readonly DependencyProperty ExpandedProperty = DependencyProperty.RegisterAttached(
        "Expanded",
        typeof(bool),
        typeof(ScrollMotion),
        new PropertyMetadata(false, OnExpandedChanged));

    public static bool GetExpanded(DependencyObject element) => (bool)element.GetValue(ExpandedProperty);

    public static void SetExpanded(DependencyObject element, bool value) => element.SetValue(ExpandedProperty, value);

    private static void OnExpandedChanged(DependencyObject d, DependencyPropertyChangedEventArgs e)
    {
        if (d is not Border polegar || Barra(polegar) is not { } barra)
        {
            return;
        }

        var expandir = (bool)e.NewValue;
        var espessura = polegar.TryFindResource(expandir ? "size.scroll.thumb.hover" : "size.scroll.thumb") as double?;
        var raio = expandir ? "radius.scroll.thumb.hover" : "radius.scroll.thumb";

        if (espessura is not { } alvo)
        {
            return;
        }

        // A espessura é a dimensão de través: largura na barra vertical,
        // altura na horizontal. A outra é o comprimento, que é do Track.
        var propriedade = barra.Orientation == Orientation.Vertical
            ? FrameworkElement.WidthProperty
            : FrameworkElement.HeightProperty;

        if (!expandir)
        {
            polegar.SetResourceReference(Border.CornerRadiusProperty, raio);
        }

        var duracao = polegar.TryFindResource("motion.hover") as Duration? ?? new Duration(TimeSpan.Zero);
        var animacao = new DoubleAnimation(alvo, duracao)
        {
            EasingFunction = polegar.TryFindResource("ease.out") as IEasingFunction,
        };

        if (expandir)
        {
            // Só se ainda estiver expandido quando a animação terminar: o mouse
            // pode ter saído no meio, e aí quem manda é o encolher.
            animacao.Completed += (_, _) =>
            {
                if (GetExpanded(polegar))
                {
                    polegar.SetResourceReference(Border.CornerRadiusProperty, raio);
                }
            };
        }

        polegar.BeginAnimation(propriedade, animacao);
    }

    private static ScrollBar? Barra(DependencyObject elemento)
    {
        for (var atual = VisualTreeHelper.GetParent(elemento); atual is not null; atual = VisualTreeHelper.GetParent(atual))
        {
            if (atual is ScrollBar barra)
            {
                return barra;
            }
        }

        return null;
    }
}
