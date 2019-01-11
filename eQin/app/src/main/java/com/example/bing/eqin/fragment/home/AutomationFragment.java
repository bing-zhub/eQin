package com.example.bing.eqin.fragment.home;

import android.graphics.Color;
import android.os.Bundle;
import android.support.annotation.NonNull;
import android.support.annotation.Nullable;
import android.support.v4.app.Fragment;
import android.text.Editable;
import android.text.TextWatcher;
import android.util.Log;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.AdapterView;
import android.widget.ArrayAdapter;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.Spinner;
import android.widget.TextView;

import com.afollestad.materialdialogs.DialogAction;
import com.afollestad.materialdialogs.MaterialDialog;
import com.example.bing.eqin.R;
import com.example.bing.eqin.controller.AutomationController;
import com.example.bing.eqin.controller.DeviceController;
import com.example.bing.eqin.model.AutomationItem;
import com.example.bing.eqin.model.DeviceItem;
import com.example.bing.eqin.utils.CommonUtils;

import java.util.LinkedList;
import java.util.List;

public class AutomationFragment extends Fragment{

    private TextView tvThis, tvThat;
    private ImageView ivThis, ivThat, ivConfirm;
    private LinearLayout itemThis, itemThat;
    private AutomationItem automationItem;
    private final String[] limit = {""};
    private List<DeviceItem> deviceItems;


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

        ivConfirm = view.findViewById(R.id.automation_confirm);


        itemThis.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                automationItem = new AutomationItem();
                showThisDialog();
            }
        });

        itemThat.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                showThatDialog();
            }
        });

        ivConfirm.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                AutomationController.getInstance().addAutomation(automationItem);
                CommonUtils.showMessage(getContext(), "添加成功");
                ivConfirm.setVisibility(View.INVISIBLE);
            }
        });

        return view;
    }

    private void showThatDialog() {
        MaterialDialog dialog = new MaterialDialog.Builder(getContext())
                .title("操作")
                .content("在触发条件时执行的操作")
                .items(new String[]{"通知我","操作1", "操作2"})
                .itemsCallback(new MaterialDialog.ListCallback() {
                    @Override
                    public void onSelection(MaterialDialog dialog, View itemView, int position, CharSequence text) {
                        if(position!=0){
                            CommonUtils.showMessage(getContext(), "正待开发");
                            return;
                        }
                        automationItem.setType("info");
                        automationItem.setTargetTopic("");
                        tvThat.setTextColor(Color.GRAY);

                        tvThat.setText("提醒我");
                        ivThat.setImageResource(R.drawable.notification);
                        ivConfirm.setVisibility(View.VISIBLE);
                    }
                })
                .show();
    }

    private void showThisDialog() {
        deviceItems = DeviceController.getInstance().getDevice(true);

        MaterialDialog dialog =  new MaterialDialog.Builder(getContext())
                .customView(R.layout.item_automation_this, false)
                .positiveText("确定")
                .negativeText("取消")
                .onPositive(new MaterialDialog.SingleButtonCallback() {
                    @Override
                    public void onClick(@NonNull MaterialDialog dialog, @NonNull DialogAction which) {
                        automationItem.setCondition(automationItem.getCondition()+limit[0]);
                        toggleStatus();
                        String type = automationItem.getSourceTopic().split("/")[1].equals("humidity")?"湿度":"温度";
                        tvThis.setText(type+automationItem.getCondition());
                        if(type.equals("温度"))
                            ivThis.setImageResource(R.drawable.temperature);
                        else if(type.equals("湿度"))
                            ivThis.setImageResource(R.drawable.humidity);
                    }
                })
                .show();

        Spinner sourceSpinner =  dialog.getCustomView().findViewById(R.id.automation_this_source);
        final List<String> sources = new LinkedList<>();
        for (DeviceItem deviceItem : deviceItems){
            String deviceInfo = CommonUtils.mappingToName(deviceItem.getDeviceType())+"@"+deviceItem.getLocation();
            sources.add(deviceInfo);
        }
        sourceSpinner.setAdapter(new ArrayAdapter<String>(getContext(), android.R.layout.simple_spinner_item,sources));

        sourceSpinner.setOnItemSelectedListener(new AdapterView.OnItemSelectedListener() {
            @Override
            public void onItemSelected(AdapterView<?> parent, View view, int position, long id) {
                automationItem.setSourceTopic(deviceItems.get(position).getTopic());
            }

            @Override
            public void onNothingSelected(AdapterView<?> parent) {

            }
        });

        Spinner conditionSpinner = dialog.getCustomView().findViewById(R.id.automation_this_condition_char);
        final String []conditions = new String[]{">",">=","=","<=","<"};
        conditionSpinner.setAdapter(new ArrayAdapter<String>(getContext(), android.R.layout.simple_spinner_item, conditions));
        conditionSpinner.setOnItemSelectedListener(new AdapterView.OnItemSelectedListener() {
            @Override
            public void onItemSelected(AdapterView<?> parent, View view, int position, long id) {
                automationItem.setCondition(conditions[position]);
            }

            @Override
            public void onNothingSelected(AdapterView<?> parent) {

            }
        });

        TextView limitTV = dialog.getCustomView().findViewById(R.id.automation_this_condition_limit);
        limitTV.addTextChangedListener(new TextWatcher() {
            @Override
            public void beforeTextChanged(CharSequence s, int start, int count, int after) {

            }

            @Override
            public void onTextChanged(CharSequence s, int start, int before, int count) {

            }

            @Override
            public void afterTextChanged(Editable s) {
                limit[0] = s.toString();
            }
        });
    }

    void toggleStatus(){
        tvThis.setTextColor(Color.GRAY);

        tvThat.setTextColor(getResources().getColor(R.color.colorAccent));
        ivThat.setVisibility(View.VISIBLE);
    }


}
