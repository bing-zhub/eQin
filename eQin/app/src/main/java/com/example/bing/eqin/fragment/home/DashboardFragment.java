package com.example.bing.eqin.fragment.home;

import android.graphics.Color;
import android.os.Bundle;
import android.support.annotation.NonNull;
import android.support.annotation.Nullable;
import android.support.v4.app.Fragment;
import android.util.Log;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;

import com.example.bing.eqin.R;
import com.example.bing.eqin.controller.DynamicLineChartController;
import com.example.bing.eqin.controller.MQTTController;
import com.github.mikephil.charting.charts.LineChart;
import org.eclipse.paho.client.mqttv3.MqttMessage;
import org.greenrobot.eventbus.EventBus;
import org.greenrobot.eventbus.Subscribe;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;


public class DashboardFragment extends Fragment{

    private MQTTController mqttController;
    private LineChart lineChart;
    private DynamicLineChartController dynamicLineChartController;
    private List<Integer> list = new ArrayList<>();
    private List<String> names = new ArrayList<>();
    private List<Integer> colors = new ArrayList<>();

    @Override
    public void onCreate(@Nullable Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        mqttController = MQTTController.getInstance();
        EventBus.getDefault().register(this);
    }

    @Nullable
    @Override
    public View onCreateView(@NonNull LayoutInflater inflater, @Nullable ViewGroup container, @Nullable Bundle savedInstanceState) {
        View view = inflater.inflate(R.layout.fragment_dashboard, container, false);
        lineChart = view.findViewById(R.id.chart);

        setConfigToChart();
        setConfigToMQTT();

        return view;
    }

    private void setConfigToChart() {
        names.add("温度");
        names.add("湿度");
        colors.add(Color.CYAN);
        colors.add(Color.BLUE);
        dynamicLineChartController = new DynamicLineChartController(lineChart, names, colors);
        dynamicLineChartController.setDescription("当前温湿度");
        dynamicLineChartController.setLeftYAxis(100, 0, 10);
        dynamicLineChartController.setRightYAxis(100, 0, 10);
    }

    private void setConfigToMQTT() {
        new Thread(new Runnable() {
            @Override
            public void run() {
                boolean res =  mqttController.createConnect("tcp://115.159.98.171:1883", null,null,"2131");
                Log.d("MQTT", res?"连接成功":"连接失败");
            }
        }).start();
        try {
            Thread.sleep(200);
        } catch (InterruptedException e) {
            e.printStackTrace();
        }
        new Thread(new Runnable() {
            @Override
            public void run() {
                boolean res = MQTTController.getInstance().subscribe("dht11", 2);
                Log.d("MQTT", res?"订阅成功":"订阅失败");
            }
        }).start();
    }

    @Subscribe
    public void onEvent(MqttMessage message) {
        try {
            JSONObject jsonObject = new JSONObject(message.toString());
            list.add((int) jsonObject.getDouble("temperature"));
            list.add((int) jsonObject.getDouble("humidity"));
            dynamicLineChartController.addEntry(list);
            list.clear();
        } catch (JSONException e) {
            e.printStackTrace();
        }
    }

}
