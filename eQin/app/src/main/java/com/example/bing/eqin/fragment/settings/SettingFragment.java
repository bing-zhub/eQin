package com.example.bing.eqin.fragment.settings;

import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Bundle;
import android.support.annotation.NonNull;
import android.support.annotation.Nullable;
import android.support.v4.app.Fragment;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.CompoundButton;
import android.widget.Switch;

import com.example.bing.eqin.MainActivity;
import com.example.bing.eqin.R;
import com.example.bing.eqin.activity.CustomPinActivity;
import com.github.omadahealth.lollipin.lib.managers.AppLock;
import com.github.omadahealth.lollipin.lib.managers.LockManager;

public class SettingFragment extends Fragment {

    @Override
    public void onCreate(@Nullable Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
    }

    @Nullable
    @Override
    public View onCreateView(@NonNull LayoutInflater inflater, @Nullable ViewGroup container, @Nullable Bundle savedInstanceState) {
        View view = inflater.inflate(R.layout.fragment_setting, container, false);

        final SharedPreferences sharedPreferences = getActivity().getSharedPreferences("settings", getActivity().MODE_PRIVATE);
        boolean pinEnable =  sharedPreferences.getBoolean("pinEnable", false);
        boolean notificationEnable = sharedPreferences.getBoolean("notificationEnable",false);

        Switch pinSwitch = view.findViewById(R.id.setting_pin_able);
        pinSwitch.setChecked(pinEnable);

        Switch notificationSwitch = view.findViewById(R.id.setting_pin_able);
        notificationSwitch.setChecked(notificationEnable);

        pinSwitch.setOnCheckedChangeListener(new CompoundButton.OnCheckedChangeListener() {
            @Override
            public void onCheckedChanged(CompoundButton buttonView, boolean isChecked) {
                if(isChecked){
                    sharedPreferences.edit().putBoolean("pinEnable", true).apply();
                    Intent intent = new Intent(getContext(), CustomPinActivity.class);
                    intent.putExtra(AppLock.EXTRA_TYPE, AppLock.ENABLE_PINLOCK);
                    startActivityForResult(intent, 2);
                }else {
                    sharedPreferences.edit().putBoolean("pinEnable", false).apply();
                }
            }
        });

        notificationSwitch.setOnCheckedChangeListener(new CompoundButton.OnCheckedChangeListener() {
            @Override
            public void onCheckedChanged(CompoundButton buttonView, boolean isChecked) {
                if(isChecked){
                    sharedPreferences.edit().putBoolean("notificationEnable", true).apply();
                }else {
                    sharedPreferences.edit().putBoolean("notificationEnable", false).apply();
                }
            }
        });

        return view;
    }
}
