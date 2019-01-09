package com.example.bing.eqin.adapter;

import android.support.annotation.Nullable;
import android.widget.ImageView;

import com.bumptech.glide.Glide;
import com.chad.library.adapter.base.BaseQuickAdapter;
import com.chad.library.adapter.base.BaseViewHolder;
import com.example.bing.eqin.R;
import com.example.bing.eqin.model.MessageItem;
import com.example.bing.eqin.utils.CommonUtils;

import java.util.List;

public class MessageAdapter extends BaseQuickAdapter<MessageItem, BaseViewHolder>{

    public MessageAdapter(int layoutResId, @Nullable List<MessageItem> data) {
        super(layoutResId, data);
    }

    @Override
    protected void convert(BaseViewHolder helper, MessageItem item) {
        helper.setText(R.id.message_item_date, CommonUtils.dateToString(item.getDate()));
        helper.setText(R.id.message_item_info, item.getInfo());
        if(item.getPush())
            Glide.with(mContext).load(R.drawable.push).into((ImageView) helper.itemView.findViewById(R.id.message_item_image));
        else
            Glide.with(mContext).load(R.drawable.operation).into((ImageView) helper.itemView.findViewById(R.id.message_item_image));
    }
}
