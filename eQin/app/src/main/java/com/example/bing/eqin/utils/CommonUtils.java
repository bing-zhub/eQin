package com.example.bing.eqin.utils;

import android.content.Context;
import android.widget.Toast;

import com.example.bing.eqin.MainActivity;

public class CommonUtils {
    public static void showMessage(Context context, String message) {
        Toast.makeText(context,message, Toast.LENGTH_SHORT).show();
    }
}
