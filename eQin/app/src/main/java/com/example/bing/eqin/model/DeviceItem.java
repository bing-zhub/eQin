package com.example.bing.eqin.model;

public class DeviceItem {
    private String connectionType;
    private String deviceType;
    private String deviceId;
    private String topic;
    private String location;
    private String note;
    private String objectId;
    private boolean isSensor;

    public String getConnectionType() {
        return connectionType;
    }

    public void setConnectionType(String connectionType) {
        this.connectionType = connectionType;
    }

    public String getDeviceType() {
        return deviceType;
    }

    public void setDeviceType(String deviceType) {
        this.deviceType = deviceType;
    }

    public String getDeviceId() {
        return deviceId;
    }

    public void setDeviceId(String deviceId) {
        this.deviceId = deviceId;
    }

    public String getTopic() {
        return topic;
    }

    public void setTopic(String topic) {
        this.topic = topic;
    }

    public boolean isSensor() {
        return isSensor;
    }

    public void setSensor(boolean sensor) {
        isSensor = sensor;
    }

    public String getLocation() {
        return location;
    }

    public void setLocation(String location) {
        this.location = location;
    }

    public String getNote() {
        return note;
    }

    public void setNote(String note) {
        this.note = note;
    }

    public String getObjectId() {
        return objectId;
    }

    public void setObjectId(String objectId) {
        this.objectId = objectId;
    }
}


