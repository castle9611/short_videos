<?php
declare(strict_types=1);
// Serve only web/ publicly. Original PHP parsers are reachable through /api/parse only.
$root = dirname(__DIR__);
$path = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH) ?: '/';
$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
$allowed = array_filter(array_map('trim',explode(',', getenv('ALLOWED_ORIGINS') ?: 'http://127.0.0.1:8080,http://localhost:8080')));
if ($origin && !in_array($origin, $allowed, true)) reply(['msg'=>'来源未授权'],403);
if ($origin) { header('Access-Control-Allow-Origin: '.$origin); header('Vary: Origin'); }
header('Access-Control-Allow-Headers: Content-Type, Authorization');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: no-referrer');
header("Content-Security-Policy: default-src 'self'; img-src 'self' https: http: data:; media-src https: http:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(204); exit; }
function reply(array $data, int $status = 200): never {
    http_response_code($status); header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store'); echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE); exit;
}
if (!str_starts_with($path, '/api/')) {
    $file = $root.'/web'.($path === '/' ? '/index.html' : $path);
    $real = realpath($file);
    if (!$real || !str_starts_with($real, realpath($root.'/web').DIRECTORY_SEPARATOR) || !is_file($real)) reply(['msg'=>'页面不存在'],404);
    $types=['html'=>'text/html; charset=utf-8','css'=>'text/css; charset=utf-8','js'=>'text/javascript; charset=utf-8','json'=>'application/json'];
    if (!in_array($_SERVER['REQUEST_METHOD'],['GET','HEAD'],true)) reply(['msg'=>'请使用 GET'],405);
    header('Cache-Control: no-cache');
    header('Content-Type: '.($types[pathinfo($real, PATHINFO_EXTENSION)] ?? 'application/octet-stream'));
    if ($_SERVER['REQUEST_METHOD']!=='HEAD') readfile($real); exit;
}
set_exception_handler(function(Throwable $e): never {error_log((string)$e);reply(['msg'=>'服务暂时不可用，请稍后再试'],500);});
if ($path === '/api/health') reply(['status'=>'ok','auth'=>'required','parser'=>extension_loaded('curl') && extension_loaded('pdo_sqlite'),'platforms'=>['douyin','kuaishou','xiaohongshu'],'features'=>['home'=>getenv('ENABLE_HOME')==='1']]);
if (!in_array($_SERVER['REQUEST_METHOD'],['GET','POST'],true)) reply(['msg'=>'请求方法不支持'],405);
$dataDir=getenv('APP_DATA_DIR') ?: $root.'/var';
if (!is_dir($dataDir)) mkdir($dataDir,0700,true);
$db = new PDO('sqlite:'.$dataDir.'/app.sqlite');
$db->setAttribute(PDO::ATTR_ERRMODE,PDO::ERRMODE_EXCEPTION);
$db->exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, email TEXT UNIQUE NOT NULL, password TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, user_id INTEGER NOT NULL, expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS limits (key TEXT PRIMARY KEY, count INTEGER NOT NULL, expires INTEGER NOT NULL);');
$db->exec('CREATE TABLE IF NOT EXISTS assets(id TEXT PRIMARY KEY,user_id INTEGER NOT NULL,url TEXT NOT NULL,name TEXT NOT NULL,kind TEXT NOT NULL,expires INTEGER NOT NULL);');
$db->exec('CREATE INDEX IF NOT EXISTS assets_expiry ON assets(expires);');
require_once __DIR__.'/media.php';
require_once __DIR__.'/platform.php';
$db->exec('DELETE FROM sessions WHERE expires < '.time().'; DELETE FROM limits WHERE expires < '.time());
$db->exec('DELETE FROM assets WHERE expires < '.time());
function rateLimit(PDO $db, string $scope, int $limit): void {
    $key = $scope.':'.($_SERVER['REMOTE_ADDR'] ?? 'unknown').':'.intdiv(time(),600);
    $s=$db->prepare('INSERT INTO limits VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1');$s->execute([$key,time()+600]);
    $s=$db->prepare('SELECT count FROM limits WHERE key=?');$s->execute([$key]);
    if ($s->fetchColumn()>$limit) reply(['msg'=>'操作太频繁，请稍后再试'],429);
}
$body=[];
if ($_SERVER['REQUEST_METHOD']==='POST') {
    if ((int)($_SERVER['CONTENT_LENGTH'] ?? 0)>16384) reply(['msg'=>'请求内容过长'],413);
    $raw=file_get_contents('php://input',false,null,0,16385);
    if (strlen($raw)>16384) reply(['msg'=>'请求内容过长'],413);
    $object=json_decode($raw);
    if (!is_object($object)) reply(['msg'=>'无效的 JSON 请求'],400);
    $body=(array)$object;
}
if (in_array($path,['/api/register','/api/login'],true)) {
    if ($_SERVER['REQUEST_METHOD']!=='POST') reply(['msg'=>'请使用 POST'],405);
    rateLimit($db,'auth',20);
    if (!is_string($body['email'] ?? null)||!is_string($body['password'] ?? null)) reply(['msg'=>'邮箱和密码必须为字符串'],400);
    $email=strtolower(trim($body['email']));$password=$body['password'];
    if (!filter_var($email,FILTER_VALIDATE_EMAIL)||strlen($email)>254||strlen($password)<10||strlen($password)>72) reply(['msg'=>'请输入有效邮箱，密码需为 10–72 字节'],400);
    if ($path==='/api/register') {
        try {$s=$db->prepare('INSERT INTO users(email,password) VALUES (?,?)');$s->execute([$email,password_hash($password,PASSWORD_DEFAULT)]);}
        catch (PDOException $e) {if ($e->getCode()==='23000') reply(['msg'=>'该邮箱已注册，请登录'],409); throw $e;}
    }
    $s=$db->prepare('SELECT * FROM users WHERE email=?');$s->execute([$email]);$user=$s->fetch(PDO::FETCH_ASSOC);
    if (!$user||!password_verify($password,$user['password'])) reply(['msg'=>'邮箱或密码错误'],401);
    $token=bin2hex(random_bytes(32));$s=$db->prepare('INSERT INTO sessions VALUES (?,?,?)');$s->execute([hash('sha256',$token),$user['id'],time()+86400]);
    reply(['token'=>$token,'email'=>$email,'expiresIn'=>86400]);
}
$token=preg_replace('/^Bearer /','',$_SERVER['HTTP_AUTHORIZATION'] ?? '');
$bridgeSecret=getenv('PHP_BRIDGE_SECRET') ?: '';
$bridge=$path==='/api/bridge' && $bridgeSecret!=='' && hash_equals($bridgeSecret,$_SERVER['HTTP_X_BRIDGE_SECRET'] ?? '');
$s=$db->prepare('SELECT users.id,users.email FROM sessions JOIN users ON users.id=sessions.user_id WHERE token=? AND expires>?');$s->execute([hash('sha256',$token),time()]);$user=$s->fetch(PDO::FETCH_ASSOC);
if (!$user && !$bridge) reply(['msg'=>'请先注册或登录'],401);
if ($path==='/api/me') {if ($_SERVER['REQUEST_METHOD']!=='GET') reply(['msg'=>'请使用 GET'],405);reply(['email'=>$user['email']]);}
if ($path==='/api/logout' && $_SERVER['REQUEST_METHOD']==='POST') {$s=$db->prepare('DELETE FROM sessions WHERE token=?');$s->execute([hash('sha256',$token)]);reply(['msg'=>'已退出登录']);}
if ($path==='/api/platform/douyin/status') reply(platformSession('status',(int)$user['id']));
if (in_array($path,['/api/platform/douyin/login','/api/platform/douyin/disconnect'],true)) {
    if ($_SERVER['REQUEST_METHOD']!=='POST') reply(['msg'=>'请使用 POST'],405);
    rateLimit($db,'platform-login',15);
    $action=$path==='/api/platform/douyin/login'?'start':'disconnect';$state=platformSession($action,(int)$user['id']);
    reply($state,($state['available'] ?? true)?200:503);
}
if ($path==='/api/download') {
    if ($_SERVER['REQUEST_METHOD']!=='POST') reply(['msg'=>'请使用 POST'],405);
    rateLimit($db,'download',120);set_time_limit(100);downloadMedia($db,(int)$user['id'],$body);
}
if ($path==='/api/home') {
    if (getenv('ENABLE_HOME')!=='1') reply(['msg'=>'主页批量功能暂未开放'],404);
    if ($_SERVER['REQUEST_METHOD']!=='POST') reply(['msg'=>'请使用 POST'],405);
    rateLimit($db,'home',10);
    $input=$body['url'] ?? ''; $cookie=$body['cookie'] ?? (getenv('DOUYIN_COOKIE') ?: '');
    if (!is_string($input)||!preg_match('~https://(?:www\.)?douyin\.com/user/([a-zA-Z0-9_.-]+)~',$input,$homeMatch)) reply(['msg'=>'请输入完整的抖音主页链接 https://www.douyin.com/user/...'],400);
    if (!is_string($cookie)||strlen($cookie)>12000||preg_match('/[\r\n]/',$cookie)) reply(['msg'=>'Cookie 格式无效'],400);
    if (!$cookie) $cookie=platformSession('cookie',(int)$user['id'])['cookie'] ?? '';
    if (!$cookie) reply(['msg'=>'请先点击“登录抖音”，在独立窗口中完成登录后再获取主页'],400);
    $count=$body['count'] ?? 18;
    if (!is_int($count)||$count<1||$count>54) reply(['msg'=>'每次获取数量须为 1–54'],400);
    require_once $root.'/api/douyin-home/DouyinHomeParser.php';set_time_limit(100);
    $home=(new DouyinHomeParser($cookie))->getData('',$homeMatch[1],$count);
    if (($home['code'] ?? 500)!==200) reply(['code'=>502,'msg'=>'主页获取失败，请检查 Cookie 是否有效、作品是否公开，或稍后重试','data'=>[]],502);
    $home['data']=array_map(fn($item)=>registerMedia($db,(int)$user['id'],$item),$home['data']);reply($home);
}
if ($path!=='/api/parse' && !$bridge) reply(['msg'=>'接口不存在'],404);
if ($_SERVER['REQUEST_METHOD']!=='POST') reply(['msg'=>'请使用 POST'],405);
rateLimit($db,'parse',60);
if (!is_string($body['url'] ?? null)||strlen($body['url'])>12000) reply(['msg'=>'分享文案必须为字符串，且不能超过 12000 字节'],400);
$text=$body['url'];
if (!preg_match('~https?://[^\s<>"\x27]+~u',$text,$m)) reply(['msg'=>'请粘贴包含 http(s) 链接的分享文案'],400);
$url=preg_replace('/[，。；,.;]+$/u','',$m[0]);$parts=parse_url($url);$host=strtolower($parts['host'] ?? '');
if (isset($parts['user'])||isset($parts['pass'])||isset($parts['port'])) reply(['msg'=>'链接地址无效'],400);
$platforms=[
 'douyin.com'=>'douyin/douyin.php','iesdouyin.com'=>'douyin/douyin.php',
 'kuaishou.com'=>'kuaishou/ksjx.php','gifshow.com'=>'kuaishou/ksjx.php','chenzhongtech.com'=>'kuaishou/ksjx.php','xiaohongshu.com'=>'xiaohongshu/xhsjx.php','xhslink.com'=>'xiaohongshu/xhsjx.php','xhslink.cn'=>'xiaohongshu/xhsjx.php','xhs.com'=>'xiaohongshu/xhsjx.php',
 'bilibili.com'=>'bilibili/bilibili.php','b23.tv'=>'bilibili/bilibili.php','weibo.com'=>'weibo.php','weibo.cn'=>'weibo.php',
 'toutiao.com'=>'toutiao.php','toutiaovod.com'=>'toutiao.php','pipix.com'=>'ppxia.php','ippzone.com'=>'pipigx.php','izuiyou.com'=>'zuiyou.php'];
$script=null;foreach($platforms as $domain=>$entry) if ($host===$domain||str_ends_with($host,'.'.$domain)) {$script=$entry;break;}
if (!$script) reply(['msg'=>'暂不支持该平台，请使用下方列出的平台链接'],400);
// Dispatch locally, avoiding the upstream aggregator's HTTP self-request/deadlock.
$_GET=['url'=>$url];$_POST=['url'=>$url];$_SERVER['REQUEST_METHOD']='GET';$_SERVER['REQUEST_URI']='/api/'.$script.'?url='.rawurlencode($url);
set_time_limit(60);ini_set('default_socket_timeout','30');chdir($root.'/api/'.dirname($script));
// Parsers emit a wildcard CORS header; restore the configured origin before output.
header_register_callback(function() use ($origin) {header_remove('Access-Control-Allow-Origin'); if ($origin) header('Access-Control-Allow-Origin: '.$origin);header('Cache-Control: no-store');});
// Normalize failures even for legacy scripts that call exit or print diagnostics.
ob_start(function(string $output) use ($db,$user,$bridge): string {
    $result=json_decode($output,true);
    if (!is_array($result)||!isset($result['code'])) {
        http_response_code(502);
        return json_encode(['code'=>502,'msg'=>'上游解析服务暂时不可用，请检查链接或稍后重试','data'=>[]],JSON_UNESCAPED_UNICODE);
    }
    try {if (!$bridge&&(int)$result['code']===200&&is_array($result['data'] ?? null)) $result['data']=registerMedia($db,(int)$user['id'],$result['data']);}
    catch(Throwable $e){error_log((string)$e);http_response_code(500);return json_encode(['code'=>500,'msg'=>'无法准备下载，请稍后重试','data'=>[]],JSON_UNESCAPED_UNICODE);}
    return json_encode($result,JSON_UNESCAPED_UNICODE|JSON_INVALID_UTF8_SUBSTITUTE);
});
require $root.'/api/'.$script;
