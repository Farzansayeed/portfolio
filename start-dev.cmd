@echo off
cd /d C:\Users\farza\github\portfolio
set ADMIN_PASSWORD=test-pass-12345
set SESSION_SECRET=test-secret-abcdef0123456789
set EDGE_CONFIG_ID=mock-id
set EDGE_CONFIG_READ_WRITE_TOKEN=mock-token
set EDGE_CONFIG_API=http://127.0.0.1:8499
call vercel dev --listen 127.0.0.1:8440 > vercel-dev.log 2>&1
