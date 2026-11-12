package cn.shiying.studio;

import android.app.Activity;
import android.content.Context;
import android.content.SharedPreferences;
import android.net.Uri;
import android.provider.DocumentsContract;
import org.json.JSONArray;
import org.json.JSONObject;

/** Only files successfully created by this app enter the ledger. */
final class DownloadHistory {
    private final Context activity;
    private final SharedPreferences preferences;
    DownloadHistory(Activity activity){this(activity,activity.getPreferences(Activity.MODE_PRIVATE));}
    DownloadHistory(Context activity,SharedPreferences preferences){this.activity=activity;this.preferences=preferences;}
    boolean enabled(){return preferences.getBoolean("keepDownloadHistory",true);}
    void enabled(boolean value){preferences.edit().putBoolean("keepDownloadHistory",value).apply();}
    private JSONArray entries(){try{return new JSONArray(preferences.getString("downloadHistory","[]"));}catch(Exception error){return new JSONArray();}}
    synchronized String list(){return entries().toString();}
    synchronized void add(Uri uri,String name,String type,long bytes){
        if(!enabled())return;
        try{JSONArray entries=entries();entries.put(new JSONObject().put("uri",uri.toString()).put("name",name).put("type",type).put("bytes",bytes).put("time",System.currentTimeMillis()));preferences.edit().putString("downloadHistory",entries.toString()).commit();}catch(Exception ignored){}
    }
    synchronized JSONObject find(String uri){JSONArray entries=entries();for(int i=0;i<entries.length();i++){JSONObject entry=entries.optJSONObject(i);if(entry!=null&&uri.equals(entry.optString("uri")))return entry;}return null;}
    synchronized boolean usesTree(Uri tree){JSONArray entries=entries();for(int i=0;i<entries.length();i++)if(entries.optJSONObject(i).optString("uri").startsWith(tree.toString()+"/document/"))return true;return false;}
    synchronized String clear(boolean deleteFiles){
        JSONArray entries=entries(),remaining=new JSONArray();int deleted=0;
        if(deleteFiles)for(int i=0;i<entries.length();i++){
            JSONObject entry=entries.optJSONObject(i);
            try{Uri uri=Uri.parse(entry.getString("uri"));
                if(!"content".equals(uri.getScheme())||!DocumentsContract.deleteDocument(activity.getContentResolver(),uri))throw new java.io.IOException();
                deleted++;
            }catch(java.io.FileNotFoundException missing){/* Already removed by the user. */}
            catch(Exception error){remaining.put(entry);}
        }
        if(!preferences.edit().putString("downloadHistory",remaining.toString()).commit())return "无法保存历史记录，请重试";
        return deleteFiles?"已删除 "+deleted+" 个历史文件"+(remaining.length()>0?"；"+remaining.length()+" 个未能删除，已保留记录，请检查目录授权":""):"已清空历史记录，下载文件仍保留在原目录";
    }
}
