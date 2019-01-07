package com.example.bing.eqin.activity;


import com.example.bing.eqin.utils.CommonUtils;
import com.github.omadahealth.lollipin.lib.managers.AppLockActivity;
import com.github.omadahealth.lollipin.lib.managers.LockManager;

public class CustomPinActivity extends AppLockActivity {
    int total = 3;

    @Override
    public void showForgotDialog() {
        CommonUtils.showMessage(getApplicationContext(), "Test");
    }

    @Override
    public void onPinFailure(int attempts) {
        if(attempts == total){
            CommonUtils.showMessage(getApplicationContext(), "错误次数过多, 请10s后重试");
            LockManager<CustomPinActivity> lockManager = LockManager.getInstance();
            lockManager.getAppLock().setTimeout(1000);

            return;
        }

        CommonUtils.showMessage(getApplicationContext(), "还有"+(total - attempts)+"次机会");
    }

    @Override
    public void onPinSuccess(int attempts) {

    }

    @Override
    public int getPinLength() {
        return super.getPinLength();
    }

}
