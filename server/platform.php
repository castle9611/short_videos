<?php
declare(strict_types=1);
function platformSession(string $action,int $userId): array {
    $secret=getenv('PLATFORM_HELPER_SECRET') ?: '';
    if (!$secret) return ['available'=>false,'state'=>'unavailable','msg'=>'请通过 start.ps1 启动本地服务，以启用抖音登录窗口'];
    $port=(int)(getenv('PLATFORM_HELPER_PORT') ?: 9310);
    $ch=curl_init('http://127.0.0.1:'.$port.'/'.$action);
    curl_setopt_array($ch,[CURLOPT_PROXY=>'',CURLOPT_POST=>true,CURLOPT_POSTFIELDS=>json_encode(['userId'=>$userId]),CURLOPT_HTTPHEADER=>['Content-Type: application/json','X-Helper-Secret: '.$secret],CURLOPT_RETURNTRANSFER=>true,CURLOPT_TIMEOUT=>8]);
    $raw=curl_exec($ch);$code=curl_getinfo($ch,CURLINFO_HTTP_CODE);$result=is_string($raw)?json_decode($raw,true):null;
    if ($code!==200||!is_array($result)) return ['available'=>false,'state'=>'unavailable','msg'=>'抖音登录助手暂不可用，请重新运行 start.ps1'];
    return $result;
}
