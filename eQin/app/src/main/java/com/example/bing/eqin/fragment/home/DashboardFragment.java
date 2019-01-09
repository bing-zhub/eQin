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
import android.widget.ImageView;
import android.widget.TextView;

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
        tabLayout.getTabAt(0).setCustomView(makeTabView(0));
        tabLayout.getTabAt(1).setCustomView(makeTabView(1));

        return view;
    }

    private View makeTabView(int position){
        View tabView = LayoutInflater.from(getContext()).inflate(R.layout.tablayout,null);
        TextView textView = tabView.findViewById(R.id.tablayout_text);
        ImageView imageView = tabView.findViewById(R.id.tablayout_image);
        if (position==0)
            textView.setText("传感器");
        else
            textView.setText("执行器");

        if (position==0)
            imageView.setImageResource(R.drawable.sensor);
        else
            imageView.setImageResource(R.drawable.controller);

        return tabView;
    }

}
