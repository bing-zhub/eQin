package com.example.bing.eqin.controller;

import android.util.Log;

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
        EventBus.getDefault().post(message);
    }
    @Override
    public void deliveryComplete(IMqttDeliveryToken token) {
    }
}