package com.example.bing.eqin.fragment.dashboard;

import android.os.Bundle;
import android.support.annotation.NonNull;
import android.support.annotation.Nullable;
import android.support.v4.app.Fragment;
import android.support.v4.widget.SwipeRefreshLayout;
import android.support.v7.widget.LinearLayoutManager;
import android.support.v7.widget.RecyclerView;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;

import com.example.bing.eqin.R;
import com.example.bing.eqin.adapter.SensorAdapter;
import com.example.bing.eqin.model.DeviceItem;
import com.example.bing.eqin.model.SensorItem;
import com.example.bing.eqin.utils.CommonUtils;

import java.util.Date;
import java.util.LinkedList;
import java.util.List;

public class SensorFragment extends Fragment {

    private RecyclerView sensorContainer;
    private SwipeRefreshLayout sensorSwipeRefreshLayout;
    List<SensorItem> sensorItems = new LinkedList<>();
    private SensorAdapter sensorAdapter;


    @Override
    public void onCreate(@Nullable Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
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
        for(int i =0; i < 10; i++){
            SensorItem sensorItem = new SensorItem();
            DeviceItem deviceItem = new DeviceItem();
            deviceItem.setSensor(true);
            deviceItem.setDeviceType("温湿度");
            deviceItem.setLocation("寝室");
            deviceItem.setNote("备注"+Math.random()*10);
            sensorItem.setData(i+"");
            sensorItem.setDate(new Date());
            sensorItem.setDeviceItem(deviceItem);
            sensorItems.add(sensorItem);
        }
        if(sensorAdapter!=null)
            sensorAdapter.notifyDataSetChanged();
    }
}
