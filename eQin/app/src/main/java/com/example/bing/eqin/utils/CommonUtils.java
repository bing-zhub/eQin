package com.example.bing.eqin.utils;

import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.support.v4.app.NotificationCompat;
import android.support.v4.app.NotificationManagerCompat;
import android.widget.Toast;

import com.example.bing.eqin.MainActivity;
import com.example.bing.eqin.R;

import java.util.Date;
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

    public static String dateToString(Date date){
        String ret = "";
        ret = (date.getYear()+1900) +"年"+(date.getMonth()+1)+"月"+date.getDate()+"日"+date.getHours()+"时"+date.getMinutes()+"分";

        return ret;
    }

    public static void startNotification(Context context, String title, String content) {

        SharedPreferences sharedPreferences = context.getSharedPreferences("settings", context.MODE_PRIVATE);
        if(sharedPreferences.getBoolean("notificationEnable", false)){
            return;
        }

        NotificationCompat.Builder mBuilder = new NotificationCompat.Builder(context, "push_channel")
                .setSmallIcon(R.drawable.ic_notification)
                .setContentTitle(title)
                .setContentText(content)
                .setAutoCancel(true)
                .setColor(Color.parseColor("#448AFF"))
                .setContentInfo("Info")
                .setPriority(NotificationCompat.PRIORITY_MAX)
                .setDefaults(NotificationCompat.DEFAULT_ALL);

        Intent intent = new Intent(context, MainActivity.class);
        PendingIntent pIntent = PendingIntent.getActivity(context, 0, intent, 0);
        mBuilder.setContentIntent(pIntent);

        NotificationManagerCompat notificationManager = NotificationManagerCompat.from(context);

        notificationManager.notify(1, mBuilder.build());

    }

    public static String mapToChinese(String raw){
        switch (raw){
            case "humidity":
                return "湿度";
            case "temperature":
                return "温度";
        }
        return "";
    }
}
