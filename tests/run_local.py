"""Launch either runtime with disposable state; never touch the working account DB."""
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
sys.stdout.reconfigure(encoding='utf-8',errors='replace')
runtime = sys.argv[1] if len(sys.argv) > 1 else 'php'
with socket.socket() as sock:
    sock.bind(('127.0.0.1', 0))
    port = sock.getsockname()[1]
base = f'http://127.0.0.1:{port}'
(ROOT / '.runtime').mkdir(exist_ok=True)
with tempfile.TemporaryDirectory(prefix='qa-', dir=ROOT / '.runtime',ignore_cleanup_errors=True) as directory:
    state = Path(directory)
    env = {**os.environ, 'APP_DATA_DIR': str(state), 'TEST_STATE_DIR': str(state), 'TEST_BASE_URL': base, 'ALLOWED_ORIGINS': base, 'TEST_RATE_LIMIT': '1', 'WRANGLER_SEND_METRICS': 'false', 'PYTHONIOENCODING':'utf-8'}
    if runtime == 'php':
        php = ROOT / '.runtime/php/php.exe'
        command = [str(php), '-c', str(ROOT / '.runtime/php/php.ini')] if php.exists() else [shutil.which('php') or 'php']
        command += ['-S', f'127.0.0.1:{port}', 'server/router.php']
    elif runtime == 'worker':
        wrangler = ROOT / 'node_modules/wrangler/bin/wrangler.js'
        if not wrangler.exists():
            wrangler = ROOT / '.runtime/tooling/node_modules/wrangler/bin/wrangler.js'
        cli = ['node', str(wrangler)]
        subprocess.run(cli + ['d1', 'execute', 'shiying-users', '--local', '--persist-to', str(state), '--file', 'cloudflare/schema.sql'], cwd=ROOT, env=env, check=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
        command = cli + ['dev', '--ip', '127.0.0.1', '--port', str(port), '--persist-to', str(state)]
    else:
        raise SystemExit('Expected php or worker')
    with (state / 'server.log').open('w+', encoding='utf-8') as log:
        process = subprocess.Popen(command, cwd=ROOT, env=env, stdout=log, stderr=subprocess.STDOUT)
        try:
            deadline = time.monotonic() + 45
            while time.monotonic() < deadline:
                if process.poll() is not None:
                    raise RuntimeError('Test server exited before becoming ready')
                try:
                    with urllib.request.urlopen(base + '/api/health', timeout=1) as response:
                        if json.load(response).get('parser'):
                            break
                except Exception:
                    time.sleep(.2)
            else:
                raise TimeoutError('Test server did not become ready')
            subprocess.run([sys.executable, 'tests/smoke.py'], cwd=ROOT, env=env, check=True)
        except Exception:
            log.flush()
            print((state / 'server.log').read_text(encoding='utf-8', errors='replace')[-6000:])
            raise
        finally:
            if os.name == 'nt':
                subprocess.run(['taskkill', '/PID', str(process.pid), '/T', '/F'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            else:
                process.terminate()
            process.wait(timeout=15)
