<?php
require __DIR__.'/../api/douyin/DouyinParser.php';
$method = new ReflectionMethod(DouyinParser::class, 'extractHighestQualityVideo');
$result = $method->invoke(new DouyinParser(), ['video'=>['bit_rate'=>[
    ['bit_rate'=>9000000,'play_addr'=>['width'=>540,'height'=>960,'url_list'=>['https://v3.douyinvod.com/low.mp4']]],
    ['bit_rate'=>2000000,'play_addr'=>['width'=>1080,'height'=>1920,'url_list'=>['https://v3.douyinvod.com/high.mp4']]],
]]]);
if ($result['url'] !== 'https://v3.douyinvod.com/high.mp4') throw new RuntimeException('Higher resolution must win over lower-resolution bitrate');
echo "PASS: PHP Douyin resolution-first source selection\n";
