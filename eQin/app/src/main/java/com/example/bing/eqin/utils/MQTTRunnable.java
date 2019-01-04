package com.example.bing.eqin.utils;

import android.util.Log;

import com.example.bing.eqin.controller.MQTTController;

import java.util.List;

public class MQTTRunnable implements Runnable {
    private List<String> topics;

    public void setTopics(List<String> topics){
        this.topics = topics;
    }

    @Override
    public void run() {
        boolean res =  MQTTController.getInstance().createConnect("tcp://115.159.98.171:1883", null,null,"2131");
        Log.d("MQTT", res?"连接成功":"连接失败");
        if(res) {
            for(String topic : topics){
                res = MQTTController.getInstance().subscribe(topic, 2);
                Log.d("MQTT", res ? "订阅成功"+topic : topic+"订阅失败");
            }
        }
    }
}
