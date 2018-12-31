package com.example.bing.eqin;

import android.app.Fragment;
import android.content.Intent;
import android.content.res.TypedArray;
import android.graphics.drawable.Drawable;
import android.support.annotation.ColorInt;
import android.support.annotation.ColorRes;
import android.support.annotation.Nullable;
import android.support.v4.content.ContextCompat;
import android.support.v4.view.PagerAdapter;
import android.support.v4.view.ViewPager;
import android.support.v7.app.AppCompatActivity;
import android.os.Bundle;
import android.support.v7.widget.LinearLayoutManager;
import android.support.v7.widget.RecyclerView;
import android.support.v7.widget.Toolbar;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.ImageView;
import android.widget.TextView;
import android.widget.Toast;

import com.bumptech.glide.Glide;
import com.example.bing.eqin.activity.LoginSignUpActivity;
import com.example.bing.eqin.fragment.CenteredTextFragment;
import com.example.bing.eqin.fragment.home.HomeFragment;
import com.example.bing.eqin.fragment.settings.SettingFragment;
import com.example.bing.eqin.menu.DrawerAdapter;
import com.example.bing.eqin.menu.DrawerItem;
import com.example.bing.eqin.menu.SimpleItem;
import com.example.bing.eqin.menu.SpaceItem;
import com.example.bing.eqin.model.UserProfile;
import com.example.bing.eqin.utils.CommonUtils;
import com.example.bing.eqin.views.CircleImageview;
import com.yarolegovich.slidingrootnav.SlidingRootNav;
import com.yarolegovich.slidingrootnav.SlidingRootNavBuilder;
import java.util.ArrayList;
import java.util.Arrays;

import devlight.io.library.ntb.NavigationTabBar;

public class MainActivity extends AppCompatActivity implements DrawerAdapter.OnItemSelectedListener{

    private static final int POS_HOME = 0;
    private static final int POS_SETTING = 1;
    private static final int POS_MESSAGES = 2;
    private static final int POS_CART = 3;
    private static final int POS_LOGOUT = 5;
    private static final int LOGIN_REQUEST_CODE = 0;

    private String[] screenTitles;
    private Drawable[] screenIcons;
    private Toolbar toolbar;
    private TextView toolbarTitle, userNickname;
    private SlidingRootNav slidingRootNav;
    private CircleImageview userAvatar;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);

        setConfigToLeftDrawer(savedInstanceState);


    }

    private void setConfigToLeftDrawer(Bundle savedInstanceState) {
        toolbar = findViewById(R.id.toolbar);
        toolbarTitle = findViewById(R.id.toolbar_title);


        toolbar.setTitle("");
        toolbarTitle.setText("鹅寝");
        setSupportActionBar(toolbar);

        slidingRootNav = new SlidingRootNavBuilder(this)
                .withToolbarMenuToggle(toolbar)
                .withMenuOpened(false)
                .withContentClickableWhenMenuOpened(false)
                .withSavedState(savedInstanceState)
                .withMenuLayout(R.layout.menu_left_drawer)
                .inject();

        View slidingNav =  slidingRootNav.getLayout().getRootView();
        userAvatar = slidingNav.findViewById(R.id.user_avatar);
        userNickname = slidingNav.findViewById(R.id.user_nickname);

        screenIcons = loadScreenIcons();
        screenTitles = loadScreenTitles();

        DrawerAdapter adapter = new DrawerAdapter(Arrays.asList(
                createItemFor(POS_HOME).setChecked(true),
                createItemFor(POS_SETTING),
                createItemFor(POS_MESSAGES),
                createItemFor(POS_CART),
                new SpaceItem(48),
                createItemFor(POS_LOGOUT)));
        adapter.setListener(this);

        RecyclerView list = findViewById(R.id.list);
        list.setNestedScrollingEnabled(false);
        list.setLayoutManager(new LinearLayoutManager(this));
        list.setAdapter(adapter);
        adapter.setSelected(POS_HOME);

        userAvatar.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                startActivityForResult(new Intent(MainActivity.this, LoginSignUpActivity.class), LOGIN_REQUEST_CODE);
            }
        });
    }

    @Override
    public void onItemSelected(int position) {
        if (position == POS_LOGOUT) {
            finish();
        }

        slidingRootNav.closeMenu();

        if(position == POS_HOME){
            HomeFragment homeFragment = new HomeFragment();
            getSupportFragmentManager().beginTransaction().replace(R.id.container, homeFragment).commit();
        }else if(position == POS_SETTING){
            SettingFragment settingFragment = new SettingFragment();
            getSupportFragmentManager().beginTransaction().replace(R.id.container, settingFragment).commit();
        }

    }


    private DrawerItem createItemFor(int position) {
        return new SimpleItem(screenIcons[position], screenTitles[position])
                .withIconTint(color(R.color.textColorSecondary))
                .withTextTint(color(R.color.textColorPrimary))
                .withSelectedIconTint(color(R.color.colorAccent))
                .withSelectedTextTint(color(R.color.colorAccent));
    }

    private String[] loadScreenTitles() {
        return getResources().getStringArray(R.array.ld_activityScreenTitles);
    }

    private Drawable[] loadScreenIcons() {
        TypedArray ta = getResources().obtainTypedArray(R.array.ld_activityScreenIcons);
        Drawable[] icons = new Drawable[ta.length()];
        for (int i = 0; i < ta.length(); i++) {
            int id = ta.getResourceId(i, 0);
            if (id != 0) {
                icons[i] = ContextCompat.getDrawable(this, id);
            }
        }
        ta.recycle();
        return icons;
    }

    @ColorInt
    private int color(@ColorRes int res) {
        return ContextCompat.getColor(this, res);
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, @Nullable Intent data) {
        if(resultCode == 0) {
            if(requestCode == LOGIN_REQUEST_CODE){
                if(data!=null){
                    String userAvatarUrl = data.getStringExtra("userAvatar");
                    String nickname = data.getStringExtra("userNickname");
                    Glide.with(this).load(userAvatarUrl).into(userAvatar);
                    userNickname.setText(nickname.replace(" ",""));
                    CommonUtils.showMessage(MainActivity.this, "登录成功");
                }else{
                    CommonUtils.showMessage(MainActivity.this, "取消登录");
                }
            }
        }
        slidingRootNav.closeMenu();
        super.onActivityResult(requestCode, resultCode, data);
    }
}
