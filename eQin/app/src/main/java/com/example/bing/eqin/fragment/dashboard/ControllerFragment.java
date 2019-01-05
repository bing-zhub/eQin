package com.example.bing.eqin.fragment.dashboard;

import android.content.Context;
import android.graphics.Color;
import android.os.Bundle;
import android.os.Handler;
import android.os.Message;
import android.support.annotation.NonNull;
import android.support.annotation.Nullable;
import android.support.v4.app.Fragment;
import android.support.v4.widget.SwipeRefreshLayout;
import android.support.v7.widget.LinearLayoutManager;
import android.support.v7.widget.RecyclerView;
import android.util.Log;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.SeekBar;
import android.widget.Toast;

import com.afollestad.materialdialogs.DialogAction;
import com.afollestad.materialdialogs.MaterialDialog;
import com.afollestad.materialdialogs.color.ColorChooserDialog;
import com.chad.library.adapter.base.BaseQuickAdapter;
import com.example.bing.eqin.MainActivity;
import com.example.bing.eqin.R;
import com.example.bing.eqin.adapter.ControllerAdapter;
import com.example.bing.eqin.controller.DeviceController;
import com.example.bing.eqin.model.DeviceItem;
import com.example.bing.eqin.model.ControllerItem;
import com.example.bing.eqin.utils.CommonUtils;
import com.example.bing.eqin.utils.ItemDecoration;

import java.util.LinkedList;
import java.util.List;

public class ControllerFragment extends Fragment implements ColorChooserDialog.ColorCallback{

    private RecyclerView controllerContainer;
    private SwipeRefreshLayout controllerSwipeRefreshLayout;
    List<ControllerItem> controllerItems = new LinkedList<>();
    private ControllerAdapter controllerAdapter;
    private MainActivity mainActivity;
    private int colorPos;
    Handler handler = new Handler(new Handler.Callback() {
        @Override
        public boolean handleMessage(Message msg) {
            Bundle bundle = msg.getData();
            int color = bundle.getInt("color");
            if (color != 0) {
                controllerItems.get(colorPos).setData(CommonUtils.argbToHex(color));
                // TODO
                controllerAdapter.notifyDataSetChanged();
            }
            return false;
        }
    });




    @Override
    public void onCreate(@Nullable Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
    }

    @Override
    public void onAttach(Context context) {
        super.onAttach(context);
        mainActivity = (MainActivity) context;
        mainActivity.setHandler(handler);
    }

    @Nullable
    @Override
    public View onCreateView(@NonNull LayoutInflater inflater, @Nullable ViewGroup container, @Nullable Bundle savedInstanceState) {
        View view = inflater.inflate(R.layout.fragment_controller, container, false);
        getData();
        controllerContainer = view.findViewById(R.id.controller_container);
        controllerSwipeRefreshLayout = view.findViewById(R.id.controller_swipe_refresh);
        controllerSwipeRefreshLayout.setOnRefreshListener(new SwipeRefreshLayout.OnRefreshListener() {
            @Override
            public void onRefresh() {
                getData();
                controllerSwipeRefreshLayout.setRefreshing(false);
                CommonUtils.showMessage(getContext(), "刷新完成");
            }
        });
        controllerAdapter = new ControllerAdapter(R.layout.item_controller, controllerItems);
        controllerAdapter.bindToRecyclerView(controllerContainer);
        controllerContainer.setLayoutManager(new LinearLayoutManager(getContext()));
        controllerAdapter.setEmptyView(R.layout.item_empty, (ViewGroup)controllerContainer.getParent());
        controllerAdapter.addHeaderView(inflater.inflate(R.layout.item_header, (ViewGroup)controllerContainer.getParent(), false));
        controllerContainer.addItemDecoration(new ItemDecoration(30));
        controllerAdapter.setOnItemClickListener(new BaseQuickAdapter.OnItemClickListener() {
            @Override
            public void onItemClick(BaseQuickAdapter adapter, View view, int position) {
                ControllerItem controllerItem =  controllerItems.get(position);
                switch (controllerItem.getDeviceItem().getDeviceType()){
                    case "开关":
                        new MaterialDialog.Builder(getContext())
                                .items(new String[]{"开", "关"})
                                .itemsCallback(new MaterialDialog.ListCallback() {
                                    @Override
                                    public void onSelection(MaterialDialog dialog, View view, int which, CharSequence text) {
                                        CommonUtils.showMessage(getContext(), which+" "+text);
                                        // TODO
                                    }
                                })
                                .show();

                        break;
                    case "颜色":
                        colorPos = position;
                        new ColorChooserDialog.Builder(getContext(), R.string.app_name)
                                .customButton(R.string.md_custom_label)
                                .presetsButton(R.string.md_presets_label)
                                .show(getFragmentManager());
                        break;
                    case "滑动条":
                        // TODO
                        MaterialDialog dialog =  new MaterialDialog.Builder(getContext())
                                .customView(R.layout.item_slide, false)
                                .show();
                        SeekBar seekBar =  dialog.getCustomView().findViewById(R.id.seekBar);
                        seekBar.setOnSeekBarChangeListener(new SeekBar.OnSeekBarChangeListener() {
                            @Override
                            public void onProgressChanged(SeekBar seekBar, int progress, boolean fromUser) {
                                CommonUtils.showMessage(getContext(), ""+progress);
                            }

                            @Override
                            public void onStartTrackingTouch(SeekBar seekBar) {

                            }

                            @Override
                            public void onStopTrackingTouch(SeekBar seekBar) {

                            }
                        });
                        break;
                }
            }
        });

        controllerAdapter.setOnItemChildLongClickListener(new BaseQuickAdapter.OnItemChildLongClickListener() {
            @Override
            public boolean onItemChildLongClick(BaseQuickAdapter adapter, View view, int position) {
                final ControllerItem controllerItem =  controllerAdapter.getItem(position);
                if(view.getId() == R.id.controller_item_location){
                    new MaterialDialog.Builder(getContext())
                            .title("修改位置")
                            .positiveText("确认")
                            .negativeText("取消")
                            .input(null, controllerItem.getDeviceItem().getLocation(), true, new MaterialDialog.InputCallback() {
                                @Override
                                public void onInput(@NonNull MaterialDialog dialog, CharSequence input) {

                                }
                            })
                            .onPositive(new MaterialDialog.SingleButtonCallback() {
                                @Override
                                public void onClick(@NonNull MaterialDialog dialog, @NonNull DialogAction which) {
                                    controllerItem.getDeviceItem().setLocation(dialog.getInputEditText().getText().toString());
                                    DeviceController.getInstance().updateDevice(controllerItem.getDeviceItem().getObjectId(), controllerItem.getDeviceItem());
                                    controllerAdapter.notifyDataSetChanged();
                                    CommonUtils.showMessage(getContext(), dialog.getInputEditText().getText().toString());
                                }
                            })
                            .onNegative(new MaterialDialog.SingleButtonCallback() {
                                @Override
                                public void onClick(@NonNull MaterialDialog dialog, @NonNull DialogAction which) {
                                    CommonUtils.showMessage(getContext(), "取消");
                                }
                            })
                            .show();
                }else if(view.getId() == R.id.controller_item_note){
                    new MaterialDialog.Builder(getContext())
                            .title("修改备注")
                            .positiveText("确认")
                            .negativeText("取消")
                            .input(null, controllerItem.getDeviceItem().getNote(), true, new MaterialDialog.InputCallback() {
                                @Override
                                public void onInput(@NonNull MaterialDialog dialog, CharSequence input) {

                                }
                            })
                            .onPositive(new MaterialDialog.SingleButtonCallback() {
                                @Override
                                public void onClick(@NonNull MaterialDialog dialog, @NonNull DialogAction which) {
                                    controllerItem.getDeviceItem().setNote(dialog.getInputEditText().getText().toString());
                                    DeviceController.getInstance().updateDevice(controllerItem.getDeviceItem().getObjectId(), controllerItem.getDeviceItem());
                                    controllerAdapter.notifyDataSetChanged();
                                    CommonUtils.showMessage(getContext(), dialog.getInputEditText().getText().toString());
                                }
                            })
                            .onNegative(new MaterialDialog.SingleButtonCallback() {
                                @Override
                                public void onClick(@NonNull MaterialDialog dialog, @NonNull DialogAction which) {
                                    CommonUtils.showMessage(getContext(), "取消");
                                }
                            })
                            .show();
                }

                return true;
            }
        });
        return view;
    }

    private void getData() {
        controllerItems.clear();
        List<DeviceItem> deviceItems =  DeviceController.getInstance().getDevice();
        for (int i = 0; i < deviceItems.size(); i++ ){
            DeviceItem d = deviceItems.get(i);
            if (d.isSensor())
                continue;

            ControllerItem s = new ControllerItem();
            s.setDeviceItem(d);

            switch (d.getDeviceType()){
                case "switch":
                    d.setDeviceType("开关");
                    s.setData("OFF");
                    break;
                case "slide":
                    d.setDeviceType("滑动条");
                    s.setData("0%");
                    break;
                case "color":
                    d.setDeviceType("颜色");
                    s.setData("#ffffff");
                    break;
            }

            controllerItems.add(s);
        }
        if(controllerAdapter!=null)
            controllerAdapter.notifyDataSetChanged();
    }

    @Override
    public void onColorSelection(@NonNull ColorChooserDialog dialog, int selectedColor) {
        CommonUtils.showMessage(getContext(), selectedColor+"");
    }

    @Override
    public void onColorChooserDismissed(@NonNull ColorChooserDialog dialog) {

    }
}
