' Starts update.ps1 in a hidden window with no console flash: wscript.exe is not a console app and Run(...,0) creates the console hidden from the start.
' (Launching powershell.exe straight from Zen shows a console for an instant.) Arguments are passed to the script as they are. Keep this file ASCII-only.
Option Explicit
Dim sh, fso, cmd, a
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
cmd = """" & sh.ExpandEnvironmentStrings("%SystemRoot%") & "\System32\WindowsPowerShell\v1.0\powershell.exe"" -NoProfile -ExecutionPolicy Bypass -STA -WindowStyle Hidden -File """ & fso.BuildPath(fso.GetParentFolderName(WScript.ScriptFullName), "update.ps1") & """"
For Each a In WScript.Arguments
  cmd = cmd & " """ & a & """"
Next
sh.Run cmd, 0, False
