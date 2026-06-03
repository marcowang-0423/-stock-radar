@echo off
chcp 65001 > nul
echo.
echo  =================================
echo   飆股雷達 - 台股智能分析系統
echo  =================================
echo.
cd /d "%~dp0backend"

echo [1/2] 安裝相依套件 (首次需要較長時間)...
pip install -r requirements.txt -q --disable-pip-version-check
if %errorlevel% neq 0 (
    echo [錯誤] 套件安裝失敗，請確認已安裝 Python 3.9+
    pause
    exit /b 1
)

echo [2/2] 啟動分析伺服器...
echo.
echo  瀏覽器網址: http://localhost:8000
echo  按 Ctrl+C 可停止伺服器
echo.

timeout /t 2 > nul
start "" "http://localhost:8000"
python -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload

pause
