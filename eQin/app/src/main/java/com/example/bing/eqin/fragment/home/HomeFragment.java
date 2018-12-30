package com.example.bing.eqin.fragment.home;

import android.os.Bundle;
import android.support.annotation.NonNull;
import android.support.annotation.Nullable;
import android.support.v4.app.Fragment;
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
        final ViewPager viewPager = (ViewPager) view.findViewById(R.id.vp_horizontal_ntb);
        viewPager.setAdapter(new PagerAdapter() {
            @Override
            public int getCount() {
                return 5;
            }

            @Override
            public boolean isViewFromObject(final View view, final Object object) {
                return view.equals(object);
            }

            @Override
            public void destroyItem(final View container, final int position, final Object object) {
                ((ViewPager) container).removeView((View) object);
            }

            @Override
            public Object instantiateItem(final ViewGroup container, final int position) {
                final View view = LayoutInflater.from(
                        getContext()).inflate(R.layout.item_vp, null, false);

                final TextView txtPage = (TextView) view.findViewById(R.id.txt_vp_item_page);
                txtPage.setText(String.format("Page #%d", position));

                container.addView(view);
                return view;
            }
        });

        final NavigationTabBar navigationTabBar = view.findViewById(R.id.ntb);
        final ArrayList<NavigationTabBar.Model> models = new ArrayList<>();
        models.add(
                new NavigationTabBar.Model.Builder(
                        getResources().getDrawable(R.drawable.ic_account_circle_black_24dp),
                        R.color.colorAccent
                ).title("我")
                        .build()
        );
        models.add(
                new NavigationTabBar.Model.Builder(
                        getResources().getDrawable(R.drawable.ic_home_black_24dp),
                        R.color.colorAccent
                ).title("主页")
                        .build()
        );
        models.add(
                new NavigationTabBar.Model.Builder(
                        getResources().getDrawable(R.drawable.ic_settings_black_24dp),
                        R.color.colorAccent
                ).title("设置")
                        .build()
        );
        navigationTabBar.setModels(models);
        navigationTabBar.setModelIndex(1, true);
        navigationTabBar.setViewPager(viewPager, 1);
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
//        navigationTabBar.setOnTabBarSelectedIndexListener(new NavigationTabBar.OnTabBarSelectedIndexListener() {
//            @Override
//            public void onStartTabSelected(final NavigationTabBar.Model model, final int index) {
//
//            }
//
//            @Override
//            public void onEndTabSelected(final NavigationTabBar.Model model, final int index) {
//                Toast.makeText(MainActivity.this, String.format("onEndTabSelected #%d", index), Toast.LENGTH_SHORT).show();
//            }
//        });
    }
}
