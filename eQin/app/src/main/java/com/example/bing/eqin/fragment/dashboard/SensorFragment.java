package com.example.bing.eqin.fragment.dashboard;

import android.os.Bundle;
import android.os.Handler;
import android.support.annotation.NonNull;
import android.support.annotation.Nullable;
import android.support.v4.app.Fragment;
import android.support.v4.widget.SwipeRefreshLayout;
import android.support.v7.widget.LinearLayoutManager;
import android.support.v7.widget.RecyclerView;
import android.util.Log;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;

import com.example.bing.eqin.R;
import com.example.bing.eqin.adapter.SensorAdapter;
import com.example.bing.eqin.controller.DeviceController;
import com.example.bing.eqin.controller.MQTTController;
import com.example.bing.eqin.model.DeviceItem;
import com.example.bing.eqin.model.MQTTDataItem;
import com.example.bing.eqin.model.SensorItem;
import com.example.bing.eqin.utils.CommonUtils;
import com.example.bing.eqin.utils.MQTTRunnable;
import com.parse.ParseUser;

import org.greenrobot.eventbus.EventBus;
import org.greenrobot.eventbus.Subscribe;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.Date;
import java.util.HashMap;
import java.util.LinkedList;
import java.util.List;
import java.util.Map;

public class SensorFragment extends Fragment {

    private RecyclerView sensorContainer;
    private SwipeRefreshLayout sensorSwipeRefreshLayout;
    List<SensorItem> sensorItems = new LinkedList<>();
    private SensorAdapter sensorAdapter;
    private Map<String, Integer> positionTopicMapping = new HashMap<>();
    private Handler handler=null;
    private List<String> topics = new LinkedList<>();
    private MQTTRunnable mqttRunnable = new MQTTRunnable();


    @Override
    public void onCreate(@Nullable Bundle savedInstanceState) {
        EventBus.getDefault().register(this);
        super.onCreate(savedInstanceState);
        handler=new Handler();
        mqttRunnable.setTopics(DeviceController.getInstance().getAllDeviceTopic());
        new Thread(mqttRunnable).start();
    }


    @Nullable
    @Override
    public View onCreateView(@NonNull LayoutInflater inflater, @Nullable ViewGroup container, @Nullable Bundle savedInstanceState) {
        View view = inflater.inflate(R.layout.fragment_sensor, container, false);
        getData();
        sensorContainer = view.findViewById(R.id.sensor_container);
        sensorSwipeRefreshLayout = view.findViewById(R.id.sensor_swipe_refresh);
        sensorSwipeRefreshLayout.setOnRefreshListener(new SwipeRefreshLayout.OnRefreshListener() {
            @Override
            public void onRefresh() {
                getData();
                sensorSwipeRefreshLayout.setRefreshing(false);
                CommonUtils.showMessage(getContext(), "刷新完成");
            }
        });
        sensorAdapter = new SensorAdapter(R.layout.item_sensor, sensorItems);
        sensorContainer.setAdapter(sensorAdapter);
        sensorContainer.setLayoutManager(new LinearLayoutManager(getContext()));
        return view;
    }

    private void getData() {
        sensorItems.clear();
        List<DeviceItem> deviceItems =  DeviceController.getInstance().getDevice();
        for (int i = 0; i < deviceItems.size(); i++ ){
            DeviceItem d = deviceItems.get(i);
            SensorItem s = new SensorItem();
            d.setDeviceType(CommonUtils.mappingToName(d.getDeviceType()));
            s.setDeviceItem(d);
            s.setData("未获取到数据");
            sensorItems.add(s);
            positionTopicMapping.put(d.getTopic(), i);
            topics.add(d.getTopic());
        }
        if(sensorAdapter!=null)
            sensorAdapter.notifyDataSetChanged();
    }

    Runnable udpUIRunnable=new  Runnable(){
        @Override
        public void run() {
            sensorAdapter.notifyDataSetChanged();
        }
    };

    @Subscribe
    public void onEvent(MQTTDataItem message) {
        try {
            String topic = message.getTopic();
            if(DeviceController.getInstance().getMapping().get(topic).equals(ParseUser.getCurrentUser().getObjectId())){
                JSONObject jsonObject = new JSONObject(message.getData().toString());
                int pos = positionTopicMapping.get(topic);
                String data = jsonObject.getDouble("temperature")+"";
                sensorItems.get(pos).setData(data);
                handler.post(udpUIRunnable);
            }
        } catch (JSONException e) {
            e.printStackTrace();
        }
    }
}
