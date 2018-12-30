package com.example.bing.eqin.utils;

import android.content.Context;
import android.widget.Toast;

public class CommonUtils {
    public static void showMessage(Context context, String message) {
        Toast.makeText(context, message, Toast.LENGTH_SHORT).show();
    }
}
