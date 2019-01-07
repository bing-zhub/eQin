package com.example.bing.eqin.controller;

import android.content.Context;

import com.example.bing.eqin.model.DeviceItem;
import com.example.bing.eqin.model.SensorItem;
import com.example.bing.eqin.utils.CommonUtils;
import com.parse.FindCallback;
import com.parse.ParseException;
import com.parse.ParseObject;
import com.parse.ParseQuery;
import com.parse.ParseUser;
import com.parse.SaveCallback;

import java.util.HashMap;
import java.util.LinkedList;
import java.util.List;
import java.util.Map;

public class DeviceController {
    private static DeviceController mInstance;
    private static Map<String, String> UserTopicMapping;

    public static DeviceController getInstance() {
        if(null == mInstance)
            mInstance = new DeviceController();
        return mInstance;
    }


    public Map<String,String> getMapping() {
        List<ParseObject> objects = new LinkedList<>();
        Map<String, String> mapping = new HashMap<>();
        ParseQuery<ParseObject> query = ParseQuery.getQuery("UserDevice");
        try {
            objects = query.find();
        } catch (ParseException e) {
            e.printStackTrace();
        }

        for (ParseObject o : objects){
            mapping.put(o.getString("topic"), o.getParseUser("user").getObjectId());
        }

        return mapping;
    }


    public void addDevice(DeviceItem item, final Context context){
        String topic = item.getConnectionType()+"/"+item.getDeviceType()+"/"+item.getDeviceId();
        ParseQuery<ParseObject> query = ParseQuery.getQuery("UserDevice");
        query.whereEqualTo("topic", topic);
        List<ParseObject> objects = null;
        try {
            objects = query.find();
        } catch (ParseException e) {
            e.printStackTrace();
        }

        if(objects!=null && objects.size()==0){
            ParseObject object = new ParseObject("UserDevice");
            object.put("user", ParseUser.getCurrentUser());
            object.put("connectionType", item.getConnectionType());
            object.put("deviceType", item.getDeviceType());
            object.put("deviceId", item.getDeviceId());
            object.put("isSensor", item.isSensor());

            if(item.getLocation()==null)
                object.put("location", "undefined");
            else
                object.put("location",item.getLocation());

            if(item.getNote()==null)
                object.put("note", "undefined");
            else
                    object.put("location",item.getNote());

            object.put("topic", topic);
            object.saveInBackground(new SaveCallback() {
                @Override
                public void done(ParseException e) {
                    if(e==null)
                        CommonUtils.showMessage(context, "添加成功");
                }
            });
        }else{
            CommonUtils.showMessage(context, "已添加无需重复添加");
        }
    }

    public List<DeviceItem> getDevice(boolean isSensor){
        List<DeviceItem> deviceItems = new LinkedList<>();
        List<ParseObject> objects = null;
        ParseQuery<ParseObject> query = ParseQuery.getQuery("UserDevice");
        query.whereEqualTo("user", ParseUser.getCurrentUser());
        query.whereEqualTo("isSensor", isSensor);
        try {
             objects = query.find();
        } catch (ParseException e) {
            e.printStackTrace();
        }

        if(objects!=null && objects.size()!=0){
            for(ParseObject o: objects){
                DeviceItem deviceItem = new DeviceItem();
                deviceItem.setLocation(o.getString("location"));
                deviceItem.setNote(o.getString("note"));
                deviceItem.setSensor(o.getBoolean("isSensor"));
                deviceItem.setTopic(o.getString("topic"));
                deviceItem.setDeviceType(o.getString("deviceType"));
                deviceItem.setConnectionType(o.getString("connectionType"));
                deviceItem.setDeviceId(o.getString(o.getString("deviceId")));
                deviceItem.setObjectId(o.getObjectId());
                deviceItems.add(deviceItem);
            }
        }

        return deviceItems;
    }

    public List<String> getTopics(){
        List<String> allTopics = new LinkedList<>();
        List<ParseObject> objects = null;
        ParseQuery<ParseObject> query = ParseQuery.getQuery("UserDevice");
        query.whereEqualTo("user", ParseUser.getCurrentUser());
        query.whereNotEqualTo("isSensor",false);
        try {
            objects = query.find();
        } catch (ParseException e) {
            e.printStackTrace();
        }

        if(objects!=null && objects.size()!=0){
            for(ParseObject o: objects){
                allTopics.add(o.getString("topic"));
            }
        }

        return allTopics;
    }

    public void updateDevice(String objectId, DeviceItem deviceItem){
        ParseQuery<ParseObject> query = ParseQuery.getQuery("UserDevice");
        try {
            ParseObject parseObject =  query.get(objectId);
            parseObject.put("note", deviceItem.getNote());
            parseObject.put("location", deviceItem.getLocation());
            parseObject.saveInBackground();
        } catch (ParseException e) {
            e.printStackTrace();
        }
    }

}
