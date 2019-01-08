package com.example.bing.eqin.controller;

import android.util.Log;

import com.example.bing.eqin.model.UserProfile;
import com.parse.LogInCallback;
import com.parse.ParseException;
import com.parse.ParseUser;
import com.parse.SignUpCallback;

import org.xml.sax.helpers.ParserFactory;

import static com.vondear.rxtool.RxEncodeTool.base64Encode;

public class UserController {

    private static UserController userController;

    public static UserController getInstance(){
        if(userController == null){
            userController = new UserController();
        }
        return  userController;
    }

    public void register(UserProfile profile, String password, boolean isQQ) throws ParseException {
        ParseUser user = new ParseUser();
        user.setUsername(profile.getNickname());

        if(isQQ){
            user.setPassword("loginByQQ");
            user.put("gender", profile.getGender());
            user.put("province", profile.getGender());
            user.put("city", profile.getCity());
            user.put("birthYear", profile.getBirth_year());
            user.put("avatar", profile.getAvatarBigUrl());
        }else{
            user.setPassword(password);
        }

        user.signUp();
    }

    public void login(String username, String password) throws ParseException {
        ParseUser.logInInBackground(username, password, new LogInCallback() {
            @Override
            public void done(ParseUser user, ParseException e) {
                if(e==null){
                    Log.d("User", ParseUser.getCurrentUser().getUsername());
                }else{
                    Log.d("User", e.getMessage());
                }
            }
        });
    }
}
