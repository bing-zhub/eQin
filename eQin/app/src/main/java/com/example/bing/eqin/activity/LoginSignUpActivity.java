package com.example.bing.eqin.activity;

import android.content.Intent;
import android.support.v7.app.AppCompatActivity;
import android.os.Bundle;
import android.util.Log;
import android.view.View;
import android.widget.ImageView;
import android.widget.Toast;

import com.bumptech.glide.Glide;
import com.example.bing.eqin.MainActivity;
import com.example.bing.eqin.R;
import com.example.bing.eqin.model.UserProfile;
import com.tencent.connect.UserInfo;
import com.tencent.connect.auth.QQToken;
import com.tencent.connect.common.Constants;
import com.tencent.tauth.IUiListener;
import com.tencent.tauth.Tencent;
import com.tencent.tauth.UiError;

import org.json.JSONException;
import org.json.JSONObject;

import java.util.HashMap;

import static android.widget.Toast.LENGTH_SHORT;

public class LoginSignUpActivity extends AppCompatActivity {

    Tencent mTencent;
    private ImageView avatar;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_login_sign_up);
        mTencent = Tencent.createInstance("101535967", getApplicationContext());
    }

    public void test(View view) {
        mTencent.login(LoginSignUpActivity.this, "all", new BaseUiListener());
    }



    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);

        Tencent.onActivityResultData(requestCode, resultCode, data, new BaseUiListener());

        if (requestCode == Constants.REQUEST_API) {
            if (resultCode == Constants.REQUEST_LOGIN) {
                Tencent.handleResultData(data, new BaseUiListener());
            }
        }
    }

    private class BaseUiListener implements IUiListener {

        public void onComplete(Object response) {
            Toast.makeText(getApplicationContext(), "登录成功", LENGTH_SHORT).show();
            try {
                String openidString = ((JSONObject) response).getString("openid");
                mTencent.setOpenId(openidString);
                mTencent.setAccessToken(((JSONObject) response).getString("access_token"),((JSONObject) response).getString("expires_in"));


            } catch (JSONException e) {
                e.printStackTrace();
            }

            QQToken qqToken = mTencent.getQQToken();
            UserInfo info = new UserInfo(getApplicationContext(), qqToken);

            info.getUserInfo(new IUiListener() {
                @Override
                public void onComplete(Object o) {
                    try {
                        JSONObject userInfo =  (JSONObject) o;
                        UserProfile profile = new UserProfile();
                        profile.setNickname(userInfo.getString("nickname"));
                        profile.setGender(userInfo.getString("gender"));
                        profile.setProvince(userInfo.getString("province"));
                        profile.setCity(userInfo.getString("city"));
                        profile.setBirth_year(userInfo.getString("year"));
                        profile.setAvatarSmallUrl(userInfo.getString("figureurl_qq_1"));
                        profile.setAvatarBigUrl(userInfo.getString("figureurl_qq_2"));
                        Intent intent = new Intent();
                        intent.putExtra("userAvatar", profile.getAvatarBigUrl());
                        intent.putExtra("userNickname", profile.getNickname());
                        setResult(0, intent);
                        LoginSignUpActivity.this.finish();
                    } catch (JSONException e) {
                        // TODO Auto-generated catch block
                        e.printStackTrace();
                    }
                }

                @Override
                public void onError(UiError uiError) {
                    Log.v("UserInfo","onError");
                }

                @Override
                public void onCancel() {
                    Log.v("UserInfo","onCancel");
                }
            });
            Toast.makeText(getApplicationContext(), response+"", LENGTH_SHORT).show();
        }

        @Override
        public void onError(UiError uiError) {
            Toast.makeText(getApplicationContext(), "onError", LENGTH_SHORT).show();
        }

        @Override
        public void onCancel() {
            Toast.makeText(getApplicationContext(), "onCancel", LENGTH_SHORT).show();
        }


    }
}
