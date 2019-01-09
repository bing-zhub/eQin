package com.example.bing.eqin.fragment.home;

import android.Manifest;
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

import com.example.bing.eqin.R;
import com.example.bing.eqin.fragment.dashboard.ControllerFragment;
import com.example.bing.eqin.fragment.dashboard.SensorFragment;
import com.yanzhenjie.permission.AndPermission;


public class DashboardFragment extends Fragment{



    private TabLayout tabLayout;
    private ViewPager dashboardContainer;
    private SensorFragment sensorFragment;
    private ControllerFragment controllerFragment;

    @Override
    public void onCreate(@Nullable Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        sensorFragment = new SensorFragment();
        controllerFragment = new ControllerFragment();

        AndPermission.with(this)
                .runtime()
                .permission(Manifest.permission.CHANGE_NETWORK_STATE)
                .permission(Manifest.permission.CHANGE_WIFI_STATE)
                .permission(Manifest.permission.ACCESS_NETWORK_STATE)
                .permission(Manifest.permission.ACCESS_WIFI_STATE)
                .permission(Manifest.permission.INTERNET)
                .permission(Manifest.permission.ACCESS_FINE_LOCATION)
                .permission(Manifest.permission.ACCESS_COARSE_LOCATION)
                .start();
    }

    @Nullable
    @Override
    public View onCreateView(@NonNull LayoutInflater inflater, @Nullable ViewGroup container, @Nullable Bundle savedInstanceState) {
        View view = inflater.inflate(R.layout.fragment_dashboard, container, false);

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
        tabLayout.getTabAt(0).setText("传感器").setIcon(R.drawable.sensor);
        tabLayout.getTabAt(1).setText("执行器").setIcon(R.drawable.controller);

        return view;
    }
}
