package com.example.bing.eqin.controller;

import com.example.bing.eqin.model.AutomationItem;
import com.parse.ParseObject;

public class AutomationController {
    private static AutomationController mInstance;

    public static AutomationController getInstance() {
        if(mInstance==null){
            mInstance = new AutomationController();
        }
        return mInstance;
    }

    public void addAutomation(AutomationItem item){
        ParseObject object = new ParseObject("UserAutomation");
        object.put("sourceTopic", item.getSourceTopic());
        object.put("type", item.getType());
        object.put("condition", item.getCondition());
        object.put("targetTopic", item.getTargetTopic());
        object.saveInBackground();
    }
}
