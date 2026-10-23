@echo off
chcp 65001 >nul
set PYTHONIOENCODING=utf-8
set "PY=python"
if exist "%USERPROFILE%\anaconda3\python.exe" set "PY=%USERPROFILE%\anaconda3\python.exe"
pushd "%~dp0..\.."
"%PY%" --version >nul 2>nul
if errorlevel 1 echo Python が見つかりません。 & pause & exit /b 1
echo.
echo ===== MML検証：検証用の MML を、順番に全部（1つずつ MML が自動でコピーされます） =====
echo  各MMLで：ゲームに貼り付けて演奏 → 静かになると自動で解析 → Enter で次へ（q で終了）
echo.
"%PY%" scripts\mml_verify\run.py run --all-probes
echo.
popd
pause
