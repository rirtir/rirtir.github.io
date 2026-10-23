@echo off
chcp 65001 >nul
set PYTHONIOENCODING=utf-8
set "PY=python"
if exist "%USERPROFILE%\anaconda3\python.exe" set "PY=%USERPROFILE%\anaconda3\python.exe"
pushd "%~dp0..\.."
"%PY%" --version >nul 2>nul
if errorlevel 1 echo Python が見つかりません。 & pause & exit /b 1
echo.
echo ===== MML検証：クリップボードの MML を、ゲームで演奏して検証します =====
echo  1) 事前に MML をコピーしておく（このウィンドウを開くとすぐ録音が始まります）
echo  2) ゲームに貼り付けて演奏する   3) 演奏が終わって静かになると自動で解析します
echo.
"%PY%" scripts\mml_verify\run.py run --repeat
echo.
popd
pause
