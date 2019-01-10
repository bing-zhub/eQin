package com.example.bing.eqin.fragment.home;

import android.graphics.Color;
import android.os.Bundle;
import android.support.annotation.NonNull;
import android.support.annotation.Nullable;
import android.support.v4.app.Fragment;
import android.text.Editable;
import android.text.TextWatcher;
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
import com.example.bing.eqin.controller.DeviceController;
import com.example.bing.eqin.model.AutomationItem;
import com.example.bing.eqin.utils.CommonUtils;

import java.util.LinkedList;
import java.util.List;

public class AutomationFragment extends Fragment{

    private TextView tvThis, tvThat;
    private ImageView ivThis, ivThat;
    private LinearLayout itemThis, itemThat;
    private AutomationItem automationItem;

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
                automationItem = new AutomationItem();
                final String[] limit = {""};

                MaterialDialog dialog =  new MaterialDialog.Builder(getContext())
                        .customView(R.layout.item_automation_this, false)
                        .positiveText("确定")
                        .negativeText("取消")
                        .onPositive(new MaterialDialog.SingleButtonCallback() {
                            @Override
                            public void onClick(@NonNull MaterialDialog dialog, @NonNull DialogAction which) {
                                automationItem.setCondition(automationItem.getCondition()+limit[0]);
                                CommonUtils.showMessage(getContext(), automationItem.getSourceTopic() + " "+ automationItem.getCondition());
                                toggleStatus();
                            }
                        })
                        .show();

                Spinner sourceSpinner =  dialog.getCustomView().findViewById(R.id.automation_this_source);
                final List<String> sources = new LinkedList<>();
                sources.addAll(DeviceController.getInstance().getDeviceInfo());
                sourceSpinner.setAdapter(new ArrayAdapter<String>(getContext(), android.R.layout.simple_spinner_item,sources));

                sourceSpinner.setOnItemSelectedListener(new AdapterView.OnItemSelectedListener() {
                    @Override
                    public void onItemSelected(AdapterView<?> parent, View view, int position, long id) {
                        automationItem.setSourceTopic(sources.get(position));
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
        });

        return view;
    }

    void toggleStatus(){
        tvThis.setTextColor(Color.GRAY);
        ivThis.setVisibility(View.INVISIBLE);

        tvThat.setTextColor(getResources().getColor(R.color.colorAccent));
        ivThat.setVisibility(View.VISIBLE);
    }


}
