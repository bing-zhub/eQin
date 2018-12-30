package com.example.bing.eqin.model;

public class UserProfile {
    private String nickname;
    private String gender;
    private String province;
    private String city;
    private String birth_year;
    private String avatarSmallUrl;
    private String avatarBigUrl;

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
