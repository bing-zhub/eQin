package com.example.bing.eqin.adapter;

import android.support.annotation.Nullable;
import android.widget.ImageView;

import com.bumptech.glide.Glide;
import com.chad.library.adapter.base.BaseQuickAdapter;
import com.chad.library.adapter.base.BaseViewHolder;
import com.example.bing.eqin.R;
import com.example.bing.eqin.model.CartItem;

import java.util.List;

public class CartAdapter extends BaseQuickAdapter<CartItem, BaseViewHolder> {

    public CartAdapter(int layoutResId, @Nullable List<CartItem> data) {
        super(layoutResId, data);
    }

    @Override
    protected void convert(BaseViewHolder helper, CartItem item) {
        helper.setText(R.id.cart_item_name, item.getProduct().getItemName());
        helper.setText(R.id.cart_item_price, item.getProduct().getItemPrice()+"¥");
        helper.setText(R.id.cart_item_remain, "剩余: "+item.getProduct().getItemRemain()+"套");
        helper.setText(R.id.cart_item_total, item.getNum()+"");
        helper.addOnClickListener(R.id.cart_item_add);
        helper.addOnClickListener(R.id.cart_item_minus);
        helper.addOnClickListener(R.id.cart_item_delete);
        Glide.with(mContext).load(item.getProduct().getItemImg()).into((ImageView) helper.getView(R.id.cart_item_image));
    }
}
