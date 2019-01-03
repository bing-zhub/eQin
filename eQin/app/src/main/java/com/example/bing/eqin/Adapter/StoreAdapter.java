package com.example.bing.eqin.adapter;

import android.support.annotation.Nullable;
import android.widget.ImageView;

import com.bumptech.glide.Glide;
import com.chad.library.adapter.base.BaseQuickAdapter;
import com.chad.library.adapter.base.BaseViewHolder;
import com.example.bing.eqin.R;
import com.example.bing.eqin.model.StoreItem;

import java.util.List;

public class StoreAdapter extends BaseQuickAdapter<StoreItem, BaseViewHolder> {

    public StoreAdapter(int layoutResId, @Nullable List<StoreItem> data) {
        super(layoutResId, data);
    }

    @Override
    protected void convert(BaseViewHolder helper, StoreItem item) {
        helper.setText(R.id.store_item_name, item.getItemName());
        helper.setText(R.id.store_item_price, item.getItemPrice()+"¥");
        helper.setText(R.id.store_item_remain, "剩余: "+item.getItemRemain()+"套");
        helper.addOnClickListener(R.id.store_item_add);
        Glide.with(mContext).load(item.getItemImg()).into((ImageView) helper.getView(R.id.store_item_image));
    }
}
