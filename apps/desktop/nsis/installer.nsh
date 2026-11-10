; Per-user Explorer verb. Runtime registration refreshes the label and exe path.
!macro customInstall
  WriteRegStr HKCU "Software\Classes\*\shell\Ponder" "" "Send to Ponder"
  WriteRegStr HKCU "Software\Classes\*\shell\Ponder" "Icon" "$\"$INSTDIR\${APP_EXECUTABLE_FILENAME}$\",0"
  WriteRegStr HKCU "Software\Classes\*\shell\Ponder" "MultiSelectModel" "Document"
  WriteRegStr HKCU "Software\Classes\*\shell\Ponder\command" "" "$\"$INSTDIR\${APP_EXECUTABLE_FILENAME}$\" --share-file $\"%1$\""
!macroend

!macro customUnInstall
  DeleteRegKey HKCU "Software\Classes\*\shell\Ponder"
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "Ponder"
  ClearErrors
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run" "Ponder"
  ClearErrors
!macroend
