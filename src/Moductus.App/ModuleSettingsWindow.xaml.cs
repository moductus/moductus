using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using Moductus.UI;

namespace Moductus.App;

/// <summary>
/// A configuração de um módulo, em janela própria. O painel vinha inline,
/// abaixo da grade de cartões: empurrava a grade para baixo, obrigava a rolar
/// para ver o que se estava ajustando, e não tinha relação visual com o cartão
/// que o abriu.
/// </summary>
/// <remarks>
/// O painel é um <see cref="UserControl"/> cacheado pelo dono, reaproveitado
/// entre aberturas para não perder o que foi digitado e não gravado. Por isso
/// o <c>Corpo</c> é esvaziado ao fechar: um elemento do WPF só pode ter um pai
/// lógico, e reabrir sem soltar derruba o app na segunda vez.
/// </remarks>
public partial class ModuleSettingsWindow : Window
{
    internal ModuleSettingsWindow(Theme theme, string nome, string descricao, UserControl painel)
    {
        InitializeComponent();

        Title = $"Moductus · {nome}";
        Titulo.Text = nome;
        Descricao.Text = descricao;
        Corpo.Content = painel;

        SourceInitialized += (_, _) => TitleBar.Sync(this, theme);

        // Solta o painel ao fechar, para a próxima abertura poder readotá-lo.
        Closed += (_, _) => Corpo.Content = null;
    }

    private void OnFecharClick(object sender, RoutedEventArgs e) => Close();

    private void OnKeyDown(object sender, KeyEventArgs e)
    {
        if (e.Key == Key.Escape)
        {
            Close();
        }
    }
}
