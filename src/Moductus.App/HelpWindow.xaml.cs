using System.Windows;
using System.Windows.Input;
using Moductus.Core.Leader;
using Moductus.Core.Modules;
using Moductus.UI;

namespace Moductus.App;

/// <summary>
/// A tela que explica o produto. Existe porque um app sem janela principal,
/// acionado por uma combinação que ninguém adivinha, é indistinguível de um
/// app quebrado na primeira execução.
/// </summary>
/// <remarks>
/// Abre sozinha uma vez, na primeira vez que o Moductus sobe, e nunca mais —
/// a menos que o usuário peça pelo menu da bandeja. Tutorial que reaparece é
/// a razão de as pessoas aprenderem a fechar tutorial sem ler.
/// </remarks>
public partial class HelpWindow : Window
{
    private readonly Action<bool> _guardarPreferencia;

    private sealed record Passo(string Tecla, string Titulo, string Detalhe);

    internal HelpWindow(
        Theme theme,
        string atalhoLider,
        IReadOnlyList<IModule> modulos,
        IReadOnlyList<LeaderKeyRegistration> letras,
        bool abrirNoInicio,
        Action<bool> guardarPreferencia)
    {
        InitializeComponent();

        _guardarPreferencia = guardarPreferencia;
        NaoMostrarMais.IsChecked = !abrirNoInicio;

        SourceInitialized += (_, _) => TitleBar.Sync(this, theme);

        Passos.ItemsSource = new List<Passo>
        {
            new(atalhoLider, "Chame o Moductus", "De qualquer lugar, em qualquer aplicativo. Uma tecla só, e ela é configurável."),
            new("letra", "Escolha o módulo", "A tela mostra as letras disponíveis. Você não precisa decorar nada para começar."),
            new("Esc", "Saia de qualquer lugar", "Esc fecha o que estiver aberto. Repetir o atalho do módulo também fecha."),
        };

        // A letra vem do registro, não da inicial do nome: três módulos
        // disputariam o "p", e o usuário pode ter trocado qualquer uma.
        var porModulo = letras.ToDictionary(l => l.ModuleId);

        Modulos.ItemsSource = modulos
            .Select(m => new Passo(
                porModulo.TryGetValue(m.Id, out var l) && l.Active ? l.Key.ToString().ToUpperInvariant() : "—",
                m.Name,
                m.Description))
            .ToList();
    }

    private void OnNaoMostrarClick(object sender, RoutedEventArgs e) =>
        _guardarPreferencia(NaoMostrarMais.IsChecked != true);

    private void OnFecharClick(object sender, RoutedEventArgs e) => Close();

    private void OnKeyDown(object sender, KeyEventArgs e)
    {
        if (e.Key == Key.Escape)
        {
            Close();
        }
    }
}
