package com.example.bing.eqin;

import android.app.Application;
import android.util.Log;

import com.example.bing.eqin.activity.CustomPinActivity;
import com.github.omadahealth.lollipin.lib.managers.LockManager;
import com.parse.Parse;
import com.parse.ParseACL;


public class ApplicationStarter extends Application {
    @Override
    public void onCreate() {
        super.onCreate();

        Parse.enableLocalDatastore(this);
        Parse.initialize(new Parse.Configuration.Builder(this)
                .applicationId("r5em6wDjRffPNR6900ll9leu0T1sZP8t2TCZbPrI")
                .clientKey("sLj9Qhu8Lj3ea21kxpMBHNaRGUqSjJqXPE3dDtBH")
                .server("http://47.101.66.229:1337/parse/")
                .build()
        );

        ParseACL acl = new ParseACL();
        acl.setPublicReadAccess(true);
        acl.setPublicWriteAccess(true);
        ParseACL.setDefaultACL(acl, true);

        LockManager<CustomPinActivity> lockManager = LockManager.getInstance();
        lockManager.enableAppLock(this, CustomPinActivity.class);
        lockManager.getAppLock().setLogoId(R.drawable.e);
        lockManager.getAppLock().setShouldShowForgot(false);
        lockManager.getAppLock().setTimeout(1000);

    }
}
