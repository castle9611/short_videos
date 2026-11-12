package cn.shiying.studio;

import android.app.Activity;
import android.content.Context;
import android.net.Uri;
import android.provider.DocumentsContract;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;
import java.util.zip.Deflater;
import java.util.function.Supplier;

/** Download on the device, with the authenticated cloud proxy as a fallback. */
final class NativeDownloads {
    interface Events { void send(String method,String id,String message); }
    private final Activity activity;
    private final Events events;
    private final DownloadHistory history;
    private final Supplier<String> backend;
    private final Set<String> hosts=new HashSet<>();
    private Job current;

    NativeDownloads(Activity activity,Events events,Supplier<String> backend,DownloadHistory history){
        this.history=history;
        this.activity=activity;this.events=events;this.backend=backend;
        hosts.addAll(loadHosts(activity,"media-hosts.json"));
    }
    static Set<String> loadHosts(Context context,String... files){
        Set<String> hosts=new HashSet<>();
        for(String file:files)try(InputStream in=context.getAssets().open("web/"+file)){
            ByteArrayOutputStream out=new ByteArrayOutputStream();byte[] bytes=new byte[4096];int n;
            while((n=in.read(bytes))!=-1)out.write(bytes,0,n);
            JSONArray list=new JSONArray(out.toString("UTF-8"));for(int i=0;i<list.length();i++)hosts.add(list.getString(i));
        }catch(Exception error){throw new IllegalStateException("Missing host configuration",error);}
        return hosts;
    }
    synchronized boolean busy(){return current!=null;}
    synchronized String start(String id,String json,boolean zip,String token,Uri folder){
        if(current!=null)return "另一个下载任务尚未结束";
        if(folder==null)return "请先设置下载目录";
        try{
            if(id==null||!id.matches("download_[a-zA-Z0-9_]+")||token==null||!token.matches("[a-f0-9]{64}")||json==null||json.length()>1024*1024)throw new IOException();
            JSONArray items=new JSONArray(json);if(items.length()<1||items.length()>100)throw new IOException();
            for(int i=0;i<items.length();i++){
                JSONObject item=items.getJSONObject(i);
                String url=item.getString("url").replaceFirst("^http://","https://");
                if(!item.getString("id").matches("[a-f0-9]{32}")||!MediaTransfer.allowed(url,hosts))throw new IOException();item.put("url",url);
                item.put("name",safeName(item.getString("name")));
            }
            Job job=new Job(id,items,zip,token,folder,hosts,backend.get());current=job;
            new Thread(()->run(job),"shiying-download").start();return "";
        }catch(Exception error){return "下载请求无效，请重新解析作品";}
    }
    synchronized void cancel(String id){if(current!=null&&(id==null||current.id.equals(id)))current.cancel();}
    private static String safeName(String name){String clean=name.replaceAll("[\\\\/:*?\"<>|\\p{Cntrl}]","_");if(clean.length()>180)clean=clean.substring(0,180);return clean.isEmpty()||clean.equals(".")||clean.equals("..")?"拾影素材":clean;}
    private static final class Job {
        final String id,token;final JSONArray items;final boolean zip;final Uri folder;
        final ExecutorService workers=Executors.newFixedThreadPool(3);
        final MediaTransfer media;
        final AtomicInteger saved=new AtomicInteger();
        volatile boolean cancelled;
        Job(String id,JSONArray items,boolean zip,String token,Uri folder,Set<String> hosts,String server){this.id=id;this.items=items;this.zip=zip;this.token=token;this.folder=folder;this.media=new MediaTransfer(hosts,()->cancelled,server);}
        void check() throws IOException {if(cancelled||Thread.currentThread().isInterrupted())throw new IOException("下载已取消");}
        void cancel(){cancelled=true;media.cancel();workers.shutdownNow();}
    }
    private static final class Result {
        final int index;final File file;final String error;
        Result(int index,File file,String error){this.index=index;this.file=file;this.error=error;}
    }
    private void run(Job job){
        File directory=null;String message;boolean success=false;
        try{
            directory=File.createTempFile("shiying-","",activity.getCacheDir());if(!directory.delete()||!directory.mkdir())throw new IOException("无法创建下载缓存");
            final File cache=directory;
            CompletionService<Result> completed=new ExecutorCompletionService<>(job.workers);
            for(int i=0;i<job.items.length();i++){
                final int index=i;
                completed.submit(()->{
                    File file=new File(cache,index+".media");
                    try{
                        job.check();JSONObject item=job.items.getJSONObject(index);job.media.fetch(item.getString("url"),item.getString("id"),job.token,file);
                        if(!job.zip){save(job,file,item.getString("name"),mime(item.getString("name")));job.saved.incrementAndGet();file.delete();}
                        return new Result(index,file,null);
                    }catch(Exception error){file.delete();return new Result(index,null,error.getMessage()==null?"下载失败":error.getMessage());}
                });
            }
            Result[] results=new Result[job.items.length()];List<String> failed=new ArrayList<>();int count=0;
            while(count<results.length){
                job.check();Future<Result> ready=completed.poll(250,TimeUnit.MILLISECONDS);if(ready==null)continue;Result result=ready.get();
                job.check();results[result.index]=result;count++;
                if(result.error!=null)failed.add(job.items.getJSONObject(result.index).getString("name")+"："+result.error);
                events.send("onProgress",job.id,"已处理 "+count+" / "+results.length+" 个文件");
            }
            if(job.zip){
                File archive=new File(cache,"materials.zip");int files=0;Set<String> names=new HashSet<>();
                try(ZipOutputStream out=new ZipOutputStream(new BufferedOutputStream(new FileOutputStream(archive)))){
                    out.setLevel(Deflater.NO_COMPRESSION);
                    for(Result result:results){job.check();if(result.file==null)continue;
                        String name=job.items.getJSONObject(result.index).getString("name");while(!names.add(name))name=(result.index+1)+"_"+name;
                        out.putNextEntry(new ZipEntry(name));try(InputStream in=new FileInputStream(result.file)){copy(job,in,out);}out.closeEntry();files++;
                    }
                    if(!failed.isEmpty()){out.putNextEntry(new ZipEntry("下载失败清单.txt"));out.write(String.join("\n",failed).getBytes(StandardCharsets.UTF_8));out.closeEntry();}
                }
                if(files==0)throw new IOException(failed.isEmpty()?"没有可下载的文件":failed.get(0));
                String date=new SimpleDateFormat("yyyy-MM-dd",Locale.ROOT).format(new Date());
                save(job,archive,"拾影素材_"+date+".zip","application/zip");job.saved.set(files);
            }
            job.check();if(job.saved.get()==0)throw new IOException(failed.isEmpty()?"没有可下载的文件":failed.get(0));
            message="已保存 "+job.saved.get()+" 个文件"+(failed.isEmpty()?"":"；"+failed.size()+" 个失败"+(job.zip?"，详情见 ZIP 内清单":"，请稍后重试"));success=true;
        }catch(Exception error){message=job.cancelled?"下载已取消":error.getMessage();if(job.saved.get()>0)message+="，已保存 "+job.saved.get()+" 个文件";}
        finally{
            job.cancel();try{job.workers.awaitTermination(20,TimeUnit.SECONDS);}catch(InterruptedException error){Thread.currentThread().interrupt();}
            if(directory!=null){File[] files=directory.listFiles();if(files!=null)for(File file:files)file.delete();directory.delete();}
            synchronized(this){if(current==job)current=null;}
        }
        events.send(success?"onReady":"onError",job.id,message==null?"下载失败，请重试":message);
    }
    private static void copy(Job job,InputStream in,OutputStream out) throws IOException {
        byte[] buffer=new byte[65536];int n;
        while((n=in.read(buffer))!=-1){job.check();out.write(buffer,0,n);}job.check();
    }
    private void save(Job job,File file,String name,String type) throws Exception {
        job.check();Uri target=DocumentsContract.createDocument(activity.getContentResolver(),job.folder,type,name);if(target==null)throw new IOException("无法创建文件，请重新设置下载目录");
        try{
            try(InputStream in=new FileInputStream(file);OutputStream out=activity.getContentResolver().openOutputStream(target,"w")){if(out==null)throw new IOException("保存位置不可用");copy(job,in,out);}
            job.check();
        }catch(Exception error){try{DocumentsContract.deleteDocument(activity.getContentResolver(),target);}catch(Exception ignored){}throw error;}
        history.add(target,name,type,file.length());
    }
    private static String mime(String name){String ext=name.substring(name.lastIndexOf('.')+1).toLowerCase(Locale.ROOT);switch(ext){case "jpg":case "jpeg":return "image/jpeg";case "png":return "image/png";case "webp":return "image/webp";case "gif":return "image/gif";case "avif":return "image/avif";case "mp4":return "video/mp4";case "webm":return "video/webm";case "mp3":return "audio/mpeg";case "m4a":return "audio/mp4";default:return "application/octet-stream";}}
}
