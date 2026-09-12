using System.Windows;
using System.Windows.Controls;

namespace Moductus.UI.Modules;

/// <summary>
/// As peças do painel que <c>BuildSettings()</c> devolve.
/// </summary>
/// <remarks>
/// <para>
/// Os doze painéis de configuração são a mesma coisa doze vezes: uma linha com
/// rótulo, campo e explicação, mais notas em texto pequeno. Escritos um a um,
/// cada módulo inventava a própria largura de rótulo — 64, 72, 96 e 128 —, e a
/// diferença não era decisão de nenhum deles.
/// </para>
/// <para>
/// Aqui a coluna do rótulo é uma só, do tamanho que serve ao mais longo. É o
/// mesmo motivo dos quatro arquétipos: módulo novo não decide nada de visual.
/// </para>
/// </remarks>
public static class SettingsUI
{
    /// <summary>
    /// A frase pequena que explica a consequência de um ajuste, ou o que muda
    /// e quando. Estado sem explicação é o que faz a pessoa não mexer em nada.
    /// </summary>
    public static TextBlock Note(string texto)
    {
        var t = new TextBlock { Text = texto, TextWrapping = TextWrapping.Wrap };
        t.SetResourceReference(FrameworkElement.StyleProperty, "style.caption");
        t.SetResourceReference(FrameworkElement.MarginProperty, "inset.4");
        return t;
    }

    /// <summary>
    /// Caixa de número: estreita, com o valor alinhado à direita, porque o que
    /// se compara entre linhas é a unidade e não o primeiro dígito.
    /// </summary>
    public static TextBox NumberBox(string valor)
    {
        var caixa = new TextBox
        {
            Text = valor,
            HorizontalContentAlignment = HorizontalAlignment.Right,
            VerticalAlignment = VerticalAlignment.Center,
        };

        caixa.SetResourceReference(FrameworkElement.WidthProperty, "size.settings.field");
        return caixa;
    }

    /// <summary>
    /// Uma linha de ajuste: rótulo à esquerda, campo em seguida, e a explicação
    /// ocupando o que sobrar.
    /// </summary>
    public static FrameworkElement Row(string rotulo, string dica, FrameworkElement campo)
    {
        var detalhe = new TextBlock
        {
            Text = dica,
            VerticalAlignment = VerticalAlignment.Center,
            TextWrapping = TextWrapping.Wrap,
        };
        detalhe.SetResourceReference(FrameworkElement.StyleProperty, "style.caption");
        detalhe.SetResourceReference(FrameworkElement.MarginProperty, "inset.8");

        // A explicação é o último filho e é ela que estica: o campo fica do
        // tamanho que pediu, e o texto usa o resto da largura.
        var linha = (DockPanel)Row(rotulo, campo, esticar: false);
        linha.LastChildFill = true;
        linha.Children.Add(detalhe);

        return linha;
    }

    /// <summary>
    /// A mesma linha sem explicação ao lado. Com <paramref name="esticar"/>, o
    /// campo toma a largura que sobra — é o que um caminho de arquivo precisa,
    /// e o que uma caixa de número não quer.
    /// </summary>
    public static FrameworkElement Row(string rotulo, FrameworkElement campo, bool esticar = false)
    {
        var nome = new TextBlock { Text = rotulo, VerticalAlignment = VerticalAlignment.Center };
        nome.SetResourceReference(FrameworkElement.MinWidthProperty, "size.settings.label");

        var linha = new DockPanel { LastChildFill = esticar };
        linha.SetResourceReference(FrameworkElement.MarginProperty, "inset.4");
        DockPanel.SetDock(nome, Dock.Left);
        linha.Children.Add(nome);

        if (!esticar)
        {
            DockPanel.SetDock(campo, Dock.Left);
        }

        linha.Children.Add(campo);
        return linha;
    }
}
