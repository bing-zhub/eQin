package com.example.bing.eqin.fragment.account;

import android.os.Bundle;
import android.support.annotation.NonNull;
import android.support.annotation.Nullable;
import android.support.v4.app.Fragment;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.EditText;

import com.example.bing.eqin.R;
import com.example.bing.eqin.controller.UserController;
import com.example.bing.eqin.model.UserProfile;
import com.example.bing.eqin.utils.CommonUtils;
import com.tapadoo.alerter.Alerter;

import info.hoang8f.widget.FButton;


public class SignupFragment extends Fragment{

    private EditText etUsername, etUserPassword, etUserConfirmPassword;
    private UserController controller;
    private FButton btnSignup;

    public SignupFragment(){

    }

    @Override
    public void onCreate(@Nullable Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
    }

    @Nullable
    @Override
    public View onCreateView(@NonNull LayoutInflater inflater, @Nullable ViewGroup container, @Nullable Bundle savedInstanceState) {
        getActivity().findViewById(R.id.login_toolbar_title).setVisibility(View.INVISIBLE);

        View view = inflater.inflate(R.layout.fragment_signup, container, false);
        etUserConfirmPassword = view.findViewById(R.id.signup_confirm_password);
        etUserPassword = view.findViewById(R.id.signup_password);
        etUsername = view.findViewById(R.id.signup_username);
        btnSignup = view.findViewById(R.id.signup_submission);

        btnSignup.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                String confirmPassword = etUserConfirmPassword.getText().toString();
                String password = etUserPassword.getText().toString();
                String username = etUsername.getText().toString();
                controller = new UserController();

                if(confirmPassword.isEmpty() || password.isEmpty() || username.isEmpty()){
                    Alerter.create(getActivity()).setTitle("错误").setText("必填信息为空").show();
                    return;
                }

                if(!confirmPassword.equals(password)){
                    Alerter.create(getActivity()).setTitle("错误").setText("两次密码输入不一致").show();
                    return;
                }

                UserProfile profile = new UserProfile();
                profile.setNickname(username);
                boolean result =  controller.register(profile, password, false);
                if(result){
                    Alerter.create(getActivity()).setTitle("通知").setText("注册成功请返回登录").show();
                    getActivity().getSupportFragmentManager().popBackStack();
                }else{
                    Alerter.create(getActivity()).setTitle("错误").setText("注册失败").show();
                }
            }
        });

        return view;
    }
}
