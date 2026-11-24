; Ask the user to close Oceanic before install/uninstall.
; Silent runs (auto-updater) skip this; the updater closes the app itself.
!macro OCEANIC_WAIT_FOR_CLOSE
  IfSilent oceanic_done
  oceanic_check:
    nsis_tauri_utils::FindProcess "Oceanic.exe"
    Pop $R0
    IntCmp $R0 0 0 oceanic_done oceanic_done
    MessageBox MB_ABORTRETRYIGNORE|MB_ICONEXCLAMATION \
      "Oceanic is running. Close it, then continue.$\n$\nAbort: cancel setup$\nRetry: check again after closing Oceanic$\nIgnore: force close Oceanic (unsaved changes may be lost)" \
      IDRETRY oceanic_check IDIGNORE oceanic_kill
    Quit
  oceanic_kill:
    nsis_tauri_utils::KillProcess "Oceanic.exe"
    Pop $R0
    Sleep 500
    Goto oceanic_check
  oceanic_done:
!macroend

!macro NSIS_HOOK_PREINSTALL
  !insertmacro OCEANIC_WAIT_FOR_CLOSE
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  !insertmacro OCEANIC_WAIT_FOR_CLOSE
!macroend

; LAN sync: allow Oceanic's sync port (TCP 47823) on Private networks only.
!macro NSIS_HOOK_POSTINSTALL
  nsExec::Exec 'netsh advfirewall firewall delete rule name="Oceanic LAN sync"'
  nsExec::Exec 'netsh advfirewall firewall add rule name="Oceanic LAN sync" dir=in action=allow protocol=TCP localport=47823 profile=private program="$INSTDIR\${MAINBINARYNAME}.exe"'
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  nsExec::Exec 'netsh advfirewall firewall delete rule name="Oceanic LAN sync"'
!macroend
