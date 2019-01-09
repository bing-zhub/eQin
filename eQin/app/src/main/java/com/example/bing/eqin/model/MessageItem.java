package com.example.bing.eqin.model;

import java.util.Date;

public class MessageItem {
    private String info;
    private Date date;
    private Boolean isPush;

    public MessageItem(String info, Date date, Boolean isPush){
        this.info = info;
        this.date = date;
        this.isPush = isPush;
    }

    public Date getDate() {
        return date;
    }

    public void setDate(Date date) {
        this.date = date;
    }

    public String getInfo() {
        return info;
    }

    public void setInfo(String info) {
        this.info = info;
    }

    public Boolean getPush() {
        return isPush;
    }

    public void setPush(Boolean push) {
        isPush = push;
    }
}
