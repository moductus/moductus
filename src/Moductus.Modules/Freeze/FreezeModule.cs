using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using System.Windows.Shapes;
using Moductus.Core.Interop;
using Moductus.Core.Modules;
using Moductus.Core.Ocr;
using Moductus.UI.Archetypes;
using Moductus.UI.Modules;

namespace Moductus.Modules.Freeze;

/// <summary>
/// Tela congelada com lupa, conta-gotas, régua e OCR. Um clique copia a cor
/// sob o cursor; arrastar mede; Shift e arrastar reconhece o texto da
/// região. Tudo sobre o bitmap capturado — preciso, e independente do que
/// se movia na tela.
/// </summary>
public sealed class FreezeModule(ModuleContext context) : IModule
{
    private const int LupaZoom = 8;
    private const int LupaPixels = 20;
    private const double LupaTamanho = LupaPixels * LupaZoom;
    private const double ArrasteMinimo = 3;

    private readonly Canvas _camada = new() { Cursor = Cursors.Cross, Background = Brushes.Transparent };
    private readonly Rectangle _selecao = new() { StrokeThickness = 1, Visibility = Visibility.Collapsed };
    private readonly TextBlock _dimensoes = new() { Visibility = Visibility.Collapsed };
    private readonly Border _lupa = new() { Width = LupaTamanho, Height = LupaTamanho };
    private readonly Rectangle _lupaImagem = new();
    private readonly TextBlock _cor = new();
    private readonly Rectangle _amostra = new() { Width = 14, Height = 14, Margin = new Thickness(0, 0, 8, 0) };
    private readonly TextBlock _dica = new();

    private BitmapSource? _bitmap;
    private MonitorArea _area;
    private double _escala = 1;
    private Point? _inicio;
    private bool _ocr;

    /// <summary>A árvore visual só é construída uma vez, por mais que Enable repita.</summary>
    private bool _montado;

    public string Id => "freeze";

    public string Name => "Freeze";

    public string Description => "Congela a tela: cor, medida, lupa e OCR";

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
        _selecao.Fill = new SolidColorBrush(Color.FromArgb(0x28, 0xFF, 0xB2, 0x24));

        _dimensoes.SetResourceReference(TextBlock.FontFamilyProperty, "font.mono");
        _dimensoes.SetResourceReference(TextBlock.ForegroundProperty, "accent.fg");
        _dimensoes.SetResourceReference(TextBlock.BackgroundProperty, "accent");
        _dimensoes.Padding = new Thickness(6, 2, 6, 2);

        RenderOptions.SetBitmapScalingMode(_lupaImagem, BitmapScalingMode.NearestNeighbor);
        var mira = new Grid();
        mira.Children.Add(_lupaImagem);
        mira.Children.Add(new Rectangle { Width = LupaZoom, Height = LupaZoom, Stroke = Brushes.White, StrokeThickness = 1, HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Center });
        _lupa.Child = mira;
        _lupa.SetResourceReference(Border.BorderBrushProperty, "border.strong");
        _lupa.BorderThickness = new Thickness(2);
        _lupa.SetResourceReference(Border.CornerRadiusProperty, "radius.control");
        _lupa.ClipToBounds = true;

        _cor.SetResourceReference(TextBlock.FontFamilyProperty, "font.mono");
        _cor.VerticalAlignment = VerticalAlignment.Center;

        _dica.Text = "clique: copiar cor   ·   arraste: medir   ·   Shift + arraste: OCR   ·   Esc: fechar";
        _dica.SetResourceReference(FrameworkElement.StyleProperty, "style.caption");

        _camada.Children.Add(_selecao);
        _camada.Children.Add(_dimensoes);
        _camada.Children.Add(_lupa);
        _camada.Children.Add(Rotulo(_amostra, _cor));
        _camada.Children.Add(Cartao(_dica));

        _camada.MouseMove += OnMove;
        _camada.MouseLeftButtonDown += OnDown;
        _camada.MouseLeftButtonUp += OnUp;
    }

    public void Disable() => Soltar();

    public void Invoke()
    {
        var canvas = context.Archetypes.Canvas;

        if (canvas.IsVisible && canvas.Owner == Id)
        {
            canvas.Dismiss();
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
            context.Archetypes.Hud.Flash("Não deu para capturar a tela", Resumo(e.Message, 80), HudTone.Alerta);
            return;
        }

        _escala = _area.Scale;
        _lupaImagem.Fill = new ImageBrush(_bitmap) { ViewboxUnits = BrushMappingMode.Absolute, Stretch = Stretch.Fill };

        canvas.Owner = Id;
        canvas.SetBackdrop(_bitmap);
        canvas.SlotContent = _camada;
        canvas.Dismissed += SoltarAoFechar;
        canvas.Present(_area);
    }

    // ---- Interação -----------------------------------------------------------

    private void OnMove(object sender, MouseEventArgs e)
    {
        var pos = e.GetPosition(_camada);
        var (px, py) = Pixel(pos);

        AtualizarLupa(pos, px, py);
        AtualizarCor(px, py);

        if (_inicio is { } inicio)
        {
            var r = new Rect(inicio, pos);
            Canvas.SetLeft(_selecao, r.X);
            Canvas.SetTop(_selecao, r.Y);
            _selecao.Width = r.Width;
            _selecao.Height = r.Height;
            _selecao.Visibility = Visibility.Visible;

            var (w, h) = (PixelsDe(r.Width), PixelsDe(r.Height));
            _dimensoes.Text = _ocr ? $"OCR  {w} × {h}" : $"{w} × {h}";
            Canvas.SetLeft(_dimensoes, r.X);
            Canvas.SetTop(_dimensoes, Math.Max(0, r.Y - 24));
            _dimensoes.Visibility = Visibility.Visible;
        }
    }

    private void OnDown(object sender, MouseButtonEventArgs e)
    {
        _inicio = e.GetPosition(_camada);
        _ocr = Keyboard.Modifiers.HasFlag(ModifierKeys.Shift);
        _camada.CaptureMouse();
    }

    private async void OnUp(object sender, MouseButtonEventArgs e)
    {
        _camada.ReleaseMouseCapture();

        if (_inicio is not { } inicio || _bitmap is null)
        {
            return;
        }

        var fim = e.GetPosition(_camada);
        _inicio = null;
        _selecao.Visibility = Visibility.Collapsed;
        _dimensoes.Visibility = Visibility.Collapsed;

        var r = new Rect(inicio, fim);
        var hud = context.Archetypes.Hud;

        // Clique: cor.
        if (r.Width < ArrasteMinimo && r.Height < ArrasteMinimo)
        {
            var (px, py) = Pixel(fim);
            var hex = Hex(px, py);
            Fechar();
            Copiar(hex, "Cor copiada", hex);
            return;
        }

        var recorte = new Int32Rect(
            Math.Clamp(PixelsDe(r.X), 0, _bitmap.PixelWidth - 1),
            Math.Clamp(PixelsDe(r.Y), 0, _bitmap.PixelHeight - 1),
            Math.Max(1, Math.Min(PixelsDe(r.Width), _bitmap.PixelWidth - PixelsDe(r.X))),
            Math.Max(1, Math.Min(PixelsDe(r.Height), _bitmap.PixelHeight - PixelsDe(r.Y))));

        // Arraste: medida.
        if (!_ocr)
        {
            Fechar();
            Copiar($"{recorte.Width}×{recorte.Height}", "Medida copiada", $"{recorte.Width} × {recorte.Height} px, pronto para colar.");
            return;
        }

        // Shift + arraste: OCR sobre o recorte.
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
            hud.Flash("OCR falhou", Resumo(ex.Message, 80), HudTone.Alerta);
        }
    }

    // ---- Lupa e cor ----------------------------------------------------------

    private void AtualizarLupa(Point pos, int px, int py)
    {
        if (_lupaImagem.Fill is ImageBrush pincel)
        {
            pincel.Viewbox = new Rect(px - LupaPixels / 2.0 + 0.5, py - LupaPixels / 2.0 + 0.5, LupaPixels, LupaPixels);
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

    // ---- Auxiliares ------------------------------------------------------------

    private (int X, int Y) Pixel(Point dip) => (PixelsDe(dip.X), PixelsDe(dip.Y));

    private int PixelsDe(double dip) => (int)Math.Round(dip * _escala);

    private void Fechar() => context.Archetypes.Canvas.Dismiss();

    private void Copiar(string texto, string titulo, string detalhe)
    {
        try
        {
            System.Windows.Clipboard.SetText(texto);
            context.Archetypes.Hud.Flash(titulo, detalhe, HudTone.Sucesso);
        }
        catch (Exception e)
        {
            context.Archetypes.Hud.Flash("Não consegui copiar", Resumo(e.Message, 80), HudTone.Alerta);
        }
    }

    private void SoltarAoFechar()
    {
        context.Archetypes.Canvas.Dismissed -= SoltarAoFechar;
        Soltar();
    }

    private void Soltar()
    {
        _bitmap = null;
        _inicio = null;
        _lupaImagem.Fill = null;
        _selecao.Visibility = Visibility.Collapsed;
        _dimensoes.Visibility = Visibility.Collapsed;
    }

    private static string Resumo(string t, int max = 40)
    {
        var linha = t.ReplaceLineEndings(" ").Trim();
        return linha.Length > max ? linha[..max] + "…" : linha;
    }

    private static FrameworkElement Rotulo(UIElement amostra, UIElement texto)
    {
        var painel = new StackPanel { Orientation = Orientation.Horizontal };
        painel.Children.Add(amostra);
        painel.Children.Add(texto);
        return Cartao(painel);
    }

    private static Border Cartao(UIElement filho)
    {
        var b = new Border { Child = filho, Padding = new Thickness(10, 5, 10, 5) };
        b.SetResourceReference(Border.BackgroundProperty, "bg.raised");
        b.SetResourceReference(Border.BorderBrushProperty, "border.strong");
        b.SetResourceReference(Border.BorderThicknessProperty, "border.width");
        b.SetResourceReference(Border.CornerRadiusProperty, "radius.control");
        return b;
    }

    public UserControl? BuildSettings() => null;
}
