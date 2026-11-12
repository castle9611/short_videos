package cn.shiying.studio;

import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;
import java.util.concurrent.atomic.AtomicBoolean;

public final class MediaTransferTest {
    static String mode;
    static final List<Fake> requests=new ArrayList<>();
    static final AtomicBoolean cancelled=new AtomicBoolean();
    static final String ID="1234567890abcdef1234567890abcdef",TOKEN=ID+ID;
    static final long LARGE=101L*1024*1024+7;
    static final Set<String> HOSTS=new HashSet<>(Arrays.asList("yximgs.com","kwaicdn.com"));
    static void check(boolean condition,String message){if(!condition)throw new AssertionError(message);}
    static boolean proxy(URL url){return url.getPath().equals("/api/download");}
    static class Fake extends HttpURLConnection {
        final ByteArrayOutputStream payload=new ByteArrayOutputStream();
        boolean disconnected;final URL address;
        Fake(URL url){super(url);address=url;requests.add(this);}
        public void connect(){}public boolean usingProxy(){return false;}public void disconnect(){disconnected=true;}
        public int getResponseCode(){
            if(mode.equals("fallback")||mode.equals("proxy-redirect"))return proxy(url)?(mode.equals("proxy-redirect")?302:200):403;
            if((mode.equals("redirect")||mode.equals("unsafe-redirect"))&&!proxy(url)&&!url.getHost().startsWith("v2."))return 302;
            return 200;
        }
        public String getHeaderField(String key){if(!key.equals("Location"))return null;
            if(mode.equals("proxy-redirect"))return "https://evil.test/steal";
            return mode.equals("unsafe-redirect")?"http://127.0.0.1/private":"https://v2.a.yximgs.com/video.mp4";
        }
        public String getContentType(){return mode.equals("html")&&!proxy(url)?"text/html":"video/mp4";}
        public long getContentLengthLong(){return mode.equals("large")?LARGE:mode.equals("large-stream")?-1:mode.equals("length-mismatch")?100L*1024*1024+1:mode.equals("truncated")&&!proxy(url)?99:body().length;}
        byte[] body(){return (proxy(url)?"complete-proxy-video":"direct-video").getBytes(StandardCharsets.UTF_8);}
        public InputStream getInputStream(){if(mode.equals("cancel"))cancelled.set(true);if(mode.startsWith("large"))return new InputStream(){long remaining=LARGE;public int read(){if(remaining==0)return -1;remaining--;return 90;}public int read(byte[] bytes,int offset,int length){if(remaining==0)return -1;int n=(int)Math.min(remaining,length);Arrays.fill(bytes,offset,offset+n,(byte)90);remaining-=n;return n;}};return new ByteArrayInputStream(body());}
        public OutputStream getOutputStream(){return payload;}
    }
    public static void main(String[] args) throws Exception {
        URL.setURLStreamHandlerFactory(protocol->new URLStreamHandler(){protected URLConnection openConnection(URL url){return new Fake(url);}});
        for(String url:Arrays.asList("http://v.a.yximgs.com/v","https://user:pass@v.a.yximgs.com/v","https://v.a.yximgs.com.evil.test/v","https://127.0.0.1/v","https://v.a.yximgs.com:443/v"))check(!MediaTransfer.allowed(url,HOSTS),"Untrusted URL accepted: "+url);
        check(MediaTransfer.allowed("https://v.a.yximgs.com/v",HOSTS),"CDN subdomain rejected");
        for(String address:Arrays.asList(Backend.DEVICE,Backend.CLOUD,"http://192.168.21.3:8080","http://10.1.2.3:8080","http://172.16.0.1:80","http://172.31.255.254"))check(Backend.normalize(address).equals(address),"Valid backend rejected");
        for(String address:Arrays.asList("http://127.0.0.1:8080","http://169.254.169.254","http://8.8.8.8","http://172.32.0.1","http://192.168.999.1","http://localhost","http://192.168.1.2:0","http://192.168.1.2:65536","http://u:p@192.168.1.2","http://192.168.1.2/path","http://192.168.1.2?q=1","http://192.168.1.2#fragment","https://evil.test")){
            boolean rejected=false;try{Backend.normalize(address);}catch(IllegalArgumentException expected){rejected=true;}check(rejected,"Invalid backend accepted: "+address);
        }
        Path file=Files.createTempFile("shiying-transfer-",".mp4");
        try{
            for(String server:Arrays.asList(Backend.DEVICE,Backend.CLOUD,"http://192.168.21.3:8080"))for(String scenario:Arrays.asList("direct","fallback","redirect","unsafe-redirect","html","truncated","length-mismatch","proxy-redirect","cancel")){
                mode=scenario;requests.clear();cancelled.set(false);boolean failed=false;
                try{new MediaTransfer(HOSTS,cancelled::get,server).fetch("https://v.a.yximgs.com/video.mp4",ID,TOKEN,file.toFile());}catch(IOException error){failed=true;}
                check(failed==(mode.equals("length-mismatch")||mode.equals("proxy-redirect")||mode.equals("cancel")||server.equals(Backend.DEVICE)&&!mode.equals("direct")&&!mode.equals("redirect")),"Unexpected outcome: "+mode);
                if(server.equals(Backend.DEVICE))check(requests.stream().noneMatch(request->proxy(request.address)),"Device mode contacted a backend");
                if(!failed){String result=new String(Files.readAllBytes(file),StandardCharsets.UTF_8);check(result.equals(mode.equals("direct")||mode.equals("redirect")?"direct-video":"complete-proxy-video"),"Partial or incorrect file: "+mode);}
                check(requests.size()<4,"Unbounded redirect chain");
                for(Fake request:requests){
                    check(request.disconnected,"Connection not released");check(!request.getInstanceFollowRedirects(),"Automatic redirect enabled");
                    check(!request.address.getHost().equals("127.0.0.1")&&!request.address.getHost().equals("evil.test"),"Unsafe redirect followed");
                    String auth=request.getRequestProperty("Authorization");
                    if(proxy(request.address)){check(("Bearer "+TOKEN).equals(auth),"Proxy authentication missing");check(request.getRequestMethod().equals("POST"),"Proxy must receive POST");check(request.payload.toString("UTF-8").equals("{\"id\":\""+ID+"\"}"),"Wrong download handle");}
                    else{check(auth==null,"Token leaked to CDN");check("https://www.kuaishou.com/".equals(request.getRequestProperty("Referer")),"Wrong platform referer");}
                }
                if(mode.equals("direct"))check(requests.size()==1,"Successful direct fetch used proxy");
                if(mode.equals("cancel"))check(requests.size()==1,"Cancelled fetch retried through proxy");
            }
            for(String scenario:Arrays.asList("large","large-stream")){
                mode=scenario;requests.clear();cancelled.set(false);new MediaTransfer(HOSTS,cancelled::get,Backend.DEVICE).fetch("https://v.a.yximgs.com/large.mp4",ID,TOKEN,file.toFile());check(Files.size(file)==LARGE,"Large file was truncated");check(requests.size()==1,"Large direct download used a backend");try(RandomAccessFile saved=new RandomAccessFile(file.toFile(),"r")){saved.seek(LARGE-1);check(saved.read()==90,"Large file tail was lost");}
            }
            System.out.println("PASS: native 101 MB downloads with/without Content-Length, authenticated fallback, redirects, integrity and cancellation");
        }finally{Files.deleteIfExists(file);}
    }
}
