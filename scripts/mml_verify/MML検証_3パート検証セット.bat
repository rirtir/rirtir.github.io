@echo off
chcp 65001 >nul
set PYTHONIOENCODING=utf-8
set "PY=python"
if exist "%USERPROFILE%\anaconda3\python.exe" set "PY=%USERPROFILE%\anaconda3\python.exe"
pushd "%~dp0..\.."
"%PY%" --version >nul 2>nul
if errorlevel 1 echo Python が見つかりません。 & pause & exit /b 1
echo.
echo ===== 長い3パート曲（約1分）を6曲、1曲2回ずつ演奏して検証します =====
echo  （1曲につき1回だけにするなら、このファイルの run.py の行の最後に  --times 1  を付けてください）
echo.
"%PY%" scripts\mml_verify\run.py run --all-probes
echo.
popd
pause
