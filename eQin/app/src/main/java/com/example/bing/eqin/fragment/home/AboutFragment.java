package com.example.bing.eqin.fragment.home;

import android.os.Bundle;
import android.support.annotation.NonNull;
import android.support.annotation.Nullable;
import android.support.v4.app.Fragment;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;

import com.example.bing.eqin.R;

import mehdi.sakout.aboutpage.AboutPage;
import mehdi.sakout.aboutpage.Element;

public class AboutFragment extends Fragment {
    @Override
    public void onCreate(@Nullable Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
    }

    @Nullable
    @Override
    public View onCreateView(@NonNull LayoutInflater inflater, @Nullable ViewGroup container, @Nullable Bundle savedInstanceState) {
        Element versionElement = new Element();
        versionElement.setTitle("版本 0.0.1");
        View aboutPage = new AboutPage(getActivity())
                .isRTL(false)
                .setImage(R.drawable.e)
                .addItem(versionElement)
                .setDescription("这是一个基于MQTT协议实现的物联网应用~ 旨在打造一个略带智能的寝室 它可以帮你监控并收集寝室多种环境数据. 同时也可以控制寝室中的各种电器.")
                .addGroup("联系我")
                .addEmail("bing.zhub@gmail.com")
                .addWebsite("http://www.zshaopingb.cn/")
                .addGitHub("bing-zhub")
                .create();
        return aboutPage;
    }
}
