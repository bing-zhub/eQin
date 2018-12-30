package com.example.bing.eqin.controller;

import com.example.bing.eqin.model.UserProfile;
import com.parse.LogInCallback;
import com.parse.ParseException;
import com.parse.ParseUser;
import com.parse.SignUpCallback;

import org.xml.sax.helpers.ParserFactory;

import static com.vondear.rxtool.RxEncodeTool.base64Encode;

public class UserController {
    private boolean isRegisterOk = false;
    private boolean isLoginOk = false;

    public boolean register(UserProfile profile, String password){
        ParseUser user = new ParseUser();
        isRegisterOk = false;
        user.setUsername(profile.getNickname());

        if(password.isEmpty())
            user.setPassword(base64Encode(profile.getNickname()).toString());
        else
            user.setPassword(password);

        user.put("gender", profile.getGender());
        user.put("province", profile.getGender());
        user.put("city", profile.getCity());
        user.put("birthYear", profile.getBirth_year());
        user.put("avatar", profile.getAvatarBigUrl());

        user.signUpInBackground(new SignUpCallback() {
            @Override
            public void done(ParseException e) {
                if(e==null)
                    isRegisterOk = true;
                else
                    isRegisterOk = false;
            }
        });
        return isRegisterOk;
    }

    public boolean login(String username, String password){
        isLoginOk = false;
        ParseUser.logInInBackground(username, password, new LogInCallback() {
            @Override
            public void done(ParseUser user, ParseException e) {
                if(e==null)
                    isLoginOk = true;
                else
                    isLoginOk = false;
            }
        });
        return isLoginOk;
    }
}
