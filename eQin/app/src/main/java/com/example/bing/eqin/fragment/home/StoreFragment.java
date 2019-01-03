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

import com.chad.library.adapter.base.BaseQuickAdapter;
import com.example.bing.eqin.adapter.StoreAdapter;
import com.example.bing.eqin.R;
import com.example.bing.eqin.controller.CartController;
import com.example.bing.eqin.model.StoreItem;
import com.example.bing.eqin.utils.CommonUtils;
import com.parse.FindCallback;
import com.parse.ParseException;
import com.parse.ParseObject;
import com.parse.ParseQuery;

import java.util.LinkedList;
import java.util.List;

public class StoreFragment extends Fragment{

    private RecyclerView storeContainer;
    private StoreAdapter adapter;

    @Override
    public void onCreate(@Nullable Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
    }

    @Nullable
    @Override
    public View onCreateView(@NonNull LayoutInflater inflater, @Nullable ViewGroup container, @Nullable Bundle savedInstanceState) {
        View view = inflater.inflate(R.layout.fragment_store, container, false);
        storeContainer = view.findViewById(R.id.store_container);
        final List<StoreItem> storeItems = new LinkedList<>();
        ParseQuery<ParseObject> query = ParseQuery.getQuery("StoreItem");

        query.findInBackground(new FindCallback<ParseObject>() {
            @Override
            public void done(List<ParseObject> objects, ParseException e) {
                if(objects!=null && objects.size()!=0 && e==null){
                    for (ParseObject object: objects){
                        StoreItem storeItem = new StoreItem();
                        storeItem.setItemRemain(object.getInt("remain"));
                        storeItem.setItemPrice(object.getInt("price"));
                        storeItem.setItemName(object.getString("name"));
                        storeItem.setItemImg(object.getString("img"));
                        storeItems.add(storeItem);
                    }
                    if(adapter!=null){
                        adapter.notifyDataSetChanged();
                    }
                }
            }
        });

        adapter = new StoreAdapter(R.layout.item_store, storeItems);
        adapter.setOnItemChildClickListener(new BaseQuickAdapter.OnItemChildClickListener() {
            @Override
            public void onItemChildClick(BaseQuickAdapter adapter, View view, int position) {
                CartController.getInstance().addToCart(storeItems.get(position), getContext());
            }
        });
        storeContainer.setAdapter(adapter);
        storeContainer.setLayoutManager(new LinearLayoutManager(getContext()));
        return view;
    }
}
