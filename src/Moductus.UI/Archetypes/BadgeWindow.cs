using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Shapes;
using System.Windows.Threading;
using Moductus.Core.Interop;
using Moductus.Core.Layout;

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
/// <b>Uma janela por pastilha, e esta aqui não desenha nada.</b> Uma janela só,
/// cobrindo a união das pastilhas, tinha um defeito que nenhuma API resolve:
/// sem <c>AllowsTransparency</c> o HWND é um retângulo opaco, então o fundo da
/// janela pintava também o vão entre duas pastilhas e fundia as duas num bloco.
/// Com um HWND do tamanho exato de cada cartão o vão volta a ser o desktop por
/// construção, cada pastilha ganha sombra nativa e material do DWM, e o
/// empilhamento deixa de ser um StackPanel para virar conta de coordenada em
/// <see cref="BadgeStack"/>.
/// </para>
/// <para>
/// O que sobrou desta janela é ser dona das outras: toda pastilha tem este
/// HWND como <c>Owner</c>. Ela própria nunca é exibida.
/// </para>
/// <para>
/// <b>O que a posse compra, e o que não compra.</b> Compra destruição em
/// cascata — fechar esta janela fecha as pastilhas que sobraram, que é o que
/// garante nenhum HWND vivo depois do <c>Dispose</c> do host — e mantém as
/// pastilhas juntas na mesma ordem de ativação. <b>Não</b> compra ordem entre
/// as irmãs: a relação de posse só garante a filha acima da dona, e como a
/// dona nunca aparece, nada impede uma terceira janela topmost de se intercalar
/// entre duas pastilhas. Isso é degradação cosmética conhecida, não defeito
/// funcional, e não há API que a resolva sem tirar as pastilhas do topo.
/// </para>
/// <para>
/// A posse não custa o <c>WS_EX_NOACTIVATE</c>: o <c>Owner</c> do WPF escreve
/// em <c>GWLP_HWNDPARENT</c>, e os estilos estendidos entram depois, em
/// <c>SourceInitialized</c>, num índice diferente do mesmo HWND. A dona também
/// é <c>stealsFocus: false</c>, então nem por ela a ativação volta.
/// </para>
/// <para>
/// Não rouba foco nem entra no Alt+Tab. Clique funciona mesmo sem ativação,
/// que é o ponto de <c>WS_EX_NOACTIVATE</c>.
/// </para>
/// </remarks>
public class BadgeWindow : ArchetypeWindow
{
    private readonly List<PastilhaWindow> _pastilhas = [];

    public BadgeWindow() : base(stealsFocus: false)
    {
    }

    /// <summary>Sem material: esta janela não aparece, quem aparece são as pastilhas.</summary>
    protected override Dwm.Backdrop Material => Dwm.Backdrop.None;

    /// <summary>Há alguma pastilha no ar?</summary>
    public bool TemAlguma => _pastilhas.Count > 0;

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

        var pastilha = _pastilhas.FirstOrDefault(p => p.Dono == owner);

        if (pastilha is null)
        {
            // O HWND desta janela precisa existir antes de ela virar Owner de
            // alguém: o WPF recusa Owner de janela que ainda não teve a source
            // window criada. Prewarm é idempotente e sai na hora se já existe.
            // Estar oculta não atrapalha — a posse é GWLP_HWNDPARENT, que não
            // exige dona visível, e esconder a dona não esconde as pastilhas.
            Prewarm();

            pastilha = new PastilhaWindow(owner) { Owner = this };

            // Cria o HWND e paga a primeira renderização antes de qualquer
            // conta de posição: sem isso ActualWidth vem zero e a pilha sai
            // torta na primeira aparição.
            pastilha.Prewarm();

            _pastilhas.Add(pastilha);
        }

        pastilha.Atualizar(texto, dica, tom, aoClicar, acoes);
        Reposicionar();
    }

    /// <summary>Tira a pastilha do dono, fechando a janela dela.</summary>
    public void Soltar(string owner)
    {
        var pastilha = _pastilhas.FirstOrDefault(p => p.Dono == owner);

        if (pastilha is null)
        {
            return;
        }

        _pastilhas.Remove(pastilha);

        // Some agora, some para valer depois. Soltar quase sempre vem de um
        // clique na própria pastilha — é o gesto que o arquétipo existe para
        // oferecer —, e destruir o HWND no meio do roteamento do evento dele
        // desmonta a árvore visual debaixo do WPF. Esconder é seguro dentro do
        // handler; o Close vai para o fim da fila do dispatcher.
        //
        // E fecha, não só esconde: uma janela por pastilha vira HWND acumulado
        // ao longo do processo se soltar apenas escondesse.
        pastilha.Hide();
        pastilha.Dispatcher.BeginInvoke(DispatcherPriority.Background, pastilha.Close);

        Reposicionar();
    }

    /// <summary>O dono tem pastilha no ar?</summary>
    public bool TemDe(string owner) => _pastilhas.Any(p => p.Dono == owner);

    /// <summary>
    /// Mede todas, calcula a pilha e move quem saiu do lugar. É chamado a cada
    /// atualização de texto — inclusive uma vez por segundo, com o Timer
    /// contando —, e por isso só mexe na janela cujo retângulo mudou de fato:
    /// reposicionar as N a cada tique fazia a pilha tremer.
    /// </summary>
    private void Reposicionar()
    {
        if (_pastilhas.Count == 0)
        {
            return;
        }

        var area = Monitors.Around(ForegroundWindow.Capture());

        var tamanhos = new BadgeSize[_pastilhas.Count];
        for (var i = 0; i < _pastilhas.Count; i++)
        {
            tamanhos[i] = _pastilhas[i].Medir(area);
        }

        var lugares = BadgeStack.Empilhar(
            area,
            tamanhos,
            folga: area.Px(Token("space.16")),
            vao: area.Px(Token("space.8")));

        for (var i = 0; i < _pastilhas.Count; i++)
        {
            _pastilhas[i].Mover(area, lugares[i]);
        }
    }

    /// <summary>Esta janela não tem moldura: o slot fica vazio e nada é pintado.</summary>
    protected override FrameworkElement BuildChrome(ContentPresenter slot) => slot;

    protected override void Place(MonitorArea a)
    {
        // Nunca exibida. Se alguém chamar Present, que seja sem tamanho e no
        // canto do monitor — quem aparece são as janelas das pastilhas.
        PlacePhysical(a, a.Left, a.Top, 0, 0);
    }

    protected override void OnClosed(EventArgs e)
    {
        foreach (var pastilha in _pastilhas.ToArray())
        {
            pastilha.Close();
        }

        _pastilhas.Clear();
        base.OnClosed(e);
    }

    /// <summary>
    /// Uma pastilha: ponto colorido, texto, dica e o clique que desfaz, numa
    /// janela do tamanho exato do cartão.
    /// </summary>
    private sealed class PastilhaWindow : ArchetypeWindow
    {
        private readonly Ellipse _ponto = new() { VerticalAlignment = VerticalAlignment.Center };
        private readonly TextBlock _texto = new() { TextWrapping = TextWrapping.NoWrap };
        private readonly TextBlock _dica = new() { TextWrapping = TextWrapping.NoWrap };
        private readonly StackPanel _botoes = new();

        private Border? _moldura;
        private Action? _aoClicar;
        private BadgeSpot _lugar;
        private string _fundo = "bg.raised";

        public PastilhaWindow(string dono) : base(stealsFocus: false) => Dono = dono;

        /// <summary>Id do módulo que fixou esta pastilha.</summary>
        public string Dono { get; }

        /// <summary>A pastilha é a superfície elevada, não o fundo da janela.</summary>
        protected override string FundoTranslucido => "bg.raised.tint";

        /// <summary>
        /// Mede o cartão em pixels físicos do monitor de destino. Separado do
        /// posicionamento porque a pilha inteira precisa das medidas antes de
        /// qualquer uma saber onde fica.
        /// </summary>
        public BadgeSize Medir(MonitorArea a)
        {
            SizeToContent = SizeToContent.WidthAndHeight;
            UpdateLayout();
            return new BadgeSize(a.Px(ActualWidth), a.Px(ActualHeight));
        }

        /// <summary>Coloca no lugar calculado, e só se ele tiver mudado.</summary>
        public void Mover(MonitorArea a, BadgeSpot lugar)
        {
            if (_lugar == lugar && IsVisible)
            {
                return;
            }

            _lugar = lugar;
            Present(a);
        }

        public void Atualizar(string texto, string? dica, HudTone tom, Action? aoClicar, IReadOnlyList<BadgeAction>? acoes)
        {
            _texto.Text = texto;
            _dica.Text = dica ?? string.Empty;
            _dica.Visibility = string.IsNullOrEmpty(dica) ? Visibility.Collapsed : Visibility.Visible;

            _aoClicar = aoClicar;

            if (_moldura is not null)
            {
                _moldura.Cursor = aoClicar is null ? Cursors.Arrow : Cursors.Hand;
            }

            MontarBotoes(acoes);

            _ponto.SetResourceReference(Shape.FillProperty, tom switch
            {
                HudTone.Sucesso => "success",
                HudTone.Alerta => "danger",
                _ => "accent",
            });
        }

        protected override FrameworkElement BuildChrome(ContentPresenter slot)
        {
            _ponto.SetResourceReference(FrameworkElement.WidthProperty, "size.dot");
            _ponto.SetResourceReference(FrameworkElement.HeightProperty, "size.dot");
            _ponto.SetResourceReference(FrameworkElement.MarginProperty, "inset.end.12");

            _texto.SetResourceReference(TextBlock.FontSizeProperty, "type.body");
            _texto.SetResourceReference(TextBlock.LineHeightProperty, "type.body.line");
            _texto.SetResourceReference(TextBlock.FontWeightProperty, "weight.semibold");
            _texto.TextTrimming = TextTrimming.CharacterEllipsis;

            _dica.SetResourceReference(FrameworkElement.StyleProperty, "style.caption");
            _dica.TextTrimming = TextTrimming.CharacterEllipsis;
            _dica.Visibility = Visibility.Collapsed;

            _botoes.Orientation = Orientation.Horizontal;
            _botoes.SetResourceReference(FrameworkElement.MarginProperty, "inset.top.8");
            _botoes.Visibility = Visibility.Collapsed;

            var coluna = new StackPanel { VerticalAlignment = VerticalAlignment.Center };
            coluna.Children.Add(_texto);
            coluna.Children.Add(_dica);
            coluna.Children.Add(_botoes);

            var linha = new StackPanel { Orientation = Orientation.Horizontal };
            linha.Children.Add(_ponto);
            linha.Children.Add(coluna);

            _moldura = new Border { Child = linha };
            Superficie = _moldura;

            _moldura.SetResourceReference(Border.PaddingProperty, "inset.badge");
            _moldura.SetResourceReference(FrameworkElement.MaxWidthProperty, "size.badge.maxwidth");

            _moldura.SetResourceReference(Border.BackgroundProperty, _fundo);
            _moldura.SetResourceReference(Border.BorderBrushProperty, "border.strong");
            _moldura.SetResourceReference(Border.BorderThicknessProperty, "border.width");

            // O raio é o do recorte do DWM, não o de cartão: a janela é do
            // tamanho exato deste Border, e raio maior que o corte do sistema
            // deixa uma lasca do fundo da janela em cada canto.
            // OnSuperficieDecidida derruba para canto vivo se o sistema nem
            // conhecer o atributo de recorte.
            _moldura.SetResourceReference(Border.CornerRadiusProperty, "radius.clip");

            _moldura.MouseLeftButtonUp += (_, e) =>
            {
                e.Handled = true;
                _aoClicar?.Invoke();
            };

            _moldura.MouseEnter += (_, _) => _moldura.SetResourceReference(Border.BackgroundProperty, "bg.hover");
            _moldura.MouseLeave += (_, _) => _moldura.SetResourceReference(Border.BackgroundProperty, _fundo);

            return _moldura;
        }

        protected override void OnSuperficieDecidida()
        {
            if (_moldura is null)
            {
                return;
            }

            _moldura.SetResourceReference(Border.CornerRadiusProperty, RaioDaSuperficie);

            // Com material no ar o fundo em repouso passa a ser o translúcido;
            // senão o MouseLeave devolveria o opaco e a pastilha mudaria de tom
            // ao primeiro passe do mouse.
            _fundo = MaterialAtivo ? FundoTranslucido : "bg.raised";
        }

        protected override void Place(MonitorArea a) =>
            PlacePhysical(a, _lugar.X, _lugar.Y, _lugar.Width, _lugar.Height);

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
                var novo = new Button();
                novo.SetResourceReference(FrameworkElement.HeightProperty, "size.badge.action");
                novo.SetResourceReference(Control.PaddingProperty, "inset.badge.action");
                novo.SetResourceReference(FrameworkElement.MarginProperty, "inset.end.8");
                novo.SetResourceReference(Control.FontSizeProperty, "type.action");

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
