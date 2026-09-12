using System.IO;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using Moductus.Core.Commands;
using Moductus.UI.Archetypes;
using Moductus.UI.Modules;
using QRCoder;

namespace Moductus.Modules.Palette;

/// <summary>
/// QR do que estiver no clipboard, para mandar um link ao celular. A única
/// dependência NuGet do projeto: o Windows não tem codificador de QR nativo.
/// </summary>
internal sealed class QrCommand(ModuleContext context)
{
    public const string Owner = "qr";

    private const int MaxChars = 2000;

    private readonly Image _imagem = new() { Stretch = Stretch.Uniform, Margin = new Thickness(16) };
    private readonly TextBlock _legenda = new();
    private readonly DockPanel _corpo = new();

    private bool _montado;

    public void Register()
    {
        Montar();

        context.Commands.Register(Owner, new PaletteCommand(
            "qr", "QR do clipboard", "Mostra o texto copiado como QR, para apontar o celular", null, Mostrar));
    }

    /// <summary>Construída uma vez: Register roda de novo quando a Palette é religada.</summary>
    private void Montar()
    {
        if (_montado)
        {
            return;
        }

        _montado = true;

        _legenda.SetResourceReference(FrameworkElement.StyleProperty, "style.caption");
        _legenda.HorizontalAlignment = HorizontalAlignment.Center;
        _legenda.Margin = new Thickness(16, 0, 16, 12);
        _legenda.TextTrimming = TextTrimming.CharacterEllipsis;
        _legenda.TextWrapping = TextWrapping.NoWrap;

        RenderOptions.SetBitmapScalingMode(_imagem, BitmapScalingMode.NearestNeighbor);

        DockPanel.SetDock(_legenda, Dock.Bottom);
        _corpo.Children.Add(_legenda);
        _corpo.Children.Add(_imagem);
    }

    private void Mostrar()
    {
        var hud = context.Archetypes.Hud;

        string texto;
        try
        {
            texto = System.Windows.Clipboard.ContainsText() ? System.Windows.Clipboard.GetText() : string.Empty;
        }
        catch (Exception e)
        {
            hud.Flash("Clipboard indisponível", Resumo(e.Message, 80), HudTone.Alerta);
            return;
        }

        if (string.IsNullOrWhiteSpace(texto))
        {
            hud.Flash(
                "Nada de texto no clipboard",
                "Copie um link ou texto e repita o comando.",
                HudTone.Alerta);
            return;
        }

        if (texto.Length > MaxChars)
        {
            hud.Flash(
                "Texto longo demais para um QR",
                $"{texto.Length} caracteres; o limite é {MaxChars}.",
                HudTone.Alerta);
            return;
        }

        byte[] png;
        try
        {
            using var gerador = new QRCodeGenerator();
            using var dados = gerador.CreateQrCode(texto, QRCodeGenerator.ECCLevel.M);
            png = new PngByteQRCode(dados).GetGraphic(8);
        }
        catch (Exception e)
        {
            hud.Flash("Não deu para gerar o QR", Resumo(e.Message, 80), HudTone.Alerta);
            return;
        }

        var bitmap = new BitmapImage();
        bitmap.BeginInit();
        bitmap.CacheOption = BitmapCacheOption.OnLoad;
        bitmap.StreamSource = new MemoryStream(png);
        bitmap.EndInit();
        bitmap.Freeze();

        _imagem.Source = bitmap;
        _legenda.Text = texto.ReplaceLineEndings(" ");

        var panel = context.Archetypes.Panel;
        panel.Owner = Owner;
        panel.Heading = "QR do clipboard";
        panel.Placement = PanelPlacement.Center;
        panel.SlotContent = _corpo;
        panel.Present();
    }

    private static string Resumo(string t, int max)
    {
        var linha = t.ReplaceLineEndings(" ").Trim();
        return linha.Length > max ? linha[..max] + "…" : linha;
    }
}
