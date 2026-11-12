package cn.shiying.studio;

import android.content.Context;
import org.json.JSONObject;
import java.io.*;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.*;

/** Native JSON requests also allow an explicitly chosen LAN HTTP service. */
final class ApiRequests {
    private static final Set<String> PATHS=new HashSet<>(Arrays.asList("health","me","login","register","logout","parse","home","platform/douyin/status","platform/douyin/login","platform/douyin/disconnect"));
    private final NativeDownloads.Events events;
    private final Set<String> platformHosts;
    private final ExecutorService workers=Executors.newFixedThreadPool(3);
    private final Map<String,Task> tasks=new ConcurrentHashMap<>();
    private static final class Task {
        volatile boolean cancelled;volatile HttpURLConnection connection;
        synchronized void cancel(){if(cancelled)return;cancelled=true;HttpURLConnection active=connection;if(active!=null)new Thread(active::disconnect,"shiying-cancel").start();}
        void check() throws IOException {if(cancelled||Thread.currentThread().isInterrupted())throw new IOException("请求已取消");}
    }
    ApiRequests(Context context,NativeDownloads.Events events){this.events=events;this.platformHosts=NativeDownloads.loadHosts(context,"parser-hosts.json","media-hosts.json");}
    String platform(String id,String url,String method,String headers){
        if(id==null||!id.matches("platform_[a-zA-Z0-9_]+")||url==null||url.length()>16000||!MediaTransfer.allowed(url,platformHosts)||!("GET".equals(method)||"HEAD".equals(method))||headers==null||headers.length()>16000)return "平台请求无效";
        final JSONObject input;
        try{input=new JSONObject(headers);for(Iterator<String> keys=input.keys();keys.hasNext();){String key=keys.next();String value=input.getString(key);if(!key.toLowerCase(Locale.ROOT).matches("user-agent|accept|accept-language|referer|sec-fetch-(dest|mode|site|user)|sec-ch-ua(-mobile|-platform)?")||value.length()>2048||value.contains("\r")||value.contains("\n"))return "平台请求头无效";}}
        catch(Exception error){return "平台请求头无效";}
        Task task=new Task();if(tasks.putIfAbsent(id,task)!=null)return "请求编号重复";
        workers.submit(()->{
            try{
                task.check();HttpURLConnection connection=(HttpURLConnection)new URL(url).openConnection();task.connection=connection;task.check();
                connection.setRequestMethod(method);connection.setInstanceFollowRedirects(false);connection.setConnectTimeout(8000);connection.setReadTimeout(15000);connection.setRequestProperty("Accept-Encoding","identity");
                for(Iterator<String> keys=input.keys();keys.hasNext();){String key=keys.next();connection.setRequestProperty(key,input.getString(key));}
                int status=connection.getResponseCode();String type=connection.getContentType();JSONObject outputHeaders=new JSONObject();
                for(String name:new String[]{"Content-Type","Content-Length","Location"}){String value=connection.getHeaderField(name);if(value!=null)outputHeaders.put(name,value);}
                ByteArrayOutputStream bytes=new ByteArrayOutputStream();
                if(!"HEAD".equals(method)&&!(type!=null&&type.toLowerCase(Locale.ROOT).matches("^(image/|video/|audio/|application/octet-stream(?:;|$)).*"))){
                    try(InputStream in=status>=400?connection.getErrorStream():connection.getInputStream()){
                        if(in!=null){byte[] buffer=new byte[16384];int n;while((n=in.read(buffer))!=-1){task.check();if(bytes.size()+n>4*1024*1024)throw new IOException("平台页面过大");bytes.write(buffer,0,n);}}
                    }
                }
                task.check();events.send("onResponse",id,new JSONObject().put("status",status).put("body",bytes.toString("UTF-8")).put("headers",outputHeaders).put("url",url).toString());
            }catch(Exception error){if(!task.cancelled)events.send("onError",id,"平台访问失败："+(error.getMessage()==null?"请稍后重试":error.getMessage()));}
            finally{if(task.connection!=null)task.connection.disconnect();tasks.remove(id,task);}
        });return "";
    }
    String start(String id,String server,String path,String body,String token){
        if(id==null||!id.matches("api_[a-zA-Z0-9_]+")||!PATHS.contains(path)||body!=null&&body.getBytes(StandardCharsets.UTF_8).length>16384||token==null||!token.isEmpty()&&!token.matches("[a-f0-9]{64}"))return "服务请求无效";
        final String base;try{base=Backend.normalize(server);}catch(Exception error){return error.getMessage();}
        Task task=new Task();if(tasks.putIfAbsent(id,task)!=null)return "请求编号重复";
        workers.submit(()->{
            try{
                task.check();HttpURLConnection connection=(HttpURLConnection)new URL(base+"/api/"+path).openConnection();task.connection=connection;task.check();
                connection.setInstanceFollowRedirects(false);connection.setConnectTimeout(8000);connection.setReadTimeout(90000);connection.setRequestProperty("User-Agent","Mozilla/5.0");connection.setRequestProperty("Accept","application/json");
                if(!token.isEmpty())connection.setRequestProperty("Authorization","Bearer "+token);
                if(body!=null){connection.setRequestMethod("POST");connection.setDoOutput(true);connection.setRequestProperty("Content-Type","application/json");byte[] payload=body.getBytes(StandardCharsets.UTF_8);connection.setFixedLengthStreamingMode(payload.length);try(OutputStream out=connection.getOutputStream()){out.write(payload);}}
                int status=connection.getResponseCode();if(status>=300&&status<400)throw new IOException("服务地址发生跳转，请检查地址设置");
                ByteArrayOutputStream bytes=new ByteArrayOutputStream();
                try(InputStream in=status>=400?connection.getErrorStream():connection.getInputStream()){
                    if(in!=null){byte[] buffer=new byte[16384];int n;while((n=in.read(buffer))!=-1){task.check();if(bytes.size()+n>4*1024*1024)throw new IOException("服务响应过大");bytes.write(buffer,0,n);}}
                }
                task.check();events.send("onResponse",id,new JSONObject().put("status",status).put("body",bytes.toString("UTF-8")).toString());
            }catch(Exception error){if(!task.cancelled)events.send("onError",id,"无法连接服务，请确认电脑已启动、手机和电脑处于同一局域网："+(error.getMessage()==null?"连接失败":error.getMessage()));}
            finally{if(task.connection!=null)task.connection.disconnect();tasks.remove(id,task);}
        });return "";
    }
    void cancel(String id){Task task=tasks.get(id);if(task!=null)task.cancel();}
    void cancelAll(){for(Task task:tasks.values())task.cancel();}
    void close(){cancelAll();workers.shutdownNow();}
}
