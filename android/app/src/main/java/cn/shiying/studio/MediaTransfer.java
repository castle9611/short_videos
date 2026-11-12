package cn.shiying.studio;

import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import java.util.function.BooleanSupplier;

/** Bounded, cancellable media fetch; redirects never receive the app token. */
final class MediaTransfer {
    private final Set<String> hosts;
    private final BooleanSupplier cancelled;
    private final String api;
    private final Set<HttpURLConnection> connections=ConcurrentHashMap.newKeySet();
    MediaTransfer(Set<String> hosts,BooleanSupplier cancelled,String server){this.hosts=hosts;this.cancelled=cancelled;String base=Backend.normalize(server);this.api=Backend.DEVICE.equals(base)?null:base+"/api/download";}
    static boolean allowed(String value,Set<String> hosts){
        try{URI uri=new URI(value);String host=uri.getHost();if(!"https".equalsIgnoreCase(uri.getScheme())||uri.getRawUserInfo()!=null||uri.getPort()!=-1||host==null)return false;
            host=host.toLowerCase(Locale.ROOT);for(String suffix:hosts)if(host.equals(suffix)||host.endsWith("."+suffix))return true;
        }catch(Exception ignored){}return false;
    }
    void cancel(){for(HttpURLConnection connection:connections)connection.disconnect();}
    private void check() throws IOException {if(cancelled.getAsBoolean()||Thread.currentThread().isInterrupted())throw new IOException("下载已取消");}
    void fetch(String url,String assetId,String token,File file) throws Exception {
        if(!assetId.matches("[a-f0-9]{32}")||!token.matches("[a-f0-9]{64}")||!allowed(url,hosts))throw new IOException("下载请求无效");
        try{transfer(url,null,null,file);}catch(Exception error){check();if(api==null)throw error;transfer(api,assetId,token,file);}
    }
    private void transfer(String url,String assetId,String token,File file) throws Exception {
        for(int redirects=0;redirects<6;redirects++){
            check();if(assetId==null&&!allowed(url,hosts))throw new IOException("媒体地址不在允许的域名内");
            HttpURLConnection connection=(HttpURLConnection)new URL(url).openConnection();connections.add(connection);
            try{
                check();connection.setInstanceFollowRedirects(false);connection.setConnectTimeout(8000);connection.setReadTimeout(assetId==null?15000:0);
                connection.setRequestProperty("User-Agent","Mozilla/5.0");connection.setRequestProperty("Accept-Encoding","identity");
                if(assetId!=null){
                    connection.setRequestMethod("POST");connection.setDoOutput(true);connection.setRequestProperty("Content-Type","application/json");connection.setRequestProperty("Authorization","Bearer "+token);
                    byte[] payload=("{\"id\":\""+assetId+"\"}").getBytes(StandardCharsets.UTF_8);connection.setFixedLengthStreamingMode(payload.length);
                    try(OutputStream out=connection.getOutputStream()){out.write(payload);}
                }else{
                    String host=new URL(url).getHost();String referer=host.contains("bili")?"https://www.bilibili.com/":host.matches(".*(sina|weibo).*")?"https://weibo.com/":host.matches(".*(xhs|xiaohongshu).*")?"https://www.xiaohongshu.com/":host.matches(".*(kwimg|yximg|kwaicdn).*")?"https://www.kuaishou.com/":"https://www.douyin.com/";
                    connection.setRequestProperty("Referer",referer);
                }
                int status=connection.getResponseCode();String next=connection.getHeaderField("Location");
                if(assetId==null&&status>=300&&status<400&&next!=null){url=new URL(new URL(url),next).toString();continue;}
                if(status!=200)throw new IOException("媒体服务器拒绝下载（"+status+"），请重新解析");
                String type=connection.getContentType();if(type!=null&&!type.toLowerCase(Locale.ROOT).matches("^(image/|video/|audio/|application/octet-stream(?:;|$)).*"))throw new IOException("媒体服务器未返回有效媒体文件");
                long size=connection.getContentLengthLong();
                long written=0;byte[] buffer=new byte[65536];
                try(InputStream in=connection.getInputStream();OutputStream out=new BufferedOutputStream(new FileOutputStream(file))){
                    int n;while((n=in.read(buffer))!=-1){check();written+=n;out.write(buffer,0,n);}check();
                }
                if(written==0||(size>=0&&size!=written))throw new IOException("文件未完整下载，请重试");return;
            }finally{connections.remove(connection);connection.disconnect();}
        }
        throw new IOException("媒体重定向次数过多");
    }
}
