<?php
declare(strict_types=1);
// Serve only web/ publicly. Original PHP parsers are reachable through /api/parse only.
$root = dirname(__DIR__);
$path = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
$allowed = array_filter(explode(',', getenv('ALLOWED_ORIGINS') ?: 'http://127.0.0.1:8080,http://localhost:8080'));
if ($origin && !in_array($origin, $allowed, true)) { http_response_code(403); exit; }
if ($origin) { header('Access-Control-Allow-Origin: '.$origin); header('Vary: Origin'); }
header('Access-Control-Allow-Headers: Content-Type, Authorization');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: no-referrer');
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
    header('Content-Type: '.($types[pathinfo($real, PATHINFO_EXTENSION)] ?? 'application/octet-stream')); readfile($real); exit;
}
if ($path === '/api/health') reply(['status'=>'ok','auth'=>'required','parser'=>extension_loaded('curl')]);
if (!is_dir($root.'/var')) mkdir($root.'/var',0700,true);
$db = new PDO('sqlite:'.$root.'/var/app.sqlite');
$db->setAttribute(PDO::ATTR_ERRMODE,PDO::ERRMODE_EXCEPTION);
$db->exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, email TEXT UNIQUE NOT NULL, password TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, user_id INTEGER NOT NULL, expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS limits (key TEXT PRIMARY KEY, count INTEGER NOT NULL, expires INTEGER NOT NULL);');
$db->exec('DELETE FROM sessions WHERE expires < '.time().'; DELETE FROM limits WHERE expires < '.time());
function rateLimit(PDO $db, string $scope, int $limit): void {
    $key = $scope.':'.($_SERVER['REMOTE_ADDR'] ?? 'unknown').':'.intdiv(time(),600);
    $s=$db->prepare('INSERT INTO limits VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1');$s->execute([$key,time()+600]);
    $s=$db->prepare('SELECT count FROM limits WHERE key=?');$s->execute([$key]);
    if ($s->fetchColumn()>$limit) reply(['msg'=>'操作太频繁，请稍后再试'],429);
}
$body=[];
if ($_SERVER['REQUEST_METHOD']==='POST') {
    if ((int)($_SERVER['CONTENT_LENGTH'] ?? 0)>16384) reply(['msg'=>'请求内容过长'],413);
    $body=json_decode(file_get_contents('php://input',false,null,0,16385),true);
    if (!is_array($body)) reply(['msg'=>'无效的 JSON 请求'],400);
}
if (in_array($path,['/api/register','/api/login'],true)) {
    if ($_SERVER['REQUEST_METHOD']!=='POST') reply(['msg'=>'请使用 POST'],405);
    rateLimit($db,'auth',20);
    $email=strtolower(trim((string)($body['email'] ?? '')));$password=(string)($body['password'] ?? '');
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
if ($path==='/api/me') reply(['email'=>$user['email']]);
if ($path==='/api/logout' && $_SERVER['REQUEST_METHOD']==='POST') {$s=$db->prepare('DELETE FROM sessions WHERE token=?');$s->execute([hash('sha256',$token)]);reply(['msg'=>'已退出登录']);}
if ($path!=='/api/parse' && !$bridge) reply(['msg'=>'接口不存在'],404);
if ($_SERVER['REQUEST_METHOD']!=='POST') reply(['msg'=>'请使用 POST'],405);
rateLimit($db,'parse',60);
$text=(string)($body['url'] ?? '');
if (!preg_match('~https?://[^\s<>"\x27]+~u',$text,$m)) reply(['msg'=>'请粘贴包含 http(s) 链接的分享文案'],400);
$url=rtrim($m[0],"，。；,.;");$parts=parse_url($url);$host=strtolower($parts['host'] ?? '');
if (isset($parts['user'])||isset($parts['pass'])||isset($parts['port'])) reply(['msg'=>'链接地址无效'],400);
$platforms=[
 'douyin.com'=>'douyin/douyin.php','iesdouyin.com'=>'douyin/douyin.php',
 'kuaishou.com'=>'kuaishou/ksjx.php','xiaohongshu.com'=>'xiaohongshu/xhsjx.php','xhslink.com'=>'xiaohongshu/xhsjx.php',
 'bilibili.com'=>'bilibili/bilibili.php','b23.tv'=>'bilibili/bilibili.php','weibo.com'=>'weibo.php','weibo.cn'=>'weibo.php',
 'toutiao.com'=>'toutiao.php','toutiaovod.com'=>'toutiao.php','pipix.com'=>'ppxia.php','ippzone.com'=>'pipigx.php','izuiyou.com'=>'zuiyou.php'];
$script=null;foreach($platforms as $domain=>$entry) if ($host===$domain||str_ends_with($host,'.'.$domain)) {$script=$entry;break;}
if (!$script) reply(['msg'=>'暂不支持该平台，请使用下方列出的平台链接'],400);
// Dispatch locally, avoiding the upstream aggregator's HTTP self-request/deadlock.
$_GET=['url'=>$url];$_POST=['url'=>$url];$_SERVER['REQUEST_METHOD']='GET';$_SERVER['REQUEST_URI']='/api/'.$script.'?url='.rawurlencode($url);
set_time_limit(60);chdir($root.'/api/'.dirname($script));
// Parsers emit a wildcard CORS header; restore the configured origin before output.
header_register_callback(function() use ($origin) {header_remove('Access-Control-Allow-Origin'); if ($origin) header('Access-Control-Allow-Origin: '.$origin);header('Cache-Control: no-store');});
require $root.'/api/'.$script;
