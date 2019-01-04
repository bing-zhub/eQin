package com.example.bing.eqin.fragment.home;

import android.Manifest;
import android.content.Intent;
import android.graphics.Color;
import android.os.Bundle;
import android.support.annotation.NonNull;
import android.support.annotation.Nullable;
import android.support.v4.app.Fragment;
import android.util.Log;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Button;

import com.example.bing.eqin.R;
import com.example.bing.eqin.activity.EspTouchActivity;
import com.example.bing.eqin.controller.DynamicLineChartController;
import com.example.bing.eqin.controller.MQTTController;
import com.example.bing.eqin.model.MQTTDataItem;
import com.github.mikephil.charting.charts.LineChart;
import com.yanzhenjie.permission.AndPermission;

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
    private Button btnAdd;

    @Override
    public void onCreate(@Nullable Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        mqttController = MQTTController.getInstance();
//        EventBus.getDefault().register(this);

        AndPermission.with(this)
                .runtime()
                .permission(Manifest.permission.CHANGE_NETWORK_STATE)
                .permission(Manifest.permission.CHANGE_WIFI_STATE)
                .permission(Manifest.permission.ACCESS_NETWORK_STATE)
                .permission(Manifest.permission.ACCESS_WIFI_STATE)
                .permission(Manifest.permission.INTERNET)
                .permission(Manifest.permission.ACCESS_FINE_LOCATION)
                .permission(Manifest.permission.ACCESS_COARSE_LOCATION)
                .start();

    }

    @Nullable
    @Override
    public View onCreateView(@NonNull LayoutInflater inflater, @Nullable ViewGroup container, @Nullable Bundle savedInstanceState) {
        View view = inflater.inflate(R.layout.fragment_dashboard, container, false);
        lineChart = view.findViewById(R.id.chart);
        btnAdd = view.findViewById(R.id.dashboard_add);
        btnAdd.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                startActivity(new Intent(getContext(), EspTouchActivity.class));
            }
        });
        setConfigToChart();
//        setConfigToMQTT();

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
                if(res) {
                    res = MQTTController.getInstance().subscribe("dht11", 2);
                    Log.d("MQTT", res ? "订阅成功dht11" : "dht11订阅失败");
                    MQTTController.getInstance().subscribe("dht12", 2);
                    Log.d("MQTT", res ? "订阅成功dht12" : "dht12订阅失败");
                    MQTTController.getInstance().subscribe("dht13", 2);
                    Log.d("MQTT", res ? "订阅成功dht13" : "dht13订阅失败");
                }
            }
        }).start();
    }

//    @Subscribe
//    public void onEvent(MQTTDataItem message) {
//        try {
//            String topic = message.getTopic();
//            JSONObject jsonObject = new JSONObject(message.getData().toString());
//            list.add((int) jsonObject.getDouble("temperature"));
//            list.add((int) jsonObject.getDouble("humidity"));
//            dynamicLineChartController.addEntry(list);
//            list.clear();
//        } catch (JSONException e) {
//            e.printStackTrace();
//        }
//    }

}
