package cn.shiying.studio;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
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
    private static final Set<String> FILES = new HashSet<>(Arrays.asList("index.html","app.js","config.js","style.css","zip.js","native-downloads.js"));
    private WebView web;
    private FrameLayout root;
    private View fullScreen;
    private WebChromeClient.CustomViewCallback fullScreenCallback;
    private final Downloads downloads = new Downloads();
    private long lastBack;

    @SuppressLint("SetJavaScriptEnabled")
    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        root=new FrameLayout(this); root.setBackgroundColor(Color.rgb(247,249,248));
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
    private WebResourceResponse missing(){return new WebResourceResponse("text/plain","UTF-8",404,"Not Found",new HashMap<>(),new ByteArrayInputStream("Not found".getBytes(StandardCharsets.UTF_8)));}
    private void hideVideo(){if(fullScreen!=null){root.removeView(fullScreen);fullScreen=null;web.setVisibility(View.VISIBLE);if(fullScreenCallback!=null)fullScreenCallback.onCustomViewHidden();fullScreenCallback=null;}}
    @Override public void onBackPressed(){
        if(fullScreen!=null){hideVideo();return;}
        web.evaluateJavascript("(()=>{const d=document.querySelector('dialog[open]');if(d){d.close();return true;}return false;})()",result->{
            if("true".equals(result))return;if(web.canGoBack()){web.goBack();return;}
            if(System.currentTimeMillis()-lastBack<2000){finish();return;}lastBack=System.currentTimeMillis();Toast.makeText(this,"再按一次返回键退出拾影",Toast.LENGTH_SHORT).show();
        });
    }
    @Override protected void onSaveInstanceState(Bundle state){web.saveState(state);super.onSaveInstanceState(state);}
    @Override protected void onActivityResult(int request,int result,Intent data){super.onActivityResult(request,result,data);if(request==SAVE_REQUEST)downloads.openTarget(result==RESULT_OK&&data!=null?data.getData():null);}
    @Override protected void onDestroy(){downloads.close();if(web!=null){web.removeJavascriptInterface("ShiyingAndroid");web.destroy();}super.onDestroy();}
    private void notifyJs(String method,String id,String message){runOnUiThread(()->{if(!isFinishing())web.evaluateJavascript("window.ShiyingDownloads&&window.ShiyingDownloads."+method+"("+JSONObject.quote(id)+(message==null?"":","+JSONObject.quote(message))+")",null);});}

    public final class Downloads {
        private String pendingId;
        private long expected,written;
        private OutputStream stream;
        @JavascriptInterface public synchronized String beginSave(String id,String name,String mime,long size){
            if(pendingId!=null)return "另一个文件仍在保存，请稍候";
            if(id==null||!id.matches("save_[a-zA-Z0-9_]+")||size<0||size>152L*1024*1024)return "文件保存请求无效或文件过大";
            pendingId=id;expected=size;written=0;
            String safeName=name==null?"拾影素材":name.replaceAll("[\\\\/\\p{Cntrl}]","_");
            if(safeName.length()>180)safeName=safeName.substring(0,180);
            final String fileName=safeName;final String contentType=mime!=null&&mime.matches("[a-zA-Z0-9.+-]+/[a-zA-Z0-9.+-]+")?mime:"application/octet-stream";
            runOnUiThread(()->{try{Intent intent=new Intent(Intent.ACTION_CREATE_DOCUMENT);intent.addCategory(Intent.CATEGORY_OPENABLE);intent.setType(contentType);intent.putExtra(Intent.EXTRA_TITLE,fileName);startActivityForResult(intent,SAVE_REQUEST);}catch(Exception error){fail("无法打开系统文件保存窗口");}});
            return "";
        }
        synchronized void openTarget(Uri uri){
            if(pendingId==null)return;if(uri==null){fail("已取消保存");return;}
            try{stream=getContentResolver().openOutputStream(uri,"w");if(stream==null)throw new IOException();notifyJs("onReady",pendingId,null);}
            catch(Exception error){fail("无法写入选定位置，请选择其他保存目录");}
        }
        @JavascriptInterface public synchronized String appendSave(String id,String chunk){
            if(!matches(id)||stream==null)return "文件保存会话已失效";
            try{if(chunk==null||chunk.length()>180000)return "数据块过大";byte[] bytes=Base64.decode(chunk,Base64.NO_WRAP);if(written+bytes.length>expected)return "文件数据长度不匹配";stream.write(bytes);written+=bytes.length;return "";}
            catch(Exception error){return "写入失败，请检查剩余空间或更换保存目录";}
        }
        @JavascriptInterface public synchronized String finishSave(String id){
            if(!matches(id)||stream==null)return "文件保存会话已失效";
            if(written!=expected){close();return "文件未完整保存，请重试";}
            try{stream.flush();stream.close();stream=null;pendingId=null;return "";}catch(Exception error){close();return "文件保存失败，请重试";}
        }
        @JavascriptInterface public synchronized void abortSave(String id){if(matches(id))close();}
        private boolean matches(String id){return pendingId!=null&&pendingId.equals(id);}
        private synchronized void fail(String message){String id=pendingId;close();if(id!=null)notifyJs("onError",id,message);}
        synchronized void close(){try{if(stream!=null)stream.close();}catch(IOException ignored){}stream=null;pendingId=null;written=0;expected=0;}
    }
}
