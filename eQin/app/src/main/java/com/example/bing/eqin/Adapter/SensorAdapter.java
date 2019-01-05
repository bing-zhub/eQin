package com.example.bing.eqin.adapter;

import android.support.annotation.Nullable;
import android.widget.ImageView;

import com.bumptech.glide.Glide;
import com.chad.library.adapter.base.BaseQuickAdapter;
import com.chad.library.adapter.base.BaseViewHolder;
import com.example.bing.eqin.R;
import com.example.bing.eqin.model.SensorItem;

import java.util.List;

public class SensorAdapter extends BaseQuickAdapter<SensorItem, BaseViewHolder> {

    public SensorAdapter(int layoutResId, @Nullable List<SensorItem> data) {
        super(layoutResId, data);
    }

    @Override
    protected void convert(BaseViewHolder helper, SensorItem item) {
        helper.setText(R.id.sensor_item_data, item.getData());
        helper.setText(R.id.sensor_item_location, item.getDeviceItem().getLocation());
        helper.setText(R.id.sensor_item_type, item.getDeviceItem().getDeviceType());
        helper.setText(R.id.sensor_item_note, item.getDeviceItem().getNote());
        helper.addOnLongClickListener(R.id.sensor_item_location);
        helper.addOnLongClickListener(R.id.sensor_item_note);
        if(item.getDeviceItem().getDeviceType()!=null)
            if(item.getDeviceItem().getDeviceType().equals("湿度"))
                Glide.with(mContext).load(R.drawable.humidity).into((ImageView) helper.getView(R.id.sensor_item_img));
            else if(item.getDeviceItem().getDeviceType().equals("温度"))
                Glide.with(mContext).load(R.drawable.temperature).into((ImageView) helper.getView(R.id.sensor_item_img));
    }
}
