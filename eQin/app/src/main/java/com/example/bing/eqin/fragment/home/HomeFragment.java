package com.example.bing.eqin.fragment.home;

import android.os.Bundle;
import android.support.annotation.NonNull;
import android.support.annotation.Nullable;
import android.support.v4.app.Fragment;
import android.support.v4.app.FragmentPagerAdapter;
import android.support.v4.view.PagerAdapter;
import android.support.v4.view.ViewPager;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.TextView;
import android.widget.Toast;

import com.example.bing.eqin.MainActivity;
import com.example.bing.eqin.R;

import java.util.ArrayList;

import devlight.io.library.ntb.NavigationTabBar;

public class HomeFragment extends Fragment{

    @Override
    public void onCreate(@Nullable Bundle savedInstanceState) {
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
        final ViewPager viewPager =  view.findViewById(R.id.vp_horizontal_ntb);
        viewPager.setAdapter(new FragmentPagerAdapter(getFragmentManager()) {
            @Override
            public Fragment getItem(int i) {
                if(i==0){
                    return new CartFragment();
                }else if(i==1){
                    return new MessageFragment();
                }else if(i==2){
                    return new AboutFragment();
                }else{
                    return new CartFragment();
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
        navigationTabBar.setModels(models);
        navigationTabBar.setModelIndex(0, true);
        navigationTabBar.setViewPager(viewPager, 0);
        navigationTabBar.setOnPageChangeListener(new ViewPager.OnPageChangeListener() {
            @Override
            public void onPageScrolled(final int position, final float positionOffset, final int positionOffsetPixels) {

            }

            @Override
            public void onPageSelected(final int position) {
                Toast.makeText(getActivity(), "position"+position, Toast.LENGTH_SHORT).show();
            }

            @Override
            public void onPageScrollStateChanged(final int state) {

            }
        });
    }
}
