<?php
require __DIR__.'/../api/kuaishou/KuaishouSpider.php';
$parser=new KuaishouSpider('','test');
$method=new ReflectionMethod($parser,'extractFromInitState');
function verify($ok,string $message): void {if(!$ok)throw new RuntimeException($message);}
$state=['tusjoh-empty'=>['fid'=>'unrelated'],'tusjoh-photo'=>['photo'=>['caption'=>'回归样例','manifest'=>['adaptationSet'=>[['representation'=>[['url'=>'https://v.a.yximgs.com/video.mp4']]]]]]]];
$html='<script>window.INIT_STATE={};</script><script>window.INIT_STATE='.json_encode($state).';</script>';
$result=$method->invoke($parser,$html);
verify($result['code']===200&&$result['data']['type']==='video','Empty bootstrap/unrelated fid must not hide video manifest');
$atlas=['tusjoh-photo'=>['photo'=>['ext_params'=>json_encode(['atlas'=>['list'=>['image1.jpg','image2.jpg']]])]]];
$result=$method->invoke($parser,'<script>window.INIT_STATE='.json_encode($atlas).';</script>');
verify($result['code']===200&&count($result['data']['images'])===2,'JSON-encoded ext_params gallery must parse');
$apollo=new ReflectionMethod($parser,'extractFromApolloState');
$state=['defaultClient'=>['VisionVideoDetailPhoto:abc'=>['photoUrl'=>'https://v.a.yximgs.com/video.mp4']]];
$result=$apollo->invoke($parser,'<script>window.__APOLLO_STATE__='.json_encode($state).';</script>','abc','photo');
verify($result['data']['type']==='video','A /photo/ page is not necessarily a gallery');
echo "PASS: empty bootstrap state, unrelated records, manifest video, encoded gallery and /photo/ video\n";
