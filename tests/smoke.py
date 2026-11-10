import json, urllib.request, urllib.error, secrets, os
base=os.environ.get('TEST_BASE_URL', 'http://127.0.0.1:8080').rstrip('/')
def req(path, body=None, token=None):
    headers={'Content-Type':'application/json'}
    if token: headers['Authorization']='Bearer '+token
    r=urllib.request.Request(base+path,data=json.dumps(body).encode() if body is not None else None,headers=headers)
    try:
        with urllib.request.urlopen(r) as response: return response.status,json.load(response)
    except urllib.error.HTTPError as e: return e.code,json.load(e)
assert req('/api/health')[1]['parser']
assert req('/api/parse',{'url':'https://www.douyin.com/video/1'})[0]==401
email='qa-'+secrets.token_hex(4)+'@example.com';password=secrets.token_urlsafe(18)
status,data=req('/api/register',{'email':email,'password':password});assert status==200,(status,data)
token=data['token']
assert req('/api/me',token=token)[1]['email']==email
assert req('/api/login',{'email':email,'password':'incorrect-password'})[0]==401
login_status,login=req('/api/login',{'email':email,'password':password});assert login_status==200
assert req('/api/me',token=login['token'])[1]['email']==email
assert req('/api/logout',{},login['token'])[0]==200
assert req('/api/register',{'email':email,'password':password})[0]==409
assert req('/api/parse',{'url':'https://douyin.com.evil.test/test'},token)[0]==400
assert req('/api/parse',{'url':'https://127.0.0.1/test'},token)[0]==400
assert req('/api/douyin/douyin.php',token=token)[0]==404
assert req('/var/app.sqlite')[0] in (401,404)
assert req('/server/router.php')[0] in (401,404)
assert req('/api/logout',{},token)[0]==200
assert req('/api/me',token=token)[0]==401
print('PASS: registration, login, duplicate user, wrong password, authenticated access, SSRF host filtering, private files, logout revocation')

