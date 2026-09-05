param(
    [string]$Listener = "127.0.0.1",
    [int]$Port = 1700
)

$client = [System.Net.Sockets.UdpClient]::new()
$client.Client.ReceiveTimeout = 3000
$gatewayMac = [byte[]](0x10, 0x32, 0x54, 0x76, 0x98, 0xBA, 0xDC, 0xFE)
$json = '{"rxpk":[{"jver":2,"time":"2026-08-25T12:00:00.000000Z","tmst":3512348514,"freq":865.4,"stat":1,"modu":"LR-FHSS","datr":"M0CW137","codr":"4/6","hpw":2,"size":15,"data":"QLwaASaAOTAKqrsRIjNE","rsig":[{"ant":0,"chan":3,"rssic":-105,"rssis":-106,"lsnr":-2.5,"foff":120,"fdri":4,"ftstat":0}]}]}'
$payload = [System.Text.Encoding]::UTF8.GetBytes($json)
$packet = [byte[]](2, 0x12, 0x34, 0x00) + $gatewayMac + $payload
$endpoint = [System.Net.IPEndPoint]::new([System.Net.IPAddress]::Parse($Listener), $Port)
[void]$client.Send($packet, $packet.Length, $endpoint)

$remote = [System.Net.IPEndPoint]::new([System.Net.IPAddress]::Any, 0)
try {
    $ack = $client.Receive([ref]$remote)
    Write-Host ("Received ACK: " + (($ack | ForEach-Object { $_.ToString('X2') }) -join ' '))
} catch {
    Write-Error "No ACK received from ${Listener}:${Port}: $($_.Exception.Message)"
    exit 1
} finally {
    $client.Dispose()
}
