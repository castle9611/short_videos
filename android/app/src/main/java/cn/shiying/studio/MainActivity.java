package cn.shiying.studio;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.content.UriPermission;
import android.content.ClipboardManager;
import android.content.ClipData;
import android.database.Cursor;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.DocumentsContract;
import android.util.Base64;
import android.view.View;
import android.view.WindowInsets;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.Toast;
import org.json.JSONObject;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;
import java.util.Set;
import java.util.HashSet;
import java.util.Arrays;

public final class MainActivity extends Activity {
    private static final String HOST = "appassets.androidplatform.net";
    private static final String API = "https://shiying-api.castle9611-shiying.workers.dev";
    private static final int SAVE_REQUEST = 41;
    private static final int FOLDER_REQUEST = 42;
    private static final Set<String> FILES = new HashSet<>(Arrays.asList("index.html","app.js","config.js","style.css","zip.js","native-downloads.js","device-parser.js","native-ui.js","mobile.css"));
    private WebView web;
    private FrameLayout root;
    private View fullScreen;
    private WebChromeClient.CustomViewCallback fullScreenCallback;
    private final Downloads downloads = new Downloads();
    private NativeDownloads nativeDownloads;
    private DownloadHistory history;
    private volatile boolean historyClearing;
    private ApiRequests apiRequests;
    private long lastBack;
    private boolean pageReady,pendingOpen=true,internalPicker;

    @SuppressLint("SetJavaScriptEnabled")
    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        if(!getPreferences(MODE_PRIVATE).getBoolean("deviceParserEnabled",false))getPreferences(MODE_PRIVATE).edit().putBoolean("deviceParserEnabled",true).putString("serverUrl",Backend.DEVICE).apply();
        history=new DownloadHistory(this);
        nativeDownloads=new NativeDownloads(this,this::notifyJs,()->downloads.serverUrl(),history);
        apiRequests=new ApiRequests(this,this::notifyJs);
        root=new FrameLayout(this); root.setBackgroundColor(Color.rgb(242,245,248));
        if(Build.VERSION.SDK_INT>=30)getWindow().setDecorFitsSystemWindows(false);
        root.setOnApplyWindowInsetsListener((view,insets)->{
            if(Build.VERSION.SDK_INT>=30){android.graphics.Insets bars=insets.getInsets(WindowInsets.Type.systemBars()|WindowInsets.Type.displayCutout()|WindowInsets.Type.ime());view.setPadding(bars.left,bars.top,bars.right,bars.bottom);}
            else view.setPadding(insets.getSystemWindowInsetLeft(),insets.getSystemWindowInsetTop(),insets.getSystemWindowInsetRight(),insets.getSystemWindowInsetBottom());
            return insets;
        });
        web=new WebView(this);root.addView(web,new FrameLayout.LayoutParams(-1,-1));setContentView(root);
        WebView.setWebContentsDebuggingEnabled(false);
        WebSettings settings=web.getSettings();settings.setJavaScriptEnabled(true);settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);settings.setAllowContentAccess(false);settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setSupportMultipleWindows(false);settings.setJavaScriptCanOpenWindowsAutomatically(false);settings.setMediaPlaybackRequiresUserGesture(true);
        web.addJavascriptInterface(downloads,"ShiyingAndroid");
        web.setWebViewClient(new WebViewClient(){
            @Override public void onPageStarted(WebView view,String url,android.graphics.Bitmap icon){pageReady=false;}
            @Override public void onPageFinished(WebView view,String url){if(trusted(Uri.parse(url))){pageReady=true;dispatchOpen();}}
            @Override public WebResourceResponse shouldInterceptRequest(WebView view,WebResourceRequest request){
                Uri uri=request.getUrl();if(!HOST.equals(uri.getHost()))return null;
                String file=uri.getPath()==null?"":uri.getPath().replaceFirst("^/assets/web/","");if(file.isEmpty())file="index.html";
                if(!trusted(uri)||!FILES.contains(file))return missing();
                try{
                    String type=file.endsWith(".js")?"text/javascript":file.endsWith(".css")?"text/css":"text/html";
                    Map<String,String> headers=new HashMap<>();headers.put("Cache-Control","no-cache");headers.put("X-Content-Type-Options","nosniff");headers.put("Referrer-Policy","no-referrer");
                    headers.put("Content-Security-Policy","default-src 'self'; connect-src "+API+"; img-src 'self' https: data: blob:; media-src https: blob:; style-src 'self'; script-src 'self'; frame-src 'none'; object-src 'none'; base-uri 'self'");
                    return new WebResourceResponse(type,"UTF-8",200,"OK",headers,getAssets().open("web/"+file));
                }catch(IOException error){return missing();}
            }
            @Override public boolean shouldOverrideUrlLoading(WebView view,WebResourceRequest request){
                Uri uri=request.getUrl();if(trusted(uri))return false;
                if(request.isForMainFrame()&&"https".equals(uri.getScheme()))try{startActivity(new Intent(Intent.ACTION_VIEW,uri));}catch(Exception ignored){}
                return true;
            }
        });
        web.setWebChromeClient(new WebChromeClient(){
            @Override public void onShowCustomView(View view,CustomViewCallback callback){if(fullScreen!=null){callback.onCustomViewHidden();return;}fullScreen=view;fullScreenCallback=callback;web.setVisibility(View.GONE);root.addView(view,new FrameLayout.LayoutParams(-1,-1));}
            @Override public void onHideCustomView(){hideVideo();}
        });
        if(state==null||web.restoreState(state)==null)web.loadUrl("https://"+HOST+"/assets/web/index.html");
    }
    private boolean trusted(Uri uri){return "https".equals(uri.getScheme())&&HOST.equals(uri.getHost())&&(uri.getPort()==-1||uri.getPort()==443)&&uri.getPath()!=null&&uri.getPath().startsWith("/assets/web/");}
    @Override protected void onResume(){super.onResume();if(internalPicker){internalPicker=false;return;}pendingOpen=true;dispatchOpen();}
    @Override public void onWindowFocusChanged(boolean focused){super.onWindowFocusChanged(focused);if(focused)dispatchOpen();}
    private void dispatchOpen(){if(!pendingOpen||!pageReady||web==null||!hasWindowFocus())return;pendingOpen=false;web.evaluateJavascript("window.ShiyingDownloads&&window.ShiyingDownloads.onAppOpen()",null);}
    @Override public void startActivityForResult(Intent intent,int request){
        if(request==SAVE_REQUEST||request==FOLDER_REQUEST){internalPicker=true;pendingOpen=false;}
        try{super.startActivityForResult(intent,request);}catch(RuntimeException error){internalPicker=false;throw error;}
    }
    private WebResourceResponse missing(){return new WebResourceResponse("text/plain","UTF-8",404,"Not Found",new HashMap<>(),new ByteArrayInputStream("Not found".getBytes(StandardCharsets.UTF_8)));}
    private void hideVideo(){if(fullScreen!=null){root.removeView(fullScreen);fullScreen=null;web.setVisibility(View.VISIBLE);if(fullScreenCallback!=null)fullScreenCallback.onCustomViewHidden();fullScreenCallback=null;}}
    @Override public void onBackPressed(){
        if(fullScreen!=null){hideVideo();return;}
        web.evaluateJavascript("(()=>{const d=document.querySelector('dialog[open]');if(d){d.close();return true;}if(window.ShiyingApp&&window.ShiyingApp.back())return true;return false;})()",result->{
            if("true".equals(result))return;if(web.canGoBack()){web.goBack();return;}
            if(System.currentTimeMillis()-lastBack<2000){finish();return;}lastBack=System.currentTimeMillis();Toast.makeText(this,"再按一次返回键退出拾影",Toast.LENGTH_SHORT).show();
        });
    }
    @Override protected void onSaveInstanceState(Bundle state){web.saveState(state);super.onSaveInstanceState(state);}
    @Override protected void onActivityResult(int request,int result,Intent data){super.onActivityResult(request,result,data);Uri uri=result==RESULT_OK&&data!=null?data.getData():null;if(request==SAVE_REQUEST)downloads.openTarget(uri);if(request==FOLDER_REQUEST)downloads.openFolder(uri,data==null?0:data.getFlags());}
    @Override protected void onDestroy(){apiRequests.close();nativeDownloads.cancel(null);downloads.close();if(web!=null){web.removeJavascriptInterface("ShiyingAndroid");web.destroy();}super.onDestroy();}
    private void notifyJs(String method,String id,String message){runOnUiThread(()->{if(!isFinishing())web.evaluateJavascript("window.ShiyingDownloads&&window.ShiyingDownloads."+method+"("+JSONObject.quote(id)+(message==null?"":","+JSONObject.quote(message))+")",null);});}

    public final class Downloads {
        @JavascriptInterface public boolean keepHistoryEnabled(){return history.enabled();}
        @JavascriptInterface public void setKeepHistory(boolean enabled){history.enabled(enabled);}
        @JavascriptInterface public String downloadHistory(){return history.list();}
        @JavascriptInterface public void openHistory(String uri){
            JSONObject entry=history.find(uri);if(entry==null)return;
            runOnUiThread(()->{try{Intent intent=new Intent(Intent.ACTION_VIEW);intent.setDataAndType(Uri.parse(uri),entry.optString("type","application/octet-stream"));intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);internalPicker=true;pendingOpen=false;startActivity(intent);}catch(Exception error){internalPicker=false;Toast.makeText(MainActivity.this,"文件已移动、删除或没有可打开它的应用",Toast.LENGTH_LONG).show();}});
        }
        @JavascriptInterface public void clearHistory(boolean deleteFiles){
            runOnUiThread(()->{
                if(nativeDownloads.busy()||pendingId!=null){Toast.makeText(MainActivity.this,"请等待下载结束后清理历史",Toast.LENGTH_SHORT).show();return;}
                new AlertDialog.Builder(MainActivity.this).setTitle(deleteFiles?"删除历史文件？":"清空历史记录？")
                    .setMessage(deleteFiles?"将永久删除历史页记录的下载文件（含 ZIP）。不会删除目录里的其他文件。此操作无法撤销。":"只清空历史页记录，已下载文件仍保留在原目录。清空后无法再通过历史页统一删除这些文件。")
                    .setNegativeButton("取消",null).setPositiveButton(deleteFiles?"删除文件":"清空记录",(dialog,which)->{
                        synchronized(Downloads.this){if(historyClearing||nativeDownloads.busy()||pendingId!=null||batchRequest!=null){Toast.makeText(MainActivity.this,"任务进行中，请稍后清理",Toast.LENGTH_SHORT).show();return;}historyClearing=true;}
                        new Thread(()->{String message;try{message=history.clear(deleteFiles);}finally{historyClearing=false;}notifyJs("onHistoryChanged","",message);},"shiying-history").start();
                    }).show();
            });
        }
        @JavascriptInterface public boolean autoClipboardEnabled(){return getPreferences(MODE_PRIVATE).getBoolean("autoClipboard",true);}
        @JavascriptInterface public void setAutoClipboard(boolean enabled){getPreferences(MODE_PRIVATE).edit().putBoolean("autoClipboard",enabled).apply();}
        @JavascriptInterface public String clipboardText(){
            if(!autoClipboardEnabled()||!hasWindowFocus())return "";
            try{ClipboardManager manager=(ClipboardManager)getSystemService(CLIPBOARD_SERVICE);ClipData clip=manager==null?null:manager.getPrimaryClip();if(clip==null||clip.getItemCount()==0||clip.getItemAt(0).getText()==null)return "";String text=clip.getItemAt(0).getText().toString();return text.length()>12000?text.substring(0,12000):text;}
            catch(Exception error){return "";}
        }
        @JavascriptInterface public String serverUrl(){return getPreferences(MODE_PRIVATE).getString("serverUrl",Backend.DEVICE);}
        @JavascriptInterface public synchronized String setServer(String value){
            if(pendingId!=null||batchRequest!=null||nativeDownloads.busy())return "请在下载结束后切换服务";
            try{String server=Backend.normalize(value);if(!getPreferences(MODE_PRIVATE).edit().putString("serverUrl",server).commit())return "无法保存服务地址";apiRequests.cancelAll();return "";}
            catch(Exception error){return error.getMessage();}
        }
        @JavascriptInterface public String apiRequest(String id,String path,String body,String token){return apiRequests.start(id,serverUrl(),path,body,token);}
        @JavascriptInterface public void cancelRequest(String id){apiRequests.cancel(id);}
        @JavascriptInterface public String platformRequest(String id,String url,String method,String headers){return apiRequests.platform(id,url,method,headers);}
        private String pendingId;
        private long expected,written;
        private OutputStream stream;
        private Uri pendingTarget;
        private String pendingName,pendingType;
        private Uri batchFolder;
        private String batchRequest;
        private Uri savedFolder(){
            String value=getPreferences(MODE_PRIVATE).getString("downloadFolder",null);if(value==null)return null;
            Uri tree=Uri.parse(value);
            for(UriPermission permission:getContentResolver().getPersistedUriPermissions())if(permission.getUri().equals(tree)&&permission.isWritePermission())return DocumentsContract.buildDocumentUriUsingTree(tree,DocumentsContract.getTreeDocumentId(tree));
            throw new SecurityException("下载目录授权已失效，请重新设置下载目录");
        }
        @JavascriptInterface public synchronized String folderName(){
            try{Uri folder=savedFolder();if(folder==null)return "尚未设置，保存时选择位置";
                try(Cursor cursor=getContentResolver().query(folder,new String[]{DocumentsContract.Document.COLUMN_DISPLAY_NAME},null,null,null)){if(cursor!=null&&cursor.moveToFirst())return cursor.getString(0);}
            }catch(Exception error){return "目录不可用，请重新设置";}return "已设置下载目录";
        }
        @JavascriptInterface public synchronized String chooseFolder(String id){
            if(pendingId!=null||batchRequest!=null||batchFolder!=null||nativeDownloads.busy())return "下载进行中，请结束后更换目录";
            if(id==null||!id.matches("batch_[a-zA-Z0-9_]+"))return "文件夹请求无效";
            batchRequest=id;
            runOnUiThread(()->{try{Intent intent=new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION|Intent.FLAG_GRANT_WRITE_URI_PERMISSION|Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);startActivityForResult(intent,FOLDER_REQUEST);}catch(Exception error){String requestId=batchRequest;endBatch();if(requestId!=null)notifyJs("onError",requestId,"无法打开文件夹选择窗口");}});return "";
        }
        @JavascriptInterface public synchronized String beginBatch(String id){
            if(historyClearing)return "历史文件正在清理，请稍候";
            if(pendingId!=null||batchRequest!=null||nativeDownloads.busy())return "另一个保存任务尚未结束";
            if(id==null||!id.matches("batch_[a-zA-Z0-9_]+"))return "文件夹请求无效";
            try{batchFolder=savedFolder();if(batchFolder!=null){notifyJs("onReady",id,null);return "";}}catch(Exception error){return "下载目录不可用，请重新设置下载目录";}
            return chooseFolder(id);
        }
        synchronized void openFolder(Uri uri,int flags){
            if(batchRequest==null)return;String id=batchRequest;batchRequest=null;if(uri==null){notifyJs("onError",id,"已取消保存");return;}
            try{
                int grants=flags&(Intent.FLAG_GRANT_READ_URI_PERMISSION|Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
                if((grants&Intent.FLAG_GRANT_WRITE_URI_PERMISSION)==0)throw new SecurityException();
                getContentResolver().takePersistableUriPermission(uri,grants);
                String old=getPreferences(MODE_PRIVATE).getString("downloadFolder",null);
                if(!getPreferences(MODE_PRIVATE).edit().putString("downloadFolder",uri.toString()).commit())throw new IOException();
                batchFolder=savedFolder();
                if(old!=null&&!old.equals(uri.toString())&&!history.usesTree(Uri.parse(old)))try{getContentResolver().releasePersistableUriPermission(Uri.parse(old),Intent.FLAG_GRANT_READ_URI_PERMISSION|Intent.FLAG_GRANT_WRITE_URI_PERMISSION);}catch(Exception ignored){}
                notifyJs("onReady",id,null);
            }catch(Exception error){notifyJs("onError",id,"无法保留目录授权，请重新选择可写文件夹");}
        }
        @JavascriptInterface public synchronized void endBatch(){batchRequest=null;batchFolder=null;}
        @JavascriptInterface public synchronized String downloadBatch(String id,String items,boolean zip,String token){
            if(historyClearing)return "历史文件正在清理，请稍候";
            if(pendingId!=null||batchRequest!=null)return "另一个保存任务尚未结束";
            try{return nativeDownloads.start(id,items,zip,token,batchFolder!=null?batchFolder:savedFolder());}
            catch(Exception error){return "下载目录不可用，请重新设置下载目录";}
        }
        @JavascriptInterface public void cancelDownload(String id){nativeDownloads.cancel(id);}
        @JavascriptInterface public synchronized String beginSave(String id,String name,String mime,long size){
            if(historyClearing)return "历史文件正在清理，请稍候";
            if(pendingId!=null||batchRequest!=null||nativeDownloads.busy())return "另一个保存任务尚未结束，请稍候";
            if(id==null||!id.matches("save_[a-zA-Z0-9_]+")||size<0)return "文件保存请求无效";
            pendingId=id;expected=size;written=0;
            String safeName=name==null?"拾影素材":name.replaceAll("[\\\\/\\p{Cntrl}]","_");
            if(safeName.length()>180)safeName=safeName.substring(0,180);
            final String fileName=safeName;final String contentType=mime!=null&&mime.matches("[a-zA-Z0-9.+-]+/[a-zA-Z0-9.+-]+")?mime:"application/octet-stream";
            pendingName=fileName;pendingType=contentType;
            runOnUiThread(()->{synchronized(Downloads.this){if(!matches(id))return;try{Uri folder=batchFolder!=null?batchFolder:savedFolder();if(folder!=null){Uri target=DocumentsContract.createDocument(getContentResolver(),folder,contentType,fileName);if(target==null)throw new IOException();openTarget(target);return;}Intent intent=new Intent(Intent.ACTION_CREATE_DOCUMENT);intent.addCategory(Intent.CATEGORY_OPENABLE);intent.setType(contentType);intent.putExtra(Intent.EXTRA_TITLE,fileName);startActivityForResult(intent,SAVE_REQUEST);}catch(Exception error){fail("保存位置不可用，请重新设置下载目录");}}});
            return "";
        }
        synchronized void openTarget(Uri uri){
            if(pendingId==null)return;if(uri==null){fail("已取消保存");return;}
            try{stream=getContentResolver().openOutputStream(uri,"w");if(stream==null)throw new IOException();pendingTarget=uri;notifyJs("onReady",pendingId,null);}
            catch(Exception error){fail("无法写入选定位置，请选择其他保存目录");}
        }
        @JavascriptInterface public synchronized String appendSave(String id,String chunk){
            if(!matches(id)||stream==null)return "文件保存会话已失效";
            try{if(chunk==null||chunk.length()>180000)return "数据块过大";byte[] bytes=Base64.decode(chunk,Base64.NO_WRAP);if(bytes.length>expected-written)return "文件数据长度不匹配";stream.write(bytes);written+=bytes.length;return "";}
            catch(Exception error){return "写入失败，请检查剩余空间或更换保存目录";}
        }
        @JavascriptInterface public synchronized String finishSave(String id){
            if(!matches(id)||stream==null)return "文件保存会话已失效";
            if(written!=expected){close();return "文件未完整保存，请重试";}
            try{stream.flush();stream.close();stream=null;history.add(pendingTarget,pendingName,pendingType,written);pendingTarget=null;pendingId=null;return "";}catch(Exception error){close();return "文件保存失败，请重试";}
        }
        @JavascriptInterface public synchronized void abortSave(String id){if(matches(id))close();}
        private boolean matches(String id){return pendingId!=null&&pendingId.equals(id);}
        private synchronized void fail(String message){String id=pendingId;close();if(id!=null)notifyJs("onError",id,message);}
        synchronized void close(){try{if(stream!=null)stream.close();}catch(IOException ignored){}stream=null;pendingTarget=null;pendingId=null;written=0;expected=0;}
    }
}
