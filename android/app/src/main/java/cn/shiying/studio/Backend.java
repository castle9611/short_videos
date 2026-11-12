package cn.shiying.studio;

import java.net.URI;

/** Only the built-in cloud service and explicit private IPv4 LAN addresses. */
final class Backend {
    static final String CLOUD="https://shiying-api.castle9611-shiying.workers.dev";
    static final String DEVICE="device";
    static String normalize(String value){
        if(value==null)throw new IllegalArgumentException("请输入服务地址");
        value=value.trim().replaceAll("/+$","");if(CLOUD.equals(value))return CLOUD;if(DEVICE.equals(value))return DEVICE;
        try{
            URI uri=new URI(value);String host=uri.getHost();int port=uri.getPort();
            if(!"http".equals(uri.getScheme())||host==null||uri.getRawUserInfo()!=null||uri.getRawQuery()!=null||uri.getRawFragment()!=null||!uri.getRawPath().isEmpty()||port==0||port>65535)throw new Exception();
            String[] parts=host.split("\\.");if(parts.length!=4)throw new Exception();int[] octets=new int[4];
            for(int i=0;i<4;i++){if(!parts[i].matches("0|[1-9][0-9]{0,2}"))throw new Exception();octets[i]=Integer.parseInt(parts[i]);if(octets[i]>255)throw new Exception();}
            if(octets[0]!=10&&!(octets[0]==172&&octets[1]>=16&&octets[1]<=31)&&!(octets[0]==192&&octets[1]==168))throw new Exception();
            return value;
        }catch(Exception error){throw new IllegalArgumentException("局域网地址须为 http://192.168.x.x:端口、10.x.x.x 或 172.16–31.x.x");}
    }
}
