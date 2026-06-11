@echo off
cd /d "%~dp0"
echo.
echo  Building Paketo frontend...
cd frontend
call npm install
if errorlevel 1 exit /b 1
call npm run build
if errorlevel 1 exit /b 1
cd ..
if not exist .env copy .env.example .env
if not exist data mkdir data
echo.
echo  Starting Paketo at http://127.0.0.1:8000
echo  Deploy guide: see DEPLOY.md
echo.
python run.py
pause
