package com.example.bing.eqin.fragment.home;

import android.app.PendingIntent;
import android.content.Intent;
import android.graphics.Color;
import android.os.Bundle;
import android.support.annotation.NonNull;
import android.support.annotation.Nullable;
import android.support.v4.app.Fragment;
import android.support.v4.app.NotificationCompat;
import android.support.v4.app.NotificationManagerCompat;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;

import com.afollestad.materialdialogs.MaterialDialog;
import com.example.bing.eqin.MainActivity;
import com.example.bing.eqin.R;
import com.example.bing.eqin.utils.CommonUtils;

public class AutomationFragment extends Fragment{

    private TextView tvThis, tvThat;
    private ImageView ivThis, ivThat;
    private LinearLayout itemThis, itemThat;

    @Override
    public void onCreate(@Nullable Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
    }

    @Nullable
    @Override
    public View onCreateView(@NonNull LayoutInflater inflater, @Nullable ViewGroup container, @Nullable Bundle savedInstanceState) {
        View view = inflater.inflate(R.layout.fragment_automation, container, false);

        tvThat = view.findViewById(R.id.automation_that_choice);
        tvThis = view.findViewById(R.id.automation_this_choice);

        ivThat = view.findViewById(R.id.automation_that_image);
        ivThis = view.findViewById(R.id.automation_this_image);

        itemThat = view.findViewById(R.id.automation_that_item);
        itemThis = view.findViewById(R.id.automation_this_item);

        itemThis.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                CommonUtils.startNotification(getContext(), "标题", "内容");
            }
        });

        return view;
    }


}
