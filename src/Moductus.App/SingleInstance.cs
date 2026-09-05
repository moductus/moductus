using Moductus.Core.Interop;

namespace Moductus.App;

/// <summary>
/// Garante um processo só. A segunda instância não apenas encerra: ela pede à
/// primeira que abra as configurações, para que apertar o atalho de novo faça
/// alguma coisa visível.
/// </summary>
internal sealed class SingleInstance : IDisposable
{
    private const string MutexName = @"Local\Moductus.SingleInstance";

    private readonly Mutex _mutex;

    public SingleInstance()
    {
        _mutex = new Mutex(initiallyOwned: true, MutexName, out var criouAgora);
        IsFirst = criouAgora;
    }

    /// <summary>Mensagem que a segunda instância manda para a primeira.</summary>
    public static uint ActivateMessage { get; } = MessageWindow.RegisterMessage("Moductus.Activate");

    public bool IsFirst { get; }

    public static void SignalExisting()
    {
        var alvo = MessageWindow.FindExisting();

        if (alvo != 0)
        {
            MessageWindow.Post(alvo, ActivateMessage);
        }
    }

    public void Dispose()
    {
        if (IsFirst)
        {
            _mutex.ReleaseMutex();
        }

        _mutex.Dispose();
    }
}
