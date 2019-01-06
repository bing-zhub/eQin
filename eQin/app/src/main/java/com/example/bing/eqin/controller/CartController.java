package com.example.bing.eqin.controller;

import android.content.Context;
import android.util.Log;

import com.example.bing.eqin.model.CartItem;
import com.example.bing.eqin.model.StoreItem;
import com.example.bing.eqin.utils.CommonUtils;
import com.parse.DeleteCallback;
import com.parse.FindCallback;
import com.parse.Parse;
import com.parse.ParseException;
import com.parse.ParseObject;
import com.parse.ParseQuery;
import com.parse.ParseUser;
import com.parse.SaveCallback;

import java.util.List;

public class CartController {
    private static  CartController mInstance;

    public static CartController getInstance(){
        if(mInstance == null){
            mInstance = new CartController();
        }
        return mInstance;
    }

    public void addToCart(StoreItem item, final Context context){

        ParseQuery<ParseObject> query = ParseQuery.getQuery("UserCart");
        query.whereEqualTo("Product", item.getItemName());
        try {
            if(query.find().size()!=0){
                CommonUtils.showMessage(context, "已经存在于购物车, 无需重复添加");
                return;
            }
        } catch (ParseException e) {
            e.printStackTrace();
        }

        ParseObject parseObject = new ParseObject("UserCart");
        parseObject.put("Product", item.getItemName());
        parseObject.put("User", ParseUser.getCurrentUser());
        parseObject.put("Num", 1);
        parseObject.saveInBackground(new SaveCallback() {
            @Override
            public void done(ParseException e) {
                if(e==null)
                    CommonUtils.showMessage(context, "已经添加到购物车");
            }
        });
    }

    public void removeFromCart(CartItem cartItem, final Context context){
        ParseQuery<ParseObject> query = ParseQuery.getQuery("UserCart");
        query.whereEqualTo("User", ParseUser.getCurrentUser());
        query.whereEqualTo("Product", cartItem.getProduct().getItemName());
        Log.d("removeCart", ""+cartItem);
        query.findInBackground(new FindCallback<ParseObject>() {
            @Override
            public void done(List<ParseObject> objects, ParseException e) {
                if(e==null && objects.size() !=0){
                    ParseObject object = objects.get(0);
                    object.deleteInBackground(new DeleteCallback() {
                        @Override
                        public void done(ParseException e) {
                            if(e==null){
                                CommonUtils.showMessage(context, "删除成功");
                            }
                        }
                    });
                }
            }
        });
    }

    public void modItemNum(String product, final boolean isPlus){
        ParseQuery<ParseObject> query = ParseQuery.getQuery("UserCart");
        query.whereEqualTo("user",ParseUser.getCurrentUser());
        query.whereEqualTo("product", product);
        query.findInBackground(new FindCallback<ParseObject>() {
            @Override
            public void done(List<ParseObject> objects, ParseException e) {
                if(e==null)
                    if(objects!=null && objects.size()==1){
                        ParseObject o = objects.get(0);
                        if(isPlus)
                            o.increment("num",1);
                        else
                           o.increment("num",-1);
                    }
            }
        });
    }
}
