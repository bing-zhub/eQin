package com.example.bing.eqin.controller;

import android.util.Log;

import com.example.bing.eqin.model.MQTTDataItem;

import org.eclipse.paho.client.mqttv3.IMqttDeliveryToken;
import org.eclipse.paho.client.mqttv3.MqttCallback;
import org.eclipse.paho.client.mqttv3.MqttMessage;
import org.greenrobot.eventbus.EventBus;

class MqttCallbackBus implements MqttCallback {
    @Override
    public void connectionLost(Throwable cause) {
        Log.d("MQTTController",cause.toString());
    }
    @Override
    public void messageArrived(String topic, MqttMessage message) {
        MQTTDataItem dataItem = new MQTTDataItem(topic, message.toString());
        EventBus.getDefault().post(dataItem);
    }
    @Override
    public void deliveryComplete(IMqttDeliveryToken token) {
    }
}