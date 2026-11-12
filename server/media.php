<?php
declare(strict_types=1);

function mediaAllowed(string $url): bool {
    $p=parse_url($url);
    if (!$p||!in_array(strtolower($p['scheme'] ?? ''),['http','https'],true)||isset($p['user'])||isset($p['pass'])||isset($p['port'])) return false;
    $host=strtolower($p['host'] ?? '');
    $suffixes=json_decode(file_get_contents(dirname(__DIR__).'/config/media-hosts.json'),true);
    foreach ($suffixes as $suffix) if ($host===$suffix||str_ends_with($host,'.'.$suffix)) return true;
    return false;
}

function registerMedia(PDO $db, int $userId, array $data): array {
    $data['title']=(string)($data['title'] ?? $data['desc'] ?? $data['description'] ?? '未命名作品');
    if (is_string($data['author'] ?? null)) $data['author']=['name'=>$data['author']];
    $data['author']=$data['author'] ?? $data['user'] ?? [];
    $data['music']=$data['music'] ?? ['url'=>$data['music_url'] ?? '','title'=>$data['music_title'] ?? ''];
    if (is_string($data['music'])) $data['music']=['url'=>$data['music']];
    $data['images']=is_array($data['images'] ?? null) ? $data['images'] : [];
    $data['type']=$data['type'] ?? (count($data['images']) ? 'image' : 'video');
    if ($data['type']==='image'&&!count($data['images'])&&!empty($data['url'])) $data['images']=[$data['url']];
    if ($data['type']==='image') $data['url']=null;
    if ($data['type']==='video') $data['images']=[];
    $clean=str_replace(['\\','/',':','*','?','"','<','>','|'],'_',$data['title']);
    $base=mb_substr(preg_replace('~[\x00-\x1f]+~u','_',$clean),0,40) ?: '拾影';
    $group=bin2hex(random_bytes(4));$assets=[];$seen=[];
    $add=function($url,string $kind,int $index=1) use (&$assets,&$seen,$db,$userId,$base,$group): void {
        if (!is_string($url)||!mediaAllowed($url)||isset($seen[$url])) return;
        $seen[$url]=true;$id=bin2hex(random_bytes(16));
        $ext=match($kind){'video','live'=>'mp4','music'=>'mp3',default=>'jpg'};
        $pathExt=strtolower(pathinfo(parse_url($url,PHP_URL_PATH) ?: '',PATHINFO_EXTENSION));
        if (in_array($pathExt,['jpg','jpeg','png','webp','avif','gif','mp4','m4a','mp3','webm'],true)) $ext=$pathExt;
        $name=$base.'_'.$group.'_'.$kind.'_'.str_pad((string)$index,2,'0',STR_PAD_LEFT).'.'.$ext;
        $s=$db->prepare('INSERT INTO assets(id,user_id,url,name,kind,expires) VALUES (?,?,?,?,?,?)');$s->execute([$id,$userId,$url,$name,$kind,time()+3600]);
        $assets[]=['id'=>$id,'name'=>$name,'kind'=>$kind,'url'=>$url];
    };
    $add($data['url'] ?? null,'video');
    foreach($data['images'] as $i=>$url) $add($url,'image',$i+1);
    foreach(($data['live_photo'] ?? []) as $i=>$pair) {$add($pair['image'] ?? null,'image',$i+1);$add($pair['video'] ?? null,'live',$i+1);}
    foreach(($data['videos'] ?? []) as $i=>$part) $add($part['url'] ?? null,'video',$i+1);
    $add($data['cover'] ?? null,'cover');$add($data['music']['url'] ?? null,'music');
    $data['downloads']=$assets;
    return $data;
}

function downloadMedia(PDO $db,int $userId,array $body): never {
    set_time_limit(0);
    if (!is_string($body['id'] ?? null)||!preg_match('/^[a-f0-9]{32}$/',$body['id'])) reply(['msg'=>'无效的下载编号'],400);
    $s=$db->prepare('SELECT * FROM assets WHERE id=? AND user_id=? AND expires>?');$s->execute([$body['id'],$userId,time()]);$asset=$s->fetch(PDO::FETCH_ASSOC);
    if (!$asset) reply(['msg'=>'下载链接已过期或无权访问，请重新解析'],404);
    $url=$asset['url'];$temp=tmpfile();if (!$temp) reply(['msg'=>'无法创建下载缓存'],503);
    $size=0;$responseHeaders=[];
    // Validate every redirect and pin DNS. Only parser-issued, allowlisted CDN URLs are fetched.
    for($redirect=0;$redirect<6;$redirect++) {
        if (!mediaAllowed($url)) reply(['msg'=>'媒体地址不在允许的下载域名内'],400);
        $p=parse_url($url);$host=$p['host'];$ip=gethostbyname($host);
        if (!filter_var($ip,FILTER_VALIDATE_IP,FILTER_FLAG_NO_PRIV_RANGE|FILTER_FLAG_NO_RES_RANGE)) reply(['msg'=>'媒体域名无法安全解析'],502);
        $port=$p['scheme']==='https'?443:80;$size=0;$responseHeaders=[];ftruncate($temp,0);rewind($temp);
        $ch=curl_init($url);
        $referer=str_contains($host,'bili')?'https://www.bilibili.com/':(preg_match('/sina|weibo/',$host)?'https://weibo.com/':(preg_match('/xhs|xiaohongshu/',$host)?'https://www.xiaohongshu.com/':(preg_match('/kwimg|yximg|kwaicdn/',$host)?'https://www.kuaishou.com/':'https://www.douyin.com/')));
        curl_setopt_array($ch,[CURLOPT_PROXY=>'',CURLOPT_RESOLVE=>["$host:$port:$ip"],CURLOPT_FOLLOWLOCATION=>false,CURLOPT_CONNECTTIMEOUT=>10,CURLOPT_TIMEOUT=>0,CURLOPT_LOW_SPEED_LIMIT=>1,CURLOPT_LOW_SPEED_TIME=>90,CURLOPT_SSL_VERIFYPEER=>true,CURLOPT_SSL_VERIFYHOST=>2,CURLOPT_USERAGENT=>'Mozilla/5.0',CURLOPT_REFERER=>$referer,
            CURLOPT_HEADERFUNCTION=>function($c,string $line) use (&$responseHeaders): int {$parts=explode(':',$line,2);if(count($parts)===2)$responseHeaders[strtolower(trim($parts[0]))]=trim($parts[1]);return strlen($line);},
            CURLOPT_WRITEFUNCTION=>function($c,string $chunk) use ($temp,&$size): int {$size+=strlen($chunk);return fwrite($temp,$chunk);}]);
        $ok=curl_exec($ch);$code=curl_getinfo($ch,CURLINFO_HTTP_CODE);
        if (!$ok) reply(['msg'=>'媒体下载失败，请稍后重试或重新解析'],502);
        if ($code>=300&&$code<400&&isset($responseHeaders['location'])) {
            $next=$responseHeaders['location'];
            if (str_starts_with($next,'//'))$next=$p['scheme'].':'.$next;
            elseif(str_starts_with($next,'/'))$next=$p['scheme'].'://'.$host.$next;
            $url=$next;continue;
        }
        if ($code!==200||$size===0) reply(['msg'=>'媒体服务器拒绝下载，请重新解析后重试'],502);
        $type=explode(';',$responseHeaders['content-type'] ?? 'application/octet-stream')[0];
        if (!preg_match('~^(image/|video/|audio/|application/octet-stream)~i',$type)) reply(['msg'=>'媒体服务器未返回有效媒体文件'],502);
        header('Content-Type: '.$type);header('Content-Length: '.$size);header('Content-Disposition: attachment; filename="shiying-download"; filename*=UTF-8\'\''.rawurlencode($asset['name']));header('Cache-Control: no-store');
        rewind($temp);fpassthru($temp);fclose($temp);exit;
    }
    reply(['msg'=>'媒体重定向次数过多'],502);
}
