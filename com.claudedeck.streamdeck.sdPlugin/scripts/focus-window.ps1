# ClaudeDeck window helper.
#   -List                                        prints top-level windows as JSON: [{ hwnd, processName, title, path }]
#   -Focus <hwnd>                                restores the window and brings it to the foreground
#   -Window minimize|maximize|restore -Hwnd <n>  sets the window state; maximize and restore also bring it forward
#   -State -Hwnd <n>                             prints {"minimized":bool,"maximized":bool}
#   -OpenSession <local_id>                      opens claude://code/continue for that Desktop session and brings Desktop forward
#   -OpenNeedsInput                              opens claude://code/needs-input (Sessions Waiting for You) and brings Desktop forward
#   -OpenProject <chan_id> [-Thread <cse_id>]    opens claude://code/project/<chan_id>[?thread=<cse_id>] and brings Desktop forward
#   -Watch [-Parent <pid>]                       every second prints {"hwnd":n,"minimized":bool,"maximized":bool} for the
#                                                Desktop window, or {"hwnd":0}; runs until killed or process <pid> exits
param(
	[switch]$Watch,
	[long]$Parent = 0,
	[switch]$List,
	# \z, not $: .NET's $ also matches before a trailing newline. Same rule as the Desktop URL handler.
	[ValidatePattern('^local_[A-Za-z0-9-]{1,64}\z')][string]$OpenSession,
	[switch]$OpenNeedsInput,
	[ValidatePattern('^chan_[A-Za-z0-9_]{6,120}\z')][string]$OpenProject,
	[ValidatePattern('^cse_[A-Za-z0-9_]{6,120}\z')][string]$Thread,
	[long]$Focus = 0,
	[ValidateSet("minimize", "maximize", "restore")][string]$Window,
	[switch]$State,
	[long]$Hwnd = 0
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

Add-Type -Namespace ClaudeDeck -Name User32 -MemberDefinition @"
[DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
[DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
[DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
[DllImport("user32.dll")] public static extern bool IsZoomed(IntPtr hWnd);
[DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
"@

function Set-Foreground([IntPtr]$handle) {
	# Windows refuses SetForegroundWindow from background processes unless a key event just happened: tap Alt first.
	[ClaudeDeck.User32]::keybd_event(0x12, 0, 0, [UIntPtr]::Zero)
	[ClaudeDeck.User32]::keybd_event(0x12, 0, 2, [UIntPtr]::Zero)
	return [ClaudeDeck.User32]::SetForegroundWindow($handle)
}

function Get-DesktopWindow {
	Get-Process -Name claude -ErrorAction SilentlyContinue |
		Where-Object { $_.MainWindowHandle -ne 0 -and "$($_.Path)" -like "*WindowsApps\Claude_*" } | Select-Object -First 1
}

if ($Watch) {
	# Exit with the plugin process (-Parent) even if it never kills us.
	while ($Parent -eq 0 -or (Get-Process -Id $Parent -ErrorAction SilentlyContinue)) {
		$desktop = Get-DesktopWindow
		$line = '{"hwnd":0}'
		if ($desktop) {
			$handle = $desktop.MainWindowHandle
			$line = ConvertTo-Json -Compress -InputObject ([ordered]@{
				hwnd      = [long]$handle
				minimized = [ClaudeDeck.User32]::IsIconic($handle)
				maximized = [ClaudeDeck.User32]::IsZoomed($handle)
			})
		}
		[Console]::Out.WriteLine($line)
		[Console]::Out.Flush()
		Start-Sleep -Milliseconds 1000
	}
	exit 0
}

if ($Focus -ne 0) {
	$handle = [IntPtr]$Focus
	if ([ClaudeDeck.User32]::IsIconic($handle)) { [void][ClaudeDeck.User32]::ShowWindow($handle, 9) } # SW_RESTORE
	if (-not (Set-Foreground $handle)) { exit 1 }
	exit 0
}

if ($OpenSession -or $OpenNeedsInput -or $OpenProject) {
	# Fixed URLs only; the ids are checked by ValidatePattern above.
	if ($OpenSession) { Start-Process "claude://code/continue?session=$OpenSession&source=claudedeck" }
	elseif ($OpenProject) { Start-Process ("claude://code/project/$OpenProject" + $(if ($Thread) { "?thread=$Thread" } else { "" })) }
	else { Start-Process "claude://code/needs-input?source=claudedeck" }
	# The URL handler may start Desktop first: wait up to ~2 s for its window.
	for ($i = 0; $i -lt 10; $i++) {
		$desktop = Get-DesktopWindow
		if ($desktop) { break }
		Start-Sleep -Milliseconds 200
	}
	if (-not $desktop) { exit 1 }
	$handle = [IntPtr]$desktop.MainWindowHandle
	if ([ClaudeDeck.User32]::IsIconic($handle)) { [void][ClaudeDeck.User32]::ShowWindow($handle, 9) } # SW_RESTORE
	if (-not (Set-Foreground $handle)) { exit 1 }
	exit 0
}

if ($State -and $Hwnd -ne 0) {
	$handle = [IntPtr]$Hwnd
	ConvertTo-Json -Compress -InputObject ([ordered]@{
		minimized = [ClaudeDeck.User32]::IsIconic($handle)
		maximized = [ClaudeDeck.User32]::IsZoomed($handle)
	})
	exit 0
}

if ($Window -and $Hwnd -ne 0) {
	$handle = [IntPtr]$Hwnd
	$show = @{ minimize = 6; maximize = 3; restore = 9 }[$Window] # SW_MINIMIZE, SW_MAXIMIZE, SW_RESTORE
	[void][ClaudeDeck.User32]::ShowWindow($handle, $show)
	if ($Window -ne "minimize" -and -not (Set-Foreground $handle)) { exit 1 }
	exit 0
}

Write-Error "usage: focus-window.ps1 -List | -Focus <hwnd> | -Window minimize|maximize|restore -Hwnd <hwnd> | -State -Hwnd <hwnd> | -OpenSession <local_id> | -OpenNeedsInput | -OpenProject <chan_id> [-Thread <cse_id>] | -Watch [-Parent <pid>]"
exit 2
