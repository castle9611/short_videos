package cn.shiying.studio;

import android.app.Instrumentation;
import android.app.Activity;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Bundle;
import android.os.SystemClock;
import android.provider.DocumentsContract;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import org.json.JSONArray;
import org.json.JSONObject;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.UUID;
import java.lang.reflect.Field;

/** Optional device check: uses the configured folder and removes only its test files. */
public final class DownloadCheck extends Instrumentation {
    private Bundle args;
    @Override public void onCreate(Bundle args){super.onCreate(args);this.args=args;start();}
    private static void check(boolean value,String message){if(!value)throw new AssertionError(message);}
    private JSONObject request(String server,String path,JSONObject body,String token) throws Exception {
        CountDownLatch done=new CountDownLatch(1);String[] result=new String[2];
        ApiRequests api=new ApiRequests(getTargetContext(),(method,id,message)->{result[0]=method;result[1]=message;done.countDown();});
        try{
            check(api.start("api_device_check",server,path,body==null?null:body.toString(),token).isEmpty(),"Cannot start API check");check(done.await(45,TimeUnit.SECONDS),"Backend request timed out");check("onResponse".equals(result[0]),result[1]);JSONObject response=new JSONObject(result[1]);check(response.getInt("status")==200,"Backend HTTP "+response.getInt("status"));return new JSONObject(response.getString("body"));
        }finally{api.close();}
    }
    public static final class ParserResult {
        final CountDownLatch done=new CountDownLatch(1);String value;
        final Instrumentation instrumentation;
        ParserResult(Instrumentation instrumentation){this.instrumentation=instrumentation;}
        @JavascriptInterface public void complete(String value){this.value=value;done.countDown();}
        @JavascriptInterface public void progress(String message){Bundle result=new Bundle();result.putString("stage",message);instrumentation.sendStatus(0,result);}
    }
    private JSONObject deviceParse(Activity activity,String share) throws Exception {
        Field field=MainActivity.class.getDeclaredField("web");field.setAccessible(true);WebView web=(WebView)field.get(activity);ParserResult result=new ParserResult(this);
        runOnMainSync(()->{web.addJavascriptInterface(result,"ShiyingCheck");web.reload();});
        boolean ready=false;long deadline=SystemClock.elapsedRealtime()+15000;
        while(SystemClock.elapsedRealtime()<deadline){
            CountDownLatch checked=new CountDownLatch(1);String[] value=new String[1];
            runOnMainSync(()->web.evaluateJavascript("Boolean(window.ShiyingCheck&&window.ShiyingCheck.complete&&window.ShiyingDeviceParser&&window.ShiyingDownloads&&window.APP_CONFIG&&window.APP_CONFIG.deviceMode)",answer->{value[0]=answer;checked.countDown();}));
            checked.await(1,TimeUnit.SECONDS);if("true".equals(value[0])){ready=true;break;}SystemClock.sleep(100);
        }
        check(ready,"Bundled parser or native bridge did not load");
        String code="window.__checkAbort=new AbortController();window.ShiyingCheck.progress('parser ready');window.ShiyingDeviceParser.parse("+JSONObject.quote(share)+",(url,options)=>{if(String(url).includes('workers.dev')||String(url).startsWith('http:'))throw new Error('Backend request in device mode');window.ShiyingCheck.progress((options.method||'GET')+' '+new URL(url).hostname);return window.ShiyingDownloads.platformFetch(url,options).then(response=>{window.ShiyingCheck.progress('HTTP '+response.status+' '+new URL(url).hostname);return response;});},window.__checkAbort.signal).then(result=>window.ShiyingCheck.complete(JSON.stringify(result))).catch(error=>window.ShiyingCheck.complete(JSON.stringify({code:500,msg:error.message})))";
        runOnMainSync(()->web.evaluateJavascript(code,null));
        if(!result.done.await(95,TimeUnit.SECONDS)){runOnMainSync(()->web.evaluateJavascript("window.__checkAbort.abort()",null));throw new AssertionError("Device parsing timed out");}
        return new JSONObject(result.value);
    }
    @Override public void onStart(){
        if("true".equals(args.getString("historyOnly"))){historyCheck();return;}
        Bundle result=new Bundle();Activity activity=null;Uri testFolder=null;int resultCode=Activity.RESULT_CANCELED;String prefix="shiying-check-"+System.currentTimeMillis();NativeDownloads downloads=null;
        SharedPreferences preferences=getTargetContext().getSharedPreferences("MainActivity",Activity.MODE_PRIVATE);boolean clipboardEnabled=preferences.getBoolean("autoClipboard",true);preferences.edit().putBoolean("autoClipboard",false).commit();
        try{
            String url=args.getString("url");
            Intent intent=new Intent(getTargetContext(),MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            activity=startActivitySync(intent);
            String server=Backend.normalize(args.getString("server",Backend.CLOUD));
            if(args.containsKey("server"))check(activity.getPreferences(Activity.MODE_PRIVATE).edit().putString("serverUrl",server).commit(),"Cannot save backend selection");
            if(Backend.DEVICE.equals(server)){
                check(args.containsKey("share"),"Supply -e share for device parsing");JSONObject parsed=deviceParse(activity,args.getString("share"));check(parsed.getInt("code")==200,"Device parse failed: "+parsed.optString("msg"));
                JSONArray media=parsed.getJSONObject("data").getJSONArray("downloads");int playable=0;
                for(int i=0;i<media.length();i++){JSONObject file=media.getJSONObject(i);if(!file.getString("kind").matches("video|image|live"))continue;playable++;if(url==null)url=file.getString("url");}
                check(playable>0,"No playable device media");result.putString("parse","PASS: bundled phone-only parser; "+playable+" media items");
            }else{
                check(request(server,"health",null,"").getBoolean("parser"),"Backend parser unavailable");result.putString("backend",server+" health PASS");
            }
            if(!Backend.DEVICE.equals(server)&&args.containsKey("share")){
                JSONObject account=request(server,"register",new JSONObject().put("email","device-check-"+UUID.randomUUID()+"@example.com").put("password",UUID.randomUUID().toString()),"");String token=account.getString("token");
                try{JSONObject parsed=request(server,"parse",new JSONObject().put("url",args.getString("share")),token);check(parsed.getInt("code")==200,"Device parse failed: "+parsed.optString("msg"));check(parsed.getJSONObject("data").getJSONArray("downloads").length()>0,"No registered media");result.putString("parse","PASS: register, authenticated LAN parsing and download handles");}
                finally{request(server,"logout",new JSONObject(),token);}
            }
            check(url!=null,"Supply a public media URL with -e url");
            if(!"true".equals(args.getString("parseOnly"))){
            String folder=activity.getPreferences(Activity.MODE_PRIVATE).getString("downloadFolder",null);check(folder!=null,"Set a download folder in the app first");
            Uri tree=Uri.parse(folder);Uri parent=DocumentsContract.buildDocumentUriUsingTree(tree,DocumentsContract.getTreeDocumentId(tree));
            testFolder=DocumentsContract.createDocument(activity.getContentResolver(),parent,DocumentsContract.Document.MIME_TYPE_DIR,prefix);check(testFolder!=null,"Cannot create isolated test folder");
            String handle="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
            JSONArray items=new JSONArray();for(int i=0;i<3;i++)items.put(new JSONObject().put("id",handle).put("name",prefix+"-"+i+".mp4").put("url",url));
            for(boolean zip:new boolean[]{false,true}){
                CountDownLatch done=new CountDownLatch(1);String[] outcome=new String[2];
                downloads=new NativeDownloads(activity,(method,id,message)->{if(!method.equals("onProgress")){outcome[0]=method;outcome[1]=message;done.countDown();}},()->server,new DownloadHistory(activity));
                long start=SystemClock.elapsedRealtime();String error=downloads.start("download_device_check",items.toString(),zip,handle+handle,testFolder);
                check(error.isEmpty(),error);check(done.await(60,TimeUnit.SECONDS),"Native job did not finish");check("onReady".equals(outcome[0]),outcome[1]);check(outcome[1].equals("已保存 3 个文件"),outcome[1]);check(!downloads.busy(),"Native job remains busy");
                result.putString(zip?"zip":"individual",outcome[1]+" in "+(SystemClock.elapsedRealtime()-start)+" ms");
            }
            result.putString("stream","PASS: device direct downloads and native ZIP with an invalid proxy token");
            }
            resultCode=Activity.RESULT_OK;
        }catch(Throwable error){if(downloads!=null)downloads.cancel(null);result.putString("error",error.toString());}
        finally{
            preferences.edit().putBoolean("autoClipboard",clipboardEnabled).commit();
            if(activity!=null&&testFolder!=null)try{DocumentsContract.deleteDocument(activity.getContentResolver(),testFolder);}catch(Exception ignored){}

        }
        finish(resultCode,result);
    }
    private void historyCheck(){
        Bundle result=new Bundle();Uri directory=null;int code=Activity.RESULT_CANCELED;
        SharedPreferences test=getTargetContext().getSharedPreferences("HistoryCheck",Activity.MODE_PRIVATE);test.edit().clear().commit();
        try{
            String folder=getTargetContext().getSharedPreferences("MainActivity",Activity.MODE_PRIVATE).getString("downloadFolder",null);check(folder!=null,"Choose download folder first");
            Uri tree=Uri.parse(folder),parent=DocumentsContract.buildDocumentUriUsingTree(tree,DocumentsContract.getTreeDocumentId(tree));
            directory=DocumentsContract.createDocument(getTargetContext().getContentResolver(),parent,DocumentsContract.Document.MIME_TYPE_DIR,"shiying-history-check-"+System.currentTimeMillis());
            Uri tracked=DocumentsContract.createDocument(getTargetContext().getContentResolver(),directory,"text/plain","tracked.txt"),untracked=DocumentsContract.createDocument(getTargetContext().getContentResolver(),directory,"text/plain","untracked.txt");
            DownloadHistory history=new DownloadHistory(getTargetContext(),test);check(history.enabled(),"Default retention off");
            history.add(tracked,"tracked.txt","text/plain",0);check(new JSONArray(history.list()).length()==1,"Record not persisted");
            check(new JSONArray(new DownloadHistory(getTargetContext(),test).list()).length()==1,"History lost on reload");
            history.enabled(false);history.add(untracked,"untracked.txt","text/plain",0);check(new JSONArray(history.list()).length()==1,"Disabled history still records");
            history.clear(false);check(new JSONArray(history.list()).length()==0,"Records not cleared");
            try(android.database.Cursor cursor=getTargetContext().getContentResolver().query(tracked,null,null,null,null)){check(cursor!=null&&cursor.moveToFirst(),"Records-only clear deleted file");}
            history.enabled(true);history.add(tracked,"tracked.txt","text/plain",0);check(history.usesTree(tree),"Folder grant would be dropped");history.clear(true);check(new JSONArray(history.list()).length()==0,"Deleted file remains recorded");
            try(android.database.Cursor cursor=getTargetContext().getContentResolver().query(untracked,null,null,null,null)){check(cursor!=null&&cursor.moveToFirst(),"Untracked file deleted");}
            boolean exists=false;try(android.database.Cursor cursor=getTargetContext().getContentResolver().query(tracked,null,null,null,null)){exists=cursor!=null&&cursor.moveToFirst();}catch(Exception expected){}check(!exists,"Tracked file still exists");
            result.putString("history","PASS: persistence, retention switch, records-only clear, scoped file deletion and folder grants");code=Activity.RESULT_OK;
        }catch(Throwable error){result.putString("error",error.toString());}
        finally{test.edit().clear().commit();if(directory!=null)try{DocumentsContract.deleteDocument(getTargetContext().getContentResolver(),directory);}catch(Exception ignored){}}
        finish(code,result);
    }
}
