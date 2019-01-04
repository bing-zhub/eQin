package com.example.bing.eqin.fragment.home;

import android.os.Bundle;
import android.support.annotation.NonNull;
import android.support.annotation.Nullable;
import android.support.design.widget.TabLayout;
import android.support.v4.app.Fragment;
import android.support.v4.app.FragmentPagerAdapter;
import android.support.v4.view.ViewPager;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Toast;

import com.example.bing.eqin.R;
import com.example.bing.eqin.fragment.dashboard.ControllerFragment;
import com.example.bing.eqin.fragment.dashboard.SensorFragment;
import com.example.bing.eqin.fragment.settings.SettingFragment;
import com.example.bing.eqin.model.MQTTDataItem;

import org.greenrobot.eventbus.Subscribe;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.ArrayList;

import static com.parse.Parse.getApplicationContext;

public class MessageFragment extends Fragment{

    private TabLayout tabLayout;
    private ViewPager dashboardContainer;
    private SensorFragment sensorFragment;
    private ControllerFragment controllerFragment;

    @Override
    public void onCreate(@Nullable Bundle savedInstanceState) {
        sensorFragment = new SensorFragment();
        controllerFragment = new ControllerFragment();
        super.onCreate(savedInstanceState);
    }

    @Nullable
    @Override
    public View onCreateView(@NonNull LayoutInflater inflater, @Nullable ViewGroup container, @Nullable Bundle savedInstanceState) {
        View view = inflater.inflate(R.layout.fragment_message, container, false);
        tabLayout = view.findViewById(R.id.dashboard_tab_layout);
        dashboardContainer = view.findViewById(R.id.dashboard_container);

        tabLayout.addTab(tabLayout.newTab());
        tabLayout.addTab(tabLayout.newTab());


        FragmentPagerAdapter adapter = new FragmentPagerAdapter(getChildFragmentManager()) {
            @Override
            public Fragment getItem(int i) {
                if(i==0)
                    return sensorFragment;
                else
                    return controllerFragment;
            }

            @Override
            public int getCount() {
                return 2;
            }
        };

        dashboardContainer.setAdapter(adapter);
        tabLayout.setupWithViewPager(dashboardContainer);
        tabLayout.getTabAt(0).setText("传感器");
        tabLayout.getTabAt(1).setText("执行器");

        return view;
    }


}
