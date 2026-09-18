@echo off
cd /d C:\Users\farza\github\portfolio
set EDGE_CONFIG_API=http://127.0.0.1:8499
set EDGE_CONFIG_ID=mock-id
set EDGE_CONFIG_READ_WRITE_TOKEN=mock-token
set ADMIN_PASSWORD=test-pass-12345
set SESSION_SECRET=test-secret-abcdef0123456789
node mock-store.js > mock-store.log 2>&1
