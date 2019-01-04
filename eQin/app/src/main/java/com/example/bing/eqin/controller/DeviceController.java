package com.example.bing.eqin.controller;

import android.content.Context;

import com.example.bing.eqin.model.DeviceItem;
import com.example.bing.eqin.utils.CommonUtils;
import com.parse.ParseException;
import com.parse.ParseObject;
import com.parse.ParseQuery;
import com.parse.ParseUser;
import com.parse.SaveCallback;

import java.util.List;

public class DeviceController {
    private static  DeviceController mInstance;

    public static DeviceController getInstance() {
        if(null == mInstance)
            mInstance = new DeviceController();
        return mInstance;
    }

    public void addDevice(DeviceItem item, final Context context){
        String topic = ParseUser.getCurrentUser().getObjectId()+"/"+item.getConnectionType()+"/"+item.getDeviceType()+"/"+item.getDeviceId();
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
}
