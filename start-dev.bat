@echo off
REM One-click launcher for start-dev.sh (double-click this file).
REM Runs the script in Git Bash and keeps the window open so you can see
REM the service logs and press Ctrl+C to stop everything.

setlocal
set "SCRIPT_DIR=%~dp0"
set "BASH_EXE=C:\Program Files\Git\bin\bash.exe"

if not exist "%BASH_EXE%" (
    echo Could not find Git Bash at "%BASH_EXE%".
    echo Install Git for Windows from https://git-scm.com/download/win, or edit
    echo BASH_EXE in this .bat file to point at your bash.exe.
    pause
    exit /b 1
)

"%BASH_EXE%" -c "cd '%SCRIPT_DIR%' && ./start-dev.sh"
pause
