package com.example.bing.eqin.controller;

import com.example.bing.eqin.model.DeviceItem;
import com.example.bing.eqin.model.SensorItem;
import com.parse.ParseException;
import com.parse.ParseObject;
import com.parse.ParseQuery;
import com.parse.ParseUser;

import java.util.Date;
import java.util.LinkedList;
import java.util.List;

public class DataController {

    private static DataController mInstance;

    public static DataController getInstance() {
        if(mInstance == null){
            mInstance = new DataController();
        }
        return mInstance;
    }

    public List<SensorItem> getRecentData(DeviceItem deviceItem){
        List<SensorItem> sensorItems = new LinkedList<>();
        ParseQuery<ParseObject> query = ParseQuery.getQuery("UserData");
        query.setLimit(30);
        query.whereEqualTo("topic", deviceItem.getTopic());
        List<ParseObject> objects = null;
        try {
            objects =  query.find();
        } catch (ParseException e) {
            e.printStackTrace();
        }
        for(ParseObject o: objects){
            SensorItem sensorItem = new SensorItem();
            sensorItem.setData(o.getString("data"));
            sensorItem.setDate(o.getCreatedAt());
            sensorItems.add(sensorItem);
        }

        return sensorItems;
    }

}
