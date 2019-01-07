package com.example.bing.eqin.adapter;

import android.support.annotation.Nullable;
import android.widget.ImageView;

import com.bumptech.glide.Glide;
import com.chad.library.adapter.base.BaseQuickAdapter;
import com.chad.library.adapter.base.BaseViewHolder;
import com.example.bing.eqin.R;
import com.example.bing.eqin.model.ControllerItem;

import java.util.List;

public class ControllerAdapter extends BaseQuickAdapter<ControllerItem, BaseViewHolder> {

    public ControllerAdapter(int layoutResId, @Nullable List<ControllerItem> data) {
        super(layoutResId, data);
    }

    @Override
    protected void convert(BaseViewHolder helper, ControllerItem item) {
        helper.setText(R.id.controller_item_data, item.getData());
        helper.setText(R.id.controller_item_location, item.getDeviceItem().getLocation());
        helper.setText(R.id.controller_item_type, item.getDeviceItem().getDeviceType());
        helper.setText(R.id.controller_item_note, item.getDeviceItem().getNote());
        helper.addOnLongClickListener(R.id.controller_item_location);
        helper.addOnLongClickListener(R.id.controller_item_note);
        if(item.getDeviceItem().getDeviceType()!=null)
            if(item.getDeviceItem().getDeviceType().equals("开关"))
                Glide.with(mContext).load(R.drawable.mode).into((ImageView) helper.getView(R.id.controller_item_img));
            else if(item.getDeviceItem().getDeviceType().equals("颜色"))
                Glide.with(mContext).load(R.drawable.color).into((ImageView) helper.getView(R.id.controller_item_img));
            else if(item.getDeviceItem().getDeviceType().equals("滑动条"))
                Glide.with(mContext).load(R.drawable.brightness).into((ImageView) helper.getView(R.id.controller_item_img));
    }
}
