using System.Net;
using Windows.Win32;
using Windows.Win32.NetworkManagement.IpHelper;
using Windows.Win32.Networking.WinSock;

namespace Moductus.Core.Interop;

public sealed record TcpListener(ushort Port, string Address, uint ProcessId);

/// <summary>Portas TCP em escuta, com o processo dono. IPv4 e IPv6.</summary>
/// <remarks>
/// Ver o dono de portas de serviço do sistema exige elevação. Sem admin,
/// alguns vêm com PID mas o nome do processo não é legível; isso é mostrado
/// na interface como "requer elevação", nunca escondido.
/// </remarks>
public static class TcpListeners
{
    public static IReadOnlyList<TcpListener> Listening()
    {
        var lista = new List<TcpListener>();
        lista.AddRange(Ler(ADDRESS_FAMILY.AF_INET));
        lista.AddRange(Ler(ADDRESS_FAMILY.AF_INET6));
        return lista.OrderBy(l => l.Port).ThenBy(l => l.Address).ToList();
    }

    private static unsafe List<TcpListener> Ler(ADDRESS_FAMILY familia)
    {
        var linhas = new List<TcpListener>();
        uint tamanho = 0;

        // Primeira chamada só pergunta o tamanho.
        PInvoke.GetExtendedTcpTable(null, ref tamanho, false, (uint)familia, TCP_TABLE_CLASS.TCP_TABLE_OWNER_PID_LISTENER, 0);

        if (tamanho == 0)
        {
            return linhas;
        }

        var buffer = new byte[tamanho];

        fixed (byte* p = buffer)
        {
            if (PInvoke.GetExtendedTcpTable(buffer, ref tamanho, false, (uint)familia, TCP_TABLE_CLASS.TCP_TABLE_OWNER_PID_LISTENER, 0) != 0)
            {
                return linhas;
            }

            if (familia == ADDRESS_FAMILY.AF_INET)
            {
                var tabela = (MIB_TCPTABLE_OWNER_PID*)p;
                var quantidade = (int)tabela->dwNumEntries;
                var primeira = (MIB_TCPROW_OWNER_PID*)&tabela->table;

                for (var i = 0; i < quantidade; i++)
                {
                    var linha = primeira[i];
                    linhas.Add(new TcpListener(
                        PortaDeRede(linha.dwLocalPort),
                        new IPAddress(linha.dwLocalAddr).ToString(),
                        linha.dwOwningPid));
                }
            }
            else
            {
                var tabela = (MIB_TCP6TABLE_OWNER_PID*)p;
                var quantidade = (int)tabela->dwNumEntries;
                var primeira = (MIB_TCP6ROW_OWNER_PID*)&tabela->table;

                for (var i = 0; i < quantidade; i++)
                {
                    var linha = primeira[i];
                    var bytes = new ReadOnlySpan<byte>(&linha.ucLocalAddr, 16);
                    var endereco = new IPAddress(bytes, linha.dwLocalScopeId).ToString();
                    linhas.Add(new TcpListener(PortaDeRede(linha.dwLocalPort), endereco, linha.dwOwningPid));
                }
            }
        }

        return linhas;
    }

    // A porta vem em ordem de rede nos 16 bits baixos.
    private static ushort PortaDeRede(uint valor) => (ushort)(((valor & 0xFF) << 8) | ((valor >> 8) & 0xFF));
}
