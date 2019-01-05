package com.example.bing.eqin.controller;

import android.util.Log;

import org.eclipse.paho.client.mqttv3.MqttCallback;
import org.eclipse.paho.client.mqttv3.MqttClient;
import org.eclipse.paho.client.mqttv3.MqttConnectOptions;
import org.eclipse.paho.client.mqttv3.MqttException;
import org.eclipse.paho.client.mqttv3.MqttMessage;
import org.eclipse.paho.client.mqttv3.persist.MqttDefaultFilePersistence;

public class MQTTController {
    private static MQTTController mInstance = null;
    private MqttCallback mCallback;
    private MqttClient client;
    private MqttConnectOptions conOpt;
    private boolean clean = true;
    private MQTTController() {
        mCallback = new MqttCallbackBus();
    }
    public static MQTTController getInstance() {
        if (null == mInstance) {
            mInstance = new MQTTController();
        }
        return mInstance;
    }
    public static void release() {
        try {
            if (mInstance != null) {
                mInstance.disConnect();
                mInstance = null;
            }
        } catch (Exception e) {
        }
    }

    public boolean createConnect(String brokerUrl, String userName, String password, String clientId) {
        boolean flag = false;
        String tmpDir = System.getProperty("java.io.tmpdir");
        MqttDefaultFilePersistence dataStore = new MqttDefaultFilePersistence(tmpDir);
        try {
            // Construct the connection options object that contains connection parameters
            // such as cleanSession and LWT
            conOpt = new MqttConnectOptions();
            conOpt.setMqttVersion(MqttConnectOptions.MQTT_VERSION_3_1_1);
            conOpt.setCleanSession(clean);
            if (password != null) {
                conOpt.setPassword(password.toCharArray());
            }
            if (userName != null) {
                conOpt.setUserName(userName);
            }
            // Construct an MQTT blocking mode client
            client = new MqttClient(brokerUrl, clientId, dataStore);
            // Set this wrapper as the callback handler
            client.setCallback(mCallback);
            flag = doConnect();
        } catch (MqttException e) {
            Log.e("MQTTController1",e.getMessage());
        }
        return flag;
    }

    public boolean doConnect() {
        boolean flag = false;
        if (client != null) {
            try {
                client.connect(conOpt);
                Log.e("MQTTController","Connected to " + client.getServerURI() + " with client ID " + client.getClientId());
                flag = true;
            } catch (Exception e) {
            }
        }
        return flag;
    }

    public boolean publish(String topicName, int qos, byte[] payload) {
        boolean flag = false;
        if (client != null && client.isConnected()) {
            Log.d("MQTTController","Publishing to topic \"" + topicName + "\" qos " + qos);
            // Create and configure a message
            MqttMessage message = new MqttMessage(payload);            message.setQos(qos);
            // Send the message to the server, control is not returned until
            // it has been delivered to the server meeting the specified
            // quality of service.
            try {
                client.publish(topicName, message);
                flag = true;
            } catch (MqttException e) {
            }
        }
        return flag;
    }

    public boolean subscribe(String topicName, int qos) {
        boolean flag = false;
        if (client != null && client.isConnected()) {
            Log.d("MQTT","Subscribing to topic \"" + topicName + "\" qos " + qos);
            try {
                client.subscribe(topicName, qos);
                flag = true;
            } catch (MqttException e) {
            }
        }
        return flag;
    }

    public void disConnect() throws MqttException {
        if (client != null && client.isConnected()) {
            client.disconnect();
            client.close(true);
            Log.d("MQTT", "结束链接" );
        }
    }
}
