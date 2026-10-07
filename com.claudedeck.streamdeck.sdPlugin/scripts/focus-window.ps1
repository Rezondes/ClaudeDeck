# ClaudeDeck window helper.
#   -List          prints top-level windows as JSON: [{ hwnd, processName, title, path }]
#   -Focus <hwnd>  restores the window and brings it to the foreground
param(
	[switch]$List,
	[long]$Focus = 0
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

if ($List) {
	$windows = Get-Process | Where-Object { $_.MainWindowHandle -ne 0 } | ForEach-Object {
		[pscustomobject]@{
			hwnd        = [long]$_.MainWindowHandle
			processName = $_.ProcessName
			title       = $_.MainWindowTitle
			path        = "$($_.Path)"
		}
	}
	ConvertTo-Json -InputObject @($windows) -Compress
	exit 0
}

if ($Focus -ne 0) {
	Add-Type -Namespace ClaudeDeck -Name User32 -MemberDefinition @"
[DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
[DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
[DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
[DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
"@
	$hwnd = [IntPtr]$Focus
	if ([ClaudeDeck.User32]::IsIconic($hwnd)) { [void][ClaudeDeck.User32]::ShowWindow($hwnd, 9) } # SW_RESTORE
	# Windows refuses SetForegroundWindow from background processes unless a key event just happened: tap Alt first.
	[ClaudeDeck.User32]::keybd_event(0x12, 0, 0, [UIntPtr]::Zero)
	[ClaudeDeck.User32]::keybd_event(0x12, 0, 2, [UIntPtr]::Zero)
	if (-not [ClaudeDeck.User32]::SetForegroundWindow($hwnd)) { exit 1 }
	exit 0
}

Write-Error "usage: focus-window.ps1 -List | -Focus <hwnd>"
exit 2
