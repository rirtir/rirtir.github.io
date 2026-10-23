@echo off
chcp 65001 >nul
set PYTHONIOENCODING=utf-8
set "PY=python"
if exist "%USERPROFILE%\anaconda3\python.exe" set "PY=%USERPROFILE%\anaconda3\python.exe"
pushd "%~dp0..\.."
"%PY%" --version >nul 2>nul
if errorlevel 1 echo Python が見つかりません。 & pause & exit /b 1
echo.
echo ===== 仮説を確かめる短い曲を、順番に演奏して検証します =====
echo.
"%PY%" scripts\mml_verify\run.py run --all-probes --set exp
echo.
popd
pause
