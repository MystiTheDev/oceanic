; LAN sync: allow Oceanic's sync port (TCP 47823) on Private networks only.
!macro NSIS_HOOK_POSTINSTALL
  nsExec::Exec 'netsh advfirewall firewall delete rule name="Oceanic LAN sync"'
  nsExec::Exec 'netsh advfirewall firewall add rule name="Oceanic LAN sync" dir=in action=allow protocol=TCP localport=47823 profile=private program="$INSTDIR\${MAINBINARYNAME}.exe"'
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  nsExec::Exec 'netsh advfirewall firewall delete rule name="Oceanic LAN sync"'
!macroend
