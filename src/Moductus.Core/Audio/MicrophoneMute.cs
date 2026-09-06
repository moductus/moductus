using Windows.Win32;
using Windows.Win32.Foundation;
using Windows.Win32.Media.Audio;
using Windows.Win32.Media.Audio.Endpoints;
using Windows.Win32.System.Com;

namespace Moductus.Core.Audio;

/// <summary>
/// Mudo do microfone padrão, por Core Audio. É mudo de verdade, no endpoint
/// do Windows — não um filtro por aplicativo. Qualquer app que estivesse
/// capturando para de receber som.
/// </summary>
public sealed class MicrophoneMute : IDisposable
{
    private static readonly Guid IID_IAudioEndpointVolume = typeof(IAudioEndpointVolume).GUID;

    private IAudioEndpointVolume? _volume;

    /// <summary>Falso quando não há microfone padrão — nenhum conectado.</summary>
    public bool Available => Endpoint() is not null;

    /// <returns><c>null</c> quando não há microfone.</returns>
    public unsafe bool? IsMuted
    {
        get
        {
            var endpoint = Endpoint();
            if (endpoint is null)
            {
                return null;
            }

            try
            {
                BOOL mudo;
                endpoint.GetMute(&mudo);
                return mudo;
            }
            catch
            {
                Soltar();
                return null;
            }
        }
    }

    /// <returns>O estado depois da troca, ou <c>null</c> se não deu.</returns>
    public bool? Toggle()
    {
        var atual = IsMuted;
        if (atual is not { } valor)
        {
            return null;
        }

        return Set(!valor) ? !valor : null;
    }

    public unsafe bool Set(bool muted)
    {
        var endpoint = Endpoint();
        if (endpoint is null)
        {
            return false;
        }

        try
        {
            endpoint.SetMute(muted, null);
            return true;
        }
        catch
        {
            Soltar();
            return false;
        }
    }

    /// <summary>
    /// O endpoint é cacheado, mas solto ao primeiro erro: trocar de
    /// microfone invalida a referência e a próxima chamada refaz.
    /// </summary>
    private unsafe IAudioEndpointVolume? Endpoint()
    {
        if (_volume is not null)
        {
            return _volume;
        }

        try
        {
            PInvoke.CoCreateInstance<IMMDeviceEnumerator>(
                typeof(MMDeviceEnumerator).GUID, null, CLSCTX.CLSCTX_INPROC_SERVER, out var enumerador);

            enumerador.GetDefaultAudioEndpoint(EDataFlow.eCapture, ERole.eCommunications, out var dispositivo);

            dispositivo.Activate(IID_IAudioEndpointVolume, CLSCTX.CLSCTX_INPROC_SERVER, null, out var obj);
            _volume = (IAudioEndpointVolume)obj;
            return _volume;
        }
        catch
        {
            return null;
        }
    }

    private void Soltar() => _volume = null;

    public void Dispose() => Soltar();
}
