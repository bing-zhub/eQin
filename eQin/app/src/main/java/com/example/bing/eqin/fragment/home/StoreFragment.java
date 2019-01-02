package com.example.bing.eqin.fragment.home;

import android.os.Bundle;
import android.support.annotation.NonNull;
import android.support.annotation.Nullable;
import android.support.v4.app.Fragment;
import android.support.v7.widget.LinearLayoutManager;
import android.support.v7.widget.RecyclerView;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;

import com.example.bing.eqin.Adapter.StoreAdapter;
import com.example.bing.eqin.R;
import com.example.bing.eqin.model.StoreItem;

import java.util.LinkedList;
import java.util.List;

public class StoreFragment extends Fragment{

    private RecyclerView storeContainer;

    @Override
    public void onCreate(@Nullable Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
    }

    @Nullable
    @Override
    public View onCreateView(@NonNull LayoutInflater inflater, @Nullable ViewGroup container, @Nullable Bundle savedInstanceState) {
        View view = inflater.inflate(R.layout.fragment_store, container, false);
        storeContainer = view.findViewById(R.id.store_container);
        List<StoreItem> storeItems = new LinkedList<>();
        StoreItem item = new StoreItem();
        item.setItemImg("https://s2.ax1x.com/2019/01/03/FI2BE8.png");
        item.setItemName("温湿度");
        item.setItemPrice(19);
        item.setItemRemain(20);
        storeItems.add(item);
        storeItems.add(item);
        storeItems.add(item);
        storeItems.add(item);
        storeItems.add(item);
        storeItems.add(item);
        storeItems.add(item);
        storeItems.add(item);
        storeItems.add(item);
        storeContainer.setAdapter(new StoreAdapter(R.layout.item_store, storeItems));
        storeContainer.setLayoutManager(new LinearLayoutManager(getContext()));
        return view;
    }
}
