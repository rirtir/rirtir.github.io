@echo off
chcp 65001 >nul
set PYTHONIOENCODING=utf-8
set "PY=python"
if exist "%USERPROFILE%\anaconda3\python.exe" set "PY=%USERPROFILE%\anaconda3\python.exe"
pushd "%~dp0..\.."
"%PY%" --version >nul 2>nul
if errorlevel 1 echo Python が見つかりません。 & pause & exit /b 1
echo.
echo ===== ゲームの音が出ている録音先を探します =====
echo  ゲームで音（BGMなど何でも）を出し続けた状態で、このウィンドウを開いてください。
echo.
"%PY%" scripts\mml_verify\run.py calibrate
echo.
popd
pause
