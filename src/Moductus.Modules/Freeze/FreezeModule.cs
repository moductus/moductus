using System.Globalization;
using System.IO;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Controls.Primitives;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using System.Windows.Shapes;
using Moductus.Core.Clipboard;
using Moductus.Core.Interop;
using Moductus.Core.Modules;
using Moductus.Core.Text;
using Moductus.Core.Ocr;
using Moductus.UI.Archetypes;
using Moductus.UI.Modules;

namespace Moductus.Modules.Freeze;

/// <summary>
/// Tela congelada com lupa, conta-gotas, régua, OCR e recorte anotado. Um
/// clique copia a cor sob o cursor; arrastar mede e deixa a seleção de pé para
/// anotar, copiar ou salvar; Shift e arrastar reconhece o texto da região.
/// Tudo sobre o bitmap capturado — preciso, e independente do que se movia na
/// tela.
/// </summary>
public sealed class FreezeModule(ModuleContext context) : IModule
{
    private const int LupaZoom = 8;
    private const int LupaPixels = 20;
    private const double LupaTamanho = LupaPixels * LupaZoom;
    private const double ArrasteMinimo = 3;

    // Geometria das ferramentas de desenho, não estilo: a espessura do traço é
    // dado que o usuário ajusta com [ e ], e a ponta da seta e o corpo do texto
    // crescem com ela para continuarem proporcionais.
    private const double EspessuraMinima = 1;
    private const double EspessuraMaxima = 8;
    private const double EspessuraPadrao = 2;
    private const double PontaPorEspessura = 4;
    private const double TextoPorEspessura = 8;
    private const double AberturaDaSeta = Math.PI / 7;

    private readonly Canvas _camada = new() { Cursor = Cursors.Cross, Background = Brushes.Transparent, Focusable = true };
    private readonly Rectangle _selecao = new() { StrokeThickness = 1, Visibility = Visibility.Collapsed };
    private readonly Tinta _tinta = new();
    private readonly TextBlock _dimensoes = new() { Visibility = Visibility.Collapsed };
    private readonly Border _lupa = new() { Width = LupaTamanho, Height = LupaTamanho };
    private readonly Rectangle _lupaImagem = new();
    private readonly TextBlock _cor = new();
    private readonly Rectangle _amostra = new();
    private readonly TextBlock _dica = new();
    private readonly StackPanel _ferramentas = new() { Orientation = Orientation.Horizontal };
    private readonly TextBlock _traco = new();
    private readonly Border _barra = new() { Visibility = Visibility.Collapsed };
    private readonly Dictionary<Ferramenta, ToggleButton> _botoes = [];

    private readonly List<Anotacao> _anotacoes = [];

    private BitmapSource? _bitmap;
    private MonitorArea _area;
    private double _escala = 1;
    private Point? _inicio;
    private bool _ocr;

    private Rect? _regiao;
    private Ferramenta _ferramenta;
    private double _espessura = EspessuraPadrao;
    private Anotacao? _rascunho;
    private Anotacao? _escrita;

    /// <summary>A árvore visual só é construída uma vez, por mais que Enable repita.</summary>
    private bool _montado;

    private enum Ferramenta
    {
        Nenhuma,
        Retangulo,
        Seta,
        Livre,
        Texto,
    }

    public string Id => "freeze";

    public string Name => "Freeze";

    public string Description => "Congela a tela: recorte, anotação, cor, medida, lupa e OCR";

    public ModuleArchetype Archetype => ModuleArchetype.Canvas;

    public char SuggestedLeaderKey => 'f';

    public bool HasSurface => true;

    public void Enable()
    {
        // Enable roda de novo toda vez que o módulo é religado nas configurações.
        // A árvore visual já está montada, e readicionar um filho que já tem pai
        // derruba o processo inteiro — ver docs/MODULES.md, "Armadilhas conhecidas".
        if (_montado)
        {
            return;
        }

        _montado = true;

        _selecao.SetResourceReference(Shape.StrokeProperty, "accent");
        _selecao.SetResourceReference(Shape.FillProperty, "accent.veil");

        _tinta.Pintor = Pintar;
        _tinta.SetResourceReference(Tinta.CorProperty, "accent");
        _tinta.SetResourceReference(Tinta.FonteProperty, "font.ui");

        _dimensoes.SetResourceReference(TextBlock.FontFamilyProperty, "font.mono");
        _dimensoes.SetResourceReference(TextBlock.ForegroundProperty, "accent.fg");
        _dimensoes.SetResourceReference(TextBlock.BackgroundProperty, "accent");
        _dimensoes.SetResourceReference(Control.PaddingProperty, "inset.chip");

        RenderOptions.SetBitmapScalingMode(_lupaImagem, BitmapScalingMode.NearestNeighbor);
        var mira = new Grid();
        mira.Children.Add(_lupaImagem);
        var alvo = new Rectangle { Width = LupaZoom, Height = LupaZoom, StrokeThickness = 1, HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Center };
        alvo.SetResourceReference(Shape.StrokeProperty, "accent");
        mira.Children.Add(alvo);
        _lupa.Child = mira;
        _lupa.SetResourceReference(Border.BorderBrushProperty, "border.strong");
        _lupa.SetResourceReference(Border.BorderThicknessProperty, "border.width.strong");
        _lupa.SetResourceReference(Border.CornerRadiusProperty, "radius.control");
        _lupa.ClipToBounds = true;

        _amostra.SetResourceReference(FrameworkElement.WidthProperty, "size.swatch");
        _amostra.SetResourceReference(FrameworkElement.HeightProperty, "size.swatch");
        _amostra.SetResourceReference(FrameworkElement.MarginProperty, "inset.end.8");

        _cor.SetResourceReference(TextBlock.FontFamilyProperty, "font.mono");
        _cor.VerticalAlignment = VerticalAlignment.Center;

        _ferramentas.Children.Add(Botao(Ferramenta.Retangulo, "Retângulo  R"));
        _ferramentas.Children.Add(Botao(Ferramenta.Seta, "Seta  A"));
        _ferramentas.Children.Add(Botao(Ferramenta.Livre, "Livre  L"));
        _ferramentas.Children.Add(Botao(Ferramenta.Texto, "Texto  T"));

        _traco.SetResourceReference(FrameworkElement.StyleProperty, "style.caption");
        _traco.SetResourceReference(FrameworkElement.MarginProperty, "inset.8");
        _traco.VerticalAlignment = VerticalAlignment.Center;
        _ferramentas.Children.Add(_traco);
        CanvasWindow.Dress(_barra, _ferramentas);

        _dica.Text = "clique: cor   ·   arraste: recorte   ·   Shift + arraste: OCR   ·   R A L T: anotar   ·   [ ]: traço   ·   Ctrl+Z: desfazer   ·   Enter: copiar   ·   Ctrl+S: salvar   ·   Esc: fechar";
        _dica.SetResourceReference(FrameworkElement.StyleProperty, "style.caption");

        _camada.Children.Add(_selecao);
        _camada.Children.Add(_tinta);
        _camada.Children.Add(_dimensoes);
        _camada.Children.Add(_lupa);
        _camada.Children.Add(Rotulo(_amostra, _cor));
        _camada.Children.Add(_barra);
        _camada.Children.Add(CanvasWindow.Card(_dica));

        // A tinta desenha em coordenadas do Canvas; sem tamanho ela nasce com
        // zero e o layout não reserva nada para ela.
        _camada.SizeChanged += (_, e) =>
        {
            _tinta.Width = e.NewSize.Width;
            _tinta.Height = e.NewSize.Height;
        };

        _camada.MouseMove += OnMove;
        _camada.MouseLeftButtonDown += OnDown;
        _camada.MouseLeftButtonUp += OnUp;
    }

    public void Disable() => Soltar();

    public void Invoke()
    {
        var canvas = context.Archetypes.Canvas;

        if (canvas.DismissIfShowing(Id))
        {
            return;
        }

        // Congela ANTES de qualquer janela nossa aparecer: o bitmap é o que
        // o usuário via no instante do atalho.
        _area = Monitors.Around(ForegroundWindow.Capture());

        try
        {
            _bitmap = ScreenCapture.Capture(_area);
        }
        catch (Exception e)
        {
            context.Archetypes.Hud.Flash("Não deu para capturar a tela", Summary.OneLine(e.Message, 80), HudTone.Alerta);
            return;
        }

        _escala = _area.Scale;
        _espessura = EspessuraPadrao;
        _lupaImagem.Fill = new ImageBrush(_bitmap) { ViewboxUnits = BrushMappingMode.Absolute, Stretch = Stretch.Fill };
        EscolherFerramenta(Ferramenta.Nenhuma);
        AtualizarTraco();

        canvas.Owner = Id;
        canvas.SetBackdrop(_bitmap);
        canvas.SlotContent = _camada;
        canvas.Dismissed += SoltarAoFechar;
        canvas.PreviewKeyDown += OnTecla;
        canvas.PreviewTextInput += OnDigitacao;
        canvas.Present(_area);

        // Sem foco no conteúdo o WPF não levanta TextInput, e a digitação do
        // texto anotado não chegaria a lugar nenhum.
        _camada.Focus();
    }

    // ---- Interação -----------------------------------------------------------

    private void OnMove(object sender, MouseEventArgs e)
    {
        var pos = e.GetPosition(_camada);
        var (px, py) = Pixel(pos);

        AtualizarLupa(pos, px, py);
        AtualizarCor(px, py);

        if (_rascunho is { } forma)
        {
            if (forma.Tipo == Ferramenta.Livre || forma.Pontos.Count < 2)
            {
                forma.Pontos.Add(pos);
            }
            else
            {
                forma.Pontos[1] = pos;
            }

            _tinta.InvalidateVisual();
            return;
        }

        if (_inicio is { } inicio)
        {
            MostrarSelecao(new Rect(inicio, pos));
        }
    }

    private void OnDown(object sender, MouseButtonEventArgs e)
    {
        if (NaBarra(e.OriginalSource))
        {
            return;
        }

        var pos = e.GetPosition(_camada);

        if (_ferramenta != Ferramenta.Nenhuma && _regiao is not null)
        {
            FecharEscrita();

            if (_ferramenta == Ferramenta.Texto)
            {
                _escrita = new Anotacao { Tipo = Ferramenta.Texto, Pontos = [pos], Espessura = _espessura };
                _tinta.InvalidateVisual();
                return;
            }

            _rascunho = new Anotacao { Tipo = _ferramenta, Pontos = [pos], Espessura = _espessura };
            _camada.CaptureMouse();
            return;
        }

        _inicio = pos;
        _ocr = Keyboard.Modifiers.HasFlag(ModifierKeys.Shift);
        _camada.CaptureMouse();
    }

    private async void OnUp(object sender, MouseButtonEventArgs e)
    {
        _camada.ReleaseMouseCapture();

        if (_rascunho is { } forma)
        {
            _rascunho = null;

            if (forma.Pontos.Count > 1)
            {
                _anotacoes.Add(forma);
            }

            _tinta.InvalidateVisual();
            return;
        }

        if (_inicio is not { } inicio || _bitmap is null)
        {
            return;
        }

        var fim = e.GetPosition(_camada);
        _inicio = null;

        var r = new Rect(inicio, fim);
        var hud = context.Archetypes.Hud;

        // Clique: cor.
        if (r.Width < ArrasteMinimo && r.Height < ArrasteMinimo)
        {
            EsconderSelecao();
            var (px, py) = Pixel(fim);
            var hex = Hex(px, py);
            Fechar();
            Copiar(hex, "Cor copiada", hex);
            return;
        }

        var recorte = Recorte(r);

        // Arraste: medida na tela e no clipboard, e a seleção fica de pé para
        // anotar, copiar ou salvar.
        if (!_ocr)
        {
            _regiao = r;
            MostrarSelecao(r);
            MostrarBarra(r);
            CopiarQuieto($"{recorte.Width}×{recorte.Height}");
            return;
        }

        // Shift + arraste: OCR sobre o recorte.
        EsconderSelecao();
        var trecho = new CroppedBitmap(_bitmap, recorte);
        trecho.Freeze();
        Fechar();

        if (!TextRecognizer.Available)
        {
            hud.Flash(
                "OCR indisponível",
                "Nenhum idioma de reconhecimento instalado. Adicione um em Idioma e região.",
                HudTone.Alerta);
            return;
        }

        hud.Flash(
            "Reconhecendo…",
            "Leva um instante. O texto vai direto para o clipboard.",
            HudTone.Neutro);

        try
        {
            var texto = await TextRecognizer.RecognizeAsync(trecho);
            if (string.IsNullOrWhiteSpace(texto))
            {
                hud.Flash(
                    "Nenhum texto nessa região",
                    "Tente um recorte maior ou com mais contraste.",
                    HudTone.Alerta);
                return;
            }

            var linhas = texto.Count(c => c == '\n') + 1;
            Copiar(texto, "OCR copiado", $"{linhas} linhas no clipboard.");
        }
        catch (Exception ex)
        {
            hud.Flash("OCR falhou", Summary.OneLine(ex.Message, 80), HudTone.Alerta);
        }
    }

    // ---- Teclado -------------------------------------------------------------

    private void OnTecla(object sender, KeyEventArgs e)
    {
        if (_bitmap is null)
        {
            return;
        }

        if (Keyboard.Modifiers.HasFlag(ModifierKeys.Control))
        {
            switch (e.Key)
            {
                case Key.Z:
                    e.Handled = true;
                    Desfazer();
                    return;
                case Key.S:
                    e.Handled = true;
                    Salvar();
                    return;
                default:
                    return;
            }
        }

        if (_escrita is { } texto)
        {
            switch (e.Key)
            {
                case Key.Back:
                    e.Handled = true;
                    if (texto.Texto.Length > 0)
                    {
                        texto.Texto = texto.Texto[..^1];
                        _tinta.InvalidateVisual();
                    }

                    return;
                case Key.Enter:
                    e.Handled = true;
                    FecharEscrita();
                    return;
            }

            return;
        }

        if (e.Key == Key.Enter)
        {
            e.Handled = true;
            CopiarRecorte();
        }
    }

    /// <summary>
    /// Ferramenta e espessura vêm por caractere, não por <c>Key</c>: no teclado
    /// ABNT2 os colchetes caem em teclas que o WPF nomeia por outra coisa.
    /// </summary>
    private void OnDigitacao(object sender, TextCompositionEventArgs e)
    {
        if (_bitmap is null || Keyboard.Modifiers.HasFlag(ModifierKeys.Control) || e.Text.Length == 0)
        {
            return;
        }

        if (_escrita is { } texto)
        {
            if (e.Text[0] >= ' ')
            {
                e.Handled = true;
                texto.Texto += e.Text;
                _tinta.InvalidateVisual();
            }

            return;
        }

        if (_regiao is null)
        {
            return;
        }

        switch (e.Text.ToLowerInvariant())
        {
            case "r":
                e.Handled = true;
                EscolherFerramenta(Ferramenta.Retangulo);
                return;
            case "a":
                e.Handled = true;
                EscolherFerramenta(Ferramenta.Seta);
                return;
            case "l":
                e.Handled = true;
                EscolherFerramenta(Ferramenta.Livre);
                return;
            case "t":
                e.Handled = true;
                EscolherFerramenta(Ferramenta.Texto);
                return;
            case "[":
                e.Handled = true;
                MudarEspessura(-1);
                return;
            case "]":
                e.Handled = true;
                MudarEspessura(+1);
                return;
        }
    }

    // ---- Ferramentas ---------------------------------------------------------

    private void EscolherFerramenta(Ferramenta escolhida)
    {
        FecharEscrita();

        _ferramenta = _ferramenta == escolhida ? Ferramenta.Nenhuma : escolhida;

        foreach (var (chave, botao) in _botoes)
        {
            botao.IsChecked = chave == _ferramenta;
        }
    }

    private void MudarEspessura(double passo)
    {
        _espessura = Math.Clamp(_espessura + passo, EspessuraMinima, EspessuraMaxima);
        AtualizarTraco();
    }

    private void AtualizarTraco() => _traco.Text = $"traço {_espessura:0}";

    private void Desfazer()
    {
        if (_escrita is not null)
        {
            _escrita = null;
        }
        else if (_anotacoes.Count > 0)
        {
            _anotacoes.RemoveAt(_anotacoes.Count - 1);
        }
        else
        {
            return;
        }

        _tinta.InvalidateVisual();
    }

    private void FecharEscrita()
    {
        if (_escrita is not { } texto)
        {
            return;
        }

        _escrita = null;

        if (texto.Texto.Length > 0)
        {
            _anotacoes.Add(texto);
        }

        _tinta.InvalidateVisual();
    }

    // ---- Desenho -------------------------------------------------------------

    private void Pintar(DrawingContext dc, double pixelsPorDip)
    {
        foreach (var a in _anotacoes)
        {
            Desenhar(dc, a, _tinta.Cor, _tinta.Fonte, pixelsPorDip, cursor: false);
        }

        if (_rascunho is { } forma)
        {
            Desenhar(dc, forma, _tinta.Cor, _tinta.Fonte, pixelsPorDip, cursor: false);
        }

        if (_escrita is { } texto)
        {
            Desenhar(dc, texto, _tinta.Cor, _tinta.Fonte, pixelsPorDip, cursor: true);
        }
    }

    private static void Desenhar(DrawingContext dc, Anotacao a, Brush cor, FontFamily fonte, double pixelsPorDip, bool cursor)
    {
        var caneta = new Pen(cor, a.Espessura)
        {
            StartLineCap = PenLineCap.Round,
            EndLineCap = PenLineCap.Round,
            LineJoin = PenLineJoin.Round,
        };
        caneta.Freeze();

        switch (a.Tipo)
        {
            case Ferramenta.Retangulo:
                dc.DrawRectangle(null, caneta, new Rect(a.Pontos[0], a.Pontos[^1]));
                break;

            case Ferramenta.Seta:
                Seta(dc, caneta, a.Pontos[0], a.Pontos[^1]);
                break;

            case Ferramenta.Livre:
                dc.DrawGeometry(null, caneta, Traco(a.Pontos));
                break;

            case Ferramenta.Texto:
                var escrito = Escrito(a, cor, fonte, pixelsPorDip);
                var origem = a.Pontos[0];
                dc.DrawText(escrito, origem);

                if (cursor)
                {
                    var x = origem.X + escrito.WidthIncludingTrailingWhitespace;
                    dc.DrawLine(caneta, new Point(x, origem.Y), new Point(x, origem.Y + escrito.Height));
                }

                break;
        }
    }

    private static FormattedText Escrito(Anotacao a, Brush cor, FontFamily fonte, double pixelsPorDip) =>
        new(
            a.Texto,
            CultureInfo.CurrentCulture,
            FlowDirection.LeftToRight,
            new Typeface(fonte, FontStyles.Normal, FontWeights.Normal, FontStretches.Normal),
            a.Espessura * TextoPorEspessura,
            cor,
            pixelsPorDip);

    private static void Seta(DrawingContext dc, Pen caneta, Point de, Point para)
    {
        dc.DrawLine(caneta, de, para);

        var dx = para.X - de.X;
        var dy = para.Y - de.Y;

        if (Math.Sqrt((dx * dx) + (dy * dy)) < ArrasteMinimo)
        {
            return;
        }

        var ponta = caneta.Thickness * PontaPorEspessura;
        var angulo = Math.Atan2(dy, dx);

        dc.DrawLine(caneta, para, new Point(
            para.X - (ponta * Math.Cos(angulo - AberturaDaSeta)),
            para.Y - (ponta * Math.Sin(angulo - AberturaDaSeta))));

        dc.DrawLine(caneta, para, new Point(
            para.X - (ponta * Math.Cos(angulo + AberturaDaSeta)),
            para.Y - (ponta * Math.Sin(angulo + AberturaDaSeta))));
    }

    private static Geometry Traco(IReadOnlyList<Point> pontos)
    {
        var geometria = new StreamGeometry();

        using (var ctx = geometria.Open())
        {
            ctx.BeginFigure(pontos[0], false, false);

            for (var i = 1; i < pontos.Count; i++)
            {
                ctx.LineTo(pontos[i], true, true);
            }
        }

        geometria.Freeze();
        return geometria;
    }

    // ---- Recorte -------------------------------------------------------------

    /// <summary>
    /// O recorte sai de um visual com o bitmap congelado e as anotações por
    /// cima — nunca do bitmap cru, senão o que foi desenhado não vai junto. O
    /// véu da Canvas fica fora: ele é da tela, não da imagem.
    /// </summary>
    private BitmapSource? Render()
    {
        if (_bitmap is null || _regiao is not { } regiao)
        {
            return null;
        }

        FecharEscrita();

        var largura = _bitmap.PixelWidth / _escala;
        var altura = _bitmap.PixelHeight / _escala;

        var visual = new DrawingVisual();

        using (var dc = visual.RenderOpen())
        {
            dc.DrawImage(_bitmap, new Rect(0, 0, largura, altura));
            Pintar(dc, _escala);
        }

        var alvo = new RenderTargetBitmap(
            _bitmap.PixelWidth,
            _bitmap.PixelHeight,
            96 * _escala,
            96 * _escala,
            PixelFormats.Pbgra32);
        alvo.Render(visual);

        var corte = new CroppedBitmap(alvo, Recorte(regiao));
        corte.Freeze();
        return corte;
    }

    private void CopiarRecorte()
    {
        if (Render() is not { } imagem)
        {
            return;
        }

        var medida = $"{imagem.PixelWidth} × {imagem.PixelHeight} px no clipboard.";

        try
        {
            System.Windows.Clipboard.SetImage(imagem);
            Fechar();
            context.Archetypes.Hud.Flash("Recorte copiado", medida, HudTone.Sucesso);
        }
        catch (Exception e)
        {
            Fechar();
            context.Archetypes.Hud.Flash("Não consegui copiar o recorte", Summary.OneLine(e.Message, 80), HudTone.Alerta);
        }
    }

    private void Salvar()
    {
        if (Render() is not { } imagem)
        {
            return;
        }

        var nome = $"moductus-{DateTime.Now:yyyyMMdd-HHmmss}.png";

        try
        {
            var pasta = System.IO.Path.Combine(Imagens(), "Moductus");
            Directory.CreateDirectory(pasta);

            var codificador = new PngBitmapEncoder();
            codificador.Frames.Add(BitmapFrame.Create(imagem));

            using (var arquivo = File.Create(System.IO.Path.Combine(pasta, nome)))
            {
                codificador.Save(arquivo);
            }

            Fechar();
            context.Archetypes.Hud.Flash("Recorte salvo", nome, HudTone.Sucesso);
        }
        catch (Exception e)
        {
            Fechar();
            context.Archetypes.Hud.Flash("Não consegui salvar o recorte", Summary.OneLine(e.Message, 80), HudTone.Alerta);
        }
    }

    /// <summary>
    /// A pasta Imagens do perfil. Em conta sem shell carregado a pasta especial
    /// volta vazia, e aí o caminho é montado a partir do próprio perfil.
    /// </summary>
    private static string Imagens()
    {
        var pasta = Environment.GetFolderPath(Environment.SpecialFolder.MyPictures);

        return string.IsNullOrEmpty(pasta)
            ? System.IO.Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), "Pictures")
            : pasta;
    }

    private Int32Rect Recorte(Rect r)
    {
        if (_bitmap is null)
        {
            return Int32Rect.Empty;
        }

        return new Int32Rect(
            Math.Clamp(PixelsDe(r.X), 0, _bitmap.PixelWidth - 1),
            Math.Clamp(PixelsDe(r.Y), 0, _bitmap.PixelHeight - 1),
            Math.Max(1, Math.Min(PixelsDe(r.Width), _bitmap.PixelWidth - PixelsDe(r.X))),
            Math.Max(1, Math.Min(PixelsDe(r.Height), _bitmap.PixelHeight - PixelsDe(r.Y))));
    }

    // ---- Lupa e cor ----------------------------------------------------------

    private void AtualizarLupa(Point pos, int px, int py)
    {
        if (_lupaImagem.Fill is ImageBrush pincel)
        {
            pincel.Viewbox = new Rect(px - (LupaPixels / 2.0) + 0.5, py - (LupaPixels / 2.0) + 0.5, LupaPixels, LupaPixels);
        }

        // Ao lado do cursor; vira de lado perto da borda.
        var largura = _camada.ActualWidth;
        var altura = _camada.ActualHeight;
        var x = pos.X + 24 + LupaTamanho + 8 > largura ? pos.X - 24 - LupaTamanho : pos.X + 24;
        var y = pos.Y + 24 + LupaTamanho + 40 > altura ? pos.Y - 24 - LupaTamanho - 32 : pos.Y + 24;

        Canvas.SetLeft(_lupa, x);
        Canvas.SetTop(_lupa, y);

        if (_amostra.Parent is FrameworkElement rotulo)
        {
            Canvas.SetLeft(rotulo, x);
            Canvas.SetTop(rotulo, y + LupaTamanho + 4);
        }
    }

    private void AtualizarCor(int px, int py)
    {
        var hex = Hex(px, py);
        _cor.Text = hex;
        _amostra.Fill = (Brush)new BrushConverter().ConvertFromString(hex)!;
    }

    private string Hex(int px, int py)
    {
        if (_bitmap is null)
        {
            return "#000000";
        }

        px = Math.Clamp(px, 0, _bitmap.PixelWidth - 1);
        py = Math.Clamp(py, 0, _bitmap.PixelHeight - 1);

        var bgra = new byte[4];
        new FormatConvertedBitmap(_bitmap, PixelFormats.Bgra32, null, 0)
            .CopyPixels(new Int32Rect(px, py, 1, 1), bgra, 4, 0);

        return $"#{bgra[2]:X2}{bgra[1]:X2}{bgra[0]:X2}";
    }

    // ---- Seleção e barra -----------------------------------------------------

    private void MostrarSelecao(Rect r)
    {
        Canvas.SetLeft(_selecao, r.X);
        Canvas.SetTop(_selecao, r.Y);
        _selecao.Width = r.Width;
        _selecao.Height = r.Height;
        _selecao.Visibility = Visibility.Visible;

        var recorte = Recorte(r);
        _dimensoes.Text = _ocr ? $"OCR  {recorte.Width} × {recorte.Height}" : $"{recorte.Width} × {recorte.Height}";
        Canvas.SetLeft(_dimensoes, r.X);
        Canvas.SetTop(_dimensoes, Math.Max(0, r.Y - 24));
        _dimensoes.Visibility = Visibility.Visible;
    }

    private void EsconderSelecao()
    {
        _regiao = null;
        _selecao.Visibility = Visibility.Collapsed;
        _dimensoes.Visibility = Visibility.Collapsed;
        _barra.Visibility = Visibility.Collapsed;
    }

    private void MostrarBarra(Rect r)
    {
        _barra.Visibility = Visibility.Visible;
        _barra.UpdateLayout();

        var folga = (double)_camada.FindResource("space.8");
        var abaixo = r.Bottom + folga;

        Canvas.SetLeft(_barra, Math.Clamp(r.X, 0, Math.Max(0, _camada.ActualWidth - _barra.ActualWidth)));
        Canvas.SetTop(_barra, abaixo + _barra.ActualHeight > _camada.ActualHeight
            ? Math.Max(0, r.Y - folga - _barra.ActualHeight)
            : abaixo);
    }

    private bool NaBarra(object origem) =>
        ReferenceEquals(origem, _barra) || (origem is Visual v && _barra.IsAncestorOf(v));

    private ToggleButton Botao(Ferramenta ferramenta, string texto)
    {
        // Focusable false: o foco tem de ficar na camada, ou a digitação do
        // texto anotado passaria a ir para o botão.
        var botao = new ToggleButton { Content = texto, Focusable = false };
        botao.SetResourceReference(FrameworkElement.StyleProperty, "style.toggle.compact");
        botao.SetResourceReference(FrameworkElement.MarginProperty, "inset.4");
        botao.Click += (_, _) => EscolherFerramenta(ferramenta);

        _botoes[ferramenta] = botao;
        return botao;
    }

    // ---- Auxiliares ------------------------------------------------------------

    private (int X, int Y) Pixel(Point dip) => (PixelsDe(dip.X), PixelsDe(dip.Y));

    private int PixelsDe(double dip) => (int)Math.Round(dip * _escala);

    private void Fechar() => context.Archetypes.Canvas.Dismiss();

    private void Copiar(string texto, string titulo, string detalhe)
    {
        if (CopiarQuieto(texto))
        {
            context.Archetypes.Hud.Flash(titulo, detalhe, HudTone.Sucesso);
        }
    }

    /// <summary>
    /// Copia sem HUD de sucesso: a Canvas continua aberta por cima dele, e a
    /// medida já está na tela ao lado da seleção. Só a falha precisa aparecer.
    /// </summary>
    private bool CopiarQuieto(string texto)
    {
        if (ClipboardText.TryWrite(texto, out var erro))
        {
            return true;
        }

        context.Archetypes.Hud.Flash("Não consegui copiar", Summary.OneLine(erro, 80), HudTone.Alerta);
        return false;
    }

    private void SoltarAoFechar()
    {
        var canvas = context.Archetypes.Canvas;
        canvas.Dismissed -= SoltarAoFechar;
        canvas.PreviewKeyDown -= OnTecla;
        canvas.PreviewTextInput -= OnDigitacao;
        Soltar();
    }

    private void Soltar()
    {
        _bitmap = null;
        _inicio = null;
        _rascunho = null;
        _escrita = null;
        _anotacoes.Clear();
        _ferramenta = Ferramenta.Nenhuma;
        _lupaImagem.Fill = null;
        EsconderSelecao();
        _tinta.InvalidateVisual();

        foreach (var botao in _botoes.Values)
        {
            botao.IsChecked = false;
        }
    }

    private static FrameworkElement Rotulo(UIElement amostra, UIElement texto)
    {
        var painel = new StackPanel { Orientation = Orientation.Horizontal };
        painel.Children.Add(amostra);
        painel.Children.Add(texto);
        return CanvasWindow.Card(painel);
    }

    public UserControl? BuildSettings() => null;

    /// <summary>Uma anotação da pilha: a forma, seus pontos e a espessura de quando foi feita.</summary>
    private sealed class Anotacao
    {
        public required Ferramenta Tipo { get; init; }

        public required List<Point> Pontos { get; init; }

        public required double Espessura { get; init; }

        public string Texto { get; set; } = string.Empty;
    }

    /// <summary>
    /// A camada de tinta. Desenha por <see cref="DrawingContext"/> em vez de
    /// Shapes para que o mesmo traçado sirva à tela e ao
    /// <see cref="RenderTargetBitmap"/> do recorte, sem duplicar a lógica.
    /// </summary>
    private sealed class Tinta : FrameworkElement
    {
        public static readonly DependencyProperty CorProperty = DependencyProperty.Register(
            nameof(Cor),
            typeof(Brush),
            typeof(Tinta),
            new FrameworkPropertyMetadata(Brushes.Transparent, FrameworkPropertyMetadataOptions.AffectsRender));

        public static readonly DependencyProperty FonteProperty = DependencyProperty.Register(
            nameof(Fonte),
            typeof(FontFamily),
            typeof(Tinta),
            new FrameworkPropertyMetadata(SystemFonts.MessageFontFamily, FrameworkPropertyMetadataOptions.AffectsRender));

        public Tinta() => IsHitTestVisible = false;

        public Action<DrawingContext, double>? Pintor { get; set; }

        public Brush Cor
        {
            get => (Brush)GetValue(CorProperty);
            set => SetValue(CorProperty, value);
        }

        public FontFamily Fonte
        {
            get => (FontFamily)GetValue(FonteProperty);
            set => SetValue(FonteProperty, value);
        }

        protected override void OnRender(DrawingContext dc) =>
            Pintor?.Invoke(dc, VisualTreeHelper.GetDpi(this).PixelsPerDip);
    }
}
