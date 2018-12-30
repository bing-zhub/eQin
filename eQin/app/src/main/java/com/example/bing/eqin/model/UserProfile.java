package com.example.bing.eqin.model;

public class UserProfile {
    String nickname;
    String gender;
    String province;
    String city;
    String birth_year;
    String avatarSmallUrl;
    String avatarBigUrl;

    public String getNickname() {
        return nickname;
    }

    public void setNickname(String nickname) {
        this.nickname = nickname;
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

    public String getBirth_year() {
        return birth_year;
    }

    public void setBirth_year(String bitrh_year) {
        this.birth_year = bitrh_year;
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
