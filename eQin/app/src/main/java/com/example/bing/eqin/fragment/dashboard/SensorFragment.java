package com.example.bing.eqin.fragment.dashboard;

import android.graphics.Color;
import android.os.Bundle;
import android.os.Handler;
import android.support.annotation.NonNull;
import android.support.annotation.Nullable;
import android.support.v4.app.Fragment;
import android.support.v4.widget.SwipeRefreshLayout;
import android.support.v7.widget.LinearLayoutManager;
import android.support.v7.widget.RecyclerView;
import android.text.format.DateFormat;
import android.util.Log;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;

import com.afollestad.materialdialogs.DialogAction;
import com.afollestad.materialdialogs.MaterialDialog;
import com.chad.library.adapter.base.BaseQuickAdapter;
import com.example.bing.eqin.R;
import com.example.bing.eqin.adapter.SensorAdapter;
import com.example.bing.eqin.controller.DataController;
import com.example.bing.eqin.controller.DeviceController;
import com.example.bing.eqin.controller.DynamicLineChartController;
import com.example.bing.eqin.controller.MQTTController;
import com.example.bing.eqin.model.DeviceItem;
import com.example.bing.eqin.model.MQTTDataItem;
import com.example.bing.eqin.model.SensorItem;
import com.example.bing.eqin.utils.CommonUtils;
import com.example.bing.eqin.utils.HourAxisValueFormatter;
import com.example.bing.eqin.utils.MQTTRunnable;
import com.example.bing.eqin.utils.ItemDecoration;
import com.example.bing.eqin.views.ChartMarkView;
import com.github.mikephil.charting.charts.LineChart;
import com.github.mikephil.charting.components.AxisBase;
import com.github.mikephil.charting.components.Description;
import com.github.mikephil.charting.components.Legend;
import com.github.mikephil.charting.components.XAxis;
import com.github.mikephil.charting.components.YAxis;
import com.github.mikephil.charting.data.Entry;
import com.github.mikephil.charting.data.LineData;
import com.github.mikephil.charting.data.LineDataSet;
import com.github.mikephil.charting.formatter.IAxisValueFormatter;

import org.eclipse.paho.client.mqttv3.MqttException;
import org.greenrobot.eventbus.EventBus;
import org.greenrobot.eventbus.Subscribe;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
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
    private Thread mqttThread;

    @Override
    public void onCreate(@Nullable Bundle savedInstanceState) {
        EventBus.getDefault().register(this);
        super.onCreate(savedInstanceState);
        handler=new Handler();
        mqttRunnable.setTopics(DeviceController.getInstance().getTopics());
        mqttThread = new Thread(mqttRunnable);
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
        sensorAdapter.bindToRecyclerView(sensorContainer);
        sensorContainer.setLayoutManager(new LinearLayoutManager(getContext()));
        sensorAdapter.setEmptyView(R.layout.item_empty, (ViewGroup)sensorContainer.getParent());
        sensorAdapter.addHeaderView(inflater.inflate(R.layout.item_header, (ViewGroup)sensorContainer.getParent(), false));
        sensorContainer.addItemDecoration(new ItemDecoration(30));

        sensorAdapter.setOnItemLongClickListener(new BaseQuickAdapter.OnItemLongClickListener() {
            @Override
            public boolean onItemLongClick(BaseQuickAdapter adapter, View view, final int position) {
                new MaterialDialog.Builder(getContext())
                        .content("确定删除?")
                        .positiveText("确定")
                        .negativeText("取消")
                        .onPositive(new MaterialDialog.SingleButtonCallback() {
                            @Override
                            public void onClick(@NonNull MaterialDialog dialog, @NonNull DialogAction which) {
                                DeviceController.getInstance().deleteDevice(sensorItems.get(position).getDeviceItem().getObjectId());
                                sensorItems.remove(position);
                                sensorAdapter.notifyDataSetChanged();
                                CommonUtils.showMessage(getContext(),"删除");
                            }
                        })
                        .onNegative(new MaterialDialog.SingleButtonCallback() {
                            @Override
                            public void onClick(@NonNull MaterialDialog dialog, @NonNull DialogAction which) {
                                CommonUtils.showMessage(getContext(),"取消删除");

                            }
                        }).show();
                return false;
            }
        });

        sensorAdapter.setOnItemClickListener(new BaseQuickAdapter.OnItemClickListener() {
            @Override
            public void onItemClick(BaseQuickAdapter adapter, View view, int position) {
                MaterialDialog dialog =  new MaterialDialog.Builder(getContext())
                        .customView(R.layout.item_chart,false)
                        .show();

                dialog.getWindow().setLayout(900,1200);
                dialog.getWindow().setGravity(0);
                SensorItem curr = sensorItems.get(position);
                LineChart lineChart = (LineChart) dialog.findViewById(R.id.item_chart);
                final List<SensorItem> list = DataController.getInstance().getRecentData(curr.getDeviceItem());
                lineChart.setDrawBorders(false);
                List<Entry> entries = new ArrayList<>();
                for (int i = list.size()-1; i >=0 ; i--) {
                    entries.add(new Entry(list.size() - i, Float.parseFloat(list.get(i).getData())));
                }
                LineDataSet lineDataSet = new LineDataSet(entries, "");
                lineDataSet.setColor(R.color.colorAccent);
                lineDataSet.setLineWidth(1.6f);
                lineDataSet.setDrawCircles(false);
                lineDataSet.setMode(LineDataSet.Mode.HORIZONTAL_BEZIER);
                LineData data = new LineData(lineDataSet);
                lineChart.setNoDataText("暂无数据");
                data.setDrawValues(false);
                XAxis xAxis = lineChart.getXAxis();
                xAxis.setPosition(XAxis.XAxisPosition.BOTTOM);
                xAxis.setGranularity(1f);
                xAxis.setLabelCount(list.size() / 2, false);
                xAxis.setAxisMinimum(0f);
                xAxis.setAxisMaximum((float) list.size());
                xAxis.setDrawGridLines(false);
                xAxis.setLabelRotationAngle(45);
                xAxis.setValueFormatter(new IAxisValueFormatter() {
                    @Override
                    public String getFormattedValue(float value, AxisBase axis)
                    {
                        int IValue = (int) value;
                        if(IValue < list.size()){
                            CharSequence format = DateFormat.format("dd日hh时mm分", list.get(list.size()  -1 - IValue).getDate().getTime());
                            return format.toString();
                        }
                        return "";
                    }
                });
                YAxis yAxis = lineChart.getAxisLeft();
                YAxis rightYAxis = lineChart.getAxisRight();
                rightYAxis.setEnabled(false); //右侧Y轴不显示
                yAxis.setDrawGridLines(false);
                yAxis.setGranularity(1);
                yAxis.setLabelCount(list.size()/3, true);
                yAxis.setAxisMinimum(Float.parseFloat(Collections.min(list, new Comparator<SensorItem>() {
                    @Override
                    public int compare(SensorItem o1, SensorItem o2) {
                        return Float.parseFloat(o1.getData()) > Float.parseFloat(o2.getData())?1:-1;
                    }
                }).getData())-1);
                yAxis.setAxisMaximum(Float.parseFloat(Collections.max(list, new Comparator<SensorItem>() {
                    @Override
                    public int compare(SensorItem o1, SensorItem o2) {
                        return Float.parseFloat(o1.getData()) > Float.parseFloat(o2.getData())?1:-1;
                    }
                }).getData())+1);
                yAxis.setValueFormatter(new IAxisValueFormatter() {
                    @Override
                    public String getFormattedValue(float value, AxisBase axis)
                    {
                        int IValue = (int) value;
                        return String.valueOf(IValue);
                    }
                });
                Legend legend = lineChart.getLegend();
                legend.setEnabled(false);
                Description description = new Description();
                description.setEnabled(false);
                lineChart.setDescription(description);
                ChartMarkView mv = new ChartMarkView(getContext());
                lineChart.setMarker(mv);
                lineChart.setData(data);
                lineChart.invalidate();
            }
        });

        sensorAdapter.setOnItemChildLongClickListener(new BaseQuickAdapter.OnItemChildLongClickListener() {
            @Override
            public boolean onItemChildLongClick(BaseQuickAdapter adapter, View view, int position) {
                final SensorItem sensorItem =  sensorAdapter.getItem(position);
                if(view.getId() == R.id.sensor_item_location){
                    new MaterialDialog.Builder(getContext())
                            .title("修改位置")
                            .positiveText("确认")
                            .negativeText("取消")
                            .input(null, sensorItem.getDeviceItem().getLocation(), true, new MaterialDialog.InputCallback() {
                                @Override
                                public void onInput(@NonNull MaterialDialog dialog, CharSequence input) {

                                }
                            })
                            .onPositive(new MaterialDialog.SingleButtonCallback() {
                                @Override
                                public void onClick(@NonNull MaterialDialog dialog, @NonNull DialogAction which) {
                                    sensorItem.getDeviceItem().setLocation(dialog.getInputEditText().getText().toString());
                                    DeviceController.getInstance().updateDevice(sensorItem.getDeviceItem().getObjectId(), sensorItem.getDeviceItem());
                                    sensorAdapter.notifyDataSetChanged();
                                    CommonUtils.showMessage(getContext(), dialog.getInputEditText().getText().toString());
                                }
                            })
                            .onNegative(new MaterialDialog.SingleButtonCallback() {
                                @Override
                                public void onClick(@NonNull MaterialDialog dialog, @NonNull DialogAction which) {
                                    CommonUtils.showMessage(getContext(), "取消");
                                }
                            })
                            .show();
                }else if(view.getId() == R.id.sensor_item_note){
                    new MaterialDialog.Builder(getContext())
                            .title("修改备注")
                            .positiveText("确认")
                            .negativeText("取消")
                            .input(null, sensorItem.getDeviceItem().getNote(), true, new MaterialDialog.InputCallback() {
                                @Override
                                public void onInput(@NonNull MaterialDialog dialog, CharSequence input) {

                                }
                            })
                            .onPositive(new MaterialDialog.SingleButtonCallback() {
                                @Override
                                public void onClick(@NonNull MaterialDialog dialog, @NonNull DialogAction which) {
                                    sensorItem.getDeviceItem().setNote(dialog.getInputEditText().getText().toString());
                                    DeviceController.getInstance().updateDevice(sensorItem.getDeviceItem().getObjectId(), sensorItem.getDeviceItem());
                                    sensorAdapter.notifyDataSetChanged();
                                    CommonUtils.showMessage(getContext(), dialog.getInputEditText().getText().toString());
                                }
                            })
                            .onNegative(new MaterialDialog.SingleButtonCallback() {
                                @Override
                                public void onClick(@NonNull MaterialDialog dialog, @NonNull DialogAction which) {
                                    CommonUtils.showMessage(getContext(), "取消");
                                }
                            })
                            .show();
                }

                return true;
            }
        });

        return view;
    }

    public void updateTopics(){
        try {
            MQTTController.getInstance().disConnect();
        } catch (MqttException e) {
            e.printStackTrace();
        }
        mqttRunnable.setTopics(DeviceController.getInstance().getTopics());
        mqttThread = new Thread(mqttRunnable);
        mqttThread.start();
    }

    private void getData() {
        updateTopics();
        sensorItems.clear();
        List<DeviceItem> deviceItems =  DeviceController.getInstance().getDevice(true);
        for (int i = 0; i < deviceItems.size(); i++ ){
            DeviceItem d = deviceItems.get(i);
            SensorItem s = new SensorItem();
            d.setDeviceType(CommonUtils.mappingToName(d.getDeviceType()));
            s.setDeviceItem(d);
            s.setData("未获取到数据");
            if(d.isSensor())
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
            String[] parts = topic.split("/");
            if(parts.length!=3)
                return;
            String connectionType = parts[0];
            String type = parts[1];
            String id = parts[2];
            if(!type.equals("humidity") && !type.equals("temperature"))
                return;
            int pos = positionTopicMapping.get(topic);
            String data = "";

            JSONObject jsonObject = new JSONObject(message.getData().toString());
            if(type.equals("temperature")){
                data = jsonObject.getDouble("temperature")+"°C";
            }else if(type.equals("humidity")){
                data = jsonObject.getDouble("humidity")+"%";
            }
            sensorItems.get(pos).setData(data);
            handler.post(udpUIRunnable);
        } catch (JSONException e) {
            e.printStackTrace();
        }
    }
}
