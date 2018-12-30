package com.example.bing.eqin;

import android.app.Application;
import android.util.Log;

import com.parse.Parse;
import com.parse.ParseACL;
import com.parse.ParseException;
import com.parse.ParseUser;
import com.parse.SignUpCallback;

public class ApplicationStarter extends Application {
    @Override
    public void onCreate() {
        super.onCreate();

        Parse.enableLocalDatastore(this);
        Parse.initialize(new Parse.Configuration.Builder(this)
                .applicationId("r5em6wDjRffPNR6900ll9leu0T1sZP8t2TCZbPrI")
                .clientKey("sLj9Qhu8Lj3ea21kxpMBHNaRGUqSjJqXPE3dDtBH")
                .server("http://10.0.2.2:1337/parse/") // for debug only! localhost
                .build()
        );

        ParseACL acl = new ParseACL();
        acl.setPublicReadAccess(true);
        acl.setPublicWriteAccess(true);
        ParseACL.setDefaultACL(acl, true);
    }
}