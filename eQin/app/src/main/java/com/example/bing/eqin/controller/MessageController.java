package com.example.bing.eqin.controller;

import com.example.bing.eqin.model.MessageItem;
import com.parse.ParseException;
import com.parse.ParseObject;
import com.parse.ParseQuery;

import java.util.LinkedList;
import java.util.List;

public class MessageController {

    private static MessageController mInstance;

    public static MessageController getInstance() {
        if(null == mInstance)
            mInstance = new MessageController();
        return mInstance;
    }

    public List<MessageItem> getMessages(){
        List<MessageItem> messageItems = new LinkedList<>();

        ParseQuery<ParseObject> query = ParseQuery.getQuery("UserInfo");
        List<ParseObject> objects = null;
        try {
            objects =  query.find();
        } catch (ParseException e) {
            e.printStackTrace();
        }
        for (ParseObject object: objects){
            MessageItem messageItem = new MessageItem(object.getString("info"), object.getCreatedAt(),object.getBoolean("isPush"));
            messageItems.add(messageItem);
        }

        return messageItems;
    }
}
