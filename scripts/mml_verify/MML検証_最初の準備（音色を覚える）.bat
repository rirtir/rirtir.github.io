@echo off
chcp 65001 >nul
set PYTHONIOENCODING=utf-8
set "PY=python"
if exist "%USERPROFILE%\anaconda3\python.exe" set "PY=%USERPROFILE%\anaconda3\python.exe"
pushd "%~dp0..\.."
"%PY%" --version >nul 2>nul
if errorlevel 1 echo Python が見つかりません。 & pause & exit /b 1
echo.
echo ===== 最初の準備：ゲームの音色を覚えます（1回だけ） =====
echo  半音階を1回演奏します。MMLは自動でコピーされるので、ゲームに貼り付けて最後まで演奏してください。
echo.
"%PY%" scripts\mml_verify\run.py setup
echo.
popd
pause
