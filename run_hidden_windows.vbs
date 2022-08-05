Dim objShell, objFSO, objFile, strArguments
Set objShell = WScript.CreateObject("WScript.shell")
Set objFSO = CreateObject("Scripting.FileSystemObject")
Set objFile = objFSO.GetFile(WScript.ScriptFullName)
For Each strArgument in WScript.Arguments
    strArguments = strArguments & " " & strArgument
Next
objShell.Run """" & objFSO.GetParentFolderName(objFile) & "\" &  "hello.exe""" & strArguments, 0, False
