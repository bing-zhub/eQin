package com.example.bing.eqin.fragment.home;

import android.os.Bundle;
import android.support.annotation.NonNull;
import android.support.annotation.Nullable;
import android.support.v4.app.Fragment;
import android.support.v4.app.FragmentPagerAdapter;
import android.support.v4.app.FragmentTransaction;
import android.support.v4.view.PagerAdapter;
import android.support.v4.view.ViewPager;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.TextView;
import android.widget.Toast;

import com.example.bing.eqin.MainActivity;
import com.example.bing.eqin.R;
import com.example.bing.eqin.views.CustomViewPager;

import java.util.ArrayList;

import devlight.io.library.ntb.NavigationTabBar;

public class HomeFragment extends Fragment{

    private DashboardFragment dashboardFragment;
    private StoreFragment storeFragment;
    private AutomationFragment automationFragment;
    private MeFragment meFragment;


    @Override
    public void onCreate(@Nullable Bundle savedInstanceState) {
        dashboardFragment = new DashboardFragment();
        storeFragment = new StoreFragment();
        automationFragment = new AutomationFragment();
        meFragment = new MeFragment();

        super.onCreate(savedInstanceState);
    }

    @Nullable
    @Override
    public View onCreateView(@NonNull LayoutInflater inflater, @Nullable ViewGroup container, @Nullable Bundle savedInstanceState) {
        View view = inflater.inflate(R.layout.fragment_home, container, false);
        setConfigToNavigationTabBar(view);
        return view;
    }

    private void setConfigToNavigationTabBar(View view) {
        final CustomViewPager viewPager =  view.findViewById(R.id.vp_horizontal_ntb);
        viewPager.setScanScroll(false);
        viewPager.setAdapter(new FragmentPagerAdapter(getFragmentManager()) {
            @Override
            public Fragment getItem(int i) {
                if(i==0){
                    return dashboardFragment;
                }else if(i==1){
                    return storeFragment;
                }else if(i==2){
                    return automationFragment;
                }else if(i==3){
                    return meFragment;
                }else{
                    return null;
                }
            }

            @Override
            public int getCount() {
                return 4;
            }
        });

        final NavigationTabBar navigationTabBar = view.findViewById(R.id.ntb);
        final ArrayList<NavigationTabBar.Model> models = new ArrayList<>();
        models.add(
                new NavigationTabBar.Model.Builder(
                        getResources().getDrawable(R.drawable.ic_home_black_24dp),
                        R.color.colorAccent
                ).title("主页")
                        .build()
        );
        models.add(
                new NavigationTabBar.Model.Builder(
                        getResources().getDrawable(R.drawable.ic_add_shopping_cart_black_24dp),
                        R.color.colorAccent
                ).title("商店")
                        .build()
        );
        models.add(
                new NavigationTabBar.Model.Builder(
                        getResources().getDrawable(R.drawable.ic_dashboard_black_24dp),
                        R.color.colorAccent
                ).title("自动化")
                        .build()
        );
        models.add(
                new NavigationTabBar.Model.Builder(
                        getResources().getDrawable(R.drawable.ic_account_circle_black_24dp),
                        R.color.colorAccent
                ).title("我")
                        .build()
        );
        navigationTabBar.setIsSwiped(false);
        navigationTabBar.setModels(models);
        navigationTabBar.setModelIndex(0, true);
        navigationTabBar.setViewPager(viewPager, 0);
    }
}
