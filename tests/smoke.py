"""HTTP regression tests. Use run_local.py for disposable accounts/data."""
import hashlib
import json
import os
from pathlib import Path
import secrets
import sqlite3
import urllib.error
import urllib.request

BASE = os.environ.get('TEST_BASE_URL', 'http://127.0.0.1:8080').rstrip('/')
USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
checks = 0

def check(condition, message):
    global checks
    if not condition:
        raise AssertionError(message)
    checks += 1

def request(path, body=None, token=None, method=None, headers=None, raw=None):
    h = {'Content-Type': 'application/json', 'User-Agent': USER_AGENT, **(headers or {})}
    if token:
        h['Authorization'] = 'Bearer ' + token
    data = raw if raw is not None else json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, headers=h, method=method)
    try:
        response = urllib.request.urlopen(req, timeout=70)
    except urllib.error.HTTPError as e:
        response = e
    with response:
        text = response.read().decode('utf-8')
        try:
            payload = json.loads(text)
        except json.JSONDecodeError:
            payload = text
        return response.status, payload, response.headers

def status(path, expected, **kwargs):
    response = request(path, **kwargs)
    check(response[0] in ((expected,) if isinstance(expected,int) else expected), f'{path}: expected {expected}, got {response[0]}: {str(response[1])[:200]}')
    return response

health = status('/api/health', 200)[1]
check(health['parser'] and health['auth'] == 'required', 'Runtime must be ready')
for path, content_type in [('/', 'text/html'), ('/app.js', 'javascript'), ('/style.css', 'text/css'), ('/config.js', 'javascript')]:
    response = status(path, 200)
    check(content_type in response[2]['Content-Type'], 'Incorrect asset content type')
    check(response[2].get('X-Content-Type-Options') == 'nosniff', 'Missing asset security header')
check("frame-ancestors 'none'" in status('/', 200)[2].get('Content-Security-Policy', ''), 'Missing frame protection')
status('/', 200, method='HEAD')
for path in ['/var/app.sqlite', '/server/router.php', '/.git/config', '/../README.md', '/%2e%2e/README.md', '/missing-page']:
    status(path, (400,404))
status('/api/parse', 401, body={'url': 'https://www.douyin.com/video/1'})
status('/api/me', 401, token='invalid-token')
status('/api/login', 405)
status('/api/login', 405, method='PUT', body={})
for raw in [b'{', b'null', b'[]', b'"string"']:
    status('/api/login', 400, raw=raw)
status('/api/login', 413, raw=b'x' * 17000)
status('/api/health', 403, headers={'Origin': 'https://evil.example'})
cors = status('/api/health', 200, headers={'Origin': BASE})
check(cors[2].get('Access-Control-Allow-Origin') == BASE, 'Same-origin CORS failed')
status('/api/parse', 204, method='OPTIONS', headers={'Origin': BASE})
for body in [{'email': [], 'password': 'abcdefghijk'}, {'email': 'bad-email', 'password': 'abcdefghijk'}, {'email': 'qa@example.com', 'password': 'short'}, {'email': 'qa@example.com', 'password': 'a' * 73}]:
    status('/api/register', 400, body=body)

email = 'qa-' + secrets.token_hex(6) + '@example.com'
password = secrets.token_urlsafe(20)
account = status('/api/register', 200, body={'email': email.upper(), 'password': password})[1]
token = account['token']
check(account['email'] == email and len(token) == 64, 'Account normalization/session generation failed')
check(status('/api/me', 200, token=token)[1]['email'] == email, 'Session has wrong identity')
status('/api/me', 405, token=token, body={})
status('/api/login', 401, body={'email': email, 'password': 'incorrect-password'})
login = status('/api/login', 200, body={'email': email, 'password': password})[1]
status('/api/logout', 200, body={}, token=login['token'])
status('/api/me', 401, token=login['token'])
status('/api/register', 409, body={'email': email, 'password': password})
for url in ['', 'no link', 'https://127.0.0.1/test', 'https://douyin.com.evil.test/test', 'https://www.douyin.com@evil.test/test', 'https://www.douyin.com:8443/test', ['https://www.douyin.com'], 'a' * 12001]:
    status('/api/parse', 400, body={'url': url}, token=token)
status('/api/douyin/douyin.php', 404, token=token)
status('/api/parse', 405, token=token)
status('/api/download',401,body={'id':'a'*32})
status('/api/download',400,body={'url':'https://127.0.0.1/'},token=token)
status('/api/download',404,body={'id':'a'*32},token=token)
status('/api/home',401,body={'url':'https://www.douyin.com/user/test'})
if health.get('features',{}).get('home'):
    status('/api/home',400,body={'url':'https://evil.example/user/test'},token=token)
    status('/api/home',400,body={'url':'https://www.douyin.com/user/test','cookie':''},token=token)
    status('/api/home',400,body={'url':'https://www.douyin.com/user/test','cookie':'x\ny'},token=token)
    status('/api/home',400,body={'url':'https://www.douyin.com/user/test','cookie':'test','count':55},token=token)
else:
    status('/api/home',404,body={'url':'https://www.douyin.com/user/test'},token=token)

share = os.environ.get('TEST_SHARE_URL')
if share:
    parsed = status('/api/parse', 200, body={'url': '分享文案 ' + share + ' 复制打开'}, token=token)[1]
    check(parsed.get('code') == 200, f'Real parsing failed: {parsed.get("msg")}')
    media = parsed.get('data', {})
    check(bool(media.get('url') or media.get('images') or media.get('live_photo')), 'No media returned')
    assets=media.get('downloads',[])
    check(len(assets)>0,'No authenticated download handles returned')
    if media.get('type')=='video':
        check(any(a.get('kind')=='video' for a in assets),'Video URL was dropped: only cover/music downloads remain')
    other=status('/api/register',200,body={'email':'other-'+secrets.token_hex(5)+'@example.com','password':password})[1]
    status('/api/download',404,body={'id':assets[0]['id']},token=other['token'])
    status('/api/logout',200,body={},token=other['token'])
    download=urllib.request.Request(BASE+'/api/download',data=json.dumps({'id':assets[0]['id']}).encode(),headers={'Content-Type':'application/json','User-Agent':USER_AGENT,'Authorization':'Bearer '+token})
    with urllib.request.urlopen(download,timeout=100) as response:
        check('attachment' in response.headers.get('Content-Disposition',''),'Missing attachment header')
        check(len(response.read())>1000,'Downloaded media is empty')
    print('Real media:', json.dumps({'type': media.get('type'), 'title': media.get('title'), 'images': len(media.get('images', []))}, ensure_ascii=True))

# Only inspect the disposable database explicitly selected by run_local.py.
state_dir = os.environ.get('TEST_STATE_DIR')
if state_dir:
    for path in Path(state_dir).rglob('*.sqlite'):
        with sqlite3.connect(path, timeout=5) as db:
            if not db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='sessions'").fetchone():
                continue
            row = db.execute('SELECT password FROM users WHERE email=?', (email,)).fetchone()
            check(row is not None and row[0] != password and len(row[0]) > 50, 'Password stored as plaintext')
            session_hash = hashlib.sha256(token.encode()).hexdigest()
            check(db.execute('SELECT token FROM sessions WHERE token=?', (session_hash,)).fetchone() is not None, 'Session not hashed at rest')
            db.execute('UPDATE sessions SET expires=0 WHERE token=?', (session_hash,))
        status('/api/me', 401, token=token)
        break
    else:
        raise AssertionError('Disposable database was not found')
else:
    status('/api/logout', 200, body={}, token=token)
    status('/api/me', 401, token=token)

if os.environ.get('TEST_RATE_LIMIT') == '1':
    for _ in range(21):
        result = request('/api/login', body={'email': email, 'password': 'incorrect-password'})
        if result[0] == 429:
            break
    check(result[0] == 429, 'Login rate limit did not activate')
print(f'PASS: {checks} checks (assets, auth, CORS, malformed input, isolation, expiry/revocation, media and rate limits).')
