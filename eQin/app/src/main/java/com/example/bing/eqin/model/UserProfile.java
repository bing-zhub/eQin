package com.example.bing.eqin.model;

public class UserProfile {
    String nikename;
    String gender;
    String province;
    String city;
    String bitrh_year;
    String avatarSmallUrl;
    String avatarBigUrl;

    public String getNikename() {
        return nikename;
    }

    public void setNickname(String nikename) {
        this.nikename = nikename;
    }

    public String getGender() {
        return gender;
    }

    public void setGender(String gender) {
        this.gender = gender;
    }

    public String getProvince() {
        return province;
    }

    public void setProvince(String province) {
        this.province = province;
    }

    public String getCity() {
        return city;
    }

    public void setCity(String city) {
        this.city = city;
    }

    public String getBitrh_year() {
        return bitrh_year;
    }

    public void setBitrh_year(String bitrh_year) {
        this.bitrh_year = bitrh_year;
    }

    public String getAvatarSmallUrl() {
        return avatarSmallUrl;
    }

    public void setAvatarSmallUrl(String avatarSmallUrl) {
        this.avatarSmallUrl = avatarSmallUrl;
    }

    public String getAvatarBigUrl() {
        return avatarBigUrl;
    }

    public void setAvatarBigUrl(String avatarBigUrl) {
        this.avatarBigUrl = avatarBigUrl;
    }
}
