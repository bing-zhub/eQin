package com.example.bing.eqin.activity;

import android.Manifest;
import android.app.Activity;
import android.app.ProgressDialog;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.DialogInterface;
import android.content.Intent;
import android.content.IntentFilter;
import android.net.ConnectivityManager;
import android.net.NetworkInfo;
import android.net.wifi.WifiInfo;
import android.net.wifi.WifiManager;
import android.os.AsyncTask;
import android.os.Build;
import android.support.v7.app.AlertDialog;
import android.support.v7.app.AppCompatActivity;
import android.os.Bundle;
import android.util.Log;
import android.view.View;
import android.widget.Button;
import android.widget.EditText;
import android.widget.TextView;
import android.widget.Toast;

import com.espressif.iot.esptouch.EsptouchTask;
import com.espressif.iot.esptouch.IEsptouchListener;
import com.espressif.iot.esptouch.IEsptouchResult;
import com.espressif.iot.esptouch.IEsptouchTask;
import com.espressif.iot.esptouch.task.__IEsptouchTask;
import com.espressif.iot.esptouch.util.ByteUtil;
import com.espressif.iot.esptouch.util.EspAES;
import com.espressif.iot.esptouch.util.EspNetUtil;
import com.example.bing.eqin.R;
import com.example.bing.eqin.utils.EspUtils;
import com.yanzhenjie.permission.AndPermission;

import java.lang.ref.WeakReference;
import java.net.InetAddress;
import java.util.List;

public class EspTouchActivity extends AppCompatActivity implements View.OnClickListener {

    private static final String TAG = "EspTouchActivity.this";
    private InetAddress Return_Address;

    private static final boolean AES_ENABLE = false;//是否验证KEY，false为不验证
    private static final String AES_SECRET_KEY = "1234567890123456"; // TODO modify your own key
    private static final int CALL_PHONE_REQUEST_CODE = 0;

    private TextView mApSsidTV;
    private TextView mApBssidTV;
    private EditText mApPasswordET;
    private EditText mDeviceCountET;
    private WifiManager mWifiManager;
    private Button mConfirmBtn;

    private IEsptouchListener myListener = new IEsptouchListener() {

        @Override
        public void onEsptouchResultAdded(final IEsptouchResult result) {
            onEsptoucResultAddedPerform(result);
        }
    };

    private EsptouchAsyncTask4 mTask;

    private BroadcastReceiver mReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            String action = intent.getAction();
            if (action == null) {
                return;
            }

            if(WifiManager.NETWORK_STATE_CHANGED_ACTION.equals(action)){
                NetworkInfo networkInfo = intent.getParcelableExtra(WifiManager.EXTRA_NETWORK_INFO);
                if(ConnectivityManager.TYPE_WIFI == networkInfo.getType()){
                    WifiManager wifiManager = (WifiManager) getApplicationContext().getSystemService(Context.WIFI_SERVICE);
                    WifiInfo info = wifiManager.getConnectionInfo();
                    onWifiChanged(info);
                }
            }
        }
    };


    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_esp_touch);

        AndPermission.with(this)
                .runtime()
                .permission(Manifest.permission.CHANGE_NETWORK_STATE)
                .permission(Manifest.permission.CHANGE_WIFI_STATE)
                .permission(Manifest.permission.ACCESS_NETWORK_STATE)
                .permission(Manifest.permission.ACCESS_WIFI_STATE)
                .permission(Manifest.permission.INTERNET)
                .permission(Manifest.permission.ACCESS_FINE_LOCATION)
                .permission(Manifest.permission.ACCESS_COARSE_LOCATION)
                .start();



        mWifiManager= (WifiManager)getApplicationContext().getSystemService(Context.WIFI_SERVICE);
        mApSsidTV = findViewById(R.id.ap_ssid_text);
        mApBssidTV = findViewById(R.id.ap_bssid_text);
        mApPasswordET = findViewById(R.id.ap_password_edit);
        mDeviceCountET = findViewById(R.id.device_count_edit);
        mDeviceCountET.setText("1");
        mConfirmBtn = findViewById(R.id.confirm_btn);
        mConfirmBtn.setEnabled(false);
        mConfirmBtn.setOnClickListener(this);
        // wifi连接监听
        IntentFilter filter = new IntentFilter(WifiManager.NETWORK_STATE_CHANGED_ACTION);
        registerReceiver(mReceiver, filter);

    }


    @Override
    protected void onDestroy() {
        super.onDestroy();

        unregisterReceiver(mReceiver);
    }

    private void onWifiChanged(WifiInfo info) {
        if (info == null) {
            mApSsidTV.setText("");
            mApSsidTV.setTag(null);
            mApBssidTV.setTag("");
            mConfirmBtn.setEnabled(false);
            mConfirmBtn.setTag(null);

            if (mTask != null) {
                mTask.cancelEsptouch();
                mTask = null;
                new AlertDialog.Builder(EspTouchActivity.this)
                        .setMessage("Wifi disconnected or changed")
                        .setNegativeButton(android.R.string.cancel, null)
                        .show();
            }
        } else {
            String ssid = info.getSSID();
            Log.d("wifiChange", ssid);
            if (ssid.startsWith("\"") && ssid.endsWith("\"")) {
                ssid = ssid.substring(1, ssid.length() - 1);
            }
            mApSsidTV.setText(ssid);
            mApSsidTV.setTag(ByteUtil.getBytesByString(ssid));
            byte[] ssidOriginalData = EspUtils.getOriginalSsidBytes(info);
            mApSsidTV.setTag(ssidOriginalData);

            String bssid = info.getBSSID();
            mApBssidTV.setText(bssid);

            mConfirmBtn.setEnabled(true);
            mConfirmBtn.setTag(Boolean.FALSE);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                int frequence = info.getFrequency();
                if (frequence > 4900 && frequence < 5900) {
                    // Connected 5G wifi. Device does not support 5G
                    mConfirmBtn.setTag(Boolean.TRUE);
                }
            }
        }
    }

    @Override
    public void onClick(View v) {
        if (v == mConfirmBtn) {
            if ((Boolean) mConfirmBtn.getTag()) {
                Toast.makeText(this, "5g网络暂不支持", Toast.LENGTH_SHORT).show();
                return;
            }

            byte[] ssid = mApSsidTV.getTag() == null ? ByteUtil.getBytesByString(mApSsidTV.getText().toString())
                    : (byte[]) mApSsidTV.getTag();
            byte[] password = ByteUtil.getBytesByString(mApPasswordET.getText().toString());
            byte [] bssid = EspNetUtil.parseBssid2bytes(mApBssidTV.getText().toString());
            byte[] deviceCount = mDeviceCountET.getText().toString().getBytes();

            if(mTask != null) {
                mTask.cancelEsptouch();
            }
            mTask = new EsptouchAsyncTask4(EspTouchActivity.this);
            mTask.execute(ssid, bssid, password, deviceCount);
        }
    }

    private void onEsptoucResultAddedPerform(final IEsptouchResult result) {
        runOnUiThread(new Runnable() {
            @Override
            public void run() {
                String text = result.getBssid() + " is connected to the wifi";
                Return_Address = result.getInetAddress();
                Log.e(TAG,"返回的id:"+Return_Address);
                Log.e(TAG,"返回信息:"+Return_Address);
                Toast.makeText(EspTouchActivity.this, text, Toast.LENGTH_LONG).show();
            }
        });
    }

    private static class EsptouchAsyncTask4 extends AsyncTask<byte[], Void, List<IEsptouchResult>> {
        private WeakReference<EspTouchActivity> mActivity;

        private final Object mLock = new Object();
        private ProgressDialog mProgressDialog;
        private AlertDialog mResultDialog;
        private IEsptouchTask mEsptouchTask;

        EsptouchAsyncTask4(EspTouchActivity activity) {
            mActivity = new WeakReference<>(activity);
        }

        void cancelEsptouch() {
            cancel(true);
            if (mProgressDialog != null) {
                mProgressDialog.dismiss();
            }
            if (mResultDialog != null) {
                mResultDialog.dismiss();
            }
            if (mEsptouchTask != null) {
                mEsptouchTask.interrupt();
            }
        }

        @Override
        protected void onPreExecute() {
            Activity activity = mActivity.get();
            mProgressDialog = new ProgressDialog(activity);
            mProgressDialog.setMessage("正在配置请稍等...");
            mProgressDialog.setCanceledOnTouchOutside(false);
            mProgressDialog.setOnCancelListener(new DialogInterface.OnCancelListener() {
                @Override
                public void onCancel(DialogInterface dialog) {
                    synchronized (mLock) {
                        if (__IEsptouchTask.DEBUG) {
                            Log.i(TAG, "progress dialog back pressed canceled");
                        }
                        if (mEsptouchTask != null) {
                            mEsptouchTask.interrupt();
                        }
                    }
                }
            });
            mProgressDialog.setButton(DialogInterface.BUTTON_NEGATIVE, activity.getText(android.R.string.cancel),
                    new DialogInterface.OnClickListener() {
                        @Override
                        public void onClick(DialogInterface dialog, int which) {
                            synchronized (mLock) {
                                if (__IEsptouchTask.DEBUG) {
                                    Log.i(TAG, "progress dialog cancel button canceled");
                                }
                                if (mEsptouchTask != null) {
                                    mEsptouchTask.interrupt();
                                }
                            }
                        }
                    });
            mProgressDialog.show();
        }

        @Override
        protected List<IEsptouchResult> doInBackground(byte[]... params) {
            EspTouchActivity activity = mActivity.get();
            int taskResultCount;
            synchronized (mLock) {
                // !!!NOTICE
                byte[] apSsid = params[0];
                byte[] apBssid = params[1];
                byte[] apPassword = params[2];
                byte[] deviceCountData = params[3];
                taskResultCount = deviceCountData.length == 0 ? -1 : Integer.parseInt(new String(deviceCountData));
                Context context = activity.getApplicationContext();
                if (AES_ENABLE) {
                    byte[] secretKey = AES_SECRET_KEY.getBytes();
                    EspAES aes = new EspAES(secretKey);
                    mEsptouchTask = new EsptouchTask(apSsid, apBssid, apPassword, aes, context);
                } else {
                    mEsptouchTask = new EsptouchTask(apSsid, apBssid, apPassword, null, context);
                }
                mEsptouchTask.setEsptouchListener(activity.myListener);
            }
            return mEsptouchTask.executeForResults(taskResultCount);
        }

        @Override
        protected void onPostExecute(List<IEsptouchResult> result) {
            EspTouchActivity activity = mActivity.get();
            mProgressDialog.dismiss();
            mResultDialog = new AlertDialog.Builder(activity)
                    .setPositiveButton(android.R.string.ok, null)
                    .create();
            mResultDialog.setCanceledOnTouchOutside(false);
            if (result == null) {
                mResultDialog.setMessage("创建连接失败，连接端口可能被其他线程使用！");
                mResultDialog.show();
                return;
            }

            IEsptouchResult firstResult = result.get(0);
            if (!firstResult.isCancelled()) {
                int count = 0;
                final int maxDisplayCount = 5;
                if (firstResult.isSuc()) {
                    StringBuilder sb = new StringBuilder();
                    for (IEsptouchResult resultInList : result) {
                        sb.append("Esptouch success, bssid = ")
                                .append(resultInList.getBssid())
                                .append(", InetAddress = ")
                                .append(resultInList.getInetAddress().getHostAddress())
                                .append("\n");
                        count++;
                        if (count >= maxDisplayCount) {
                            break;
                        }
                    }
                    if (count < result.size()) {
                        sb.append("\nthere's ")
                                .append(result.size() - count)
                                .append(" more result(s) without showing\n");
                    }
                    mResultDialog.setMessage(sb.toString());
                } else {
                    mResultDialog.setMessage("连接失败");
                }

                mResultDialog.show();
            }

            activity.mTask = null;
        }
    }
}
