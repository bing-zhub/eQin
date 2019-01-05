package com.example.bing.eqin.utils;

import android.content.Context;
import android.graphics.Color;
import android.widget.Toast;

import com.example.bing.eqin.MainActivity;

import java.util.HashMap;
import java.util.Map;

public class CommonUtils {

    Map<String, String> nameTypeMapping = new HashMap<>();


    public static void showMessage(Context context, String message) {
        Toast.makeText(context,message, Toast.LENGTH_SHORT).show();
    }

    public static String mappingToName(String deviceType){
        return getMapping().get(deviceType);
    }

    private static Map<String, String> getMapping(){
        Map<String, String> nameTypeMapping = new HashMap<>();
        nameTypeMapping.put("humidity","湿度");
        nameTypeMapping.put("temperature", "温度");
        return nameTypeMapping;
    }

    public static String argbToHex(int color){
        return "#"+Integer.toHexString(Color.red(color)).replace("0x","") +
                Integer.toHexString(Color.green(color)).replace("0x","")+
                Integer.toHexString(Color.blue(color)).replace("0x","");
    }


}
