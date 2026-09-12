using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Shapes;
using Moductus.Core.Interop;

namespace Moductus.UI.Archetypes;

/// <summary>Um botão da pastilha. O rótulo é curto: cabe ao lado de outros dois.</summary>
/// <param name="Rotulo">Uma ou duas palavras. "Pausar", "+5 min", "Parar".</param>
/// <param name="Dica">O que acontece. Vai no tooltip.</param>
/// <param name="Executar">A ação.</param>
public sealed record BadgeAction(string Rotulo, string? Dica, Action Executar);

/// <summary>
/// Badge: pastilha pequena e permanente no canto da tela, uma por módulo,
/// que fica enquanto o estado durar e desfaz o estado quando clicada.
/// </summary>
/// <remarks>
/// <para>
/// É a resposta a um buraco do produto: módulos de estado — Mic mudo, Awake
/// ligado, Timer contando — comunicavam pelo ícone da bandeja, e o Windows 11
/// esconde ícone novo atrás da setinha de estouro. O estado existia e ninguém
/// via. Pior: desfazer exigia repetir a tecla líder inteira, quando o gesto
/// natural é clicar no aviso que está na tela.
/// </para>
/// <para>
/// Empilha: mic mudo e pomodoro rodando ao mesmo tempo são duas pastilhas,
/// não uma disputa. Isso é o oposto do ícone de bandeja, que é único e
/// resolvido por prioridade — e é por isso que os dois existem.
/// </para>
/// <para>
/// Não rouba foco nem entra no Alt+Tab. Clique funciona mesmo sem ativação,
/// que é o ponto de <c>WS_EX_NOACTIVATE</c>.
/// </para>
/// </remarks>
public class BadgeWindow : ArchetypeWindow
{
    private readonly StackPanel _pilha = new();
    private readonly List<Entrada> _entradas = [];

    public BadgeWindow() : base(stealsFocus: false)
    {
    }

    /// <summary>
    /// Sem material: a janela cobre a união das pastilhas, vãos inclusive, e
    /// o Acrylic pintaria os vãos também — viraria um bloco borrado em vez de
    /// pastilhas soltas. Cada pastilha traz o próprio fundo.
    /// </summary>
    protected override Dwm.Backdrop Material => Dwm.Backdrop.None;

    /// <summary>Há alguma pastilha no ar?</summary>
    public bool TemAlguma => _entradas.Count > 0;

    /// <summary>
    /// Mostra ou atualiza a pastilha de um dono. Chamar de novo com o mesmo
    /// dono troca o texto no lugar, sem piscar.
    /// </summary>
    /// <param name="owner">Id do módulo. Uma pastilha por dono.</param>
    /// <param name="texto">Curto: cabe numa pastilha, não numa frase.</param>
    /// <param name="dica">O que o clique faz. Aparece menor, embaixo.</param>
    /// <param name="tom">Cor do ponto.</param>
    /// <param name="aoClicar">
    /// O que o clique no corpo da pastilha faz. Nulo deixa o corpo inerte —
    /// use quando houver botões, senão clicar sem querer dispara a ação.
    /// </param>
    /// <param name="acoes">
    /// Botões. Estado que só dá para desfazer é estado que a pessoa desfaz
    /// cedo demais: um pomodoro precisa de pausar e esticar, não só de parar.
    /// </param>
    public void Fixar(
        string owner,
        string texto,
        string? dica,
        HudTone tom,
        Action? aoClicar,
        IReadOnlyList<BadgeAction>? acoes = null)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(owner);

        var entrada = _entradas.FirstOrDefault(e => e.Owner == owner);

        if (entrada is null)
        {
            entrada = new Entrada(owner, Construir());
            _entradas.Add(entrada);
            _pilha.Children.Add(entrada.Raiz);
        }

        entrada.Atualizar(texto, dica, tom, aoClicar, acoes);
        Mostrar();
    }

    /// <summary>Tira a pastilha do dono. Sem nenhuma sobrando, a janela some.</summary>
    public void Soltar(string owner)
    {
        var entrada = _entradas.FirstOrDefault(e => e.Owner == owner);

        if (entrada is null)
        {
            return;
        }

        _entradas.Remove(entrada);
        _pilha.Children.Remove(entrada.Raiz);

        if (_entradas.Count == 0)
        {
            Dismiss();
            return;
        }

        Mostrar();
    }

    /// <summary>O dono tem pastilha no ar?</summary>
    public bool TemDe(string owner) => _entradas.Any(e => e.Owner == owner);

    private void Mostrar()
    {
        // Present recoloca e redimensiona; com a janela já visível ele não
        // reanima, que é o que queremos ao trocar só o texto.
        Present();
    }

    protected override FrameworkElement BuildChrome(ContentPresenter slot)
    {
        _pilha.Orientation = Orientation.Vertical;

        var raiz = new StackPanel();
        raiz.Children.Add(_pilha);
        raiz.Children.Add(slot);
        return raiz;
    }

    protected override void Place(MonitorArea a)
    {
        SizeToContent = SizeToContent.WidthAndHeight;
        UpdateLayout();

        var w = a.Px(ActualWidth);
        var h = a.Px(ActualHeight);

        // Canto inferior direito, acima da barra: é onde o olho já procura
        // notificação no Windows, e é longe do centro, onde o trabalho está.
        var folga = a.Px(Token("space.16"));
        var x = a.WorkLeft + a.WorkWidth - w - folga;
        var y = a.WorkTop + a.WorkHeight - h - folga;

        PlacePhysical(a, x, y, w, h);
    }

    private static Pastilha Construir() => new();

    private sealed class Entrada(string owner, Pastilha pastilha)
    {
        public string Owner { get; } = owner;

        public FrameworkElement Raiz => pastilha.Raiz;

        public void Atualizar(string texto, string? dica, HudTone tom, Action? aoClicar, IReadOnlyList<BadgeAction>? acoes) =>
            pastilha.Atualizar(texto, dica, tom, aoClicar, acoes);
    }

    /// <summary>Uma pastilha: ponto colorido, texto, dica, e o clique que desfaz.</summary>
    private sealed class Pastilha
    {
        private readonly Ellipse _ponto = new() { Width = 8, Height = 8, VerticalAlignment = VerticalAlignment.Center };
        private readonly TextBlock _texto = new() { TextWrapping = TextWrapping.NoWrap };
        private readonly TextBlock _dica = new() { TextWrapping = TextWrapping.NoWrap };
        private readonly StackPanel _botoes = new();
        private readonly Border _moldura;

        private Action? _aoClicar;

        public Pastilha()
        {
            _ponto.Margin = new Thickness(0, 0, 12, 0);

            _texto.SetResourceReference(TextBlock.FontSizeProperty, "type.body");
            _texto.SetResourceReference(TextBlock.LineHeightProperty, "type.body.line");
            _texto.SetResourceReference(TextBlock.FontWeightProperty, "weight.semibold");
            _texto.TextTrimming = TextTrimming.CharacterEllipsis;

            _dica.SetResourceReference(FrameworkElement.StyleProperty, "style.caption");
            _dica.TextTrimming = TextTrimming.CharacterEllipsis;
            _dica.Visibility = Visibility.Collapsed;

            _botoes.Orientation = Orientation.Horizontal;
            _botoes.Margin = new Thickness(0, 8, 0, 0);
            _botoes.Visibility = Visibility.Collapsed;

            var coluna = new StackPanel { VerticalAlignment = VerticalAlignment.Center };
            coluna.Children.Add(_texto);
            coluna.Children.Add(_dica);
            coluna.Children.Add(_botoes);

            var linha = new StackPanel { Orientation = Orientation.Horizontal };
            linha.Children.Add(_ponto);
            linha.Children.Add(coluna);

            _moldura = new Border
            {
                Child = linha,
                Padding = new Thickness(12, 8, 16, 8),
                Margin = new Thickness(0, 4, 0, 0),
                MaxWidth = 320,
            };

            _moldura.SetResourceReference(Border.BackgroundProperty, "bg.raised");
            _moldura.SetResourceReference(Border.BorderBrushProperty, "border.strong");
            _moldura.SetResourceReference(Border.BorderThicknessProperty, "border.width");
            // Cartão, não pílula: o raio de pílula é para uma linha só. Num
            // bloco de duas linhas com botões ele vira um comprimido torto.
            _moldura.SetResourceReference(Border.CornerRadiusProperty, "radius.card");

            _moldura.MouseLeftButtonUp += (_, e) =>
            {
                e.Handled = true;
                _aoClicar?.Invoke();
            };

            _moldura.MouseEnter += (_, _) => _moldura.SetResourceReference(Border.BackgroundProperty, "bg.hover");
            _moldura.MouseLeave += (_, _) => _moldura.SetResourceReference(Border.BackgroundProperty, "bg.raised");
        }

        public FrameworkElement Raiz => _moldura;

        public void Atualizar(string texto, string? dica, HudTone tom, Action? aoClicar, IReadOnlyList<BadgeAction>? acoes)
        {
            _texto.Text = texto;
            _dica.Text = dica ?? string.Empty;
            _dica.Visibility = string.IsNullOrEmpty(dica) ? Visibility.Collapsed : Visibility.Visible;

            _aoClicar = aoClicar;
            _moldura.Cursor = aoClicar is null ? Cursors.Arrow : Cursors.Hand;

            MontarBotoes(acoes);

            _ponto.SetResourceReference(Shape.FillProperty, tom switch
            {
                HudTone.Sucesso => "success",
                HudTone.Alerta => "danger",
                _ => "accent",
            });
        }

        /// <summary>
        /// Reaproveita os botões que já estão lá. Recriar a cada tique faria a
        /// pastilha piscar uma vez por segundo e perder o clique no meio.
        /// </summary>
        private void MontarBotoes(IReadOnlyList<BadgeAction>? acoes)
        {
            var quantos = acoes?.Count ?? 0;
            _botoes.Visibility = quantos == 0 ? Visibility.Collapsed : Visibility.Visible;

            while (_botoes.Children.Count > quantos)
            {
                _botoes.Children.RemoveAt(_botoes.Children.Count - 1);
            }

            while (_botoes.Children.Count < quantos)
            {
                var novo = new Button
                {
                    Height = 24,
                    Padding = new Thickness(10, 0, 10, 0),
                    Margin = new Thickness(0, 0, 8, 0),
                    FontSize = 12,
                };

                // Handler fixo, lendo a ação da Tag: reassinar a cada tique
                // acumularia handlers no mesmo botão.
                novo.Click += (remetente, e) =>
                {
                    e.Handled = true;
                    if (remetente is Button { Tag: BadgeAction acao })
                    {
                        acao.Executar();
                    }
                };

                _botoes.Children.Add(novo);
            }

            for (var i = 0; i < quantos; i++)
            {
                var acao = acoes![i];
                var botao = (Button)_botoes.Children[i];
                botao.Content = acao.Rotulo;
                botao.ToolTip = acao.Dica;
                botao.Tag = acao;
            }
        }
    }
}
