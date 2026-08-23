[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [ValidatePattern('^db\.[a-z0-9]{20}\.supabase\.co$')]
    [string]$TargetHost,

    [Parameter(Mandatory)]
    [ValidateRange(1, 65535)]
    [int]$TargetPort,

    [Parameter(Mandatory)]
    [string]$ReadyFile
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$resolvedReadyFile = [IO.Path]::GetFullPath($ReadyFile)
$resolvedTemp = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
$readyLeaf = Split-Path -Leaf $resolvedReadyFile
if (-not $resolvedReadyFile.StartsWith($resolvedTemp, [StringComparison]::OrdinalIgnoreCase) -or
    -not $readyLeaf.StartsWith('finelo-loopback-relay-', [StringComparison]::Ordinal) -or
    -not $readyLeaf.EndsWith('.ready', [StringComparison]::Ordinal)) {
    throw 'O arquivo de prontidão do relay deve ficar no diretório temporário controlado.'
}
if (Test-Path -LiteralPath $resolvedReadyFile) {
    throw 'O arquivo de prontidão do relay já existe.'
}

Add-Type -TypeDefinition @'
using System;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Threading.Tasks;

public static class FinEloLoopbackTcpRelay
{
    public static void Run(string targetHost, int targetPort, string readyFile)
    {
        var listener = new TcpListener(IPAddress.Loopback, 0);
        listener.Start();
        var localPort = ((IPEndPoint)listener.LocalEndpoint).Port;
        var partial = readyFile + ".partial";
        File.WriteAllText(partial, localPort.ToString(), new UTF8Encoding(false));
        File.Move(partial, readyFile);

        while (true)
        {
            var incoming = listener.AcceptTcpClient();
            _ = RelayAsync(incoming, targetHost, targetPort);
        }
    }

    private static async Task RelayAsync(TcpClient incoming, string targetHost, int targetPort)
    {
        using (incoming)
        using (var outgoing = new TcpClient())
        {
            try
            {
                incoming.NoDelay = true;
                outgoing.NoDelay = true;
                await outgoing.ConnectAsync(targetHost, targetPort).ConfigureAwait(false);

                using (var incomingStream = incoming.GetStream())
                using (var outgoingStream = outgoing.GetStream())
                {
                    var toTarget = incomingStream.CopyToAsync(outgoingStream);
                    var toClient = outgoingStream.CopyToAsync(incomingStream);
                    await Task.WhenAny(toTarget, toClient).ConfigureAwait(false);
                }
            }
            catch
            {
                // O cliente chamador recebe a falha de transporte; nenhum dado é registrado.
            }
        }
    }
}
'@

[FinEloLoopbackTcpRelay]::Run($TargetHost, $TargetPort, $resolvedReadyFile)
